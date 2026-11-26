import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { businessRule, notFound } from "@/lib/api/errors";
import { isoDate, optionalText, paged, paginationSchema, requiredText, sortFrom } from "@/lib/validation/common";
import { propertyScopeFilter } from "@/lib/permissions";
import { dateOnly, toISODate, todayInTz } from "@/lib/dates";
import {
  MAINTENANCE_CATEGORIES, OPEN_REQUEST_STATUSES, PRIORITIES, REQUEST_STATUSES,
  canTransitionRequest, defaultTargetDate, type Priority, type RequestStatus,
} from "@/server/domain/maintenance";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";
import { assertUnitInProperty } from "./asset.service";
import { addTimeline, escalateEmergency, notifyUser, syncRequestFromWorkOrders } from "./maintenance-common";
import { createWorkOrderTx, reasonSchema, checklistItemSchema } from "./work-order.service";
import { humanizeStatus } from "./maintenance-labels";

const optionalDate = isoDate.optional().nullable().or(z.literal("").transform(() => null));

export const requestCreateSchema = z.object({
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  tenantId: z.string().uuid().optional().nullable(),
  assetId: z.string().uuid().optional().nullable(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  title: requiredText(160),
  description: requiredText(4000),
  priority: z.enum(PRIORITIES).default("normal"),
  requesterName: optionalText(120),
  requesterContact: optionalText(120),
  targetDate: optionalDate,
}).strict();

export const requestUpdateSchema = z.object({
  unitId: z.string().uuid().optional().nullable(),
  assetId: z.string().uuid().optional().nullable(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  title: requiredText(160),
  description: requiredText(4000),
  priority: z.enum(PRIORITIES),
  targetDate: optionalDate,
  assignedManagerMembershipId: z.string().uuid().optional().nullable(),
  requesterContact: optionalText(120),
}).partial().strict();

export const triageSchema = z.object({
  category: z.enum(MAINTENANCE_CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  targetDate: optionalDate,
  assignedManagerMembershipId: z.string().uuid().optional().nullable(),
  note: optionalText(2000),
}).strict();
export const approveSchema = z.object({ reason: optionalText(1000) }).strict();
export const updateNoteSchema = z.object({ body: requiredText(4000), visibility: z.enum(["internal", "tenant"]).default("internal") }).strict();
export const closeRequestSchema = z.object({ resolutionNotes: requiredText(4000) }).strict();
export const createWorkOrderFromRequestSchema = z.object({
  existingWorkOrderId: z.string().uuid().optional(),
  scope: z.string().trim().max(4000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedUserId: z.string().uuid().optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
  scheduledAt: optionalDate,
  dueAt: optionalDate,
  checklist: z.array(checklistItemSchema).max(50).optional(),
}).strict();

export const requestListSchema = paginationSchema.extend({
  status: z.enum([...REQUEST_STATUSES, "open"]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  category: z.enum(MAINTENANCE_CATEGORIES).optional(),
  propertyId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  source: z.enum(["staff", "tenant_portal"]).optional(),
});

const include = {
  property: { select: { id: true, name: true } },
  unit: { select: { id: true, unitRef: true } },
  tenant: { select: { id: true, displayName: true } },
  asset: { select: { id: true, assetRef: true, name: true } },
  assignedManager: { select: { id: true, user: { select: { fullName: true } } } },
  workOrders: { select: { id: true, workOrderRef: true, status: true, dueAt: true, assignedUser: { select: { fullName: true } }, vendor: { select: { businessName: true } } }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.MaintenanceRequestInclude;
type ReqRow = Prisma.MaintenanceRequestGetPayload<{ include: typeof include }>;

const d = (x: Date | null) => (x ? toISODate(x) : null);

function serialize(r: ReqRow, today: string) {
  const target = d(r.targetDate);
  return {
    id: r.id, requestRef: r.requestRef, title: r.title, description: r.description, category: r.category, priority: r.priority, status: r.status, source: r.source,
    isEmergency: r.priority === "emergency", escalatedAt: r.escalatedAt,
    propertyId: r.propertyId, property: r.property, unitId: r.unitId, unit: r.unit, tenantId: r.tenantId, tenant: r.tenant, assetId: r.assetId, asset: r.asset,
    requesterName: r.requesterName, requesterContact: r.requesterContact,
    submittedAt: r.submittedAt, targetDate: target, triagedAt: r.triagedAt, decidedAt: r.decidedAt, decisionReason: r.decisionReason,
    completedAt: r.completedAt, closedAt: r.closedAt, resolutionNotes: r.resolutionNotes,
    overdue: !!target && target < today && (OPEN_REQUEST_STATUSES as string[]).includes(r.status),
    assignedManager: r.assignedManager ? { membershipId: r.assignedManager.id, name: r.assignedManager.user.fullName } : null,
    feedbackRating: r.feedbackRating, feedbackComment: r.feedbackComment,
    workOrders: r.workOrders.map((w) => ({ ...w, dueAt: d(w.dueAt) })),
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
export type MaintenanceRequestDTO = ReturnType<typeof serialize>;

async function loadScoped(ctx: RequestContext, id: string) {
  const r = await prisma.maintenanceRequest.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!r) throw notFound("Maintenance request");
  requirePropertyAccess(ctx, r.propertyId);
  return r;
}

function assertRequestTransition(from: string, to: RequestStatus) {
  if (!canTransitionRequest(from as RequestStatus, to)) throw businessRule(`A request that is ${humanizeStatus(from)} cannot be moved to ${humanizeStatus(to)}.`);
}

async function assertManager(ctx: RequestContext, membershipId: string, propertyId: string) {
  const m = await prisma.organizationMembership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId, status: "active", tenantId: null },
    include: { role: { include: { permissions: { include: { permission: true } } } }, propertyScopes: true },
  });
  if (!m) throw notFound("Manager");
  if (!m.role.permissions.some((p) => p.permission.key === "maintenance.request.manage")) throw businessRule("That person cannot manage maintenance requests.");
  if (!m.scopeAllProperties && !m.propertyScopes.some((s) => s.propertyId === propertyId)) throw businessRule("That manager does not have access to this property.");
}

/** Validate the unit/asset/tenant links of a request against the property. */
export async function validateRequestLinks(ctx: RequestContext, propertyId: string, links: { unitId?: string | null; assetId?: string | null; tenantId?: string | null }) {
  if (links.unitId) await assertUnitInProperty(ctx, propertyId, links.unitId);
  if (links.assetId) {
    const a = await prisma.asset.findFirst({ where: { id: links.assetId, organizationId: ctx.organizationId } });
    if (!a || a.propertyId !== propertyId) throw businessRule("The selected asset is not at this property.", [{ path: "assetId", message: "Asset is not at this property." }]);
  }
  if (links.tenantId) {
    const t = await prisma.tenant.findFirst({ where: { id: links.tenantId, organizationId: ctx.organizationId } });
    if (!t) throw notFound("Tenant");
    return t;
  }
  return null;
}

export async function listRequests(ctx: RequestContext, rawQ: z.input<typeof requestListSchema>) {
  const q = requestListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.request.read");
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const today = todayInTz(ctx.timezone);
  const where: Prisma.MaintenanceRequestWhereInput = {
    organizationId: ctx.organizationId,
    ...(propertyScopeFilter(ctx) as Prisma.MaintenanceRequestWhereInput),
    ...(q.status === "open" ? { status: { in: OPEN_REQUEST_STATUSES } } : q.status ? { status: q.status } : {}),
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.propertyId ? { propertyId: q.propertyId } : {}),
    ...(q.unitId ? { unitId: q.unitId } : {}),
    ...(q.assetId ? { assetId: q.assetId } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.search ? { OR: [{ requestRef: { contains: q.search, mode: "insensitive" } }, { title: { contains: q.search, mode: "insensitive" } }, { requesterName: { contains: q.search, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.maintenanceRequest.findMany({ where, include, orderBy: [sortFrom(q, ["submittedAt", "requestRef", "priority", "status", "targetDate"], "submittedAt"), { submittedAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.maintenanceRequest.count({ where }),
  ]);
  return paged(rows.map((r) => serialize(r, today)), total, q);
}

export async function getRequest(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.request.read");
  await loadScoped(ctx, id);
  const r = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id }, include });
  const updates = await prisma.maintenanceUpdate.findMany({ where: { requestId: id }, orderBy: { createdAt: "asc" } });
  return { ...serialize(r, todayInTz(ctx.timezone)), updates };
}

export interface NewRequestData {
  propertyId: string; unitId?: string | null; tenantId?: string | null; assetId?: string | null; category: string; title: string; description: string;
  priority: Priority; requesterName: string; requesterContact?: string | null; targetDate?: string | null; source: "staff" | "tenant_portal";
}

/** Shared by staff creation and tenant portal submission. Escalates emergencies after commit. */
export async function insertRequest(ctx: RequestContext, data: NewRequestData) {
  const today = todayInTz(ctx.timezone);
  const r = await prisma.$transaction(async (tx) => {
    const r = await tx.maintenanceRequest.create({
      data: {
        organizationId: ctx.organizationId, requestRef: await nextRef(tx, ctx.organizationId, "MR", { year: true }),
        propertyId: data.propertyId, unitId: data.unitId ?? null, tenantId: data.tenantId ?? null, assetId: data.assetId ?? null,
        category: data.category, title: data.title, description: data.description, priority: data.priority, source: data.source,
        requesterName: data.requesterName, requesterContact: data.requesterContact ?? null,
        targetDate: dateOnly(data.targetDate ?? defaultTargetDate(data.priority, today)), createdById: ctx.userId,
      },
      include,
    });
    await addTimeline(tx, ctx, r.id, { kind: "status_change", visibility: "tenant", body: `Request ${r.requestRef} received.` });
    await recordAudit(tx, ctx, { action: "maintenance_request.created", entityType: "maintenance_request", entityId: r.id, summary: `${r.requestRef} logged (${r.priority}) at ${r.property.name}: ${r.title}`, after: r, metadata: { source: data.source } });
    return r;
  });
  if (r.priority === "emergency") await escalateEmergency(ctx, r);
  return serialize(r, today);
}

export async function createRequest(ctx: RequestContext, raw: z.input<typeof requestCreateSchema>) {
  const input = requestCreateSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.request.create");
  const p = await prisma.property.findFirst({ where: { id: input.propertyId, organizationId: ctx.organizationId } });
  if (!p) throw notFound("Property");
  requirePropertyAccess(ctx, p.id);
  const tenant = await validateRequestLinks(ctx, p.id, input);
  return insertRequest(ctx, {
    ...input, source: "staff",
    requesterName: input.requesterName ?? tenant?.displayName ?? ctx.userName,
    requesterContact: input.requesterContact ?? tenant?.phone ?? null,
  });
}

export async function updateRequest(ctx: RequestContext, id: string, raw: z.input<typeof requestUpdateSchema>) {
  const input = requestUpdateSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.request.manage");
  const before = await loadScoped(ctx, id);
  if (!(OPEN_REQUEST_STATUSES as string[]).includes(before.status)) throw businessRule(`This request is ${humanizeStatus(before.status)} and can no longer be edited.`);
  await validateRequestLinks(ctx, before.propertyId, input);
  if (input.assignedManagerMembershipId) await assertManager(ctx, input.assignedManagerMembershipId, before.propertyId);
  const { targetDate, ...rest } = input;
  const after = await prisma.maintenanceRequest.update({
    where: { id }, data: { ...rest, ...(targetDate !== undefined ? { targetDate: targetDate ? dateOnly(targetDate) : null } : {}) }, include,
  });
  await recordAudit(prisma, ctx, { action: "maintenance_request.updated", entityType: "maintenance_request", entityId: id, summary: `Updated ${after.requestRef}`, before, after });
  if (after.priority === "emergency" && !before.escalatedAt) await escalateEmergency(ctx, after);
  return serialize(after, todayInTz(ctx.timezone));
}

/** Step 2: manager confirms category, priority and validity. */
export async function triageRequest(ctx: RequestContext, id: string, raw: z.input<typeof triageSchema>) {
  const input = triageSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.request.manage");
  const before = await loadScoped(ctx, id);
  assertRequestTransition(before.status, "triaged");
  if (input.assignedManagerMembershipId) await assertManager(ctx, input.assignedManagerMembershipId, before.propertyId);
  const after = await prisma.$transaction(async (tx) => {
    const r = await tx.maintenanceRequest.update({
      where: { id },
      data: {
        status: "triaged", triagedAt: new Date(), ...(input.category ? { category: input.category } : {}), ...(input.priority ? { priority: input.priority } : {}),
        ...(input.targetDate !== undefined ? { targetDate: input.targetDate ? dateOnly(input.targetDate) : null } : {}),
        ...(input.assignedManagerMembershipId !== undefined ? { assignedManagerMembershipId: input.assignedManagerMembershipId } : {}),
      },
      include,
    });
    await addTimeline(tx, ctx, id, { kind: "status_change", visibility: "tenant", body: "Your request is being reviewed." });
    if (input.note) await addTimeline(tx, ctx, id, { visibility: "internal", body: `Triage: ${input.note}` });
    await recordAudit(tx, ctx, { action: "maintenance_request.triaged", entityType: "maintenance_request", entityId: id, summary: `${r.requestRef} triaged as ${r.priority} ${r.category}`, before, after: r });
    return r;
  });
  if (after.priority === "emergency" && !before.escalatedAt) await escalateEmergency(ctx, after);
  return serialize(after, todayInTz(ctx.timezone));
}

async function decide(ctx: RequestContext, id: string, to: "approved" | "rejected" | "cancelled", reason: string | null) {
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.request.manage");
  const before = await loadScoped(ctx, id);
  assertRequestTransition(before.status, to);
  if (to === "cancelled") {
    const open = await prisma.workOrder.count({ where: { maintenanceRequestId: id, status: { notIn: ["cancelled", "closed"] } } });
    if (open) throw businessRule(`This request has ${open} work order(s) that are not closed or cancelled. Cancel them first.`);
  }
  const r = await prisma.$transaction(async (tx) => {
    const res = await tx.maintenanceRequest.updateMany({ where: { id, status: before.status }, data: { status: to, decidedAt: new Date(), decisionReason: reason } });
    if (res.count === 0) throw businessRule("This request was changed by someone else. Refresh and try again.");
    const r = await tx.maintenanceRequest.findUniqueOrThrow({ where: { id }, include });
    const tenantText = { approved: "Your request has been approved and will be scheduled.", rejected: `Your request was not approved${reason ? `: ${reason}` : "."}`, cancelled: `Your request was cancelled${reason ? `: ${reason}` : "."}` }[to];
    await addTimeline(tx, ctx, id, { kind: "status_change", visibility: "tenant", body: tenantText });
    await recordAudit(tx, ctx, { action: `maintenance_request.${to}`, entityType: "maintenance_request", entityId: id, summary: `${r.requestRef} ${to}${reason ? `: ${reason}` : ""}`, before: { status: before.status }, after: { status: to, reason } });
    return r;
  });
  return serialize(r, todayInTz(ctx.timezone));
}

/** Step 3: approve (optionally with a note) or reject (reason required). */
export async function approveRequest(ctx: RequestContext, id: string, raw: z.input<typeof approveSchema>) { return decide(ctx, id, "approved", approveSchema.parse(raw).reason); }
export async function rejectRequest(ctx: RequestContext, id: string, raw: z.input<typeof reasonSchema>) { return decide(ctx, id, "rejected", reasonSchema.parse(raw).reason); }
export async function cancelRequest(ctx: RequestContext, id: string, raw: z.input<typeof reasonSchema>) { return decide(ctx, id, "cancelled", reasonSchema.parse(raw).reason); }

/** Step 4–5: create a work order from an approved request (or link an existing open one) and assign it. */
export async function createWorkOrderFromRequest(ctx: RequestContext, id: string, raw: z.input<typeof createWorkOrderFromRequestSchema>) {
  const input = createWorkOrderFromRequestSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "work_order.assign");
  const r = await loadScoped(ctx, id);
  if (!["approved", "assigned", "in_progress", "waiting_for_parts"].includes(r.status)) {
    throw businessRule(r.status === "submitted" || r.status === "triaged" ? "Approve the request before raising a work order." : `This request is ${humanizeStatus(r.status)}.`);
  }
  const result = await prisma.$transaction(async (tx) => {
    if (input.existingWorkOrderId) {
      const w = await tx.workOrder.findFirst({ where: { id: input.existingWorkOrderId, organizationId: ctx.organizationId } });
      if (!w || w.propertyId !== r.propertyId) throw notFound("Work order");
      if (w.maintenanceRequestId && w.maintenanceRequestId !== id) throw businessRule("That work order already belongs to another request.");
      if (["closed", "cancelled"].includes(w.status)) throw businessRule(`Work order ${w.workOrderRef} is ${w.status}.`);
      await tx.workOrder.update({ where: { id: w.id }, data: { maintenanceRequestId: id } });
      await addTimeline(tx, ctx, id, { kind: "work_order", visibility: "internal", body: `Linked to existing work order ${w.workOrderRef}.` });
      await recordAudit(tx, ctx, { action: "work_order.linked", entityType: "work_order", entityId: w.id, summary: `${w.workOrderRef} linked to ${r.requestRef}` });
      await syncRequestFromWorkOrders(tx, ctx, id);
      return w;
    }
    return createWorkOrderTx(tx, ctx, {
      propertyId: r.propertyId, unitId: r.unitId, assetId: r.assetId, category: r.category, priority: input.priority ?? r.priority,
      scope: input.scope?.trim() || `${r.title}\n\n${r.description}`, assignedUserId: input.assignedUserId, vendorId: input.vendorId,
      scheduledAt: input.scheduledAt, dueAt: input.dueAt ?? d(r.targetDate), checklist: input.checklist, maintenanceRequestId: id, currency: ctx.currency,
    });
  });
  if (!input.existingWorkOrderId && result.assignedUserId && result.assignedUserId !== ctx.userId) {
    await notifyUser(ctx.organizationId, result.assignedUserId, `wo-assigned:${result.id}:${result.assignedUserId}`, `Work order ${result.workOrderRef} assigned to you`, result.scope.slice(0, 300), "work_order.assigned");
  }
  return { workOrderId: result.id, workOrderRef: result.workOrderRef, request: await getRequest(ctx, id) };
}

export async function addRequestUpdate(ctx: RequestContext, id: string, raw: z.input<typeof updateNoteSchema>) {
  const input = updateNoteSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.request.manage");
  const r = await loadScoped(ctx, id);
  await addTimeline(prisma, ctx, id, { kind: "note", visibility: input.visibility, body: input.body });
  await recordAudit(prisma, ctx, { action: "maintenance_request.note_added", entityType: "maintenance_request", entityId: id, summary: `${input.visibility === "tenant" ? "Tenant-visible update" : "Internal note"} on ${r.requestRef}` });
  return { ok: true };
}

/** Step 8: close after authorized review. Every linked work order must be completed, closed or cancelled. */
export async function closeRequest(ctx: RequestContext, id: string, raw: z.input<typeof closeRequestSchema>) {
  const input = closeRequestSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "maintenance.request.manage");
  const before = await loadScoped(ctx, id);
  assertRequestTransition(before.status, "closed");
  const pending = await prisma.workOrder.count({ where: { maintenanceRequestId: id, status: { notIn: ["completed", "closed", "cancelled"] } } });
  if (pending) throw businessRule(`${pending} work order(s) on this request are still open.`);
  const r = await prisma.$transaction(async (tx) => {
    const r = await tx.maintenanceRequest.update({ where: { id }, data: { status: "closed", closedAt: new Date(), closedById: ctx.userId, resolutionNotes: input.resolutionNotes }, include });
    await addTimeline(tx, ctx, id, { kind: "status_change", visibility: "tenant", body: `Request closed. ${input.resolutionNotes}` });
    await recordAudit(tx, ctx, { action: "maintenance_request.closed", entityType: "maintenance_request", entityId: id, summary: `${r.requestRef} closed`, before: { status: before.status }, after: { status: "closed", resolutionNotes: input.resolutionNotes } });
    return r;
  });
  return serialize(r, todayInTz(ctx.timezone));
}
