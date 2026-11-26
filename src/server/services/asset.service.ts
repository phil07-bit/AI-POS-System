import { z } from "zod";
import { prisma, Prisma, type Db } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { businessRule, notFound } from "@/lib/api/errors";
import { isoDate, optionalText, paged, paginationSchema, requiredText, sortFrom } from "@/lib/validation/common";
import { propertyScopeFilter } from "@/lib/permissions";
import { addDays, dateOnly, toISODate, todayInTz } from "@/lib/dates";
import { ASSET_CATEGORIES, DUE_SOON_DAYS, computeNextServiceDate, serviceStatus, totalCost, warrantyActive } from "@/server/domain/maintenance";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";

export const CRITICALITY = ["low", "medium", "high", "critical"] as const;
export const CONDITIONS = ["good", "fair", "poor", "failed"] as const;
export const ASSET_STATUSES = ["active", "inactive", "disposed"] as const;

const optionalDate = isoDate.optional().nullable().or(z.literal("").transform(() => null));

export const assetInputSchema = z.object({
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  name: requiredText(160),
  category: z.enum(ASSET_CATEGORIES),
  location: optionalText(200),
  make: optionalText(80),
  model: optionalText(80),
  serialNumber: optionalText(80),
  installedAt: optionalDate,
  warrantyExpiresAt: optionalDate,
  criticality: z.enum(CRITICALITY).default("medium"),
  condition: z.enum(CONDITIONS).default("good"),
  status: z.enum(ASSET_STATUSES).default("active"),
  serviceIntervalDays: z.number().int().min(1).max(3660).optional().nullable(),
  lastServicedAt: optionalDate,
  notes: optionalText(4000),
}).strict();
export const assetUpdateSchema = assetInputSchema.omit({ propertyId: true }).partial().strict();

export const assetListSchema = paginationSchema.extend({
  propertyId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  service: z.enum(["overdue", "due_soon", "ok", "not_scheduled"]).optional(),
});

const include = {
  property: { select: { id: true, name: true } },
  unit: { select: { id: true, unitRef: true } },
  pmPlans: { where: { active: true }, select: { id: true, planName: true, nextDueAt: true, intervalDays: true } },
} satisfies Prisma.AssetInclude;
type AssetRow = Prisma.AssetGetPayload<{ include: typeof include }>;

const d = (x: Date | null) => (x ? toISODate(x) : null);

function serialize(a: AssetRow, today: string) {
  // The next due date shown is the earliest of the asset's interval-based date and its active plans.
  const candidates = [d(a.nextServiceAt), ...a.pmPlans.map((p) => toISODate(p.nextDueAt))].filter((x): x is string => !!x).sort();
  const nextDue = candidates[0] ?? null;
  return {
    id: a.id, assetRef: a.assetRef, name: a.name, category: a.category, location: a.location, make: a.make, model: a.model, serialNumber: a.serialNumber,
    propertyId: a.propertyId, property: a.property, unitId: a.unitId, unit: a.unit,
    installedAt: d(a.installedAt), warrantyExpiresAt: d(a.warrantyExpiresAt), underWarranty: warrantyActive(d(a.warrantyExpiresAt), today),
    criticality: a.criticality, condition: a.condition, status: a.status, serviceIntervalDays: a.serviceIntervalDays,
    lastServicedAt: d(a.lastServicedAt), nextServiceAt: d(a.nextServiceAt), nextDueAt: nextDue,
    serviceStatus: a.status === "active" ? serviceStatus(nextDue, today) : "not_scheduled",
    plans: a.pmPlans.map((p) => ({ ...p, nextDueAt: toISODate(p.nextDueAt) })),
    notes: a.notes, disposedAt: d(a.disposedAt), createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}
export type AssetDTO = ReturnType<typeof serialize>;

/** Load an asset in the caller's org and property scope (NOT_FOUND otherwise). */
export async function loadScopedAsset(ctx: RequestContext, id: string, db: Db = prisma) {
  const a = await db.asset.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!a) throw notFound("Asset");
  requirePropertyAccess(ctx, a.propertyId);
  return a;
}

