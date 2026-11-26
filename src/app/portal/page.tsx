import Link from "next/link";
import { getPageContext } from "@/lib/auth/next";
import { portalMaintenance, portalOverview, portalReceipts } from "@/server/services/portal.service";
import { PortalFeedbackForm, PortalRequestForm } from "@/components/forms/maintenance-forms";
import { formatDateTime } from "@/lib/dates";
import { Card, Stat, StatusBadge, PageHeader, Badge } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { money, date, FREQ } from "@/components/layout/format";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "My tenancy" };
export default async function Page() {
  const ctx = await getPageContext();
  const [ov, receipts, mnt] = await Promise.all([portalOverview(ctx), portalReceipts(ctx), portalMaintenance(ctx)]);
  const s = ov.ledger.summary;
  return (
    <>
      <PageHeader title={`Hello, ${ov.tenant.displayName}`} subtitle={`Tenant ref ${ov.tenant.tenantRef}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Amount due" value={formatMoney(s.outstanding)} />
        <Stat label="Overdue" value={formatMoney(s.overdueMinor)} tone={s.overdueMinor ? "red" : "green"} />
        <Stat label="Credit on account" value={formatMoney(s.unappliedCredit)} />
        <Stat label="Net balance" value={formatMoney(s.netBalance)} />
      </div>
      <Card title="My leases" className="mt-4" padded={false}>
        <Table><thead><tr><Th>Lease</Th><Th>Property · unit</Th><Th>Term</Th><Th align="right">Rent</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{ov.leases.map((l) => <tr key={l.id}><Td>{l.leaseRef}</Td><Td>{l.property.name} · {l.unit.unitRef}</Td><Td>{date(l.startDate)} – {date(l.endDate)}</Td><Td align="right">{money(l.rentAmountMinor)} {FREQ[l.billingFrequency]}</Td><Td><StatusBadge status={l.displayStatus} /></Td></tr>)}</tbody></Table>
      </Card>
      <Card title="Report a problem" className="mt-4"><PortalRequestForm units={mnt.units} /></Card>
      <Card title="My maintenance requests" className="mt-4" padded={false}>
        {mnt.requests.length === 0 ? <p className="p-4 text-sm text-slate-500">No requests yet.</p> : (
          <ul className="divide-y divide-slate-100">{mnt.requests.map((r) => (
            <li key={r.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-mono text-xs">{r.requestRef}</span> · <strong>{r.title}</strong> · {r.property.name}{r.unit ? ` · ${r.unit.unitRef}` : ""}</span><Badge tone={r.status === "closed" || r.status === "completed" ? "green" : r.status === "rejected" || r.status === "cancelled" ? "slate" : "blue"}>{r.statusLabel}</Badge></div>
              <ol className="mt-1 space-y-0.5 text-xs text-slate-600">{r.updates.map((u) => <li key={u.id}>{formatDateTime(u.createdAt, ctx.timezone)} — {u.body}</li>)}</ol>
              {(r.status === "completed" || r.status === "closed") && (r.feedbackRating ? <p className="mt-1 text-xs text-slate-500">You rated this {r.feedbackRating}/5. Thank you.</p> : <PortalFeedbackForm requestId={r.id} />)}
            </li>
          ))}</ul>
        )}
      </Card>
      <Card title="Statement" className="mt-4" padded={false}>
        <Table><thead><tr><Th>Date</Th><Th>Reference</Th><Th>Description</Th><Th align="right">Charged</Th><Th align="right">Paid</Th><Th align="right">Balance</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{ov.ledger.entries.map((e) => <tr key={e.sortKey} className={e.counted ? "" : "text-slate-400"}><Td>{date(e.date)}</Td><Td className="font-mono text-xs">{e.reference}</Td><Td>{e.description}</Td><Td align="right">{e.debitMinor ? money(e.debitMinor) : ""}</Td><Td align="right">{e.creditMinor ? money(e.creditMinor) : ""}</Td><Td align="right">{money(e.balanceMinor)}</Td></tr>)}</tbody></Table>
      </Card>
      <Card title="Receipts" className="mt-4" padded={false}>
        {receipts.length === 0 ? <p className="p-4 text-sm text-slate-500">No receipts yet.</p> : (
          <ul className="divide-y divide-slate-100">{receipts.map((r) => <li key={r.id} className="flex justify-between px-4 py-2 text-sm"><Link className="text-brand-700 hover:underline" href={`/portal/receipts/${r.id}`}>{r.receipt?.receiptNumber}</Link><span>{date(r.receivedAt)} · {money(r.amountMinor)} {r.status === "reversed" && <StatusBadge status="reversed" />}</span></li>)}</ul>
        )}
      </Card>
      <p className="mt-4 text-xs text-slate-500">Emergency requests alert the property team in the app and by email, but this portal is not monitored 24/7. For fire, gas leaks or immediate danger call emergency services first.</p>
    </>
  );
}
