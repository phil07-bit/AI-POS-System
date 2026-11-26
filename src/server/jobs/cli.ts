/**
 * Scheduled jobs (spec §11). Run by cron / a scheduler, e.g. daily at 02:00 Africa/Accra:
 *   npm run jobs:run -- all            # expire leases, generate charges, refresh statuses
 *   npm run jobs:run -- generate-charges [--org <id>]
 *   npm run jobs:run -- expire-leases
 *   npm run jobs:run -- refresh-statuses
 * Every job is idempotent (safe to re-run) and records a row in job_runs.
 * Jobs act as the "system" actor: audit rows carry userId = null, userName = "System job".
 */
import { prisma } from "@/lib/db";
import { addDays, todayInTz } from "@/lib/dates";
import { generateChargesForLeaseTx } from "@/server/services/rent.service";
import { expireEndedLeases } from "@/server/services/lease.service";
import { refreshChargeStatuses } from "@/server/services/ledger-queries";
import { log } from "@/lib/logging";

type Counts = Record<string, number>;

async function forEachOrg(orgFilter: string | undefined, fn: (org: { id: string; timezone: string; chargeGenerationHorizonDays: number; isDemo: boolean }) => Promise<Counts>) {
  const orgs = await prisma.organization.findMany({
    where: { status: "active", ...(orgFilter ? { id: orgFilter } : {}) },
    select: { id: true, timezone: true, chargeGenerationHorizonDays: true, isDemo: true },
  });
  const total: Counts = { organizations: orgs.length };
  for (const org of orgs) {
    const c = await fn(org);
    for (const [k, v] of Object.entries(c)) total[k] = (total[k] ?? 0) + v;
  }
  return total;
}

const jobs: Record<string, (orgId?: string) => Promise<Counts>> = {
  "expire-leases": (orgId) => forEachOrg(orgId, async (org) => ({ leasesExpired: await expireEndedLeases(org.id, todayInTz(org.timezone)) })),

  "generate-charges": (orgId) => forEachOrg(orgId, async (org) => {
    const horizon = addDays(todayInTz(org.timezone), org.chargeGenerationHorizonDays);
    const actor = { organizationId: org.id, userId: null as unknown as string, userName: "System job", requestId: `job-${Date.now()}`, isDemoOrg: org.isDemo };
    const leases = await prisma.lease.findMany({ where: { organizationId: org.id, status: "active" }, select: { id: true } });
    let created = 0, failed = 0;
    for (const l of leases) {
      try { created += (await prisma.$transaction((tx) => generateChargesForLeaseTx(tx, actor, l.id, horizon))).created; }
      catch (e) { failed++; log("error", "job.generate_charges.lease_failed", { leaseId: l.id, error: String(e) }); }
    }
    return { leasesScanned: leases.length, chargesCreated: created, leasesFailed: failed };
  }),

  "refresh-statuses": (orgId) => forEachOrg(orgId, async (org) => {
    // Due → overdue transitions happen with the passage of time, so the cached status must be refreshed daily.
    const ids = (await prisma.rentCharge.findMany({ where: { organizationId: org.id, status: { in: ["due", "partially_paid", "overdue"] } }, select: { id: true } })).map((c) => c.id);
    await refreshChargeStatuses(prisma, org.id, ids, todayInTz(org.timezone));
    return { chargesRefreshed: ids.length };
  }),
};

async function run(name: string, orgId?: string) {
  const fn = jobs[name];
  if (!fn) throw new Error(`Unknown job "${name}". Known: ${Object.keys(jobs).join(", ")}, all`);
  const row = await prisma.jobRun.create({ data: { jobName: name, status: "running" } });
  try {
    const counts = await fn(orgId);
    await prisma.jobRun.update({ where: { id: row.id }, data: { status: "succeeded", countsJson: counts, finishedAt: new Date() } });
    console.log(`${name}: ok`, counts);
  } catch (e) {
    await prisma.jobRun.update({ where: { id: row.id }, data: { status: "failed", error: String(e), finishedAt: new Date() } });
    throw e;
  }
}

async function main() {
  const [name = "all", ...rest] = process.argv.slice(2);
  const orgIdx = rest.indexOf("--org");
  const orgId = orgIdx >= 0 ? rest[orgIdx + 1] : undefined;
  const order = name === "all" ? ["expire-leases", "generate-charges", "refresh-statuses"] : [name];
  for (const n of order) await run(n, orgId);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
