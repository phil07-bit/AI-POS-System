import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { validationError } from "@/lib/api/errors";
import { isoDate } from "@/lib/validation/common";
import { propertyScopeFilter } from "@/lib/permissions";
import { addDays, dateOnly, toISODate, todayInTz } from "@/lib/dates";
import { OPEN_REQUEST_STATUSES, OPEN_WORK_ORDER_STATUSES, REPEAT_WINDOW_DAYS, findRepeatRepairs } from "@/server/domain/maintenance";

export const maintenanceReportSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  propertyId: z.string().uuid().optional(),
});

type Sums = { labourCostMinor: number | null; materialsCostMinor: number | null; vendorCostMinor: number | null; otherCostMinor: number | null };
const sumOf = (s: Sums) => (s.labourCostMinor ?? 0) + (s.materialsCostMinor ?? 0) + (s.vendorCostMinor ?? 0) + (s.otherCostMinor ?? 0);
const SUM = { labourCostMinor: true, materialsCostMinor: true, vendorCostMinor: true, otherCostMinor: true } as const;

/**
 * Maintenance cost and performance reporting (spec §4.8, phase 4 "maintenance cost reporting").
 * Spend = completed or closed work orders by completion date, so in-flight estimates are excluded.
 * All figures are integer minor units in the organization's currency.
 */
