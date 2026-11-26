import { z } from "zod";
import { prisma, Prisma, type Db, type Tx } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requireAnyPermission, requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { businessRule, notFound } from "@/lib/api/errors";
import { isoDate, optionalText, paged, paginationSchema, requiredText, sortFrom } from "@/lib/validation/common";
import { propertyScopeFilter } from "@/lib/permissions";
import { dateOnly, toISODate, todayInTz } from "@/lib/dates";
import {
  MAINTENANCE_CATEGORIES, OPEN_WORK_ORDER_STATUSES, PRIORITIES, WORK_ORDER_STATUSES,
  canTransitionWorkOrder, isWorkOrderOverdue, totalCost, type WorkOrderStatus,
} from "@/server/domain/maintenance";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";
import { assertAssignableVendor } from "./vendor.service";
import { assertUnitInProperty, markAssetServiced } from "./asset.service";
import { addTimeline, assertAssignableUser, notifyUser, syncRequestFromWorkOrders } from "./maintenance-common";

const optionalDate = isoDate.optional().nullable().or(z.literal("").transform(() => null));
const cost = z.number().int("Costs are in whole pesewas.").min(0).max(2_000_000_000);
export const checklistItemSchema = z.object({ item: z.string().trim().min(1).max(200), done: z.boolean().default(false), reading: z.string().trim().max(100).optional().nullable(), note: z.string().trim().max(500).optional().nullable() });

/** Fields only a coordinator (work_order.assign) may set. */
const assignmentFields = {
  scope: requiredText(4000),
  category: z.enum(MAINTENANCE_CATEGORIES),
  priority: z.enum(PRIORITIES).default("normal"),
  assignedUserId: z.string().uuid().optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
  scheduledAt: optionalDate,
  dueAt: optionalDate,
};
/** Fields the person doing the work (work_order.update) may set. */
const progressFields = {
  labourCostMinor: cost.optional(),
  materialsCostMinor: cost.optional(),
  vendorCostMinor: cost.optional(),
  otherCostMinor: cost.optional(),
  purchaseReference: optionalText(120),
  completionNotes: optionalText(4000),
  checklist: z.array(checklistItemSchema).max(50).optional(),
  returnVisitDate: optionalDate,
};

export const workOrderCreateSchema = z.object({
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  assetId: z.string().uuid().optional().nullable(),
  ...assignmentFields,
  checklist: z.array(checklistItemSchema).max(50).optional(),
}).strict();
export const workOrderUpdateSchema = z.object({ ...assignmentFields, ...progressFields }).partial().strict();
export const workOrderTransitionSchema = z.object({ status: z.enum(["in_progress", "waiting_for_parts"]), note: optionalText(2000) }).strict();
export const workOrderCompleteSchema = z.object({
  completionNotes: requiredText(4000),
  labourCostMinor: cost.optional(), materialsCostMinor: cost.optional(), vendorCostMinor: cost.optional(), otherCostMinor: cost.optional(),
  purchaseReference: optionalText(120), checklist: z.array(checklistItemSchema).max(50).optional(), returnVisitDate: optionalDate,
}).strict();
export const workOrderCloseSchema = z.object({ signOffName: optionalText(120), signOffNotes: optionalText(2000) }).strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(1000) }).strict();

export const workOrderListSchema = paginationSchema.extend({
  status: z.enum([...WORK_ORDER_STATUSES, "active", "overdue"]).optional(),
  propertyId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().optional(),
  kind: z.enum(["reactive", "preventive"]).optional(),
  mine: z.coerce.boolean().optional(),
});

const include = {
  property: { select: { id: true, name: true } },
  unit: { select: { id: true, unitRef: true } },
  asset: { select: { id: true, assetRef: true, name: true } },
  vendor: { select: { id: true, businessName: true, phone: true } },
  assignedUser: { select: { id: true, fullName: true } },
  maintenanceRequest: { select: { id: true, requestRef: true, title: true, status: true, requesterName: true, requesterContact: true } },
  pmPlan: { select: { id: true, planName: true } },
} satisfies Prisma.WorkOrderInclude;
type WoRow = Prisma.WorkOrderGetPayload<{ include: typeof include }>;

const d = (x: Date | null) => (x ? toISODate(x) : null);
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

