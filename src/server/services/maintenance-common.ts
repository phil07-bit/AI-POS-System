import { prisma, type Db } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { businessRule, notFound } from "@/lib/api/errors";
import { canTransitionRequest, requestStatusFromWorkOrders, type RequestStatus } from "@/server/domain/maintenance";
import { sendEmail } from "@/server/integrations/email";
import { TENANT_STATUS_LABEL } from "./maintenance-labels";

type Actor = Pick<RequestContext, "organizationId" | "userId" | "userName" | "requestId">;

/** Append a timeline entry to a maintenance request. */
export async function addTimeline(db: Db, actor: Actor, requestId: string, entry: { kind?: string; visibility?: "internal" | "tenant"; body: string }) {
  await db.maintenanceUpdate.create({
    data: { organizationId: actor.organizationId, requestId, kind: entry.kind ?? "note", visibility: entry.visibility ?? "internal", body: entry.body, authorUserId: actor.userId ?? null, authorName: actor.userName },
  });
}

/**
 * Keep a request's status in step with its work orders (spec §4.7 steps 4–7).
 * Tenant-visible timeline entries are written for each change, so requesters see progress
 * without seeing internal notes.
 */
export async function syncRequestFromWorkOrders(db: Db, actor: Actor, requestId: string) {
  const req = await db.maintenanceRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (["closed", "rejected", "cancelled"].includes(req.status)) return req.status;
  const wos = await db.workOrder.findMany({ where: { maintenanceRequestId: requestId }, select: { status: true } });
  const implied = requestStatusFromWorkOrders(wos.map((w) => w.status));
  if (!implied || implied === req.status) return req.status;
  if (!canTransitionRequest(req.status as RequestStatus, implied)) return req.status;
  await db.maintenanceRequest.update({
    where: { id: requestId },
    data: { status: implied, ...(implied === "completed" ? { completedAt: new Date() } : req.status === "completed" ? { completedAt: null } : {}) },
  });
  await addTimeline(db, actor, requestId, { kind: "status_change", visibility: "tenant", body: `Status: ${TENANT_STATUS_LABEL[implied] ?? implied}.` });
  return implied;
}

/** Staff who must hear about an emergency on this property: anyone who can manage requests in scope, plus the property manager. */
export async function escalationRecipients(organizationId: string, propertyId: string) {
  const members = await prisma.organizationMembership.findMany({
    where: {
      organizationId, status: "active", tenantId: null, user: { status: "active" },
      OR: [
        { role: { permissions: { some: { permission: { key: "maintenance.request.manage" } } } }, OR: [{ scopeAllProperties: true }, { propertyScopes: { some: { propertyId } } }] },
        { managedProperties: { some: { id: propertyId } } },
      ],
    },
    select: { userId: true, user: { select: { email: true, fullName: true } } },
  });
  return members;
}

/**
 * Emergency escalation (spec §4.7). Sends an in-app notification and an email (mock adapter by
 * default) to responsible staff. Idempotent per request and recipient. It does NOT imply a staffed
 * 24/7 service; the UI says so explicitly.
 */
export async function escalateEmergency(actor: Actor, request: { id: string; requestRef: string; title: string; propertyId: string }) {
  const recipients = await escalationRecipients(actor.organizationId, request.propertyId);
  const property = await prisma.property.findUniqueOrThrow({ where: { id: request.propertyId }, select: { name: true } });
  const subject = `EMERGENCY maintenance ${request.requestRef}: ${request.title}`;
  const body = `An emergency maintenance request was logged at ${property.name}.\n\n${request.requestRef} — ${request.title}\n\nOpen it in AI-POS to triage and assign. This alert is sent to staff responsible for the property; it is not a monitored 24/7 service.`;
  for (const r of recipients) {
    await prisma.notification.upsert({
      where: { idempotencyKey: `mr-emergency-inapp:${request.id}:${r.userId}` },
      update: {},
      create: { organizationId: actor.organizationId, userId: r.userId, recipient: r.userId, eventType: "maintenance.emergency", channel: "in_app", subject, body, provider: "in_app", status: "pending", idempotencyKey: `mr-emergency-inapp:${request.id}:${r.userId}` },
    });
    await sendEmail({ to: r.user.email, subject, body, eventType: "maintenance.emergency", idempotencyKey: `mr-emergency-email:${request.id}:${r.userId}`, organizationId: actor.organizationId, userId: r.userId });
  }
  await prisma.maintenanceRequest.update({ where: { id: request.id }, data: { escalatedAt: new Date() } });
  await addTimeline(prisma, actor, request.id, { kind: "note", visibility: "internal", body: `Emergency escalation sent to ${recipients.length} staff member(s): ${recipients.map((r) => r.user.fullName).join(", ") || "none found"}.` });
  return recipients.length;
}

/** In-app notification to one user (e.g. a technician newly assigned to a work order). Idempotent by key. */
export async function notifyUser(organizationId: string, userId: string, key: string, subject: string, body: string, eventType: string) {
  await prisma.notification.upsert({
    where: { idempotencyKey: key },
    update: {},
    create: { organizationId, userId, recipient: userId, eventType, channel: "in_app", subject, body, provider: "in_app", status: "pending", idempotencyKey: key },
  });
}

/**
 * An internal assignee must be an active staff member of this organization who can update work orders
 * and can access the property. Returns the user's display name.
 */
export async function assertAssignableUser(db: Db, ctx: Pick<RequestContext, "organizationId">, userId: string, propertyId: string) {
  const m = await db.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId: ctx.organizationId, userId } },
    include: { user: true, role: { include: { permissions: { include: { permission: true } } } }, propertyScopes: true },
  });
  if (!m || m.tenantId || m.status !== "active" || m.user.status !== "active") throw notFound("Assignee");
  if (!m.role.permissions.some((p) => p.permission.key === "work_order.update")) throw businessRule(`${m.user.fullName} cannot be assigned work orders (their role lacks work_order.update).`);
  if (!m.scopeAllProperties && !m.propertyScopes.some((s) => s.propertyId === propertyId)) throw businessRule(`${m.user.fullName} does not have access to this property.`);
  return m.user;
}

/** Staff who can be assigned work orders on a property (for pickers). */
export async function listAssignableUsers(ctx: RequestContext, propertyId?: string) {
  const members = await prisma.organizationMembership.findMany({
    where: {
      organizationId: ctx.organizationId, status: "active", tenantId: null, user: { status: "active" },
      role: { permissions: { some: { permission: { key: "work_order.update" } } } },
      ...(propertyId ? { OR: [{ scopeAllProperties: true }, { propertyScopes: { some: { propertyId } } }] } : {}),
    },
    select: { userId: true, user: { select: { fullName: true } }, role: { select: { name: true } } },
    orderBy: { user: { fullName: "asc" } },
  });
  return members.map((m) => ({ id: m.userId, name: m.user.fullName, role: m.role.name }));
}
