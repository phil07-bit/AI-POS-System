import { prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/context";
import { forbidden, notFound } from "@/lib/api/errors";
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
