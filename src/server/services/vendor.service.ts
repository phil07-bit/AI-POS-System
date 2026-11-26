import { z } from "zod";
import { prisma, Prisma, type Db } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requireAnyPermission, requirePermission, requireStaff } from "@/lib/auth/context";
import { businessRule, notFound } from "@/lib/api/errors";
import { addressSchema, optionalEmail, optionalPhone, optionalText, paged, paginationSchema, requiredText, sortFrom } from "@/lib/validation/common";
import { propertyScopeFilter } from "@/lib/permissions";
import { MAINTENANCE_CATEGORIES, VENDOR_STATUSES, totalCost } from "@/server/domain/maintenance";
import { toISODate } from "@/lib/dates";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";

/**
 * Vendor directory (spec §4.8). Bank details are intentionally not collected: there is no
 * accounts-payable module, so storing them would add risk without a use.
 */
export const vendorInputSchema = z.object({
  businessName: requiredText(160),
  contactName: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  address: addressSchema.partial().optional().nullable(),
  serviceCategories: z.array(z.enum(MAINTENANCE_CATEGORIES)).max(MAINTENANCE_CATEGORIES.length).default([]),
  status: z.enum(VENDOR_STATUSES).default("active"),
  notes: optionalText(4000),
}).strict();
export const vendorUpdateSchema = vendorInputSchema.partial().strict();

export const vendorListSchema = paginationSchema.extend({
  status: z.enum(VENDOR_STATUSES).optional(),
  category: z.enum(MAINTENANCE_CATEGORIES).optional(),
});

function serialize(v: Prisma.VendorGetPayload<object>) {
  return {
    id: v.id, vendorRef: v.vendorRef, businessName: v.businessName, contactName: v.contactName, phone: v.phone, email: v.email,
    address: v.addressJson as Record<string, string> | null, serviceCategories: v.serviceCategories, status: v.status, notes: v.notes,
    createdAt: v.createdAt, updatedAt: v.updatedAt,
  };
}
export type VendorDTO = ReturnType<typeof serialize>;

function requireVendorRead(ctx: RequestContext) {
  requireStaff(ctx);
  requireAnyPermission(ctx, "vendor.read", "vendor.manage");
}

export async function listVendors(ctx: RequestContext, rawQ: z.input<typeof vendorListSchema>) {
  const q = vendorListSchema.parse(rawQ);
  requireVendorRead(ctx);
  const where: Prisma.VendorWhereInput = {
    organizationId: ctx.organizationId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.category ? { serviceCategories: { has: q.category } } : {}),
    ...(q.search ? { OR: [{ businessName: { contains: q.search, mode: "insensitive" } }, { contactName: { contains: q.search, mode: "insensitive" } }, { vendorRef: { contains: q.search, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.vendor.findMany({ where, orderBy: sortFrom(q, ["businessName", "vendorRef", "status", "createdAt"], "businessName"), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.vendor.count({ where }),
  ]);
  return paged(rows.map(serialize), total, q);
}

/** Vendor detail with service history and performance (response / completion time, spend) within the caller's property scope. */
export async function getVendor(ctx: RequestContext, id: string) {
  requireVendorRead(ctx);
  const v = await prisma.vendor.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!v) throw notFound("Vendor");
  const wos = await prisma.workOrder.findMany({
    where: { organizationId: ctx.organizationId, vendorId: id, ...(propertyScopeFilter(ctx) as Prisma.WorkOrderWhereInput) },
    select: {
      id: true, workOrderRef: true, status: true, category: true, scope: true, priority: true, createdAt: true, assignedAt: true, startedAt: true, completedAt: true, dueAt: true,
      labourCostMinor: true, materialsCostMinor: true, vendorCostMinor: true, otherCostMinor: true,
      property: { select: { id: true, name: true } }, unit: { select: { unitRef: true } }, asset: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const canSeeCost = ctx.permissions.has("maintenance.report.read") || ctx.permissions.has("work_order.assign");
  const done = wos.filter((w) => w.completedAt);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
  const performance = {
    workOrders: wos.length,
    completed: done.length,
    open: wos.filter((w) => ["open", "assigned", "in_progress", "waiting_for_parts"].includes(w.status)).length,
    avgResponseHours: avg(wos.filter((w) => w.assignedAt && w.startedAt).map((w) => hours(w.assignedAt!, w.startedAt!))),
    avgCompletionDays: avg(done.filter((w) => w.assignedAt).map((w) => hours(w.assignedAt!, w.completedAt!) / 24)),
    completedLate: done.filter((w) => w.dueAt && toISODate(w.completedAt!) > toISODate(w.dueAt)).length,
    totalSpendMinor: canSeeCost ? done.reduce((s, w) => s + totalCost(w), 0) : undefined,
  };
  return {
    ...serialize(v),
    performance,
    history: wos.map(({ labourCostMinor, materialsCostMinor, vendorCostMinor, otherCostMinor, ...w }) => ({
      ...w, dueAt: w.dueAt ? toISODate(w.dueAt) : null,
      totalCostMinor: canSeeCost ? totalCost({ labourCostMinor, materialsCostMinor, vendorCostMinor, otherCostMinor }) : undefined,
    })),
  };
}

export async function createVendor(ctx: RequestContext, raw: z.input<typeof vendorInputSchema>) {
  const input = vendorInputSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "vendor.manage");
  return prisma.$transaction(async (tx) => {
    const { address, ...rest } = input;
    const v = await tx.vendor.create({
      data: { ...rest, addressJson: (address ?? undefined) as Prisma.InputJsonValue | undefined, organizationId: ctx.organizationId, vendorRef: await nextRef(tx, ctx.organizationId, "VND", { pad: 4 }), createdById: ctx.userId },
    });
    await recordAudit(tx, ctx, { action: "vendor.created", entityType: "vendor", entityId: v.id, summary: `Added vendor ${v.businessName}`, after: v });
    return serialize(v);
  });
}

export async function updateVendor(ctx: RequestContext, id: string, raw: z.input<typeof vendorUpdateSchema>) {
  const input = vendorUpdateSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "vendor.manage");
  const before = await prisma.vendor.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!before) throw notFound("Vendor");
  const { address, ...rest } = input;
  const after = await prisma.vendor.update({
    where: { id },
    data: { ...rest, ...(address !== undefined ? { addressJson: (address ?? Prisma.DbNull) as Prisma.InputJsonValue } : {}) },
  });
  await recordAudit(prisma, ctx, {
    action: before.status !== after.status ? "vendor.status_changed" : "vendor.updated", entityType: "vendor", entityId: id,
    summary: before.status !== after.status ? `Vendor ${after.businessName}: ${before.status} → ${after.status}` : `Updated vendor ${after.businessName}`, before, after,
  });
  return serialize(after);
}

/** Assignable vendors: active only. Used by work-order and plan forms. */
export async function assertAssignableVendor(ctx: Pick<RequestContext, "organizationId">, vendorId: string, db: Db = prisma) {
  const v = await db.vendor.findFirst({ where: { id: vendorId, organizationId: ctx.organizationId } });
  if (!v) throw notFound("Vendor");
  if (v.status !== "active") throw businessRule(`Vendor ${v.businessName} is ${v.status} and cannot be assigned work.`);
  return v;
}
