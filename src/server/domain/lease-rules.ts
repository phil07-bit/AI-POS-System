import { addDays, diffDays, rangesOverlap, type ISODate } from "@/lib/dates";

export type LeaseStoredStatus = "draft" | "pending_signature" | "active" | "expired" | "terminated";
export type LeaseDisplayStatus = LeaseStoredStatus | "expiring" | "upcoming";

/**
 * Display status derived from dates while preserving recorded events (spec §4.5):
 *  - terminated / draft / pending_signature are recorded states and win.
 *  - active with end date passed → expired; within warning window → expiring; start in future → upcoming.
 */
export function leaseDisplayStatus(
  l: { status: string; startDate: ISODate; endDate: ISODate },
  today: ISODate,
  warningDays = 60,
): LeaseDisplayStatus {
  if (l.status !== "active") return l.status as LeaseStoredStatus;
  if (l.endDate < today) return "expired";
  if (l.startDate > today) return "upcoming";
  if (diffDays(today, l.endDate) <= warningDays) return "expiring";
  return "active";
}

export interface DateRangeLease { id: string; status: string; startDate: ISODate; endDate: ISODate }

/**
 * Lease conflict rule (spec §9.4). Date ranges are INCLUSIVE on both ends: a lease ending
 * 2026-06-30 and one starting 2026-07-01 do not conflict; one starting 2026-06-30 does.
 * Active leases ("active or scheduled" — scheduled leases are active with a future start) conflict.
 */
export function findLeaseConflicts(candidate: { id?: string; startDate: ISODate; endDate: ISODate }, others: DateRangeLease[]): DateRangeLease[] {
  return others.filter((o) => o.id !== candidate.id && o.status === "active" && rangesOverlap(candidate.startDate, candidate.endDate, o.startDate, o.endDate));
}

export function validateLeaseDates(startDate: ISODate, endDate: ISODate): string | null {
  if (endDate < startDate) return "End date must be on or after the start date.";
  if (diffDays(startDate, endDate) > 366 * 25) return "Lease term cannot exceed 25 years.";
  return null;
}

/** Renewal proposal: new term starts the day after the old one ends, same length by default. */
export function proposeRenewalDates(endDate: ISODate, months: number, addMonthsFn: (d: ISODate, m: number) => ISODate) {
  const start = addDays(endDate, 1);
  return { startDate: start, endDate: addDays(addMonthsFn(start, months), -1) };
}
