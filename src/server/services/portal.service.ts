import { prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/context";
import { z } from "zod";
import { businessRule, forbidden, notFound } from "@/lib/api/errors";
import { MAINTENANCE_CATEGORIES, PRIORITIES } from "@/server/domain/maintenance";
import { insertRequest } from "./maintenance-request.service";
import { addTimeline } from "./maintenance-common";
import { TENANT_STATUS_LABEL } from "./maintenance-labels";
import { recordAudit } from "./audit";
import { toISODate, todayInTz } from "@/lib/dates";
import { leaseDisplayStatus } from "@/server/domain/lease-rules";
import { buildTenantLedger } from "./ledger.service";
import { buildReceipt } from "./payment.service";

/**
 * Tenant portal (spec §3.3). Everything is keyed on ctx.tenantId from the membership —
 * never on an ID supplied by the client — and returns a minimized view (no internal notes,
 * no staff-only fields, no other tenants).
 */
function requireTenant(ctx: RequestContext): string {
  requirePermission(ctx, "portal.self");
  if (!ctx.tenantId) throw forbidden("This area is for tenant portal users.");
  return ctx.tenantId;
}

export async function portalOverview(ctx: RequestContext) {
  const tenantId = requireTenant(ctx);
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId, organizationId: ctx.organizationId }, select: { displayName: true, email: true, phone: true, tenantRef: true } });
  const leases = await prisma.lease.findMany({
    where: { organizationId: ctx.organizationId, parties: { some: { tenantId } }, status: { in: ["active", "expired", "terminated"] } },
    select: { id: true, leaseRef: true, status: true, startDate: true, endDate: true, rentAmountMinor: true, currency: true, billingFrequency: true, depositAmountMinor: true, unit: { select: { unitRef: true, unitName: true } }, property: { select: { name: true } } },
    orderBy: { startDate: "desc" },
  });
  const today = todayInTz(ctx.timezone);
  const ledger = await buildTenantLedger(ctx.organizationId, tenantId, leases.map((l) => l.id));
  return {
    tenant,
    leases: leases.map((l) => ({ ...l, startDate: toISODate(l.startDate), endDate: toISODate(l.endDate), displayStatus: leaseDisplayStatus({ status: l.status, startDate: toISODate(l.startDate), endDate: toISODate(l.endDate) }, today) })),
    ledger: { summary: ledger.summary, entries: ledger.entries.map(({ linkId: _l, ...e }) => e), openCharges: ledger.openCharges },
  };
}

export async function portalReceipts(ctx: RequestContext) {
  const tenantId = requireTenant(ctx);
  const payments = await prisma.payment.findMany({
    where: { organizationId: ctx.organizationId, tenantId, receipt: { isNot: null } },
    select: { id: true, paymentRef: true, amountMinor: true, currency: true, receivedAt: true, status: true, receipt: { select: { receiptNumber: true } } },
    orderBy: { receivedAt: "desc" },
  });
  return payments.map((p) => ({ ...p, receivedAt: toISODate(p.receivedAt) }));
}

export async function portalReceipt(ctx: RequestContext, paymentId: string) {
  const tenantId = requireTenant(ctx);
  const p = await prisma.payment.findFirst({ where: { id: paymentId, organizationId: ctx.organizationId, tenantId } });
  if (!p) throw notFound("Receipt");
  const r = await buildReceipt(ctx.organizationId, paymentId);
  if (!r) throw notFound("Receipt");
  return r;
}

/** Staff attempting to use portal endpoints for an arbitrary tenant is simply not possible: no tenantId param exists. */

// ── Maintenance requests from the tenant portal (phase 4) ─────────────────

export const portalRequestSchema = z.object({
  unitId: z.string().uuid(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  title: z.string().trim().min(3, "Give a short title.").max(160),
  description: z.string().trim().min(10, "Describe the problem (at least 10 characters).").max(4000),
  priority: z.enum(PRIORITIES).default("normal"),
  contact: z.string().trim().max(120).optional().nullable(),
}).strict();
export const portalFeedbackSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional().nullable() }).strict();

/** Units the tenant may report problems for: those on their active (or pending-signature) leases. */
async function portalUnits(ctx: RequestContext, tenantId: string) {
  const leases = await prisma.lease.findMany({
    where: { organizationId: ctx.organizationId, parties: { some: { tenantId } }, status: { in: ["active", "pending_signature"] } },
    select: { unit: { select: { id: true, unitRef: true, unitName: true, propertyId: true, property: { select: { name: true } } } } },
  });
  return [...new Map(leases.map((l) => [l.unit.id, l.unit])).values()];
}

export async function portalMaintenance(ctx: RequestContext) {
  const tenantId = requireTenant(ctx);
  const [units, requests] = await Promise.all([
    portalUnits(ctx, tenantId),
    prisma.maintenanceRequest.findMany({
      where: { organizationId: ctx.organizationId, tenantId },
      select: {
        id: true, requestRef: true, title: true, category: true, priority: true, status: true, submittedAt: true, targetDate: true, completedAt: true,
        feedbackRating: true, feedbackComment: true, unit: { select: { unitRef: true } }, property: { select: { name: true } },
        // Only tenant-visible updates: internal notes never leave the staff side.
        updates: { where: { visibility: "tenant" }, select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { submittedAt: "desc" },
    }),
  ]);
  return {
    units: units.map((u) => ({ id: u.id, label: `${u.property.name} · ${u.unitRef}` })),
    requests: requests.map((r) => ({ ...r, statusLabel: TENANT_STATUS_LABEL[r.status] ?? r.status, targetDate: r.targetDate ? toISODate(r.targetDate) : null })),
  };
}

export async function portalSubmitRequest(ctx: RequestContext, raw: z.input<typeof portalRequestSchema>) {
  const input = portalRequestSchema.parse(raw);
  const tenantId = requireTenant(ctx);
  requirePermission(ctx, "maintenance.request.create");
  const unit = (await portalUnits(ctx, tenantId)).find((u) => u.id === input.unitId);
  if (!unit) throw notFound("Unit"); // not one of the tenant's own units
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId, organizationId: ctx.organizationId }, select: { displayName: true, phone: true } });
  const r = await insertRequest(ctx, {
    propertyId: unit.propertyId, unitId: unit.id, tenantId, category: input.category, title: input.title, description: input.description,
    priority: input.priority, requesterName: tenant.displayName, requesterContact: input.contact || tenant.phone, source: "tenant_portal",
  });
  return { id: r.id, requestRef: r.requestRef, status: r.status, priority: r.priority };
}

export async function portalRequestFeedback(ctx: RequestContext, id: string, raw: z.input<typeof portalFeedbackSchema>) {
  const input = portalFeedbackSchema.parse(raw);
  const tenantId = requireTenant(ctx);
  const r = await prisma.maintenanceRequest.findFirst({ where: { id, organizationId: ctx.organizationId, tenantId } });
  if (!r) throw notFound("Request");
  if (!["completed", "closed"].includes(r.status)) throw businessRule("You can rate the work once it is completed.");
  await prisma.maintenanceRequest.update({ where: { id }, data: { feedbackRating: input.rating, feedbackComment: input.comment ?? null } });
  await addTimeline(prisma, ctx, id, { visibility: "internal", body: `Requester feedback: ${input.rating}/5${input.comment ? ` — ${input.comment}` : ""}` });
  await recordAudit(prisma, ctx, { action: "maintenance_request.feedback", entityType: "maintenance_request", entityId: id, summary: `${r.requestRef} rated ${input.rating}/5 by requester` });
  return { ok: true };
}
