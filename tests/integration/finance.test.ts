import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, makeOrg, makeMember, address } from "./helpers";
import { createProperty } from "@/server/services/property.service";
import { createUnit } from "@/server/services/unit.service";
import { createTenant } from "@/server/services/tenant.service";
import { activateLease, createLease } from "@/server/services/lease.service";
import { createManualCharge, generateCharges, getCharge, listCharges, voidCharge } from "@/server/services/rent.service";
import { allocatePayment, confirmPayment, creditCharge, getReceipt, recordPayment, refundCredit, reversePayment } from "@/server/services/payment.service";
import { getTenantLedger } from "@/server/services/ledger.service";
import { arrearsReport, collectionSummary } from "@/server/services/report.service";
import { portalOverview, portalReceipt, portalReceipts } from "@/server/services/portal.service";
import { listProperties } from "@/server/services/property.service";
import { addDays, addMonths, todayInTz } from "@/lib/dates";
import { AppError } from "@/lib/api/errors";
import type { RequestContext } from "@/lib/auth/context";

const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof AppError ? e.code : "ERROR"; } };
const today = todayInTz();
const key = () => `idem-${Math.random().toString(36).slice(2)}-${Date.now()}`;

describe("phase 3 — rent ledger, payments, receipts, arrears (Scenarios B & C)", () => {
  let orgId: string;
  let admin: RequestContext, finance: RequestContext, manager: RequestContext, tech: RequestContext;
  let leaseId: string, tenantId: string, otherTenantId: string, otherLeaseId: string;

  beforeAll(async () => {
    await resetDb();
    const org = await makeOrg("Finance Org", { paymentsRequireConfirmation: true });
    orgId = org.id;
    admin = await makeMember(org.id, "org_admin");
    finance = await makeMember(org.id, "finance_officer");
    manager = await makeMember(org.id, "property_manager");
    tech = await makeMember(org.id, "technician");
    const p = await createProperty(admin, { name: "Spintex Gardens", propertyType: "residential", address, status: "active" });
    const u1 = await createUnit(admin, p.id, { unitRef: "G1", unitType: "apartment" });
    const u2 = await createUnit(admin, p.id, { unitRef: "G2", unitType: "apartment" });
    const t1 = await createTenant(manager, { tenantType: "individual", displayName: "Abena Darko", phone: "0201234567" });
    const t2 = await createTenant(manager, { tenantType: "individual", displayName: "Kwame Nkrumah Jr", phone: "0551234567" });
    tenantId = t1.id; otherTenantId = t2.id;
    // Lease started 3 months ago, monthly GHS 2,000 due on the 1st of each period start.
    const start = addMonths(today, -3);
    const l1 = await createLease(manager, { unitId: u1.id, parties: [{ tenantId, partyRole: "primary_tenant" }], startDate: start, endDate: addDays(addMonths(start, 12), -1), rentAmountMinor: 200000, billingFrequency: "monthly" });
    await activateLease(manager, l1.id);
    leaseId = l1.id;
    const l2 = await createLease(manager, { unitId: u2.id, parties: [{ tenantId: otherTenantId, partyRole: "primary_tenant" }], startDate: start, endDate: addDays(addMonths(start, 12), -1), rentAmountMinor: 150000, billingFrequency: "monthly" });
    await activateLease(manager, l2.id);
    otherLeaseId = l2.id;
  });

  it("generated 3+ periods; charges past due are overdue", async () => {
    const list = await listCharges(finance, { leaseId });
    expect(list.total).toBeGreaterThanOrEqual(4);
    expect(list.items.filter((c) => c.status === "overdue").length).toBeGreaterThanOrEqual(3);
  });

  it("technician cannot see financial data; manager cannot reverse", async () => {
    expect(await code(listCharges(tech, {}))).toBe("FORBIDDEN");
    expect(await code(arrearsReport(tech, {}))).toBe("FORBIDDEN");
    const r = await recordPayment(finance, { leaseId, amountMinor: 1000, paymentMethod: "cash", receivedAt: today, idempotencyKey: key() });
    expect(await code(reversePayment(manager, r.payment.id, { reason: "testing reversal" }))).toBe("FORBIDDEN");
    await reversePayment(finance, r.payment.id, { reason: "Cleanup of test payment" });
  });

  it("Scenario B: partial payment → pending (not counted) → confirm → allocated → balance reduces → receipt", async () => {
    const before = await getTenantLedger(finance, tenantId);
    const owed = before.summary.outstanding;
    const r = await recordPayment(finance, { leaseId, amountMinor: 120000, paymentMethod: "mobile_money", receivedAt: today, externalReference: "MTN-MOMO-88231", idempotencyKey: key() });
    expect(r.payment.status).toBe("pending");
    expect(r.payment.receipt).toBeNull();
    const mid = await getTenantLedger(finance, tenantId);
    expect(mid.summary.outstanding).toBe(owed); // pending not counted
    const confirmed = await confirmPayment(finance, r.payment.id, { allocation: "auto" });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.allocatedMinor).toBe(120000);
    expect(confirmed.receipt?.receiptNumber).toMatch(/^RCT-\d{4}-\d{6}$/);
    // Oldest charge gets the money: first charge now partially paid 2,000 − 1,200 = 800.
    const oldest = confirmed.allocations[0].charge.id;
    const ch = await getCharge(finance, oldest);
    expect(ch.balanceMinor).toBe(80000);
    expect(ch.status).toBe("overdue");
    const after = await getTenantLedger(finance, tenantId);
    expect(after.summary.outstanding).toBe(owed - 120000);
    const receipt = await getReceipt(finance, r.payment.id);
    expect(receipt.payment.amountMinor).toBe(120000);
  });

  it("idempotency: a retried submission does not create a second payment", async () => {
    const k = key();
    const a = await recordPayment(finance, { leaseId, amountMinor: 5000, paymentMethod: "cash", receivedAt: today, idempotencyKey: k });
    const b = await recordPayment(finance, { leaseId, amountMinor: 5000, paymentMethod: "cash", receivedAt: today, idempotencyKey: k });
    expect(b.replayed).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    expect(await code(recordPayment(finance, { leaseId, amountMinor: 9999, paymentMethod: "cash", receivedAt: today, idempotencyKey: k }))).toBe("CONFLICT");
    const [x, y] = await Promise.all([1, 2].map(() => recordPayment(finance, { leaseId, amountMinor: 7000, paymentMethod: "cash", receivedAt: today, idempotencyKey: `${k}-race` })));
    expect(x.payment.id).toBe(y.payment.id);
    await reversePayment(finance, a.payment.id, { reason: "Duplicate test entry" });
    await reversePayment(finance, x.payment.id, { reason: "Duplicate test entry" });
  });

  it("advance payment: excess becomes unapplied credit, never a negative charge balance", async () => {
    const pos0 = (await getTenantLedger(finance, otherTenantId)).summary;
    const r = await recordPayment(finance, { leaseId: otherLeaseId, amountMinor: pos0.outstanding + 300000, paymentMethod: "bank_transfer", receivedAt: today, idempotencyKey: key() });
    const c = await confirmPayment(finance, r.payment.id, { allocation: "auto" });
    expect(c.unallocatedMinor).toBe(300000);
    const pos = (await getTenantLedger(finance, otherTenantId)).summary;
    expect(pos.outstanding).toBe(0);
    expect(pos.unappliedCredit).toBe(300000);
    expect(pos.netBalance).toBe(-300000);
    // New charge arrives → allocate the remaining credit to it.
    await generateCharges(finance, { leaseId: otherLeaseId, upTo: addMonths(today, 2) });
    const alloc = await allocatePayment(finance, r.payment.id, { mode: "auto" });
    expect(alloc.unallocatedMinor).toBeLessThan(300000);
    const balances = await listCharges(finance, { leaseId: otherLeaseId });
    expect(balances.items.every((i) => i.balanceMinor >= 0)).toBe(true);
    // Refund only up to unapplied credit.
    const remaining = alloc.unallocatedMinor;
    if (remaining > 0) {
      expect(await code(refundCredit(finance, { leaseId: otherLeaseId, amountMinor: remaining + 1, reason: "Too much refund" }))).toBe("BUSINESS_RULE");
      await refundCredit(finance, { leaseId: otherLeaseId, amountMinor: remaining, reason: "Tenant requested refund of excess" });
      expect((await getTenantLedger(finance, otherTenantId)).summary.unappliedCredit).toBe(0);
    }
  });

  it("allocations cannot exceed the payment or the charge balance", async () => {
    const r = await recordPayment(finance, { leaseId, amountMinor: 50000, paymentMethod: "cash", receivedAt: today, idempotencyKey: key() });
    await confirmPayment(finance, r.payment.id, { allocation: "none" });
    const open = (await getTenantLedger(finance, tenantId)).openCharges;
    expect(await code(allocatePayment(finance, r.payment.id, { allocations: [{ chargeId: open[0].id, amountMinor: 60000 }] }))).toBe("BUSINESS_RULE");
    expect(await code(allocatePayment(finance, r.payment.id, { allocations: [{ chargeId: open[0].id, amountMinor: open[0].balanceMinor + 1 }] }))).toBe("BUSINESS_RULE");
    // Cross-tenant: cannot allocate to another lease's charge.
    const otherOpen = (await listCharges(finance, { leaseId: otherLeaseId, status: "open" })).items;
    if (otherOpen[0]) expect(await code(allocatePayment(finance, r.payment.id, { allocations: [{ chargeId: otherOpen[0].id, amountMinor: 1 }] }))).toBe("BUSINESS_RULE");
    // Concurrent manual allocations of the full amount: only one succeeds.
    const target = open.find((c) => c.balanceMinor >= 50000) ?? open[0];
    const amt = Math.min(50000, target.balanceMinor);
    const res = await Promise.allSettled([1, 2].map(() => allocatePayment(finance, r.payment.id, { allocations: [{ chargeId: target.id, amountMinor: amt }] })));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const total = await prisma.paymentAllocation.aggregate({ where: { paymentId: r.payment.id, reversedAt: null }, _sum: { allocatedAmountMinor: true } });
    expect(total._sum.allocatedAmountMinor).toBeLessThanOrEqual(50000);
  });

  it("payment recording and allocation are atomic (failure rolls back everything)", async () => {
    const before = await prisma.payment.count();
    // Force a failure inside the transaction by allocating to a charge that is not open → rolls back.
    const org = await prisma.organization.update({ where: { id: orgId }, data: { paymentsRequireConfirmation: false } });
    const fresh = { ...finance };
    const bogus = "00000000-0000-4000-8000-000000000000";
    expect(await code(recordPayment(fresh, { leaseId, amountMinor: 1000, paymentMethod: "cash", receivedAt: today, idempotencyKey: key(), allocation: [{ chargeId: bogus, amountMinor: 1000 }] }))).toBe("BUSINESS_RULE");
    expect(await prisma.payment.count()).toBe(before);
    await prisma.organization.update({ where: { id: org.id }, data: { paymentsRequireConfirmation: true } });
  });

  it("Scenario C: reversal keeps the original, writes a compensating entry, re-opens balances and is audited", async () => {
    const ledger0 = await getTenantLedger(finance, tenantId);
    const r = await recordPayment(finance, { leaseId, amountMinor: 80000, paymentMethod: "cheque", receivedAt: today, externalReference: "CHQ 004512", idempotencyKey: key() });
    await confirmPayment(finance, r.payment.id, { allocation: "auto" });
    const mid = await getTenantLedger(finance, tenantId);
    expect(mid.summary.outstanding).toBe(ledger0.summary.outstanding - 80000);
    expect(await code(reversePayment(finance, r.payment.id, { reason: "bad" }))).toBe("ERROR"); // too short (zod)
    const rev = await reversePayment(finance, r.payment.id, { reason: "Cheque bounced — returned by bank" });
    expect(rev.status).toBe("reversed");
    expect(rev.allocations.every((a) => a.reversedAt)).toBe(true);
    expect(rev.reversalAdjustment?.amountMinor).toBe(80000);
    const end = await getTenantLedger(finance, tenantId);
    expect(end.summary.outstanding).toBe(ledger0.summary.outstanding);
    expect(end.entries.some((e) => e.reference === r.payment.paymentRef && e.kind === "payment")).toBe(true);
    expect(end.entries.some((e) => e.kind === "reversal")).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: "payment.reversed", entityId: r.payment.id } });
    expect(audit?.actorUserId).toBe(finance.userId);
    expect(audit?.summary).toMatch(/Cheque bounced/);
    expect(await code(reversePayment(finance, r.payment.id, { reason: "again please" }))).toBe("BUSINESS_RULE");
    await expect(prisma.payment.delete({ where: { id: r.payment.id } })).rejects.toThrow();
  });

  it("manual charges, duplicate protection, credits and voids", async () => {
    const svc = await createManualCharge(finance, { leaseId, chargeType: "service_charge", periodStart: today, periodEnd: addDays(addMonths(today, 1), -1), dueDate: addDays(today, 7), amountMinor: 25000, description: "Estate security & waste levy" });
    expect(svc.status).toBe("due");
    expect(await code(createManualCharge(finance, { leaseId, chargeType: "service_charge", periodStart: today, periodEnd: addDays(today, 5), dueDate: today, amountMinor: 100 }))).toBe("CONFLICT");
    expect(await code(creditCharge(finance, { chargeId: svc.id, amountMinor: 30000, reason: "Over-credit attempt" }))).toBe("BUSINESS_RULE");
    await creditCharge(finance, { chargeId: svc.id, amountMinor: 5000, reason: "Approved waiver for water outage" });
    expect((await getCharge(finance, svc.id)).balanceMinor).toBe(20000);
    expect(await code(voidCharge(finance, svc.id, "Raised in error"))).toBe("BUSINESS_RULE"); // has a credit
    const other = await createManualCharge(finance, { leaseId, chargeType: "utility", periodStart: today, periodEnd: today, dueDate: today, amountMinor: 1234 });
    await voidCharge(finance, other.id, "Raised in error");
    expect((await getCharge(finance, other.id)).status).toBe("void");
  });

  it("arrears report buckets overdue balances and excludes future charges; collection summary separates cash and charge-period measures", async () => {
    const a = await arrearsReport(finance, {});
    expect(a.totals.overdueAccounts).toBeGreaterThanOrEqual(1);
    const row = a.rows.find((r) => r.tenantId === tenantId)!;
    expect(row.totalMinor).toBeGreaterThan(0);
    const sumBuckets = Object.values(row.buckets).reduce((s, v) => s + v, 0);
    expect(sumBuckets).toBe(row.totalMinor);
    const ledger = await getTenantLedger(finance, tenantId);
    expect(row.totalMinor).toBe(ledger.summary.overdueMinor);
    const c = await collectionSummary(finance, { from: addMonths(today, -3), to: today });
    expect(c.billedMinor).toBeGreaterThan(0);
    expect(c.collectionRate).not.toBeNull();
    expect(c.cashReceivedMinor).toBeGreaterThan(0);
    expect(c.meta.definition).toMatch(/Cash received is shown separately/);
  });

  it("tenant portal sees only their own ledger and receipts", async () => {
    const portal = await makeMember(orgId, "tenant_portal", { tenantId });
    const ov = await portalOverview(portal);
    expect(ov.tenant.displayName).toBe("Abena Darko");
    expect(ov.leases.every((l) => l.id === leaseId)).toBe(true);
    const receipts = await portalReceipts(portal);
    expect(receipts.length).toBeGreaterThan(0);
    // Another tenant's payment is not reachable.
    const otherPayment = await prisma.payment.findFirstOrThrow({ where: { tenantId: otherTenantId } });
    expect(await code(portalReceipt(portal, otherPayment.id))).toBe("NOT_FOUND");
    // Staff endpoints are refused outright.
    expect(await code(getTenantLedger(portal, otherTenantId))).toBe("FORBIDDEN");
    expect(await code(listProperties(portal, {}))).toBe("FORBIDDEN");
    expect(await code(arrearsReport(portal, {}))).toBe("FORBIDDEN");
  });

  it("cross-organization: finance user of another org cannot touch these payments or ledgers", async () => {
    const orgB = await makeOrg("Other Org");
    const finB = await makeMember(orgB.id, "finance_officer");
    const pay = await prisma.payment.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(await code(reversePayment(finB, pay.id, { reason: "malicious reversal" }))).toBe("NOT_FOUND");
    expect(await code(getTenantLedger(finB, tenantId))).toBe("NOT_FOUND");
    expect(await code(recordPayment(finB, { leaseId, amountMinor: 100, paymentMethod: "cash", receivedAt: today, idempotencyKey: key() }))).toBe("NOT_FOUND");
    expect((await arrearsReport(finB, {})).rows).toHaveLength(0);
  });
});
