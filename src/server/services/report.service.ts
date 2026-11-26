import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { isoDate } from "@/lib/validation/common";
import { addDays, addMonths, dateOnly, toISODate, todayInTz, withDayOfMonth } from "@/lib/dates";
import { AGING_BUCKETS, agingBucket, type AgingKey } from "@/server/domain/ledger";
import { OCCUPANCY_DEFINITION, calculateOccupancy } from "@/server/domain/occupancy";
import { leaseDisplayStatus } from "@/server/domain/lease-rules";
import { leaseCreditPositions, queryChargeBalances } from "./ledger-queries";
import { scopeIds } from "./rent.service";

export const arrearsQuerySchema = z.object({ asOf: isoDate.optional(), propertyId: z.string().uuid().optional() });
export const periodQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional(), propertyId: z.string().uuid().optional() });

export const COLLECTION_RATE_DEFINITION =
  "Collection rate = confirmed payments allocated to charges DUE in the period ÷ total charges due in the period × 100. Cash received is shown separately because it can relate to earlier arrears or advance rent.";
export const ARREARS_DEFINITION =
  "Arrears = positive balances (charge − confirmed allocations − credits) on charges due BEFORE the as-at date. Future charges and pending/reversed payments are excluded. Balances reflect all confirmed allocations recorded to date.";

function scopeFor(ctx: RequestContext, propertyId?: string) {
  if (propertyId) { requirePropertyAccess(ctx, propertyId); return { propertyId, propertyIds: null }; }
  return { propertyId: undefined, propertyIds: scopeIds(ctx) };
}

function reportMeta(ctx: RequestContext, filters: Record<string, unknown>, definition?: string) {
  return { generatedAt: new Date().toISOString(), timezone: ctx.timezone, currency: ctx.currency, organization: ctx.organizationName, filters, definition };
}

export async function arrearsReport(ctx: RequestContext, rawQ: z.input<typeof arrearsQuerySchema>) {
  const q = arrearsQuerySchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "report.financial.read");
  const asOf = q.asOf ?? todayInTz(ctx.timezone);
  const scope = scopeFor(ctx, q.propertyId);
  const open = await queryChargeBalances(prisma, { organizationId: ctx.organizationId, ...scope, dueBefore: asOf, openOnly: true }, asOf);
  const leases = await prisma.lease.findMany({
    where: { id: { in: [...new Set(open.map((o) => o.leaseId))] } },
    select: { id: true, leaseRef: true, status: true, unit: { select: { unitRef: true } }, property: { select: { id: true, name: true } }, parties: { where: { isPrimary: true }, select: { tenant: { select: { id: true, displayName: true, phone: true } } } } },
  });
  const credits = await leaseCreditPositions(prisma, ctx.organizationId, leases.map((l) => l.id));
  type Row = { leaseId: string; leaseRef: string; leaseStatus: string; tenantId: string; tenantName: string; tenantPhone: string | null; propertyId: string; propertyName: string; unitRef: string; buckets: Record<AgingKey, number>; totalMinor: number; unappliedCreditMinor: number; oldestDueDate: string; chargeCount: number };
  const rows = new Map<string, Row>();
  const totals: Record<AgingKey, number> = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const c of open) {
    const bucket = agingBucket(c.dueDate, asOf);
    if (!bucket) continue;
    const l = leases.find((x) => x.id === c.leaseId)!;
    let r = rows.get(c.leaseId);
    if (!r) {
      const t = l.parties[0]?.tenant;
      r = { leaseId: l.id, leaseRef: l.leaseRef, leaseStatus: l.status, tenantId: t?.id ?? c.tenantId, tenantName: t?.displayName ?? "—", tenantPhone: t?.phone ?? null, propertyId: l.property.id, propertyName: l.property.name, unitRef: l.unit.unitRef, buckets: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }, totalMinor: 0, unappliedCreditMinor: credits.get(l.id)?.unappliedMinor ?? 0, oldestDueDate: c.dueDate, chargeCount: 0 };
      rows.set(c.leaseId, r);
    }
    r.buckets[bucket] += c.balanceMinor; r.totalMinor += c.balanceMinor; r.chargeCount++;
    if (c.dueDate < r.oldestDueDate) r.oldestDueDate = c.dueDate;
    totals[bucket] += c.balanceMinor;
  }
  const list = [...rows.values()].sort((a, b) => b.totalMinor - a.totalMinor);
  const byProperty = new Map<string, { propertyId: string; propertyName: string; totalMinor: number; accounts: number }>();
  for (const r of list) {
    const p = byProperty.get(r.propertyId) ?? { propertyId: r.propertyId, propertyName: r.propertyName, totalMinor: 0, accounts: 0 };
    p.totalMinor += r.totalMinor; p.accounts++; byProperty.set(r.propertyId, p);
  }
  return {
    asOf, rows: list, totals: { ...totals, totalMinor: Object.values(totals).reduce((s, v) => s + v, 0), overdueAccounts: list.length },
    byProperty: [...byProperty.values()].sort((a, b) => b.totalMinor - a.totalMinor),
    buckets: AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label })),
    meta: reportMeta(ctx, { asOf, propertyId: q.propertyId ?? "all in scope" }, ARREARS_DEFINITION),
  };
}