function serialize(w: WoRow, today: string) {
  const costs = { labourCostMinor: w.labourCostMinor, materialsCostMinor: w.materialsCostMinor, vendorCostMinor: w.vendorCostMinor, otherCostMinor: w.otherCostMinor };
  const dueAt = d(w.dueAt);
  return {
    id: w.id, workOrderRef: w.workOrderRef, kind: w.kind, status: w.status, priority: w.priority, category: w.category, scope: w.scope,
    propertyId: w.propertyId, property: w.property, unitId: w.unitId, unit: w.unit, assetId: w.assetId, asset: w.asset,
    maintenanceRequest: w.maintenanceRequest, pmPlan: w.pmPlan, pmDueDate: d(w.pmDueDate),
    assignedUser: w.assignedUser, vendor: w.vendor, assignedAt: w.assignedAt,
    scheduledAt: d(w.scheduledAt), dueAt, startedAt: w.startedAt, completedAt: w.completedAt, closedAt: w.closedAt,
    overdue: isWorkOrderOverdue({ status: w.status, dueAt }, today),
    ...costs, totalCostMinor: totalCost(costs), // the people doing the work record these, so they see them
    currency: w.currency, purchaseReference: w.purchaseReference, completionNotes: w.completionNotes,
    checklist: (w.checklistJson as ChecklistItem[] | null) ?? [], signOffName: w.signOffName, signOffNotes: w.signOffNotes,
    returnVisitDate: d(w.returnVisitDate), cancelReason: w.cancelReason, createdAt: w.createdAt, updatedAt: w.updatedAt,
  };
}
export type WorkOrderDTO = ReturnType<typeof serialize>;

/** Technicians (work_order.read without work_order.assign) only ever see work assigned to them. */
const isCoordinator = (ctx: RequestContext) => ctx.permissions.has("work_order.assign");

async function loadScopedWorkOrder(ctx: RequestContext, id: string, db: Db = prisma) {
  const w = await db.workOrder.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!w) throw notFound("Work order");
  requirePropertyAccess(ctx, w.propertyId);
  if (!isCoordinator(ctx) && w.assignedUserId !== ctx.userId) throw notFound("Work order");
  return w;
}

function assertTransition(from: string, to: WorkOrderStatus) {
  if (!canTransitionWorkOrder(from as WorkOrderStatus, to)) throw businessRule(`A work order that is ${from.replace(/_/g, " ")} cannot move to ${to.replace(/_/g, " ")}.`);
}
function assertEditable(w: { status: string }) {
  if (w.status === "closed" || w.status === "cancelled") throw businessRule(`This work order is ${w.status} and can no longer be changed.`);
}

