import { Prisma, type Db } from "@/lib/db";
import { toISODate } from "@/lib/dates";
import { chargeStatus } from "@/server/domain/ledger";

/**
 * Derived balances straight from ledger rows (single source of truth):
 *   paid     = Σ allocations whose payment is CONFIRMED and allocation not reversed
 *   credited = Σ credit adjustments targeting the charge
 *   balance  = amount − paid − credited   (void charges → 0)
 */
export interface ChargeBalanceRow {
  id: string; chargeRef: string; chargeType: string; leaseId: string; tenantId: string; propertyId: string; unitId: string;
  periodStart: string; periodEnd: string; dueDate: string; amountMinor: number; paidMinor: number; creditedMinor: number;
  balanceMinor: number; voided: boolean; status: string; description: string | null; createdAt: Date;
}

export interface ChargeFilter {
  organizationId: string;
  chargeIds?: string[];
  leaseId?: string;
  tenantId?: string;
  propertyIds?: string[] | null; // null = all
  propertyId?: string;
  dueBefore?: string; // exclusive
  dueFrom?: string; dueTo?: string; // inclusive
  openOnly?: boolean;
  includeVoid?: boolean;
}

export async function queryChargeBalances(db: Db, f: ChargeFilter, today: string): Promise<ChargeBalanceRow[]> {
  const conds: Prisma.Sql[] = [Prisma.sql`c.organization_id = ${f.organizationId}::uuid`];
  if (f.chargeIds) conds.push(f.chargeIds.length ? Prisma.sql`c.id IN (${Prisma.join(f.chargeIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.sql`FALSE`);
  if (f.leaseId) conds.push(Prisma.sql`c.lease_id = ${f.leaseId}::uuid`);
  if (f.tenantId) conds.push(Prisma.sql`c.tenant_id = ${f.tenantId}::uuid`);
  if (f.propertyId) conds.push(Prisma.sql`c.property_id = ${f.propertyId}::uuid`);
  if (f.propertyIds) conds.push(f.propertyIds.length ? Prisma.sql`c.property_id IN (${Prisma.join(f.propertyIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.sql`FALSE`);
  if (f.dueBefore) conds.push(Prisma.sql`c.due_date < ${f.dueBefore}::date`);
  if (f.dueFrom) conds.push(Prisma.sql`c.due_date >= ${f.dueFrom}::date`);
  if (f.dueTo) conds.push(Prisma.sql`c.due_date <= ${f.dueTo}::date`);
  if (!f.includeVoid) conds.push(Prisma.sql`c.voided_at IS NULL`);
  const rows = await db.$queryRaw<Array<{
    id: string; charge_ref: string; charge_type: string; lease_id: string; tenant_id: string; property_id: string; unit_id: string;
    period_start: Date; period_end: Date; due_date: Date; amount_minor: number; paid: bigint; credited: bigint; voided: boolean; description: string | null; created_at: Date;
  }>>`
    SELECT c.id, c.charge_ref, c.charge_type, c.lease_id, c.tenant_id, c.property_id, c.unit_id, c.period_start, c.period_end, c.due_date,
           c.amount_minor, c.description, c.created_at, (c.voided_at IS NOT NULL) AS voided,
           COALESCE(a.paid, 0)::bigint AS paid, COALESCE(cr.credited, 0)::bigint AS credited
    FROM rent_charges c
    LEFT JOIN (
      SELECT pa.rent_charge_id, SUM(pa.allocated_amount_minor) AS paid
      FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
      WHERE pa.reversed_at IS NULL AND p.status = 'confirmed' AND pa.organization_id = ${f.organizationId}::uuid
      GROUP BY pa.rent_charge_id
    ) a ON a.rent_charge_id = c.id
    LEFT JOIN (
      SELECT rent_charge_id, SUM(amount_minor) AS credited FROM ledger_adjustments
      WHERE adjustment_type = 'credit' AND rent_charge_id IS NOT NULL AND organization_id = ${f.organizationId}::uuid
      GROUP BY rent_charge_id
    ) cr ON cr.rent_charge_id = c.id
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY c.due_date ASC, c.period_start ASC, c.id ASC`;
  const out = rows.map((r) => {
    const paid = Number(r.paid), credited = Number(r.credited);
    const balance = r.voided ? 0 : r.amount_minor - paid - credited;
    const dueDate = toISODate(r.due_date);
    return {
      id: r.id, chargeRef: r.charge_ref, chargeType: r.charge_type, leaseId: r.lease_id, tenantId: r.tenant_id, propertyId: r.property_id, unitId: r.unit_id,
      periodStart: toISODate(r.period_start), periodEnd: toISODate(r.period_end), dueDate, amountMinor: r.amount_minor,
      paidMinor: paid, creditedMinor: credited, balanceMinor: balance, voided: r.voided,
      status: chargeStatus({ voided: r.voided, amountMinor: r.amount_minor, balance, dueDate }, today),
      description: r.description, createdAt: r.created_at,
    };
  });
  return f.openOnly ? out.filter((r) => r.balanceMinor > 0) : out;
}

/** Re-derive and cache charge.status for the given charges (status is a cache, never the source of truth). */
export async function refreshChargeStatuses(db: Db, organizationId: string, chargeIds: string[], today: string) {
  if (!chargeIds.length) return;
  const rows = await queryChargeBalances(db, { organizationId, chargeIds, includeVoid: true }, today);
  for (const r of rows) {
    if (r.balanceMinor < 0) throw new Error(`Invariant violated: negative balance on charge ${r.chargeRef}`);
    await db.rentCharge.update({ where: { id: r.id }, data: { status: r.status } });
  }
}

/** Unapplied credit on a lease's confirmed payments: Σ confirmed payments − Σ active allocations − Σ refunds. */
export async function leaseCreditPositions(db: Db, organizationId: string, leaseIds?: string[]) {
  const leaseCond = leaseIds ? (leaseIds.length ? Prisma.sql`AND p.lease_id IN (${Prisma.join(leaseIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.sql`AND FALSE`) : Prisma.empty;
  const refundCond = leaseIds ? (leaseIds.length ? Prisma.sql`AND lease_id IN (${Prisma.join(leaseIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.sql`AND FALSE`) : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ lease_id: string; tenant_id: string; received: bigint; allocated: bigint }>>`
    SELECT p.lease_id, p.tenant_id, SUM(p.amount_minor)::bigint AS received,
           COALESCE(SUM((SELECT SUM(pa.allocated_amount_minor) FROM payment_allocations pa WHERE pa.payment_id = p.id AND pa.reversed_at IS NULL)), 0)::bigint AS allocated
    FROM payments p
    WHERE p.organization_id = ${organizationId}::uuid AND p.status = 'confirmed' AND p.lease_id IS NOT NULL ${leaseCond}
    GROUP BY p.lease_id, p.tenant_id`;
  const refunds = await db.$queryRaw<Array<{ lease_id: string; refunded: bigint }>>`
    SELECT lease_id, SUM(amount_minor)::bigint AS refunded FROM ledger_adjustments
    WHERE organization_id = ${organizationId}::uuid AND adjustment_type = 'refund' AND lease_id IS NOT NULL ${refundCond}
    GROUP BY lease_id`;
  const refundMap = new Map(refunds.map((r) => [r.lease_id, Number(r.refunded)]));
  const out = new Map<string, { tenantId: string; receivedMinor: number; allocatedMinor: number; refundedMinor: number; unappliedMinor: number }>();
  for (const r of rows) {
    const refunded = refundMap.get(r.lease_id) ?? 0;
    const unapplied = Number(r.received) - Number(r.allocated) - refunded;
    if (unapplied < 0) throw new Error("Invariant violated: negative unapplied credit");
    out.set(r.lease_id, { tenantId: r.tenant_id, receivedMinor: Number(r.received), allocatedMinor: Number(r.allocated), refundedMinor: refunded, unappliedMinor: unapplied });
  }
  return out;
}