/** Validate that a unit exists in the org and belongs to the given property. */
export async function assertUnitInProperty(ctx: RequestContext, propertyId: string, unitId: string, db: Db = prisma) {
  const u = await db.unit.findFirst({ where: { id: unitId, organizationId: ctx.organizationId } });
  if (!u || u.propertyId !== propertyId) throw businessRule("The selected unit does not belong to this property.", [{ path: "unitId", message: "Unit is not in this property." }]);
  return u;
}

export async function listAssets(ctx: RequestContext, rawQ: z.input<typeof assetListSchema>) {
  const q = assetListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "asset.read");
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const today = todayInTz(ctx.timezone);
  const t = dateOnly(today);
  const where: Prisma.AssetWhereInput = {
    organizationId: ctx.organizationId,
    ...(propertyScopeFilter(ctx) as Prisma.AssetWhereInput),
    ...(q.propertyId ? { propertyId: q.propertyId } : {}),
    ...(q.unitId ? { unitId: q.unitId } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.status ? { status: q.status } : { status: { not: "disposed" } }),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { assetRef: { contains: q.search, mode: "insensitive" } }, { serialNumber: { contains: q.search, mode: "insensitive" } }] } : {}),
  };
  // Service-status filter in SQL terms (asset date OR any active plan date) so pagination stays correct.
  const due = (cond: Prisma.DateTimeFilter): Prisma.AssetWhereInput => ({ OR: [{ nextServiceAt: cond }, { pmPlans: { some: { active: true, nextDueAt: cond } } }] });
  const soon = dateOnly(addDays(today, DUE_SOON_DAYS));
  if (q.service === "overdue") Object.assign(where, { status: "active", AND: [due({ lt: t })] });
  else if (q.service === "due_soon") Object.assign(where, { status: "active", AND: [due({ gte: t, lte: soon }), { NOT: due({ lt: t }) }] });
  else if (q.service === "not_scheduled") Object.assign(where, { nextServiceAt: null, pmPlans: { none: { active: true } } });
  else if (q.service === "ok") Object.assign(where, { status: "active", AND: [{ NOT: due({ lte: soon }) }, { OR: [{ nextServiceAt: { not: null } }, { pmPlans: { some: { active: true } } }] }] });
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({ where, include, orderBy: [sortFrom(q, ["name", "assetRef", "category", "nextServiceAt", "criticality", "createdAt"], "assetRef")], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.asset.count({ where }),
  ]);
  return paged(rows.map((r) => serialize(r, today)), total, q);
}

export async function getAsset(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "asset.read");
  await loadScopedAsset(ctx, id);
  const a = await prisma.asset.findUniqueOrThrow({ where: { id }, include });
  return serialize(a, todayInTz(ctx.timezone));
}