export async function collectionSummary(ctx: RequestContext, rawQ: z.input<typeof periodQuerySchema>) {
  const q = periodQuerySchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "report.financial.read");
  const today = todayInTz(ctx.timezone);
  const from = q.from ?? withDayOfMonth(today, 1);
  const to = q.to ?? addDays(addMonths(from, 1), -1);
  const scope = scopeFor(ctx, q.propertyId);
  const due = await queryChargeBalances(prisma, { organizationId: ctx.organizationId, ...scope, dueFrom: from, dueTo: to }, today);
  const billed = due.reduce((s, c) => s + c.amountMinor, 0);
  const collectedAgainst = due.reduce((s, c) => s + c.paidMinor, 0);
  const credited = due.reduce((s, c) => s + c.creditedMinor, 0);

  const propCond = scope.propertyId ? Prisma.sql`AND l.property_id = ${scope.propertyId}::uuid`
    : scope.propertyIds ? (scope.propertyIds.length ? Prisma.sql`AND l.property_id IN (${Prisma.join(scope.propertyIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.sql`AND FALSE`) : Prisma.empty;
  const [cash] = await prisma.$queryRaw<[{ total: bigint | null; n: bigint }]>`
    SELECT SUM(p.amount_minor)::bigint AS total, COUNT(*)::bigint AS n FROM payments p JOIN leases l ON l.id = p.lease_id
    WHERE p.organization_id = ${ctx.organizationId}::uuid AND p.status = 'confirmed' AND p.received_at BETWEEN ${from}::date AND ${to}::date ${propCond}`;
  const [pending] = await prisma.$queryRaw<[{ total: bigint | null; n: bigint }]>`
    SELECT SUM(p.amount_minor)::bigint AS total, COUNT(*)::bigint AS n FROM payments p JOIN leases l ON l.id = p.lease_id
    WHERE p.organization_id = ${ctx.organizationId}::uuid AND p.status = 'pending' ${propCond}`;

  // Trend: last 6 months, billed (by due date) vs cash received (by received date).
  const trendStart = withDayOfMonth(addMonths(today, -5), 1);
  const trendCharges = await queryChargeBalances(prisma, { organizationId: ctx.organizationId, ...scope, dueFrom: trendStart, dueTo: addDays(addMonths(withDayOfMonth(today, 1), 1), -1) }, today);
  const trendCash = await prisma.$queryRaw<Array<{ month: string; total: bigint }>>`
    SELECT to_char(p.received_at, 'YYYY-MM') AS month, SUM(p.amount_minor)::bigint AS total FROM payments p JOIN leases l ON l.id = p.lease_id
    WHERE p.organization_id = ${ctx.organizationId}::uuid AND p.status = 'confirmed' AND p.received_at >= ${trendStart}::date ${propCond}
    GROUP BY 1 ORDER BY 1`;
  const trend = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(trendStart, i).slice(0, 7);
    const ch = trendCharges.filter((c) => c.dueDate.startsWith(m));
    return { month: m, billedMinor: ch.reduce((s, c) => s + c.amountMinor, 0), collectedAgainstMinor: ch.reduce((s, c) => s + c.paidMinor, 0), cashReceivedMinor: Number(trendCash.find((t) => t.month === m)?.total ?? 0) };
  });

  const upcoming = await queryChargeBalances(prisma, { organizationId: ctx.organizationId, ...scope, dueFrom: today, dueTo: addDays(today, 30), openOnly: true }, today);
  const credits = await leaseCreditPositions(prisma, ctx.organizationId);
  let prepaid = 0;
  if (scope.propertyId || scope.propertyIds) {
    const ids = (await prisma.lease.findMany({ where: { organizationId: ctx.organizationId, ...(scope.propertyId ? { propertyId: scope.propertyId } : { propertyId: { in: scope.propertyIds! } }) }, select: { id: true } })).map((l) => l.id);
    for (const id of ids) prepaid += credits.get(id)?.unappliedMinor ?? 0;
  } else for (const c of credits.values()) prepaid += c.unappliedMinor;

  return {
    period: { from, to },
    billedMinor: billed,
    collectedAgainstPeriodMinor: collectedAgainst,
    creditedMinor: credited,
    collectionRate: billed === 0 ? null : Math.round((collectedAgainst / billed) * 1000) / 10,
    cashReceivedMinor: Number(cash.total ?? 0), cashReceiptsCount: Number(cash.n),
    pendingPaymentsMinor: Number(pending.total ?? 0), pendingPaymentsCount: Number(pending.n),
    upcomingDueMinor: upcoming.reduce((s, c) => s + c.balanceMinor, 0), upcomingDueCount: upcoming.length,
    prepaidBalancesMinor: prepaid,
    trend,
    meta: reportMeta(ctx, { from, to, propertyId: q.propertyId ?? "all in scope" }, COLLECTION_RATE_DEFINITION),
  };
}

export async function portfolioOverview(ctx: RequestContext, q: { propertyId?: string }) {
  requireStaff(ctx);
  requirePermission(ctx, "property.read");
  const today = todayInTz(ctx.timezone);
  const propWhere: Prisma.PropertyWhereInput = { organizationId: ctx.organizationId, status: { not: "archived" }, ...(q.propertyId ? { id: q.propertyId } : ctx.scopeAllProperties ? {} : { id: { in: [...ctx.propertyIds] } }) };
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const props = await prisma.property.findMany({ where: propWhere, select: { id: true } });
  const ids = props.map((p) => p.id);
  const [units, leases] = await Promise.all([
    prisma.unit.findMany({ where: { organizationId: ctx.organizationId, propertyId: { in: ids } }, select: { id: true, availability: true, archivedAt: true } }),
    prisma.lease.findMany({ where: { organizationId: ctx.organizationId, propertyId: { in: ids }, status: "active" }, select: { id: true, leaseRef: true, unitId: true, status: true, startDate: true, endDate: true, unit: { select: { unitRef: true } }, property: { select: { name: true } }, parties: { where: { isPrimary: true }, select: { tenant: { select: { displayName: true } } } } } }),
  ]);
  const ls = leases.map((l) => ({ ...l, startDate: toISODate(l.startDate), endDate: toISODate(l.endDate) }));
  const occupancy = calculateOccupancy(units, ls, today);
  const expiring = (days: number) => ls.filter((l) => l.startDate <= today && l.endDate >= today && l.endDate <= addDays(today, days));
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { leaseExpiryWarningDays: true } });
  return {
    asOf: today,
    totalProperties: ids.length,
    occupancy,
    leasesExpiring: { d30: expiring(30).length, d60: expiring(60).length, d90: expiring(90).length },
    expiringSoon: expiring(90).sort((a, b) => a.endDate.localeCompare(b.endDate)).slice(0, 8).map((l) => ({
      id: l.id, leaseRef: l.leaseRef, endDate: l.endDate, unitRef: l.unit.unitRef, propertyName: l.property.name,
      tenantName: l.parties[0]?.tenant.displayName ?? "—", displayStatus: leaseDisplayStatus(l, today, org.leaseExpiryWarningDays),
    })),
    definitions: { occupancy: OCCUPANCY_DEFINITION },
  };
}

export async function rentRoll(ctx: RequestContext, q: { propertyId?: string }) {
  requireStaff(ctx);
  requirePermission(ctx, "report.financial.read");
  const today = todayInTz(ctx.timezone);
  const scope = scopeFor(ctx, q.propertyId);
  const units = await prisma.unit.findMany({
    where: { organizationId: ctx.organizationId, archivedAt: null, ...(scope.propertyId ? { propertyId: scope.propertyId } : scope.propertyIds ? { propertyId: { in: scope.propertyIds } } : {}) },
    include: { property: { select: { name: true } }, leases: { where: { status: "active", startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) } }, include: { parties: { where: { isPrimary: true }, include: { tenant: { select: { displayName: true } } } } } } },
    orderBy: [{ property: { name: "asc" } }, { unitRef: "asc" }],
  });
  const balances = await queryChargeBalances(prisma, { organizationId: ctx.organizationId, ...scope, openOnly: true }, today);
  const rows = units.map((u) => {
    const l = u.leases[0];
    return {
      propertyName: u.property.name, unitRef: u.unitRef, unitType: u.unitType, status: l ? "occupied" : u.availability === "available" ? "vacant" : u.availability,
      tenantName: l?.parties[0]?.tenant.displayName ?? null, leaseRef: l?.leaseRef ?? null,
      leaseStart: l ? toISODate(l.startDate) : null, leaseEnd: l ? toISODate(l.endDate) : null,
      rentMinor: l?.rentAmountMinor ?? null, frequency: l?.billingFrequency ?? null, askingRentMinor: u.askingRentMinor,
      balanceMinor: l ? balances.filter((b) => b.leaseId === l.id).reduce((s, b) => s + b.balanceMinor, 0) : 0,
    };
  });
  return { rows, meta: reportMeta(ctx, { asOf: today, propertyId: q.propertyId ?? "all in scope" }) };
}
