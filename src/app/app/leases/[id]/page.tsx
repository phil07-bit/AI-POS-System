import { orNotFound } from "@/lib/auth/page-guards";
import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { getLease } from "@/server/services/lease.service";
import { listCharges } from "@/server/services/rent.service";
import { listPayments } from "@/server/services/payment.service";
import { listUnits } from "@/server/services/unit.service";
import { listTenants } from "@/server/services/tenant.service";
import { listAuditLogs } from "@/server/services/audit-query.service";
import { PageHeader, Card, DL, StatusBadge, ButtonLink, Alert, humanize } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { ActionButton } from "@/components/forms/action-button";
import { LeaseForm } from "@/components/forms/lease-form";
import { money, date, FREQ } from "@/components/layout/format";
import { formatDateTime, todayInTz } from "@/lib/dates";
import { minorToDecimalString } from "@/lib/money";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const can = (k: string) => ctx.permissions.has(k);
  const l = await orNotFound(getLease(ctx, id));
  const today = todayInTz(ctx.timezone);
  const charges = can("rent.read") ? await listCharges(ctx, { leaseId: id, pageSize: 100 }) : null;
  const payments = can("rent.read") ? await listPayments(ctx, { leaseId: id, pageSize: 50 }) : null;
  const editable = ["draft", "pending_signature"].includes(l.status);
  const history = can("audit.read") ? await listAuditLogs(ctx, { entityType: "lease", entityId: id, pageSize: 30 }) : null;

  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/leases", label: "Leases" }]}
        title={<>Lease {l.leaseRef} <span className="ml-1 align-middle"><StatusBadge status={l.displayStatus} /></span></>}
        subtitle={<><Link className="hover:underline" href={`/app/properties/${l.property.id}`}>{l.property.name}</Link> · <Link className="hover:underline" href={`/app/units/${l.unit.id}`}>unit {l.unit.unitRef}</Link> · {l.primaryTenant?.displayName}</>}
        actions={<>
          {l.status === "draft" && can("lease.update") && <ActionButton endpoint={`/leases/${id}/send-for-signature`} label="Mark pending signature" />}
          {editable && can("lease.activate") && <ActionButton endpoint={`/leases/${id}/activate`} label="Activate lease" variant="primary" confirm={{ title: "Activate this lease?", body: `Confirms the agreement is signed and approved. AI-POS checks for overlapping active leases on unit ${l.unit.unitRef} and generates the rent schedule. Active terms can then only change through renewal.`, confirmLabel: "Activate" }} />}
          {l.status === "active" && can("rent.charge.create") && <ActionButton endpoint="/rent-charges/generate" body={{ leaseId: id }} label="Generate due charges" successMessage="Charges generated" />}
          {l.status === "active" && can("payment.record") && <ButtonLink href={`/app/payments/new?leaseId=${id}`}>Record payment</ButtonLink>}
          {["active", "expired"].includes(l.status) && can("lease.create") && !l.renewals.some((r) => r.status !== "terminated") && <ActionButton endpoint={`/leases/${id}/renew`} label="Draft renewal" confirm={{ title: "Create a renewal?", body: "A new linked draft lease starting the day after this one ends is created with the same terms. You can edit it before activation. This lease's history is unchanged." }} />}
          {l.status === "active" && can("lease.terminate") && <ActionButton endpoint={`/leases/${id}/terminate`} label="Terminate" variant="danger" reasonLabel="Termination reason" extraFields={[{ name: "terminationDate", label: "Effective termination date", type: "date", defaultValue: today, required: true }, { name: "settlementNotes", label: "Settlement notes (deposit, outstanding balance)", type: "text" }]} confirm={{ title: "Terminate lease?", body: "Records the termination date and reason. Unpaid charges for periods after that date are voided; charges with payments stay for finance review. The unit becomes available. This does not issue any legal notice." }} />}
        </>} />

      {l.displayStatus === "expiring" && <div className="mb-4"><Alert tone="warning">This lease ends in {l.daysToExpiry} days ({date(l.endDate)}). Follow up on renewal or move-out.</Alert></div>}
      {l.renewalOf && <div className="mb-4"><Alert>Renewal of <Link className="underline" href={`/app/leases/${l.renewalOf.id}`}>{l.renewalOf.leaseRef}</Link>.</Alert></div>}
      {l.renewals.length > 0 && <div className="mb-4"><Alert>Renewed by {l.renewals.map((r) => <Link key={r.id} className="underline" href={`/app/leases/${r.id}`}>{r.leaseRef} ({humanize(r.status)})</Link>)}.</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Terms" className="lg:col-span-2">
          <DL items={[
            ["Term", `${date(l.startDate)} – ${date(l.endDate)} (inclusive)`], ["Rent", <>{money(l.rentAmountMinor)} per {FREQ[l.billingFrequency]?.toLowerCase()} period</>],
            ["Due", l.dueDay ? `Day ${l.dueDay} of each period's first month` : "First day of each period"], ["Grace period", `${l.gracePeriodDays} days`],
            ["Deposit", <>{money(l.depositAmountMinor)} · {humanize(l.depositStatus)}</>], ["Advance agreed", l.advanceMonths ? `${l.advanceMonths} months` : "—"],
            ["Notice period", l.noticePeriodDays ? `${l.noticePeriodDays} days` : "—"], ["Late fees", l.lateFeeEnabled ? "Enabled" : "Disabled (default)"],
            ["Renewal terms", l.renewalTerms], ["Internal notes", l.internalNotes],
            ...(l.terminatedAt ? ([["Terminated", `${date(l.terminatedAt)} — ${l.terminationReason}`], ["Settlement notes", l.settlementNotes]] as [string, string | null][]) : []),
          ]} />
        </Card>
        <Card title="Parties">
          <ul className="space-y-2 text-sm">{l.parties.map((p) => (
            <li key={p.tenantId + p.partyRole}><Link className="font-medium text-brand-700 hover:underline" href={`/app/tenants/${p.tenantId}`}>{p.tenant.displayName}</Link> <span className="text-xs text-slate-500">{humanize(p.partyRole)}</span><div className="text-xs text-slate-500">{p.tenant.phone ?? ""} {p.tenant.email ?? ""}</div></li>
          ))}</ul>
        </Card>
      </div>

      {charges && (
        <Card title="Rent schedule & charges" className="mt-4" padded={false} actions={<span className="text-xs text-slate-500">Billed {money(charges.totals.amount)} · paid {money(charges.totals.paid)} · balance {money(charges.totals.balance)}</span>}>
          {charges.items.length === 0 ? <p className="p-4 text-sm text-slate-500">{l.status === "active" ? "No charges yet." : "Charges are generated when the lease is activated."}</p> : (
            <Table><thead><tr><Th>Charge</Th><Th>Type</Th><Th>Period</Th><Th>Due</Th><Th align="right">Amount</Th><Th align="right">Paid</Th><Th align="right">Balance</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{charges.items.map((c) => (
                <tr key={c.id}><Td className="font-mono text-xs">{c.chargeRef}</Td><Td>{humanize(c.chargeType)}</Td><Td>{date(c.periodStart)} – {date(c.periodEnd)}</Td><Td>{date(c.dueDate)}</Td>
                  <Td align="right">{money(c.amountMinor)}</Td><Td align="right">{money(c.paidMinor + c.creditedMinor)}</Td><Td align="right">{money(c.balanceMinor)}</Td><Td><StatusBadge status={c.status} /></Td></tr>
              ))}</tbody></Table>
          )}
        </Card>
      )}
      {payments && payments.items.length > 0 && (
        <Card title="Payments" className="mt-4" padded={false}>
          <Table><thead><tr><Th>Payment</Th><Th>Received</Th><Th>Method</Th><Th align="right">Amount</Th><Th align="right">Unallocated</Th><Th>Status</Th><Th>Receipt</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{payments.items.map((p) => (
              <tr key={p.id}><Td><Link className="text-brand-700 hover:underline" href={`/app/payments/${p.id}`}>{p.paymentRef}</Link></Td><Td>{date(p.receivedAt)}</Td><Td>{humanize(p.paymentMethod)}</Td><Td align="right">{money(p.amountMinor)}</Td><Td align="right">{money(p.unallocatedMinor)}</Td><Td><StatusBadge status={p.status} /></Td><Td>{p.receipt?.receiptNumber ?? "—"}</Td></tr>
            ))}</tbody></Table>
        </Card>
      )}
      {editable && can("lease.update") && <EditDraft />}
      {history && history.items.length > 0 && (
        <Card title="Lease history (who created, approved and changed terms)" className="mt-4" padded={false}>
          <ul className="divide-y divide-slate-100">{history.items.map((h) => <li key={h.id} className="px-4 py-2 text-sm"><span className="font-medium">{h.actorName}</span> — {h.summary ?? h.action} <span className="text-xs text-slate-500">· {formatDateTime(h.createdAt, ctx.timezone)}</span></li>)}</ul>
        </Card>
      )}
    </>
  );

  async function EditDraft() {
    const [units, tenants] = await Promise.all([listUnits(ctx, { pageSize: 100 }), listTenants(ctx, { pageSize: 100 })]);
    return (
      <Card title="Edit draft terms" className="mt-4">
        <LeaseForm
          units={units.items.map((u) => ({ id: u.id, label: u.unitRef, propertyId: u.property.id, propertyName: u.property.name, status: u.occupancyStatus, askingRentMinor: u.askingRentMinor, rentFrequency: u.rentFrequency }))}
          tenants={tenants.items.map((t) => ({ id: t.id, name: `${t.displayName} (${t.tenantRef})` }))}
          defaults={{ today }}
          lease={{ id, unitId: l.unitId, parties: l.parties.map((p) => ({ tenantId: p.tenantId, partyRole: p.partyRole })), startDate: l.startDate, endDate: l.endDate, rent: minorToDecimalString(l.rentAmountMinor), billingFrequency: l.billingFrequency, dueDay: l.dueDay?.toString() ?? "", deposit: l.depositAmountMinor ? minorToDecimalString(l.depositAmountMinor) : "", depositStatus: l.depositStatus, advanceMonths: l.advanceMonths?.toString() ?? "", gracePeriodDays: String(l.gracePeriodDays), noticePeriodDays: l.noticePeriodDays?.toString() ?? "", renewalTerms: l.renewalTerms ?? "", internalNotes: l.internalNotes ?? "" }}
        />
      </Card>
    );
  }
}
