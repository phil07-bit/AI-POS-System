/**
 * Calendar-date helpers. Business dates (lease start/end, due dates) are plain calendar dates
 * represented as "YYYY-MM-DD" strings in application code and Postgres DATE in the database.
 * Prisma maps DATE to a JS Date at 00:00 UTC; we only ever read the UTC Y/M/D parts.
 * Instants (created_at etc.) are UTC timestamptz and rendered in the organization timezone.
 */

export type ISODate = string; // YYYY-MM-DD

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && toISODate(d) === s;
}

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

/** Date object (UTC midnight) for Prisma @db.Date columns. */
export function dateOnly(s: ISODate): Date {
  if (!isISODate(s)) throw new Error(`Invalid date: ${s}`);
  return new Date(`${s}T00:00:00Z`);
}

/** Today's calendar date in a timezone (default Africa/Accra, which is UTC+0 year-round). */
export function todayInTz(timezone = "Africa/Accra", now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA yields YYYY-MM-DD
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Add calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s: ISODate, months: number): ISODate {
  const [y, m, d] = s.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = dateOnly(s);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

/** b − a in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86_400_000);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}
export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** Inclusive range overlap: [aStart, aEnd] ∩ [bStart, bEnd] ≠ ∅ */
export function rangesOverlap(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Same calendar month, specific day (clamped). */
export function withDayOfMonth(s: ISODate, day: number): ISODate {
  const [y, m] = s.split("-").map(Number);
  const nd = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "05 Mar 2026" — unambiguous day-month order familiar in Ghana. */
export function formatDate(value: Date | ISODate | null | undefined): string {
  if (!value) return "—";
  const s = typeof value === "string" ? value : toISODate(value);
  const [y, m, d] = s.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatDateTime(value: Date | null | undefined, timezone = "Africa/Accra"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(value);
}
