import type { ISODate } from "@/lib/dates";

/**
 * Occupancy (spec §9.1).
 *  occupied_units           = rentable units with an ACTIVE lease covering the as-at date
 *  available_rentable_units = units not archived and not marked unavailable / under maintenance
 *  occupancy_rate           = occupied / available × 100, or null when the denominator is 0.
 * Reserved units are rentable (in the denominator) but not occupied.
 */
export const OCCUPANCY_DEFINITION =
  "Occupancy = units with an active lease covering the as-at date ÷ rentable units (excludes archived, unavailable and under-maintenance units) × 100.";

export interface UnitLike { id: string; availability: string; archivedAt: Date | null }
export interface LeaseLike { unitId: string; status: string; startDate: ISODate; endDate: ISODate }

export type UnitOccupancy = "occupied" | "vacant" | "reserved" | "unavailable" | "under_maintenance" | "archived";

export function unitOccupancyStatus(unit: UnitLike, coveringLease: boolean): UnitOccupancy {
  if (unit.archivedAt) return "archived";
  if (unit.availability === "unavailable" || unit.availability === "under_maintenance") return unit.availability;
  if (coveringLease) return "occupied";
  return unit.availability === "reserved" ? "reserved" : "vacant";
}

export function leaseCovers(l: LeaseLike, asOf: ISODate): boolean {
  return l.status === "active" && l.startDate <= asOf && asOf <= l.endDate;
}

export interface OccupancySummary {
  totalUnits: number;
  rentableUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  reservedUnits: number;
  excludedUnits: number; // unavailable + under maintenance
  occupancyRate: number | null; // percentage with 1 decimal, null if not applicable
  asOf: ISODate;
  definition: string;
}

export function calculateOccupancy(units: UnitLike[], leases: LeaseLike[], asOf: ISODate): OccupancySummary {
  const covered = new Set(leases.filter((l) => leaseCovers(l, asOf)).map((l) => l.unitId));
  let rentable = 0, occupied = 0, vacant = 0, reserved = 0, excluded = 0, total = 0;
  for (const u of units) {
    if (u.archivedAt) continue;
    total++;
    const s = unitOccupancyStatus(u, covered.has(u.id));
    if (s === "unavailable" || s === "under_maintenance") { excluded++; continue; }
    rentable++;
    if (s === "occupied") occupied++;
    else if (s === "reserved") reserved++;
    else vacant++;
  }
  return {
    totalUnits: total, rentableUnits: rentable, occupiedUnits: occupied, vacantUnits: vacant, reservedUnits: reserved,
    excludedUnits: excluded, occupancyRate: rentable === 0 ? null : Math.round((occupied / rentable) * 1000) / 10,
    asOf, definition: OCCUPANCY_DEFINITION,
  };
}