export async function listWorkOrders(ctx: RequestContext, rawQ: z.input<typeof workOrderListSchema>) {
  const q = workOrderListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "work_order.read");
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const today = todayInTz(ctx.timezone);
  const where: Prisma.WorkOrderWhereInput = {
    organizationId: ctx.organizationId,
    ...(propertyScopeFilter(ctx) as Prisma.WorkOrderWhereInput),
    ...(!isCoordinator(ctx) || q.mine ? { assignedUserId: ctx.userId } : q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
    ...(q.propertyId ? { propertyId: q.propertyId } : {}),
    ...(q.vendorId ? { vendorId: q.vendorId } : {}),
    ...(q.assetId ? { assetId: q.assetId } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.status === "active" ? { status: { in: OPEN_WORK_ORDER_STATUSES } }
      : q.status === "overdue" ? { status: { in: OPEN_WORK_ORDER_STATUSES }, dueAt: { lt: dateOnly(today) } }
      : q.status ? { status: q.status } : {}),
    ...(q.search ? { OR: [{ workOrderRef: { contains: q.search, mode: "insensitive" } }, { scope: { contains: q.search, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.workOrder.findMany({ where, include, orderBy: [sortFrom(q, ["workOrderRef", "dueAt", "priority", "status", "createdAt"], "createdAt"), { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.workOrder.count({ where }),
  ]);
  return paged(rows.map((r) => serialize(r, today)), total, q);
}

export async function getWorkOrder(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "work_order.read");
  await loadScopedWorkOrder(ctx, id);
  const w = await prisma.workOrder.findUniqueOrThrow({ where: { id }, include });
  return serialize(w, todayInTz(ctx.timezone));
}

export interface WorkOrderSeed {
  propertyId: string; unitId?: string | null; assetId?: string | null; category: string; scope: string; priority: string;
  assignedUserId?: string | null; vendorId?: string | null; scheduledAt?: string | null; dueAt?: string | null;
  maintenanceRequestId?: string | null; pmPlanId?: string | null; pmDueDate?: string | null; kind?: "reactive" | "preventive";
  checklist?: ChecklistItem[]; currency: string;
}

/** Shared creation path (manual, from a request, or generated by a preventive plan). Validates links and assignees. */
export async function createWorkOrderTx(tx: Tx, ctx: Pick<RequestContext, "organizationId" | "userId" | "userName" | "requestId" | "isDemoOrg">, s: WorkOrderSeed) {
  if (s.assignedUserId && s.vendorId) throw businessRule("Assign either an internal technician or a vendor, not both.");
  if (s.assignedUserId) await assertAssignableUser(tx, ctx, s.assignedUserId, s.propertyId);
  if (s.vendorId) await assertAssignableVendor(ctx, s.vendorId, tx);
  if (s.scheduledAt && s.dueAt && s.dueAt < s.scheduledAt) throw businessRule("The due date cannot be before the scheduled date.", [{ path: "dueAt", message: "Due date is before the scheduled date." }]);
  const assigned = !!(s.assignedUserId || s.vendorId);
  const w = await tx.workOrder.create({
    data: {
      organizationId: ctx.organizationId, workOrderRef: await nextRef(tx, ctx.organizationId, "WO", { year: true }),
      kind: s.kind ?? "reactive", maintenanceRequestId: s.maintenanceRequestId ?? null, pmPlanId: s.pmPlanId ?? null, pmDueDate: s.pmDueDate ? dateOnly(s.pmDueDate) : null,
      propertyId: s.propertyId, unitId: s.unitId ?? null, assetId: s.assetId ?? null, category: s.category, scope: s.scope, priority: s.priority,
      status: assigned ? "assigned" : "open", assignedUserId: s.assignedUserId ?? null, vendorId: s.vendorId ?? null, assignedAt: assigned ? new Date() : null,
      scheduledAt: s.scheduledAt ? dateOnly(s.scheduledAt) : null, dueAt: s.dueAt ? dateOnly(s.dueAt) : null,
      checklistJson: (s.checklist ?? undefined) as Prisma.InputJsonValue | undefined, currency: s.currency, createdById: ctx.userId ?? null,
    },
    include,
  });
  await recordAudit(tx, ctx, { action: "work_order.created", entityType: "work_order", entityId: w.id, summary: `Created ${w.kind} work order ${w.workOrderRef}${w.maintenanceRequest ? ` for ${w.maintenanceRequest.requestRef}` : ""}`, after: w });
  if (s.maintenanceRequestId) {
    await addTimeline(tx, ctx, s.maintenanceRequestId, { kind: "work_order", visibility: "internal", body: `Work order ${w.workOrderRef} created${w.assignedUser ? `, assigned to ${w.assignedUser.fullName}` : w.vendor ? `, assigned to ${w.vendor.businessName}` : ""}.` });
    await syncRequestFromWorkOrders(tx, ctx, s.maintenanceRequestId);
  }
  return w;
}

async function afterAssign(ctx: RequestContext, w: { id: string; workOrderRef: string; scope: string; assignedUserId: string | null }) {
  if (w.assignedUserId && w.assignedUserId !== ctx.userId) {
    await notifyUser(ctx.organizationId, w.assignedUserId, `wo-assigned:${w.id}:${w.assignedUserId}`, `Work order ${w.workOrderRef} assigned to you`, w.scope.slice(0, 300), "work_order.assigned");
  }
}

export async function createWorkOrder(ctx: RequestContext, raw: z.input<typeof workOrderCreateSchema>) {
  const input = workOrderCreateSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "work_order.assign");
  const p = await prisma.property.findFirst({ where: { id: input.propertyId, organizationId: ctx.organizationId } });
  if (!p) throw notFound("Property");
  requirePropertyAccess(ctx, p.id);
  if (input.unitId) await assertUnitInProperty(ctx, p.id, input.unitId);
  if (input.assetId) {
    const a = await prisma.asset.findFirst({ where: { id: input.assetId, organizationId: ctx.organizationId } });
    if (!a || a.propertyId !== p.id) throw businessRule("The selected asset is not at this property.", [{ path: "assetId", message: "Asset is not at this property." }]);
    if (a.status === "disposed") throw businessRule("This asset has been disposed of.");
  }
  const w = await prisma.$transaction((tx) => createWorkOrderTx(tx, ctx, { ...input, currency: ctx.currency }));
  await afterAssign(ctx, w);
  return serialize(w, todayInTz(ctx.timezone));
}

/**
 * Edit a work order. Assignment fields need work_order.assign (coordinators); progress fields
 * (costs, notes, checklist) need work_order.update, and technicians may only edit their own.
 */
export async function updateWorkOrder(ctx: RequestContext, id: string, raw: z.input<typeof workOrderUpdateSchema>) {
  const input = workOrderUpdateSchema.parse(raw);
  requireStaff(ctx);
  requireAnyPermission(ctx, "work_order.update", "work_order.assign");
  const before = await loadScopedWorkOrder(ctx, id);
  assertEditable(before);
  const touchesAssignment = (Object.keys(assignmentFields) as (keyof typeof input)[]).some((k) => input[k] !== undefined);
  const touchesProgress = (Object.keys(progressFields) as (keyof typeof input)[]).some((k) => input[k] !== undefined);
  if (touchesAssignment) requirePermission(ctx, "work_order.assign");
  if (touchesProgress) requirePermission(ctx, "work_order.update");

  const { checklist, scheduledAt, dueAt, returnVisitDate, ...rest } = input;
  const nextUser = input.assignedUserId !== undefined ? input.assignedUserId : before.assignedUserId;
  const nextVendor = input.vendorId !== undefined ? input.vendorId : before.vendorId;
  if (nextUser && nextVendor) throw businessRule("Assign either an internal technician or a vendor, not both.");
  const sched = scheduledAt !== undefined ? scheduledAt : d(before.scheduledAt);
  const due = dueAt !== undefined ? dueAt : d(before.dueAt);
  if (sched && due && due < sched) throw businessRule("The due date cannot be before the scheduled date.", [{ path: "dueAt", message: "Due date is before the scheduled date." }]);

  const reassigned = nextUser !== before.assignedUserId || nextVendor !== before.vendorId;
  const today = todayInTz(ctx.timezone);
  const after = await prisma.$transaction(async (tx) => {
    if (input.assignedUserId && input.assignedUserId !== before.assignedUserId) await assertAssignableUser(tx, ctx, input.assignedUserId, before.propertyId);
    if (input.vendorId && input.vendorId !== before.vendorId) await assertAssignableVendor(ctx, input.vendorId, tx);
    let status = before.status;
    if (reassigned && (before.status === "open" || before.status === "assigned")) status = nextUser || nextVendor ? "assigned" : "open";
    const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v ? dateOnly(v) : null);
    const w = await tx.workOrder.update({
      where: { id },
      data: {
        ...rest, status, scheduledAt: toDate(scheduledAt), dueAt: toDate(dueAt), returnVisitDate: toDate(returnVisitDate),
        ...(checklist ? { checklistJson: checklist as Prisma.InputJsonValue } : {}),
        ...(reassigned ? { assignedAt: nextUser || nextVendor ? new Date() : null } : {}),
      },
      include,
    });
    const costChanged = ["labourCostMinor", "materialsCostMinor", "vendorCostMinor", "otherCostMinor"].some((k) => (input as Record<string, unknown>)[k] !== undefined && (input as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]);
    await recordAudit(tx, ctx, {
      action: reassigned ? "work_order.assigned" : costChanged ? "work_order.costs_updated" : "work_order.updated", entityType: "work_order", entityId: id,
      summary: reassigned ? `${w.workOrderRef} assigned to ${w.assignedUser?.fullName ?? w.vendor?.businessName ?? "nobody"}` : costChanged ? `${w.workOrderRef} costs now ${totalCost(w)} minor units` : `Updated ${w.workOrderRef}`,
      before, after: w,
    });
    if (w.maintenanceRequestId) await syncRequestFromWorkOrders(tx, ctx, w.maintenanceRequestId);
    return w;
  });
  if (reassigned) await afterAssign(ctx, after);
  return serialize(after, today);
}

async function transition(ctx: RequestContext, id: string, to: WorkOrderStatus, data: Prisma.WorkOrderUpdateInput, audit: { action: string; summary: (ref: string) => string; note?: string | null }) {
  const today = todayInTz(ctx.timezone);
  return prisma.$transaction(async (tx) => {
    const before = await loadScopedWorkOrder(ctx, id, tx);
    assertTransition(before.status, to);
    // Lock in the "from" state: a concurrent transition on the same row loses (0 rows updated).
    const res = await tx.workOrder.updateMany({ where: { id, status: before.status }, data: { ...(data as Prisma.WorkOrderUpdateManyMutationInput), status: to } });
    if (res.count === 0) throw businessRule("This work order was changed by someone else. Refresh and try again.");
    const w = await tx.workOrder.findUniqueOrThrow({ where: { id }, include });
    await recordAudit(tx, ctx, { action: audit.action, entityType: "work_order", entityId: id, summary: audit.summary(w.workOrderRef), before: { status: before.status }, after: { status: to }, metadata: audit.note ? { note: audit.note } : undefined });
    if (w.maintenanceRequestId) {
      if (audit.note) await addTimeline(tx, ctx, w.maintenanceRequestId, { kind: "work_order", visibility: "internal", body: `${w.workOrderRef}: ${audit.note}` });
      await syncRequestFromWorkOrders(tx, ctx, w.maintenanceRequestId);
    }
    return { w, before };
  }).then(({ w, before }) => ({ wo: serialize(w, today), before }));
}

/** Start, put on hold for parts, or resume. */
export async function progressWorkOrder(ctx: RequestContext, id: string, raw: z.input<typeof workOrderTransitionSchema>) {
  const input = workOrderTransitionSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "work_order.update");
  const current = await loadScopedWorkOrder(ctx, id);
  const r = await transition(ctx, id, input.status, input.status === "in_progress" && !current.startedAt ? { startedAt: new Date() } : {}, {
    action: input.status === "in_progress" ? (current.status === "waiting_for_parts" ? "work_order.resumed" : "work_order.started") : "work_order.waiting_for_parts",
    summary: (ref) => `${ref}: ${current.status.replace(/_/g, " ")} → ${input.status.replace(/_/g, " ")}`, note: input.note,
  });
  return r.wo;
}

/** Technician / vendor coordinator records completion with notes and final costs. Manager sign-off is a separate step. */
export async function completeWorkOrder(ctx: RequestContext, id: string, raw: z.input<typeof workOrderCompleteSchema>) {
  const input = workOrderCompleteSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "work_order.update");
  const { checklist, returnVisitDate, ...rest } = input;
  const r = await transition(ctx, id, "completed", {
    ...rest, completedAt: new Date(), ...(checklist ? { checklistJson: checklist as Prisma.InputJsonValue } : {}),
    ...(returnVisitDate !== undefined ? { returnVisitDate: returnVisitDate ? dateOnly(returnVisitDate) : null } : {}),
  }, { action: "work_order.completed", summary: (ref) => `${ref} marked complete`, note: `Completed: ${input.completionNotes}` });
  return r.wo;
}

/**
 * Manager sign-off (spec §4.9 "a human manager approves and closes service records").
 * Closing a work order on an asset records the service date on that asset.
 */
export async function closeWorkOrder(ctx: RequestContext, id: string, raw: z.input<typeof workOrderCloseSchema>) {
  const input = workOrderCloseSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "work_order.close");
  const today = todayInTz(ctx.timezone);
  return prisma.$transaction(async (tx) => {
    const before = await loadScopedWorkOrder(ctx, id, tx);
    assertTransition(before.status, "closed");
    const res = await tx.workOrder.updateMany({ where: { id, status: "completed" }, data: { status: "closed", closedAt: new Date(), closedById: ctx.userId, signOffName: input.signOffName ?? ctx.userName, signOffNotes: input.signOffNotes } });
    if (res.count === 0) throw businessRule("This work order was changed by someone else. Refresh and try again.");
    if (before.assetId) await markAssetServiced(tx, before.assetId, before.completedAt ? todayInTz(ctx.timezone, before.completedAt) : today);
    const w = await tx.workOrder.findUniqueOrThrow({ where: { id }, include });
    await recordAudit(tx, ctx, { action: "work_order.closed", entityType: "work_order", entityId: id, summary: `${w.workOrderRef} signed off by ${w.signOffName}`, before: { status: before.status }, after: { status: "closed", totalCostMinor: totalCost(w) } });
    if (w.maintenanceRequestId) await syncRequestFromWorkOrders(tx, ctx, w.maintenanceRequestId);
    return serialize(w, today);
  });
}

/** Reviewer sends completed work back for rework. */
export async function returnWorkOrder(ctx: RequestContext, id: string, raw: z.input<typeof reasonSchema>) {
  const { reason } = reasonSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "work_order.close");
  const r = await transition(ctx, id, "in_progress", { completedAt: null }, { action: "work_order.returned", summary: (ref) => `${ref} returned for rework`, note: `Returned for rework: ${reason}` });
  return r.wo;
}

export async function cancelWorkOrder(ctx: RequestContext, id: string, raw: z.input<typeof reasonSchema>) {
  const { reason } = reasonSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "work_order.assign");
  const r = await transition(ctx, id, "cancelled", { cancelReason: reason }, { action: "work_order.cancelled", summary: (ref) => `${ref} cancelled`, note: `Cancelled: ${reason}` });
  return r.wo;
}
