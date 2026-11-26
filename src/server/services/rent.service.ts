import { z } from "zod";
import { prisma, Prisma, type Tx } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { AppError, businessRule, notFound } from "@/lib/api/errors";
import { isoDate, minorAmount, optionalText, paginationSchema } from "@/lib/validation/common";
import { addDays, dateOnly, toISODate, todayInTz } from "@/lib/dates";
import { buildRentSchedule } from "@/server/domain/rent-schedule";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";
import { queryChargeBalances, refreshChargeStatuses, type ChargeBalanceRow } from "./ledger-queries";

export const CHARGE_TYPES = ["rent", "service_charge", "utility", "other"] as const;

export const manualChargeSchema = z.object({
  leaseId: z.string().uuid(),
  chargeType: z.enum(CHARGE_TYPES),
  periodStart: isoDate,
  periodEnd: isoDate,
  dueDate: isoDate,
  amountMinor: minorAmount,
  description: optionalText(500),
}).refine((v) => v.periodEnd >= v.periodStart, { path: ["periodEnd"], message: "Period end must be on or after period start." });

export const generateSchema = z.object({
  leaseId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  upTo: isoDate.optional(), // horizon: generate periods starting on/before this date
});

export const chargeListSchema = paginationSchema.extend({
  status: z.enum(["due", "partially_paid", "paid", "overdue", "void", "open"]).optional(),
  propertyId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  leaseId: z.string().uuid().optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
});

/**
 * Generate charges for one ACTIVE lease up to `horizon`. Idempotent: the unique key
 * (lease_id, charge_type, period_start) means re-running never duplicates; existing periods are skipped.
 */
export async function generateChargesForLeaseTx(tx: Tx, actor: Pick<RequestContext, "organizationId" | "userId" | "userName" | "requestId" | "isDemoOrg">, leaseId: string, horizon: string) {
  const lease = await tx.lease.findFirst({ where: { id: leaseId, organizationId: actor.organizationId }, include: { parties: { where: { isPrimary: true } } } });
  if (!lease) throw notFound("Lease");
  if (lease.status !== "active") return { created: 0, skipped: 0 };
  const primary = lease.parties[0];
  if (!primary) throw businessRule("Lease has no primary tenant.");
  const schedule = buildRentSchedule({
    startDate: toISODate(lease.startDate), endDate: toISODate(lease.endDate), rentAmountMinor: lease.rentAmountMinor,
    billingFrequency: lease.billingFrequency, dueDay: lease.dueDay,
  }, horizon);
  if (!schedule.length) return { created: 0, skipped: 0 };
  const existing = await tx.rentCharge.findMany({ where: { leaseId, chargeType: "rent" }, select: { periodStart: true } });
  const have = new Set(existing.map((e) => toISODate(e.periodStart)));
  const missing = schedule.filter((s) => !have.has(s.periodStart));
  let created = 0;
  for (const s of missing) {
    const ref = await nextRef(tx, actor.organizationId, "CHG", { year: true, pad: 5 });
    const res = await tx.rentCharge.createMany({
      data: [{
        organizationId: actor.organizationId, leaseId, tenantId: primary.tenantId, propertyId: lease.propertyId, unitId: lease.unitId,
        chargeRef: ref, chargeType: "rent", periodStart: dateOnly(s.periodStart), periodEnd: dateOnly(s.periodEnd), dueDate: dateOnly(s.dueDate),
        amountMinor: s.amountMinor, currency: lease.currency, status: "due", source: "generated",
        description: `Rent ${s.periodStart} to ${s.periodEnd}${s.prorated ? " (pro-rated)" : ""}`,
        idempotencyKey: `gen:${leaseId}:rent:${s.periodStart}`, createdById: actor.userId,
      }],
      skipDuplicates: true, // concurrent generator lost the race → no duplicate
    });
    created += res.count;
  }
  if (created) {
    const ids = (await tx.rentCharge.findMany({ where: { leaseId, source: "generated" }, select: { id: true } })).map((c) => c.id);
    await refreshChargeStatuses(tx, actor.organizationId, ids, todayInTz());
    await recordAudit(tx, actor, { action: "rent.charges_generated", entityType: "lease", entityId: leaseId, summary: `Generated ${created} rent charge(s) for ${lease.leaseRef}`, metadata: { horizon, created } });
  }
  return { created, skipped: schedule.length - missing.length };
}

