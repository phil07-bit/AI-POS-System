import { describe, expect, it } from "vitest";
import { buildRentSchedule } from "@/server/domain/rent-schedule";
import { accountPosition, agingBucket, allocateOldestFirst, chargeBalance, chargeStatus, validateManualAllocation } from "@/server/domain/ledger";

describe("rent schedule", () => {
  it("generates monthly charges up to the horizon", () => {
    const s = buildRentSchedule({ startDate: "2026-01-15", endDate: "2026-12-14", rentAmountMinor: 250000, billingFrequency: "monthly", dueDay: null }, "2026-03-31");
    expect(s.map((c) => c.periodStart)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
    expect(s[0].periodEnd).toBe("2026-02-14");
    expect(s.every((c) => c.amountMinor === 250000 && !c.prorated)).toBe(true);
  });
  it("prorates a final partial period", () => {
    const s = buildRentSchedule({ startDate: "2026-01-01", endDate: "2026-04-15", rentAmountMinor: 900000, billingFrequency: "quarterly", dueDay: null }, "2027-01-01");
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ periodStart: "2026-04-01", periodEnd: "2026-04-15", prorated: true });
    expect(s[1].amountMinor).toBe(Math.floor((900000 * 15 * 2 + 91) / (91 * 2))); // 15 of 91 days
  });
  it("handles yearly (Ghana-style advance) and due day", () => {
    const s = buildRentSchedule({ startDate: "2026-03-01", endDate: "2028-02-29", rentAmountMinor: 3600000, billingFrequency: "yearly", dueDay: 5 }, "2030-01-01");
    expect(s.map((c) => [c.periodStart, c.dueDate, c.amountMinor])).toEqual([["2026-03-01", "2026-03-05", 3600000], ["2027-03-01", "2027-03-05", 3600000]]);
  });
  it("is deterministic so re-generation can be de-duplicated by period", () => {
    const l = { startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: 100000, billingFrequency: "monthly", dueDay: 1 };
    expect(buildRentSchedule(l, "2026-06-01")).toEqual(buildRentSchedule(l, "2026-06-01"));
    expect(buildRentSchedule({ ...l, billingFrequency: "custom" }, "2026-06-01")).toEqual([]);
  });
});

describe("balances and allocation", () => {
  it("computes balance excluding reversed/pending allocations", () => {
    const b = chargeBalance({ amountMinor: 100000, voided: false, credits: 5000, allocations: [{ amountMinor: 40000, active: true }, { amountMinor: 30000, active: false }] });
    expect(b).toEqual({ paid: 40000, credited: 5000, balance: 55000 });
    expect(() => chargeBalance({ amountMinor: 100, voided: false, credits: 0, allocations: [{ amountMinor: 200, active: true }] })).toThrow();
  });
  it("derives status", () => {
    expect(chargeStatus({ voided: false, amountMinor: 100, balance: 0, dueDate: "2026-01-01" }, "2026-02-01")).toBe("paid");
    expect(chargeStatus({ voided: false, amountMinor: 100, balance: 50, dueDate: "2026-01-01" }, "2026-02-01")).toBe("overdue");
    expect(chargeStatus({ voided: false, amountMinor: 100, balance: 50, dueDate: "2026-03-01" }, "2026-02-01")).toBe("partially_paid");
    expect(chargeStatus({ voided: false, amountMinor: 100, balance: 100, dueDate: "2026-02-01" }, "2026-02-01")).toBe("due");
  });
  it("allocates oldest first and returns the unapplied remainder (advance payment)", () => {
    const r = allocateOldestFirst(250000, [
      { id: "feb", dueDate: "2026-02-01", periodStart: "2026-02-01", balance: 100000 },
      { id: "jan", dueDate: "2026-01-01", periodStart: "2026-01-01", balance: 60000 },
      { id: "paid", dueDate: "2025-12-01", periodStart: "2025-12-01", balance: 0 },
    ]);
    expect(r.allocations).toEqual([{ chargeId: "jan", amountMinor: 60000 }, { chargeId: "feb", amountMinor: 100000 }]);
    expect(r.unapplied).toBe(90000);
  });
  it("handles a partial payment", () => {
    const r = allocateOldestFirst(30000, [{ id: "a", dueDate: "2026-01-01", periodStart: "2026-01-01", balance: 100000 }]);
    expect(r).toEqual({ allocations: [{ chargeId: "a", amountMinor: 30000 }], unapplied: 0 });
  });
  it("validates manual allocations", () => {
    const bal = new Map([["a", 1000], ["b", 500]]);
    expect(validateManualAllocation(1500, [{ chargeId: "a", amountMinor: 1000 }, { chargeId: "b", amountMinor: 500 }], bal)).toBeNull();
    expect(validateManualAllocation(1000, [{ chargeId: "a", amountMinor: 1000 }, { chargeId: "b", amountMinor: 1 }], bal)).toMatch(/exceed the payment/);
    expect(validateManualAllocation(5000, [{ chargeId: "b", amountMinor: 501 }], bal)).toMatch(/outstanding balance/);
    expect(validateManualAllocation(5000, [{ chargeId: "zzz", amountMinor: 1 }], bal)).toMatch(/not open/);
    expect(validateManualAllocation(5000, [{ chargeId: "a", amountMinor: 1 }, { chargeId: "a", amountMinor: 1 }], bal)).toMatch(/only once/);
  });
  it("computes account position with prepayment and refunds", () => {
    expect(accountPosition({ chargeBalances: [0, 0], confirmedPayments: 300000, activeAllocations: 200000, refunds: 50000 }))
      .toEqual({ outstanding: 0, unappliedCredit: 50000, netBalance: -50000 });
    expect(() => accountPosition({ chargeBalances: [], confirmedPayments: 100, activeAllocations: 100, refunds: 1 })).toThrow();
  });
});

describe("arrears aging", () => {
  it("buckets by days overdue and excludes not-yet-due charges", () => {
    expect(agingBucket("2026-11-26", "2026-11-26")).toBeNull();
    expect(agingBucket("2026-12-01", "2026-11-26")).toBeNull();
    expect(agingBucket("2026-11-25", "2026-11-26")).toBe("d0_30");
    expect(agingBucket("2026-10-27", "2026-11-26")).toBe("d0_30"); // 30 days
    expect(agingBucket("2026-10-26", "2026-11-26")).toBe("d31_60");
    expect(agingBucket("2026-08-28", "2026-11-26")).toBe("d61_90"); // 90 days
    expect(agingBucket("2026-08-27", "2026-11-26")).toBe("d90_plus");
  });
});
