import { describe, expect, it } from "vitest";
import {
  canTransitionRequest, canTransitionWorkOrder, computeNextServiceDate, defaultTargetDate, findRepeatRepairs,
  isWorkOrderOverdue, planGenerationStep, requestStatusFromWorkOrders, serviceStatus, totalCost, warrantyActive,
} from "@/server/domain/maintenance";

describe("maintenance request workflow", () => {
  it("allows the spec flow submitted → triaged → approved → assigned → in progress → completed → closed", () => {
    const path = ["submitted", "triaged", "approved", "assigned", "in_progress", "waiting_for_parts", "in_progress", "completed", "closed"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransitionRequest(path[i - 1], path[i])).toBe(true);
  });
  it("blocks leaving terminal states and skipping approval", () => {
    expect(canTransitionRequest("rejected", "approved")).toBe(false);
    expect(canTransitionRequest("closed", "in_progress")).toBe(false);
    expect(canTransitionRequest("cancelled", "submitted")).toBe(false);
    expect(canTransitionRequest("submitted", "assigned")).toBe(false);
    expect(canTransitionRequest("submitted", "closed")).toBe(false);
  });
  it("derives a default target date from priority", () => {
    expect(defaultTargetDate("emergency", "2026-03-01")).toBe("2026-03-02");
    expect(defaultTargetDate("low", "2026-03-01")).toBe("2026-03-15");
  });
});

describe("work order workflow", () => {
  it("permits start, hold, resume, complete, close", () => {
    expect(canTransitionWorkOrder("assigned", "in_progress")).toBe(true);
    expect(canTransitionWorkOrder("in_progress", "waiting_for_parts")).toBe(true);
    expect(canTransitionWorkOrder("waiting_for_parts", "in_progress")).toBe(true);
    expect(canTransitionWorkOrder("in_progress", "completed")).toBe(true);
    expect(canTransitionWorkOrder("completed", "closed")).toBe(true);
    expect(canTransitionWorkOrder("completed", "in_progress")).toBe(true); // returned for rework
  });
  it("forbids closing unfinished work and reopening closed/cancelled work", () => {
    expect(canTransitionWorkOrder("in_progress", "closed")).toBe(false);
    expect(canTransitionWorkOrder("open", "completed")).toBe(false);
    expect(canTransitionWorkOrder("closed", "in_progress")).toBe(false);
    expect(canTransitionWorkOrder("cancelled", "open")).toBe(false);
    expect(canTransitionWorkOrder("completed", "cancelled")).toBe(false);
  });
  it("detects overdue only for open work past its due date", () => {
    expect(isWorkOrderOverdue({ status: "in_progress", dueAt: "2026-03-01" }, "2026-03-02")).toBe(true);
    expect(isWorkOrderOverdue({ status: "in_progress", dueAt: "2026-03-02" }, "2026-03-02")).toBe(false);
    expect(isWorkOrderOverdue({ status: "completed", dueAt: "2026-03-01" }, "2026-03-05")).toBe(false);
    expect(isWorkOrderOverdue({ status: "open", dueAt: null }, "2026-03-05")).toBe(false);
  });
  it("maps work-order progress onto the request (least-advanced wins; cancelled ignored)", () => {
    expect(requestStatusFromWorkOrders([])).toBeNull();
    expect(requestStatusFromWorkOrders(["cancelled"])).toBe("approved");
    expect(requestStatusFromWorkOrders(["open"])).toBe("approved");
    expect(requestStatusFromWorkOrders(["assigned", "completed"])).toBe("assigned");
    expect(requestStatusFromWorkOrders(["in_progress", "waiting_for_parts"])).toBe("waiting_for_parts");
    expect(requestStatusFromWorkOrders(["completed", "closed", "cancelled"])).toBe("completed");
  });
  it("totals cost parts in integer pesewas", () => {
    expect(totalCost({ labourCostMinor: 15000, materialsCostMinor: 4550, vendorCostMinor: 0, otherCostMinor: 1 })).toBe(19551);
  });
});