export async function generateCharges(ctx: RequestContext, rawInput: z.input<typeof generateSchema>) {
  const input = generateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "rent.charge.create");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const horizon = input.upTo ?? addDays(todayInTz(ctx.timezone), org.chargeGenerationHorizonDays);
  if (input.propertyId) requirePropertyAccess(ctx, input.propertyId);
  const leases = await prisma.lease.findMany({
    where: {
      organizationId: ctx.organizationId, status: "active",
      ...(input.leaseId ? { id: input.leaseId } : {}),
      ...(input.propertyId ? { propertyId: input.propertyId } : ctx.scopeAllProperties ? {} : { propertyId: { in: [...ctx.propertyIds] } }),
    },
    select: { id: true, propertyId: true },
  });
  if (input.leaseId && !leases.length) throw businessRule("Charges can only be generated for an active lease in your scope.");
  let created = 0, skipped = 0;
  for (const l of leases) {
    requirePropertyAccess(ctx, l.propertyId);
    const r = await prisma.$transaction((tx) => generateChargesForLeaseTx(tx, ctx, l.id, horizon));
    created += r.created; skipped += r.skipped;
  }
  return { leasesProcessed: leases.length, created, skipped, horizon };
}

export async function createManualCharge(ctx: RequestContext, rawInput: z.input<typeof manualChargeSchema>) {
  const input = manualChargeSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "rent.charge.create");
  const lease = await prisma.lease.findFirst({ where: { id: input.leaseId, organizationId: ctx.organizationId }, include: { parties: { where: { isPrimary: true } } } });
  if (!lease) throw notFound("Lease");
  requirePropertyAccess(ctx, lease.propertyId);
  if (!["active", "expired", "terminated"].includes(lease.status)) throw businessRule("Charges can only be raised on active (or closed, for settlement) leases.");
  const charge = await prisma.$transaction(async (tx) => {
    const c = await tx.rentCharge.create({
      data: {
        organizationId: ctx.organizationId, leaseId: lease.id, tenantId: lease.parties[0].tenantId, propertyId: lease.propertyId, unitId: lease.unitId,
        chargeRef: await nextRef(tx, ctx.organizationId, "CHG", { year: true, pad: 5 }), chargeType: input.chargeType,
        periodStart: dateOnly(input.periodStart), periodEnd: dateOnly(input.periodEnd), dueDate: dateOnly(input.dueDate),
        amountMinor: input.amountMinor, currency: lease.currency, source: "manual", description: input.description, createdById: ctx.userId,
      },
    });
    await refreshChargeStatuses(tx, ctx.organizationId, [c.id], todayInTz(ctx.timezone));
    await recordAudit(tx, ctx, { action: "rent.charge_created", entityType: "rent_charge", entityId: c.id, summary: `Manual ${input.chargeType} charge ${c.chargeRef} on ${lease.leaseRef}`, after: c });
    return c;
  }).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("CONFLICT", `A ${input.chargeType.replace("_", " ")} charge for this lease and period start already exists.`);
    throw e;
  });
  return getCharge(ctx, charge.id);
}

