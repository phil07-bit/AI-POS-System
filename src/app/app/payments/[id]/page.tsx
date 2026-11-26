import { orNotFound } from "@/lib/auth/page-guards";
import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { getPayment } from "@/server/services/payment.service";
import { queryChargeBalances } from "@/server/services/ledger-queries";
import { prisma } from "@/lib/db";
import { PageHeader, Card, DL, StatusBadge, ButtonLink, Alert, humanize } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { ActionButton } from "@/components/forms/action-button";
import { ManualAllocationForm } from "@/components/forms/finance-forms";
import { money, date } from "@/components/layout/format";
import { formatDateTime, todayInTz } from "@/lib/dates";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const can = (k: string) => ctx.permissions.has(k);
  const p = await orNotFound(getPayment(ctx, id));
  const open = p.status === "confirmed" && p.unallocatedMinor > 0 && p.lease
    ? await queryChargeBalances(prisma, { organizationId: ctx.organizationId, leaseId: p.lease.id, openOnly: true }, todayInTz(ctx.timezone)) : [];
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/payments", label: "Payments" }]} title={<>Payment {p.paymentRef} <span className="ml-1 align-middle"><StatusBadge status={p.status} /></span></>}
        subtitle={<><Link className="hover:underline" href={`/app/tenants/${p.tenant.id}?tab=ledger`}>{p.tenant.displayName}</Link> · {p.lease && <Link className="hover:underline" href={`/app/leases/${p.lease.id}`}>{p.lease.leaseRef}</Link>}</>}
        actions={<>
          {p.status === "pending" && can("payment.confirm") && <ActionButton endpoint={`/payments/${id}/confirm`} body={{ allocation: "auto" }} label="Confirm & allocate" variant="primary" confirm={{ title: "Confirm this payment?", body: `Confirms ${p.paymentRef} was actually received (check the bank / MoMo statement). It will then count as collected, be allocated to the oldest unpaid charges and a receipt will be issued.`, confirmLabel: "Confirm" }} />}
          {p.status === "confirmed" && p.unallocatedMinor > 0 && open.length > 0 && can("payment.allocate") && <ActionButton endpoint={`/payments/${id}/allocate`} body={{ mode: "auto" }} label="Auto-allocate remainder" />}
          {p.receipt && <ButtonLink href={`/app/payments/${id}/receipt`} variant="secondary">View receipt</ButtonLink>}
          {(p.status === "confirmed" || p.status === "pending") && can("payment.reverse") && <ActionButton endpoint={`/payments/${id}/reverse`} label="Reverse payment" variant="danger" reasonLabel="Reason for reversal (required, audited)" confirm={{ title: `Reverse ${p.paymentRef}?`, body: "The original payment stays visible. Allocations are reversed, a compensating ledger entry is written and the affected charges re-open. This cannot be undone." }} />}
        </>} />
      {p.status === "pending" && <div className="mb-4"><Alert tone="warning">Pending confirmation — not counted as collected and not allocated.</Alert></div>}
      {p.status === "reversed" && <div className="mb-4"><Alert tone="error">Reversed by {p.reversedByName} on {formatDateTime(p.reversedAt, ctx.timezone)}: {p.reversalReason}{p.reversalAdjustment ? ` (adjustment ${p.reversalAdjustment.adjustmentRef})` : ""}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Payment" className="lg:col-span-2">
          <DL items={[
            ["Amount", money(p.amountMinor)], ["Date received", date(p.receivedAt)], ["Method", humanize(p.paymentMethod)], ["External reference", p.externalReference],
            ["Paid by", p.payerName ?? p.tenant.displayName], ["Property / unit", p.lease ? `${p.lease.property.name} · ${p.lease.unit.unitRef}` : "—"],
            ["Recorded by", `${p.recordedByName ?? "—"} · ${formatDateTime(p.createdAt, ctx.timezone)}`], ["Confirmed by", p.confirmedByName ? `${p.confirmedByName} · ${formatDateTime(p.confirmedAt, ctx.timezone)}` : "—"],
            ["Allocated", money(p.allocatedMinor)], ["Unallocated credit", money(p.unallocatedMinor)], ["Receipt", p.receipt?.receiptNumber ?? "Issued on confirmation"], ["Notes", p.notes],
          ]} />
        </Card>
        {open.length > 0 && can("payment.allocate") && (
          <Card title="Manual allocation"><ManualAllocationForm paymentId={id} unallocatedMinor={p.unallocatedMinor} openCharges={open.map((c) => ({ id: c.id, label: `${c.chargeRef} · due ${date(c.dueDate)}`, balanceMinor: c.balanceMinor }))} /></Card>
        )}
      </div>
      <Card title="Allocations" className="mt-4" padded={false}>
        {p.allocations.length === 0 ? <p className="p-4 text-sm text-slate-500">Not allocated.</p> : (
          <Table><thead><tr><Th>Charge</Th><Th>Period</Th><Th>Due</Th><Th align="right">Allocated</Th><Th>Rule</Th><Th>State</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{p.allocations.map((a) => (
              <tr key={a.id} className={a.reversedAt ? "text-slate-400 line-through" : ""}><Td><Link className="font-mono text-xs text-brand-700 hover:underline" href={`/app/rent/${a.charge.id}`}>{a.charge.chargeRef}</Link></Td><Td>{date(a.charge.periodStart)} – {date(a.charge.periodEnd)}</Td><Td>{date(a.charge.dueDate)}</Td><Td align="right">{money(a.amountMinor)}</Td><Td>{a.method === "auto" ? "Oldest due first" : "Manual"}</Td><Td>{a.reversedAt ? "Reversed" : "Active"}</Td></tr>
            ))}</tbody></Table>
        )}
      </Card>
    </>
  );
}
