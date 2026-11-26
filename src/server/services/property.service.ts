import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { AppError, businessRule, notFound } from "@/lib/api/errors";
import { addressSchema, isoDate, optionalText, paged, paginationSchema, sortFrom } from "@/lib/validation/common";
import { dateOnly, toISODate, todayInTz } from "@/lib/dates";
import { propertyScopeFilter } from "@/lib/permissions";
import { calculateOccupancy } from "@/server/domain/occupancy";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";

export const PROPERTY_TYPES = ["residential", "commercial", "mixed_use", "industrial", "land", "hospitality", "institutional", "other"] as const;
export const PROPERTY_STATUSES = ["active", "inactive", "under_development", "archived"] as const;

export const propertyInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a property name.").max(160),
  propertyRef: z.string().trim().max(30).regex(/^[A-Za-z0-9\-_/]*$/, "Letters, numbers, - _ / only.").optional().nullable(),
  propertyType: z.enum(PROPERTY_TYPES),
  description: optionalText(4000),
  address: addressSchema,
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  ownerNameOrEntity: optionalText(200),
  status: z.enum(["active", "inactive", "under_development"]).default("active"),
  acquisitionDate: isoDate.optional().nullable(),
  acquisitionCostMinor: z.number().int().min(0).optional().nullable(),
  managerMembershipId: z.string().uuid().optional().nullable(),
});
export const propertyUpdateSchema = propertyInputSchema.partial();

export const propertyListSchema = paginationSchema.extend({
  status: z.enum(PROPERTY_STATUSES).optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  managerId: z.string().uuid().optional(),
  includeArchived: z.coerce.boolean().optional(),
});

type PropertyRow = Prisma.PropertyGetPayload<{ include: { manager: { include: { user: { select: { fullName: true } } } } } }>;

function serialize(ctx: RequestContext, p: PropertyRow) {
  const canSeeFinancials = ctx.permissions.has("property.financials.read");
  return {
    id: p.id, propertyRef: p.propertyRef, name: p.name, propertyType: p.propertyType, description: p.description,
    address: p.addressJson as z.infer<typeof addressSchema>, latitude: p.latitude?.toNumber() ?? null, longitude: p.longitude?.toNumber() ?? null,
    ownerNameOrEntity: p.ownerNameOrEntity, status: p.status, currency: p.currency,
    acquisitionDate: p.acquisitionDate ? toISODate(p.acquisitionDate) : null,
    acquisitionCostMinor: canSeeFinancials ? p.acquisitionCostMinor : undefined,
    managerMembershipId: p.managerMembershipId, managerName: p.manager?.user.fullName ?? null,
    archivedAt: p.archivedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}
export type PropertyDTO = ReturnType<typeof serialize>;

const include = { manager: { include: { user: { select: { fullName: true } } } } } as const;

async function assertManagerInOrg(ctx: RequestContext, membershipId: string | null | undefined) {
  if (!membershipId) return;
  const m = await prisma.organizationMembership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId, status: "active", tenantId: null } });
  if (!m) throw new AppError("VALIDATION_ERROR", "Selected manager is not an active staff member.", [{ path: "managerMembershipId", message: "Invalid manager." }]);
}

