import { orNotFound } from "@/lib/auth/page-guards";
import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { getCharge } from "@/server/services/rent.service";
import { PageHeader, Card, DL, StatusBadge, humanize } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { ActionButton } from "@/components/forms/action-button";
import { CreditForm } from "@/components/forms/finance-forms";
import { money, date } from "@/components/layout/format";
import { formatDateTime, toISODate } from "@/lib/dates";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const c = await orNotFound(getCharge(ctx, id));
  const can = (k: string) => ctx.permissions.has(k);
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/rent", label: "Rent & charges" }]} title={<>Charge {c.chargeRef} <span className="ml-1 align-middle"><StatusBadge status={c.status} /></span></>}
        subtitle={<>{c.tenantName} · <Link className="hover:underline" href={`/app/leases/${c.leaseId}`}>{c.leaseRef}</Link> · {c.propertyName} {c.unitRef}</>}
        actions={can("rent.charge.void") && c.status !== "void" && c.paidMinor === 0 && c.creditedMinor === 0 && <ActionButton endpoint={`/rent-charges/${id}/void`} label="Void charge" variant="danger" reasonLabel="Reason for voiding" confirm={{ title: "Void this charge?", body: "The charge stays on record marked void and no longer counts toward balances." }} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Charge" className="lg:col-span-2">
          <DL items={[["Type", humanize(c.chargeType)], ["Source", humanize(c.source)], ["Period", `${date(c.periodStart)} – ${date(c.periodEnd)}`], ["Due", date(c.dueDate)], ["Amount", money(c.amountMinor)], ["Paid (confirmed allocations)", money(c.paidMinor)], ["Credits", money(c.creditedMinor)], ["Balance", money(c.balanceMinor)], ["Description", c.description], ...(c.voidReason ? [["Void reason", c.voidReason] as [string, string]] : [])]} />
        </Card>
        {can("rent.adjust") && c.balanceMinor > 0 && <Card title="Credit / waiver"><CreditForm chargeId={id} /></Card>}
      </div>
      <Card title="Allocations" className="mt-4" padded={false}>
        {c.allocations.length === 0 ? <p className="p-4 text-sm text-slate-500">No payments allocated.</p> : (
          <Table><thead><tr><Th>Payment</Th><Th>Received</Th><Th align="right">Amount</Th><Th>Method</Th><Th>State</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{c.allocations.map((a) => <tr key={a.id}><Td><Link className="text-brand-700 hover:underline" href={`/app/payments/${a.payment.id}`}>{a.payment.paymentRef}</Link></Td><Td>{date(toISODate(a.payment.receivedAt))}</Td><Td align="right">{money(a.allocatedAmountMinor)}</Td><Td>{a.method}</Td><Td>{a.reversedAt ? <StatusBadge status="reversed" /> : <StatusBadge status={a.payment.status} />}</Td></tr>)}</tbody></Table>
        )}
      </Card>
      {c.credits.length > 0 && (
        <Card title="Credits" className="mt-4" padded={false}>
          <ul className="divide-y divide-slate-100">{c.credits.map((cr) => <li key={cr.id} className="px-4 py-2 text-sm">{cr.adjustmentRef} · {money(cr.amountMinor)} — {cr.reason} <span className="text-xs text-slate-500">{formatDateTime(cr.createdAt, ctx.timezone)}</span></li>)}</ul>
        </Card>
      )}
    </>
  );
}
