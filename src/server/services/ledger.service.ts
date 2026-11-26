import { prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requireStaff } from "@/lib/auth/context";
import { toISODate, todayInTz } from "@/lib/dates";
import { accountPosition } from "@/server/domain/ledger";
import { loadTenant } from "./tenant.service";
import { leaseCreditPositions, queryChargeBalances } from "./ledger-queries";

export interface LedgerEntry {
  date: string;
  kind: "charge" | "payment" | "payment_pending" | "reversal" | "credit" | "refund" | "void_charge";
  reference: string;
  description: string;
  leaseRef: string | null;
  debitMinor: number;  // increases what the tenant owes
  creditMinor: number; // reduces what the tenant owes
  balanceMinor: number; // running; positive = tenant owes
  counted: boolean;
  linkId?: string;
  sortKey: string;
}

/**
 * Chronological tenant ledger built from append-only rows. Running balance:
 *   + charges − payments (ever confirmed) + reversals − credits + refunds
 * Pending payments are listed but not counted. Reversed payments show BOTH the original
 * payment and the compensating reversal so the history is never rewritten.
 */
export async function buildTenantLedger(organizationId: string, tenantId: string, leaseIds?: string[]) {
  const leaseFilter = leaseIds ? { leaseId: { in: leaseIds } } : {};
  const today = todayInTz();
  const [charges, payments, adjustments, leases] = await Promise.all([
    prisma.rentCharge.findMany({ where: { organizationId, tenantId, ...leaseFilter }, orderBy: { dueDate: "asc" } }),
    prisma.payment.findMany({ where: { organizationId, tenantId, ...leaseFilter }, include: { receipt: true }, orderBy: { receivedAt: "asc" } }),
    prisma.ledgerAdjustment.findMany({ where: { organizationId, tenantId, ...leaseFilter }, orderBy: { createdAt: "asc" } }),
    prisma.lease.findMany({ where: { organizationId, parties: { some: { tenantId } }, ...(leaseIds ? { id: { in: leaseIds } } : {}) }, select: { id: true, leaseRef: true, status: true, unit: { select: { unitRef: true } }, property: { select: { name: true } } } }),
  ]);
  const leaseRef = new Map(leases.map((l) => [l.id, l.leaseRef]));
  const entries: Omit<LedgerEntry, "balanceMinor">[] = [];
  for (const c of charges) {
    const d = toISODate(c.dueDate);
    entries.push({
      date: d, kind: c.voidedAt ? "void_charge" : "charge", reference: c.chargeRef, leaseRef: leaseRef.get(c.leaseId) ?? null,
      description: `${c.description ?? c.chargeType}${c.voidedAt ? ` — VOID (${c.voidReason ?? ""})` : ""}`,
      debitMinor: c.voidedAt ? 0 : c.amountMinor, creditMinor: 0, counted: !c.voidedAt, linkId: c.id, sortKey: `${d}|1|${c.chargeRef}`,
    });
  }
  for (const p of payments) {
    const d = toISODate(p.receivedAt);
    const pending = p.status === "pending";
    entries.push({
      date: d, kind: pending ? "payment_pending" : "payment", reference: p.paymentRef, leaseRef: p.leaseId ? leaseRef.get(p.leaseId) ?? null : null,
      description: `Payment (${p.paymentMethod.replace("_", " ")})${p.receipt ? ` · receipt ${p.receipt.receiptNumber}` : ""}${pending ? " — pending confirmation, not counted" : ""}${p.status === "reversed" ? " — later reversed" : ""}`,
      debitMinor: 0, creditMinor: pending ? 0 : p.amountMinor, counted: !pending, linkId: p.id, sortKey: `${d}|2|${p.paymentRef}`,
    });
  }
  for (const a of adjustments) {
    const d = toISODate(a.createdAt);
    const debit = a.adjustmentType === "reversal" || a.adjustmentType === "refund";
    entries.push({
      date: d, kind: a.adjustmentType as LedgerEntry["kind"], reference: a.adjustmentRef, leaseRef: a.leaseId ? leaseRef.get(a.leaseId) ?? null : null,
      description: `${a.adjustmentType === "reversal" ? `Reversal of ${a.reference}` : a.adjustmentType === "refund" ? "Refund of credit" : `Credit on ${a.reference}`}: ${a.reason}`,
      debitMinor: debit ? a.amountMinor : 0, creditMinor: debit ? 0 : a.amountMinor, counted: true, sortKey: `${d}|3|${a.adjustmentRef}`,
    });
  }
  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  let running = 0;
  const withBalance: LedgerEntry[] = entries.map((e) => { running += e.debitMinor - e.creditMinor; return { ...e, balanceMinor: running }; });

  const balances = await queryChargeBalances(prisma, { organizationId, tenantId, ...(leaseIds ? {} : {}) }, today);
  const scopedBalances = leaseIds ? balances.filter((b) => leaseIds.includes(b.leaseId)) : balances;
  const credit = await leaseCreditPositions(prisma, organizationId, leases.map((l) => l.id));
  const unapplied = [...credit.values()].reduce((s, c) => s + c.unappliedMinor, 0);
  const position = accountPosition({
    chargeBalances: scopedBalances.map((b) => b.balanceMinor),
    confirmedPayments: [...credit.values()].reduce((s, c) => s + c.receivedMinor, 0),
    activeAllocations: [...credit.values()].reduce((s, c) => s + c.allocatedMinor, 0),
    refunds: [...credit.values()].reduce((s, c) => s + c.refundedMinor, 0),
  });
  const overdue = scopedBalances.filter((b) => b.balanceMinor > 0 && b.dueDate < today).reduce((s, b) => s + b.balanceMinor, 0);
  if (position.netBalance !== running) {
    // Ledger and derived balances must agree; a mismatch indicates a data integrity problem.
    throw new Error(`Ledger integrity check failed for tenant ${tenantId}: running ${running} vs derived ${position.netBalance}`);
  }
  return {
    entries: withBalance.reverse(), // newest first for display
    summary: { ...position, unappliedCredit: unapplied, overdueMinor: overdue, asOf: today },
    openCharges: scopedBalances.filter((b) => b.balanceMinor > 0),
    leases,
  };
}

export async function getTenantLedger(ctx: RequestContext, tenantId: string) {
  requireStaff(ctx);
  requirePermission(ctx, "rent.read");
  await loadTenant(ctx, tenantId);
  let leaseIds: string[] | undefined;
  if (!ctx.scopeAllProperties) {
    leaseIds = (await prisma.lease.findMany({ where: { organizationId: ctx.organizationId, parties: { some: { tenantId } }, propertyId: { in: [...ctx.propertyIds] } }, select: { id: true } })).map((l) => l.id);
  }
  return buildTenantLedger(ctx.organizationId, tenantId, leaseIds);
}