/** Service history: every work order on the asset, newest first, with cost and checklist results. */
export async function getAssetServiceHistory(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "asset.read");
  await loadScopedAsset(ctx, id);
  const canSeeCost = ctx.permissions.has("maintenance.report.read") || ctx.permissions.has("work_order.assign");
  const rows = await prisma.workOrder.findMany({
    where: { organizationId: ctx.organizationId, assetId: id },
    select: {
      id: true, workOrderRef: true, kind: true, category: true, scope: true, status: true, priority: true, pmDueDate: true, createdAt: true, completedAt: true, closedAt: true,
      completionNotes: true, checklistJson: true, signOffName: true, labourCostMinor: true, materialsCostMinor: true, vendorCostMinor: true, otherCostMinor: true,
      vendor: { select: { id: true, businessName: true } }, assignedUser: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(({ labourCostMinor, materialsCostMinor, vendorCostMinor, otherCostMinor, ...w }) => ({
    ...w, pmDueDate: d(w.pmDueDate),
    totalCostMinor: canSeeCost ? totalCost({ labourCostMinor, materialsCostMinor, vendorCostMinor, otherCostMinor }) : undefined,
  }));
}

export async function createAsset(ctx: RequestContext, raw: z.input<typeof assetInputSchema>) {
  const input = assetInputSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "asset.manage");
  const p = await prisma.property.findFirst({ where: { id: input.propertyId, organizationId: ctx.organizationId } });
  if (!p) throw notFound("Property");
  requirePropertyAccess(ctx, p.id);
  if (p.status === "archived") throw businessRule("Cannot register assets on an archived property.");
  if (input.unitId) await assertUnitInProperty(ctx, p.id, input.unitId);
  if (input.status === "disposed") throw businessRule("Register the asset as active or inactive; dispose of it later.");
  const today = todayInTz(ctx.timezone);
  const next = computeNextServiceDate({ serviceIntervalDays: input.serviceIntervalDays ?? null, lastServicedAt: input.lastServicedAt ?? null, installedAt: input.installedAt ?? null });
  const a = await prisma.$transaction(async (tx) => {
    const a = await tx.asset.create({
      data: {
        ...input, organizationId: ctx.organizationId, assetRef: await nextRef(tx, ctx.organizationId, "AST", { pad: 4 }), createdById: ctx.userId,
        unitId: input.unitId ?? null,
        installedAt: input.installedAt ? dateOnly(input.installedAt) : null, warrantyExpiresAt: input.warrantyExpiresAt ? dateOnly(input.warrantyExpiresAt) : null,
        lastServicedAt: input.lastServicedAt ? dateOnly(input.lastServicedAt) : null, nextServiceAt: next ? dateOnly(next) : null,
      },
      include,
    });
    await recordAudit(tx, ctx, { action: "asset.created", entityType: "asset", entityId: a.id, summary: `Registered asset ${a.assetRef} ${a.name} at ${p.name}`, after: a });
    return a;
  });
  return serialize(a, today);
}

export async function updateAsset(ctx: RequestContext, id: string, raw: z.input<typeof assetUpdateSchema>) {
  const input = assetUpdateSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "asset.manage");
  const before = await loadScopedAsset(ctx, id);
  if (before.status === "disposed") throw businessRule("Disposed assets are kept for history and cannot be edited.");
  if (input.unitId) await assertUnitInProperty(ctx, before.propertyId, input.unitId);
  const merged = {
    serviceIntervalDays: input.serviceIntervalDays !== undefined ? input.serviceIntervalDays : before.serviceIntervalDays,
    lastServicedAt: input.lastServicedAt !== undefined ? input.lastServicedAt : d(before.lastServicedAt),
    installedAt: input.installedAt !== undefined ? input.installedAt : d(before.installedAt),
  };
  const next = computeNextServiceDate(merged);
  const today = todayInTz(ctx.timezone);
  const disposing = input.status === "disposed";
  const after = await prisma.$transaction(async (tx) => {
    const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v ? dateOnly(v) : null);
    const a = await tx.asset.update({
      where: { id },
      data: {
        ...input, installedAt: toDate(input.installedAt), warrantyExpiresAt: toDate(input.warrantyExpiresAt), lastServicedAt: toDate(input.lastServicedAt),
        nextServiceAt: disposing ? null : next ? dateOnly(next) : null, ...(disposing ? { disposedAt: dateOnly(today) } : {}),
      },
      include,
    });
    // A disposed asset needs no further preventive maintenance.
    if (disposing) await tx.preventiveMaintenancePlan.updateMany({ where: { assetId: id, active: true }, data: { active: false } });
    await recordAudit(tx, ctx, {
      action: disposing ? "asset.disposed" : "asset.updated", entityType: "asset", entityId: id,
      summary: disposing ? `Disposed asset ${a.assetRef} ${a.name}` : `Updated asset ${a.assetRef}`, before, after: a,
    });
    return a;
  });
  return serialize(after, today);
}

/** Record a completed service on an asset (used when a work order on it is signed off). */
export async function markAssetServiced(tx: Db, assetId: string, servicedOn: string) {
  const a = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (a.status === "disposed") return;
  const last = a.lastServicedAt && toISODate(a.lastServicedAt) > servicedOn ? toISODate(a.lastServicedAt) : servicedOn;
  const next = computeNextServiceDate({ serviceIntervalDays: a.serviceIntervalDays, lastServicedAt: last, installedAt: d(a.installedAt) });
  await tx.asset.update({ where: { id: assetId }, data: { lastServicedAt: dateOnly(last), nextServiceAt: next ? dateOnly(next) : null } });
}