export async function listProperties(ctx: RequestContext, rawQ: z.input<typeof propertyListSchema>) {
  const q = propertyListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "property.read");
  const where: Prisma.PropertyWhereInput = {
    organizationId: ctx.organizationId,
    ...(propertyScopeFilter(ctx, "id") as Prisma.PropertyWhereInput),
    ...(q.status ? { status: q.status } : q.includeArchived ? {} : { status: { not: "archived" } }),
    ...(q.propertyType ? { propertyType: q.propertyType } : {}),
    ...(q.managerId ? { managerMembershipId: q.managerId } : {}),
    ...(q.search ? { OR: [
      { name: { contains: q.search, mode: "insensitive" } },
      { propertyRef: { contains: q.search, mode: "insensitive" } },
      { addressJson: { path: ["community"], string_contains: q.search } },
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.property.findMany({ where, include, orderBy: sortFrom(q, ["name", "propertyRef", "createdAt", "propertyType", "status"], "name"), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.property.count({ where }),
  ]);
  const occ = await occupancyByProperty(ctx, rows.map((r) => r.id));
  return paged(rows.map((r) => ({ ...serialize(ctx, r), occupancy: occ.get(r.id)! })), total, q);
}

export async function occupancyByProperty(ctx: RequestContext, propertyIds: string[], asOf = todayInTz(ctx.timezone)) {
  const [units, leases] = await Promise.all([
    prisma.unit.findMany({ where: { organizationId: ctx.organizationId, propertyId: { in: propertyIds } }, select: { id: true, propertyId: true, availability: true, archivedAt: true } }),
    prisma.lease.findMany({ where: { organizationId: ctx.organizationId, propertyId: { in: propertyIds }, status: "active" }, select: { unitId: true, propertyId: true, status: true, startDate: true, endDate: true } }),
  ]);
  const out = new Map<string, ReturnType<typeof calculateOccupancy>>();
  for (const pid of propertyIds) {
    out.set(pid, calculateOccupancy(
      units.filter((u) => u.propertyId === pid),
      leases.filter((l) => l.propertyId === pid).map((l) => ({ ...l, startDate: toISODate(l.startDate), endDate: toISODate(l.endDate) })),
      asOf,
    ));
  }
  return out;
}

export async function getProperty(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "property.read");
  const p = await prisma.property.findFirst({ where: { id, organizationId: ctx.organizationId }, include });
  if (!p) throw notFound("Property");
  requirePropertyAccess(ctx, p.id);
  const occ = (await occupancyByProperty(ctx, [p.id])).get(p.id)!;
  return { ...serialize(ctx, p), occupancy: occ };
}

export async function createProperty(ctx: RequestContext, rawInput: z.input<typeof propertyInputSchema>) {
  const input = propertyInputSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "property.create");
  await assertManagerInOrg(ctx, input.managerMembershipId);
  const created = await prisma.$transaction(async (tx) => {
    const ref = input.propertyRef?.toUpperCase() || (await nextRef(tx, ctx.organizationId, "PRP", { pad: 4 }));
    const p = await tx.property.create({
      data: {
        organizationId: ctx.organizationId, propertyRef: ref, name: input.name, propertyType: input.propertyType,
        description: input.description, addressJson: input.address, latitude: input.latitude ?? null, longitude: input.longitude ?? null,
        ownerNameOrEntity: input.ownerNameOrEntity, status: input.status,
        acquisitionDate: input.acquisitionDate ? dateOnly(input.acquisitionDate) : null,
        acquisitionCostMinor: ctx.permissions.has("property.financials.read") ? input.acquisitionCostMinor ?? null : null,
        currency: ctx.currency, managerMembershipId: input.managerMembershipId ?? null,
        createdById: ctx.userId, updatedById: ctx.userId,
      },
      include,
    });
    // A property created by a property-scoped user is added to their own scope so they can manage it.
    if (!ctx.scopeAllProperties) await tx.membershipPropertyScope.create({ data: { membershipId: ctx.membershipId, propertyId: p.id } });
    await recordAudit(tx, ctx, { action: "property.created", entityType: "property", entityId: p.id, summary: `Created property ${p.name} (${p.propertyRef})`, after: p });
    return p;
  });
  if (!ctx.scopeAllProperties) (ctx.propertyIds as Set<string>).add(created.id);
  return serialize(ctx, created);
}

export async function updateProperty(ctx: RequestContext, id: string, rawInput: z.input<typeof propertyUpdateSchema>) {
  const input = propertyUpdateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "property.update");
  const before = await prisma.property.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!before) throw notFound("Property");
  requirePropertyAccess(ctx, id);
  if (before.status === "archived") throw businessRule("Archived properties cannot be edited.");
  if (input.managerMembershipId !== undefined) await assertManagerInOrg(ctx, input.managerMembershipId);
  const { address, acquisitionDate, acquisitionCostMinor, propertyRef, ...rest } = input;
  const after = await prisma.property.update({
    where: { id },
    data: {
      ...rest,
      ...(propertyRef ? { propertyRef: propertyRef.toUpperCase() } : {}),
      ...(address ? { addressJson: address } : {}),
      ...(acquisitionDate !== undefined ? { acquisitionDate: acquisitionDate ? dateOnly(acquisitionDate) : null } : {}),
      ...(acquisitionCostMinor !== undefined && ctx.permissions.has("property.financials.read") ? { acquisitionCostMinor } : {}),
      updatedById: ctx.userId,
    },
    include,
  });
  await recordAudit(prisma, ctx, { action: "property.updated", entityType: "property", entityId: id, before, after });
  return serialize(ctx, after);
}

export async function archiveProperty(ctx: RequestContext, id: string, reason?: string) {
  requireStaff(ctx);
  requirePermission(ctx, "property.archive");
  const p = await prisma.property.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!p) throw notFound("Property");
  requirePropertyAccess(ctx, id);
  if (p.status === "archived") throw businessRule("Property is already archived.");
  const activeLeases = await prisma.lease.count({ where: { propertyId: id, status: "active" } });
  if (activeLeases > 0) throw businessRule(`This property has ${activeLeases} active lease(s). Terminate or let them expire before archiving.`);
  const after = await prisma.property.update({ where: { id }, data: { status: "archived", archivedAt: new Date(), updatedById: ctx.userId }, include });
  await recordAudit(prisma, ctx, { action: "property.archived", entityType: "property", entityId: id, summary: `Archived ${p.name}${reason ? `: ${reason}` : ""}`, before: { status: p.status }, after: { status: "archived" } });
  return serialize(ctx, after);
}

/** Staff that can be assigned as property managers (for form dropdowns). */
export async function listAssignableManagers(ctx: RequestContext) {
  requireStaff(ctx);
  const ms = await prisma.organizationMembership.findMany({
    where: { organizationId: ctx.organizationId, status: "active", tenantId: null },
    include: { user: { select: { fullName: true } }, role: { select: { name: true } } }, orderBy: { createdAt: "asc" },
  });
  return ms.map((m) => ({ id: m.id, name: m.user.fullName, roleName: m.role.name }));
}
