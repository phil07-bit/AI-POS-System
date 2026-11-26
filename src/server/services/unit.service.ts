import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { AppError, businessRule, notFound } from "@/lib/api/errors";
import { optionalText, paged, paginationSchema, sortFrom } from "@/lib/validation/common";
import { toISODate, todayInTz } from "@/lib/dates";
import { propertyScopeFilter } from "@/lib/permissions";
import { leaseCovers, unitOccupancyStatus } from "@/server/domain/occupancy";
import { recordAudit } from "./audit";

export const UNIT_TYPES = ["apartment", "studio", "chamber_and_hall", "single_room", "self_contained", "townhouse", "detached_house", "shop", "office", "warehouse", "parking", "other"] as const;
export const AVAILABILITY = ["available", "reserved", "unavailable", "under_maintenance"] as const;
export const RENT_FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly", "custom"] as const;

export const unitInputSchema = z.object({
  unitRef: z.string().trim().min(1, "Enter a unit number or reference.").max(30),
  unitName: z.string().trim().max(120).optional().nullable(),
  unitType: z.enum(UNIT_TYPES),
  building: optionalText(80), block: optionalText(80), floor: optionalText(30),
  bedrooms: z.number().int().min(0).max(50).optional().nullable(),
  bathrooms: z.number().int().min(0).max(50).optional().nullable(),
  areaValue: z.number().min(0).max(1_000_000).optional().nullable(),
  areaUnit: z.enum(["sqm", "sqft"]).default("sqm"),
  furnishingStatus: z.enum(["unfurnished", "semi_furnished", "furnished"]).default("unfurnished"),
  askingRentMinor: z.number().int().min(0).optional().nullable(),
  rentFrequency: z.enum(RENT_FREQUENCIES).default("monthly"),
  availability: z.enum(AVAILABILITY).default("available"),
  description: optionalText(2000),
});
export const unitUpdateSchema = unitInputSchema.partial();

export const unitListSchema = paginationSchema.extend({
  propertyId: z.string().uuid().optional(),
  occupancy: z.enum(["occupied", "vacant", "reserved", "unavailable", "under_maintenance"]).optional(),
  unitType: z.enum(UNIT_TYPES).optional(),
  includeArchived: z.coerce.boolean().optional(),
});

const include = {
  property: { select: { id: true, name: true, propertyRef: true } },
  leases: {
    where: { status: "active" },
    select: { id: true, leaseRef: true, status: true, startDate: true, endDate: true, rentAmountMinor: true, billingFrequency: true,
      parties: { where: { isPrimary: true }, select: { tenant: { select: { id: true, displayName: true } } } } },
  },
} satisfies Prisma.UnitInclude;
type UnitRow = Prisma.UnitGetPayload<{ include: typeof include }>;

