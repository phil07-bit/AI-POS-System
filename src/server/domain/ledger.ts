import { diffDays, type ISODate } from "@/lib/dates";

/**
 * Pure ledger maths. Services load rows; these functions decide. Keeping them pure lets the
 * critical financial rules be unit-tested exhaustively without a database.
 */

export interface ChargeBalanceInput {
  amountMinor: number;
  voided: boolean;
  allocations: { amountMinor: number; active: boolean }[]; // active = payment confirmed AND allocation not reversed
  credits: number; // approved credit adjustments targeting this charge
}

/** Charge balance = amount − confirmed allocations − credits (never negative). */
export function chargeBalance(c: ChargeBalanceInput): { paid: number; credited: number; balance: number } {
  if (c.voided) return { paid: 0, credited: 0, balance: 0 };
  const paid = c.allocations.filter((a) => a.active).reduce((s, a) => s + a.amountMinor, 0);
  const balance = c.amountMinor - paid - c.credits;
  if (balance < 0) throw new Error("Invariant violated: charge balance is negative");
  return { paid, credited: c.credits, balance };
}

export type ChargeStatus = "due" | "partially_paid" | "paid" | "overdue" | "void";

export function chargeStatus(c: { voided: boolean; amountMinor: number; balance: number; dueDate: ISODate }, today: ISODate): ChargeStatus {
  if (c.voided) return "void";
  if (c.balance === 0) return "paid";
  if (c.dueDate < today) return "overdue";
  if (c.balance < c.amountMinor) return "partially_paid";
  return "due";
}

export interface OpenCharge { id: string; dueDate: ISODate; periodStart: ISODate; balance: number }

/**
 * Default allocation rule (visible in UI): oldest due date first, then earliest period.
 * Returns allocations and the unapplied remainder (which becomes tenant credit/prepayment).
 */
export function allocateOldestFirst(amountMinor: number, charges: OpenCharge[]): { allocations: { chargeId: string; amountMinor: number }[]; unapplied: number } {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new Error("amount must be a non-negative integer");
  const sorted = [...charges].filter((c) => c.balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.periodStart.localeCompare(b.periodStart) || a.id.localeCompare(b.id));
  let remaining = amountMinor;
  const allocations: { chargeId: string; amountMinor: number }[] = [];
  for (const c of sorted) {
    if (remaining === 0) break;
    const take = Math.min(remaining, c.balance);
    allocations.push({ chargeId: c.id, amountMinor: take });
    remaining -= take;
  }
  return { allocations, unapplied: remaining };
}

/** Validate a manual allocation request against payment remainder and charge balances. */
export function validateManualAllocation(
  unallocatedOnPayment: number,
  requested: { chargeId: string; amountMinor: number }[],
  balances: Map<string, number>,
): string | null {
  let total = 0;
  const seen = new Set<string>();
  for (const r of requested) {
    if (!Number.isInteger(r.amountMinor) || r.amountMinor <= 0) return "Allocation amounts must be positive whole pesewas.";
    if (seen.has(r.chargeId)) return "Each charge may appear only once per allocation request.";
    seen.add(r.chargeId);
    const bal = balances.get(r.chargeId);
    if (bal === undefined) return "One or more charges are not open for this tenant.";
    if (r.amountMinor > bal) return "An allocation exceeds the charge's outstanding balance.";
    total += r.amountMinor;
  }
  if (total > unallocatedOnPayment) return "Allocations exceed the payment's unallocated amount.";
  return null;
}

export const AGING_BUCKETS = [
  { key: "d0_30", label: "0–30 days", min: 0, max: 30 },
  { key: "d31_60", label: "31–60 days", min: 31, max: 60 },
  { key: "d61_90", label: "61–90 days", min: 61, max: 90 },
  { key: "d90_plus", label: "90+ days", min: 91, max: Infinity },
] as const;
export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

/** Days overdue = as-at date − due date. Only charges due BEFORE the as-at date are arrears (§9.2). */
export function agingBucket(dueDate: ISODate, asOf: ISODate): AgingKey | null {
  const days = diffDays(dueDate, asOf);
  if (days <= 0) return null;
  for (const b of AGING_BUCKETS) if (days >= b.min && days <= b.max) return b.key;
  return "d90_plus";
}

/**
 * Tenant account position:
 *  outstanding = Σ open charge balances
 *  unapplied credit (prepayment) = Σ confirmed payments − Σ active allocations − Σ refunds
 *  net balance = outstanding − unapplied credit (positive = tenant owes)
 */
export function accountPosition(input: { chargeBalances: number[]; confirmedPayments: number; activeAllocations: number; refunds: number }) {
  const outstanding = input.chargeBalances.reduce((s, b) => s + b, 0);
  const unapplied = input.confirmedPayments - input.activeAllocations - input.refunds;
  if (unapplied < 0) throw new Error("Invariant violated: unapplied credit is negative");
  return { outstanding, unappliedCredit: unapplied, netBalance: outstanding - unapplied };
}
