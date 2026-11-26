import { describe, expect, it } from "vitest";
import { addMonths, addDays, diffDays, formatDate, isISODate, rangesOverlap, todayInTz } from "@/lib/dates";

describe("dates", () => {
  it("adds months with end-of-month clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-03-01", 12)).toBe("2027-03-01");
  });
  it("diffs and adds days", () => {
    expect(diffDays("2026-01-01", "2026-03-01")).toBe(59);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("validates ISO dates", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("26-1-1")).toBe(false);
  });
  it("uses inclusive overlap", () => {
    expect(rangesOverlap("2026-01-01", "2026-06-30", "2026-07-01", "2026-12-31")).toBe(false);
    expect(rangesOverlap("2026-01-01", "2026-06-30", "2026-06-30", "2026-12-31")).toBe(true);
  });
  it("formats day-month-year and resolves Accra today", () => {
    expect(formatDate("2026-03-05")).toBe("05 Mar 2026");
    expect(todayInTz("Africa/Accra", new Date("2026-11-26T23:30:00Z"))).toBe("2026-11-26");
  });
});
