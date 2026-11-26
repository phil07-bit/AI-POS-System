import { describe, expect, it } from "vitest";
import { calculateOccupancy } from "@/server/domain/occupancy";
import { findLeaseConflicts, leaseDisplayStatus, validateLeaseDates } from "@/server/domain/lease-rules";

const u = (id: string, availability = "available", archived = false) => ({ id, availability, archivedAt: archived ? new Date() : null });

describe("occupancy", () => {
  it("derives occupancy from active leases covering the date", () => {
    const units = [u("a"), u("b"), u("c", "under_maintenance"), u("d", "reserved"), u("e", "available", true)];
    const leases = [
      { unitId: "a", status: "active", startDate: "2026-01-01", endDate: "2026-12-31" },
      { unitId: "b", status: "active", startDate: "2027-01-01", endDate: "2027-12-31" }, // future
      { unitId: "d", status: "terminated", startDate: "2026-01-01", endDate: "2026-12-31" },
    ];
    const s = calculateOccupancy(units, leases, "2026-06-01");
    expect(s.totalUnits).toBe(4);
    expect(s.rentableUnits).toBe(3); // a, b, d (c excluded, e archived)
    expect(s.occupiedUnits).toBe(1);
    expect(s.reservedUnits).toBe(1);
    expect(s.occupancyRate).toBe(33.3);
  });
  it("returns null rate when no rentable units", () => {
    expect(calculateOccupancy([u("x", "unavailable")], [], "2026-01-01").occupancyRate).toBeNull();
    expect(calculateOccupancy([], [], "2026-01-01").occupancyRate).toBeNull();
  });
});

describe("lease rules", () => {
  const existing = [
    { id: "L1", status: "active", startDate: "2026-01-01", endDate: "2026-12-31" },
    { id: "L2", status: "terminated", startDate: "2027-01-01", endDate: "2027-12-31" },
    { id: "L3", status: "draft", startDate: "2027-01-01", endDate: "2027-12-31" },
  ];
  it("detects overlapping active leases (inclusive)", () => {
    expect(findLeaseConflicts({ startDate: "2026-12-31", endDate: "2027-06-30" }, existing).map((l) => l.id)).toEqual(["L1"]);
    expect(findLeaseConflicts({ startDate: "2027-01-01", endDate: "2027-06-30" }, existing)).toEqual([]);
    expect(findLeaseConflicts({ id: "L1", startDate: "2026-01-01", endDate: "2026-12-31" }, existing)).toEqual([]);
  });
  it("validates dates", () => {
    expect(validateLeaseDates("2026-02-01", "2026-01-01")).toMatch(/after/);
    expect(validateLeaseDates("2026-01-01", "2026-01-01")).toBeNull();
  });
  it("derives expiry status", () => {
    const l = { status: "active", startDate: "2026-01-01", endDate: "2026-12-31" };
    expect(leaseDisplayStatus(l, "2026-06-01", 60)).toBe("active");
    expect(leaseDisplayStatus(l, "2026-11-15", 60)).toBe("expiring");
    expect(leaseDisplayStatus(l, "2027-01-01", 60)).toBe("expired");
    expect(leaseDisplayStatus(l, "2025-12-01", 60)).toBe("upcoming");
    expect(leaseDisplayStatus({ ...l, status: "terminated" }, "2026-06-01")).toBe("terminated");
  });
});