export async function maintenanceReport(ctx: RequestContext, rawQ: z.input<typeof maintenanceReportSchema>) {
  const q = maintenanceReportSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.report.read");
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const today = todayInTz(ctx.timezone);
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -364);
  if (from > to) throw validationError("The start date must be on or before the end date.", [{ path: "from", message: "After the end date." }]);

  const scope = { organizationId: ctx.organizationId, ...(propertyScopeFilter(ctx) as Prisma.WorkOrderWhereInput), ...(q.propertyId ? { propertyId: q.propertyId } : {}) };
  const spendWhere: Prisma.WorkOrderWhereInput = {
    ...scope, status: { in: ["completed", "closed"] },
    completedAt: { gte: dateOnly(from), lt: dateOnly(addDays(to, 1)) },
  };

  const [byProperty, byCategory, byAsset, byVendor, byKind, totals, count] = await Promise.all([
    prisma.workOrder.groupBy({ by: ["propertyId"], where: spendWhere, _sum: SUM, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ["category"], where: spendWhere, _sum: SUM, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ["assetId"], where: { ...spendWhere, assetId: { not: null } }, _sum: SUM, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ["vendorId"], where: { ...spendWhere, vendorId: { not: null } }, _sum: SUM, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ["kind"], where: spendWhere, _sum: SUM, _count: { _all: true } }),
    prisma.workOrder.aggregate({ where: spendWhere, _sum: SUM }),
    prisma.workOrder.count({ where: spendWhere }),
  ]);

  const [props, assets, vendors] = await Promise.all([
    prisma.property.findMany({ where: { id: { in: byProperty.map((r) => r.propertyId) } }, select: { id: true, name: true } }),
    prisma.asset.findMany({ where: { id: { in: byAsset.map((r) => r.assetId!) } }, select: { id: true, assetRef: true, name: true } }),
    prisma.vendor.findMany({ where: { id: { in: byVendor.map((r) => r.vendorId!) } }, select: { id: true, businessName: true } }),
  ]);
  const name = <T extends { id: string }>(xs: T[], id: string | null, f: (x: T) => string) => { const x = xs.find((y) => y.id === id); return x ? f(x) : "—"; };
  const rows = <R extends { _sum: Sums; _count: { _all: number } }>(rs: R[], key: (r: R) => { id: string | null; label: string }) =>
    rs.map((r) => ({ ...key(r), workOrders: r._count._all, labourMinor: r._sum.labourCostMinor ?? 0, materialsMinor: r._sum.materialsCostMinor ?? 0, vendorMinor: r._sum.vendorCostMinor ?? 0, otherMinor: r._sum.otherCostMinor ?? 0, totalMinor: sumOf(r._sum) }))
      .sort((a, b) => b.totalMinor - a.totalMinor);

  // Operational snapshot (as of today, not limited to the date range).
  const reqScope: Prisma.MaintenanceRequestWhereInput = { organizationId: ctx.organizationId, ...(propertyScopeFilter(ctx) as Prisma.MaintenanceRequestWhereInput), ...(q.propertyId ? { propertyId: q.propertyId } : {}) };
  const [openRequests, openEmergencies, openWorkOrders, overdueWorkOrders, timing] = await Promise.all([
    prisma.maintenanceRequest.count({ where: { ...reqScope, status: { in: OPEN_REQUEST_STATUSES } } }),
    prisma.maintenanceRequest.count({ where: { ...reqScope, status: { in: OPEN_REQUEST_STATUSES }, priority: "emergency" } }),
    prisma.workOrder.count({ where: { ...scope, status: { in: OPEN_WORK_ORDER_STATUSES } } }),
    prisma.workOrder.count({ where: { ...scope, status: { in: OPEN_WORK_ORDER_STATUSES }, dueAt: { lt: dateOnly(today) } } }),
    prisma.workOrder.findMany({ where: spendWhere, select: { createdAt: true, assignedAt: true, startedAt: true, completedAt: true, dueAt: true } }),
  ]);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

  // Repeat faults over the trailing window (reactive work only).
  const recent = await prisma.workOrder.findMany({
    where: { ...scope, kind: "reactive", status: { not: "cancelled" }, createdAt: { gte: dateOnly(addDays(today, -REPEAT_WINDOW_DAYS)) } },
    select: { id: true, assetId: true, unitId: true, propertyId: true, category: true, createdAt: true, asset: { select: { assetRef: true, name: true } }, unit: { select: { unitRef: true } }, property: { select: { name: true } } },
  });
  const repeat = findRepeatRepairs(recent.map((w) => ({ ...w, createdOn: todayInTz(ctx.timezone, w.createdAt) })), today).map((g) => {
    const sample = recent.find((w) => w.id === g.workOrderIds[0])!;
    return { ...g, label: g.targetType === "asset" ? `${sample.asset?.assetRef} ${sample.asset?.name}` : `Unit ${sample.unit?.unitRef}`, propertyName: sample.property.name };
  });

  return {
    range: { from, to },
    totals: { workOrders: count, labourMinor: totals._sum.labourCostMinor ?? 0, materialsMinor: totals._sum.materialsCostMinor ?? 0, vendorMinor: totals._sum.vendorCostMinor ?? 0, otherMinor: totals._sum.otherCostMinor ?? 0, totalMinor: sumOf(totals._sum) },
    byProperty: rows(byProperty, (r) => ({ id: r.propertyId, label: name(props, r.propertyId, (p) => p.name) })),
    byCategory: rows(byCategory, (r) => ({ id: r.category, label: r.category })),
    byAsset: rows(byAsset, (r) => ({ id: r.assetId, label: name(assets, r.assetId, (a) => `${a.assetRef} ${a.name}`) })),
    byVendor: rows(byVendor, (r) => ({ id: r.vendorId, label: name(vendors, r.vendorId, (v) => v.businessName) })),
    byKind: rows(byKind, (r) => ({ id: r.kind, label: r.kind })),
    snapshot: {
      openRequests, openEmergencies, openWorkOrders, overdueWorkOrders,
      avgResponseHours: avg(timing.filter((w) => w.assignedAt && w.startedAt).map((w) => hours(w.assignedAt!, w.startedAt!))),
      avgCompletionDays: avg(timing.map((w) => hours(w.createdAt, w.completedAt!) / 24)),
      completedOnTimePct: (() => { const withDue = timing.filter((w) => w.dueAt); return withDue.length ? Math.round((withDue.filter((w) => toISODate(w.completedAt!) <= toISODate(w.dueAt!)).length / withDue.length) * 100) : null; })(),
    },
    repeatRepairs: repeat,
  };
}
