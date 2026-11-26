import { addDays, addMonths, diffDays, minDate, withDayOfMonth, type ISODate } from "@/lib/dates";
import { prorateMinor } from "@/lib/money";

export const FREQUENCY_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

export interface ScheduleLease {
  startDate: ISODate;
  endDate: ISODate; // inclusive
  rentAmountMinor: number; // per period
  billingFrequency: string;
  dueDay: number | null;
}

export interface ScheduledCharge {
  periodStart: ISODate;
  periodEnd: ISODate;
  dueDate: ISODate;
  amountMinor: number;
  prorated: boolean;
}

/**
 * Build the rent schedule for a lease: one charge per billing period from the start date,
 * up to and including periods that START on or before `horizon`.
 * - Periods are anchored on the lease start date (e.g. start 15 Mar, quarterly → 15 Mar, 15 Jun …).
 * - A final partial period is pro-rated by days (integer arithmetic). ASSUMPTION — documented in README;
 *   organisations that bill a full final period can adjust with a manual charge/credit.
 * - Due date = period start, or the lease's due day within the period-start month (never before period start).
 * - "custom" frequency generates nothing; finance staff raise manual charges.
 */
export function buildRentSchedule(lease: ScheduleLease, horizon: ISODate): ScheduledCharge[] {
  const months = FREQUENCY_MONTHS[lease.billingFrequency];
  if (!months) return [];
  const out: ScheduledCharge[] = [];
  const last = minDate(horizon, lease.endDate);
  for (let i = 0; i < 1000; i++) {
    const periodStart = addMonths(lease.startDate, i * months);
    if (periodStart > last || periodStart > lease.endDate) break;
    const fullEnd = addDays(addMonths(lease.startDate, (i + 1) * months), -1);
    const periodEnd = minDate(fullEnd, lease.endDate);
    let amount = lease.rentAmountMinor;
    let prorated = false;
    if (periodEnd < fullEnd) {
      amount = prorateMinor(lease.rentAmountMinor, diffDays(periodStart, periodEnd) + 1, diffDays(periodStart, fullEnd) + 1);
      prorated = true;
    }
    let dueDate = periodStart;
    if (lease.dueDay) {
      const candidate = withDayOfMonth(periodStart, lease.dueDay);
      dueDate = candidate < periodStart ? periodStart : candidate;
    }
    if (amount > 0) out.push({ periodStart, periodEnd, dueDate, amountMinor: amount, prorated });
  }
  return out;
}