function serialize(u: UnitRow, today: string) {
  const leases = u.leases.map((l) => ({ ...l, startDate: toISODate(l.startDate), endDate: toISODate(l.endDate) }));
  const current = leases.find((l) => leaseCovers({ ...l, unitId: u.id }, today)) ?? null;
  const upcoming = leases.filter((l) => l.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  return {
    id: u.id, propertyId: u.propertyId, property: u.property, unitRef: u.unitRef, unitName: u.unitName, unitType: u.unitType,
    building: u.building, block: u.block, floor: u.floor, bedrooms: u.bedrooms, bathrooms: u.bathrooms,
    areaValue: u.areaValue?.toNumber() ?? null, areaUnit: u.areaUnit, furnishingStatus: u.furnishingStatus,
    askingRentMinor: u.askingRentMinor, currency: u.currency, rentFrequency: u.rentFrequency,
    availability: u.availability, occupancyStatus: unitOccupancyStatus(u, !!current), description: u.description,
    currentLease: current ? { id: current.id, leaseRef: current.leaseRef, endDate: current.endDate, rentAmountMinor: current.rentAmountMinor, billingFrequency: current.billingFrequency, tenant: current.parties[0]?.tenant ?? null } : null,
    upcomingLease: upcoming ? { id: upcoming.id, leaseRef: upcoming.leaseRef, startDate: upcoming.startDate } : null,
    archivedAt: u.archivedAt, createdAt: u.createdAt, updatedAt: u.updatedAt,
  };
}
export type UnitDTO = ReturnType<typeof serialize>;

export async function listUnits(ctx: RequestContext, rawQ: z.input<typeof unitListSchema>) {
  const q = unitListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "unit.read");
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const today = todayInTz(ctx.timezone);
  const where: Prisma.UnitWhereInput = {
    organizationId: ctx.organizationId,
    ...(propertyScopeFilter(ctx) as Prisma.UnitWhereInput),
    ...(q.propertyId ? { propertyId: q.propertyId } : {}),
    ...(q.includeArchived ? {} : { archivedAt: null }),
    ...(q.unitType ? { unitType: q.unitType } : {}),
    ...(q.search ? { OR: [{ unitRef: { contains: q.search, mode: "insensitive" } }, { unitName: { contains: q.search, mode: "insensitive" } }] } : {}),
  };
  // Occupancy is derived; filter it in SQL terms so pagination stays correct.
  const covering: Prisma.LeaseWhereInput = { status: "active", startDate: { lte: new Date(`${today}T00:00:00Z`) }, endDate: { gte: new Date(`${today}T00:00:00Z`) } };
  if (q.occupancy === "occupied") Object.assign(where, { leases: { some: covering }, availability: { in: ["available", "reserved"] } });
  else if (q.occupancy === "vacant") Object.assign(where, { leases: { none: covering }, availability: "available" });
  else if (q.occupancy === "reserved") Object.assign(where, { leases: { none: covering }, availability: "reserved" });
  else if (q.occupancy) Object.assign(where, { availability: q.occupancy });
  const [rows, total] = await Promise.all([
    prisma.unit.findMany({ where, include, orderBy: [{ property: { name: "asc" } }, sortFrom(q, ["unitRef", "unitType", "askingRentMinor", "createdAt"], "unitRef")], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.unit.count({ where }),
  ]);
  return paged(rows.map((r) => serialize(r, today)), total, q);
}

export async function getUnit(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "unit.read");
  const u = await prisma.unit.findFirst({ where: { id, organizationId: ctx.organizationId }, include });
  if (!u) throw notFound("Unit");
  requirePropertyAccess(ctx, u.propertyId);
  return serialize(u, todayInTz(ctx.timezone));
}

export async function createUnit(ctx: RequestContext, propertyId: string, rawInput: z.input<typeof unitInputSchema>) {
  const input = unitInputSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "unit.manage");
  const p = await prisma.property.findFirst({ where: { id: propertyId, organizationId: ctx.organizationId } });
  if (!p) throw notFound("Property");
  requirePropertyAccess(ctx, propertyId);
  if (p.status === "archived") throw businessRule("Cannot add units to an archived property.");
  const u = await prisma.$transaction(async (tx) => {
    const u = await tx.unit.create({
      data: { ...input, unitRef: input.unitRef.toUpperCase(), unitName: input.unitName || input.unitRef, organizationId: ctx.organizationId, propertyId, currency: ctx.currency },
      include,
    });
    await recordAudit(tx, ctx, { action: "unit.created", entityType: "unit", entityId: u.id, summary: `Created unit ${u.unitRef} at ${p.name}`, after: u });
    return u;
  });
  return serialize(u, todayInTz(ctx.timezone));
}

export async function updateUnit(ctx: RequestContext, id: string, rawInput: z.input<typeof unitUpdateSchema>) {
  const input = unitUpdateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "unit.manage");
  const before = await prisma.unit.findFirst({ where: { id, organizationId: ctx.organizationId }, include });
  if (!before) throw notFound("Unit");
  requirePropertyAccess(ctx, before.propertyId);
  if (before.archivedAt) throw businessRule("Archived units cannot be edited.");
  const today = todayInTz(ctx.timezone);
  if (input.availability && input.availability !== "available" && input.availability !== "under_maintenance") {
    const current = serialize(before, today).currentLease;
    if (current && input.availability !== before.availability) {
      throw businessRule(`Unit is occupied under lease ${current.leaseRef}; only "available" or "under maintenance" can be set while leased.`);
    }
  }
  const { unitName, ...rest } = input;
  const after = await prisma.unit.update({
    where: { id },
    data: { ...rest, ...(unitName ? { unitName } : {}), ...(input.unitRef ? { unitRef: input.unitRef.toUpperCase() } : {}) },
    include,
  });
  await recordAudit(prisma, ctx, { action: "unit.updated", entityType: "unit", entityId: id, before, after });
  return serialize(after, today);
}

/** A unit cannot be archived with an active lease or unpaid charges (spec §4.3). */
export async function archiveUnit(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "unit.manage");
  const u = await prisma.unit.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!u) throw notFound("Unit");
  requirePropertyAccess(ctx, u.propertyId);
  if (u.archivedAt) throw businessRule("Unit is already archived.");
  const active = await prisma.lease.count({ where: { unitId: id, status: { in: ["active", "pending_signature"] } } });
  if (active) throw businessRule("This unit has an active or pending lease and cannot be archived.");
  const unpaid = await prisma.rentCharge.count({ where: { unitId: id, status: { in: ["due", "partially_paid", "overdue"] } } });
  if (unpaid) throw businessRule(`This unit has ${unpaid} unpaid charge(s). Settle or void them before archiving.`);
  const after = await prisma.unit.update({ where: { id }, data: { archivedAt: new Date() } });
  await recordAudit(prisma, ctx, { action: "unit.archived", entityType: "unit", entityId: id, summary: `Archived unit ${u.unitRef}` });
  return after;
}

export function assertUnitLeasable(u: { archivedAt: Date | null; availability: string }) {
  if (u.archivedAt) throw new AppError("BUSINESS_RULE", "This unit is archived.");
  if (u.availability === "unavailable") throw new AppError("BUSINESS_RULE", "This unit is marked unavailable.");
}