export async function voidCharge(ctx: RequestContext, id: string, reason: string) {
  requireStaff(ctx);
  requirePermission(ctx, "rent.charge.void");
  if (!reason || reason.trim().length < 3) throw new AppError("VALIDATION_ERROR", "Give a reason for voiding.", [{ path: "reason", message: "Required." }]);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM rent_charges WHERE id = ${id}::uuid FOR UPDATE`;
    const c = await tx.rentCharge.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!c) throw notFound("Charge");
    requirePropertyAccess(ctx, c.propertyId);
    if (c.voidedAt) throw businessRule("Charge is already void.");
    const [bal] = await queryChargeBalances(tx, { organizationId: ctx.organizationId, chargeIds: [id] }, todayInTz(ctx.timezone));
    if (bal.paidMinor > 0 || bal.creditedMinor > 0) throw businessRule("This charge has payments or credits applied. Reverse those first, or record a credit for the remaining balance.");
    const after = await tx.rentCharge.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason.trim(), status: "void" } });
    await recordAudit(tx, ctx, { action: "rent.charge_voided", entityType: "rent_charge", entityId: id, summary: `Voided ${c.chargeRef}: ${reason}`, before: { status: c.status }, after: { status: "void" } });
    return after;
  });
}

function scopeIds(ctx: RequestContext) {
  return ctx.scopeAllProperties ? null : [...ctx.propertyIds];
}

async function decorate(ctx: RequestContext, rows: ChargeBalanceRow[]) {
  const [leases, tenants, units] = await Promise.all([
    prisma.lease.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.leaseId))] } }, select: { id: true, leaseRef: true } }),
    prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, displayName: true } }),
    prisma.unit.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.unitId))] } }, select: { id: true, unitRef: true, property: { select: { name: true } } } }),
  ]);
  const L = new Map(leases.map((l) => [l.id, l])), T = new Map(tenants.map((t) => [t.id, t])), U = new Map(units.map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, leaseRef: L.get(r.leaseId)?.leaseRef, tenantName: T.get(r.tenantId)?.displayName, unitRef: U.get(r.unitId)?.unitRef, propertyName: U.get(r.unitId)?.property.name }));
}

export async function listCharges(ctx: RequestContext, rawQ: z.input<typeof chargeListSchema>) {
  const q = chargeListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "rent.read");
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const today = todayInTz(ctx.timezone);
  let rows = await queryChargeBalances(prisma, {
    organizationId: ctx.organizationId, propertyIds: scopeIds(ctx), propertyId: q.propertyId, tenantId: q.tenantId, leaseId: q.leaseId,
    dueFrom: q.dueFrom, dueTo: q.dueTo, includeVoid: q.status === "void",
  }, today);
  if (q.status === "open") rows = rows.filter((r) => r.balanceMinor > 0);
  else if (q.status) rows = rows.filter((r) => r.status === q.status);
  rows.sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.chargeRef.localeCompare(b.chargeRef));
  const total = rows.length;
  const pageRows = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const items = await decorate(ctx, pageRows);
  const totals = rows.reduce((t, r) => ({ amount: t.amount + r.amountMinor, paid: t.paid + r.paidMinor, balance: t.balance + r.balanceMinor }), { amount: 0, paid: 0, balance: 0 });
  return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), totals };
}

export async function getCharge(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "rent.read");
  const c = await prisma.rentCharge.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!c) throw notFound("Charge");
  requirePropertyAccess(ctx, c.propertyId);
  const [row] = await queryChargeBalances(prisma, { organizationId: ctx.organizationId, chargeIds: [id], includeVoid: true }, todayInTz(ctx.timezone));
  const [decorated] = await decorate(ctx, [row]);
  const allocations = await prisma.paymentAllocation.findMany({ where: { rentChargeId: id }, include: { payment: { select: { id: true, paymentRef: true, status: true, receivedAt: true } } }, orderBy: { createdAt: "asc" } });
  const credits = await prisma.ledgerAdjustment.findMany({ where: { rentChargeId: id }, orderBy: { createdAt: "asc" } });
  return { ...decorated, voidReason: c.voidReason, source: c.source, allocations, credits };
}

export { scopeIds };