describe("assets and preventive maintenance", () => {
  it("computes next service from last service, falling back to install date", () => {
    expect(computeNextServiceDate({ serviceIntervalDays: 90, lastServicedAt: "2026-01-10", installedAt: "2024-01-01" })).toBe("2026-04-10");
    expect(computeNextServiceDate({ serviceIntervalDays: 30, lastServicedAt: null, installedAt: "2026-02-01" })).toBe("2026-03-03");
    expect(computeNextServiceDate({ serviceIntervalDays: null, lastServicedAt: "2026-01-10", installedAt: null })).toBeNull();
    expect(computeNextServiceDate({ serviceIntervalDays: 30, lastServicedAt: null, installedAt: null })).toBeNull();
  });
  it("classifies service status", () => {
    expect(serviceStatus("2026-03-01", "2026-03-02")).toBe("overdue");
    expect(serviceStatus("2026-03-02", "2026-03-02")).toBe("due_soon");
    expect(serviceStatus("2026-03-16", "2026-03-02")).toBe("due_soon");
    expect(serviceStatus("2026-03-17", "2026-03-02")).toBe("ok");
    expect(serviceStatus(null, "2026-03-02")).toBe("not_scheduled");
  });
  it("checks warranty", () => {
    expect(warrantyActive("2026-03-02", "2026-03-02")).toBe(true);
    expect(warrantyActive("2026-03-01", "2026-03-02")).toBe(false);
    expect(warrantyActive(null, "2026-03-02")).toBe(false);
  });
  it("does not generate before the lead window opens", () => {
    expect(planGenerationStep({ nextDueAt: "2026-03-20", intervalDays: 30, leadDays: 7 }, "2026-03-12")).toEqual({ generate: false });
  });
  it("generates inside the lead window and advances one interval", () => {
    expect(planGenerationStep({ nextDueAt: "2026-03-20", intervalDays: 30, leadDays: 7 }, "2026-03-13"))
      .toEqual({ generate: true, occurrence: "2026-03-20", newNextDueAt: "2026-04-19", skipped: 0 });
  });
  it("collapses a long-overdue plan into one catch-up occurrence", () => {
    // Due 1 Jan, monthly-ish (30d), today 15 Mar: 31 Jan and 2 Mar are rolled over; next is 1 Apr.
    expect(planGenerationStep({ nextDueAt: "2026-01-01", intervalDays: 30, leadDays: 0 }, "2026-03-15"))
      .toEqual({ generate: true, occurrence: "2026-01-01", newNextDueAt: "2026-04-01", skipped: 2 });
  });
  it("re-running the step on the advanced plan is a no-op (idempotent)", () => {
    const r = planGenerationStep({ nextDueAt: "2026-03-20", intervalDays: 30, leadDays: 7 }, "2026-03-13");
    if (!r.generate) throw new Error("expected generation");
    expect(planGenerationStep({ nextDueAt: r.newNextDueAt, intervalDays: 30, leadDays: 7 }, "2026-03-13")).toEqual({ generate: false });
  });
});

describe("repeat repair detection", () => {
  const wo = (id: string, createdOn: string, extra: Partial<{ assetId: string | null; unitId: string | null; category: string }> = {}) =>
    ({ id, createdOn, assetId: null, unitId: "u1", propertyId: "p1", category: "plumbing", ...extra });
  it("flags three same-category repairs on one unit within 90 days", () => {
    const r = findRepeatRepairs([wo("a", "2026-01-10"), wo("b", "2026-02-10"), wo("c", "2026-03-01"), wo("d", "2026-03-01", { category: "electrical" })], "2026-03-05");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ targetType: "unit", targetId: "u1", category: "plumbing", count: 3 });
  });
  it("ignores repairs outside the window and groups by asset before unit", () => {
    expect(findRepeatRepairs([wo("a", "2025-10-01"), wo("b", "2026-02-10"), wo("c", "2026-03-01")], "2026-03-05")).toHaveLength(0);
    const r = findRepeatRepairs([1, 2, 3].map((i) => wo(String(i), "2026-03-0" + i, { assetId: "gen1", category: "electrical" })), "2026-03-05");
    expect(r[0]).toMatchObject({ targetType: "asset", targetId: "gen1" });
  });
});
