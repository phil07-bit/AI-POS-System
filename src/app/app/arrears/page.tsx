import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { arrearsReport } from "@/server/services/report.service";
import { listProperties } from "@/server/services/property.service";
import { PageHeader, Card, Select, Button, Stat, EmptyState, Input } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { money, date, qs } from "@/components/layout/format";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Arrears" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const [r, props] = await Promise.all([arrearsReport(ctx, qs(sp)), listProperties(ctx, { pageSize: 100 })]);
  return (
    <>
      <PageHeader title="Arrears & aging" subtitle={`As at ${date(r.asOf)} · ${r.meta.currency} · generated ${formatDateTime(new Date(r.meta.generatedAt), ctx.timezone)}`} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-600">As at <Input type="date" name="asOf" defaultValue={r.asOf} /></label>
        <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties in scope</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total arrears" value={formatMoney(r.totals.totalMinor)} tone={r.totals.totalMinor ? "red" : "green"} sub={`${r.totals.overdueAccounts} overdue account(s)`} />
        {r.buckets.map((b) => <Stat key={b.key} label={b.label} value={formatMoney(r.totals[b.key])} tone={b.key === "d90_plus" && r.totals[b.key] ? "red" : undefined} />)}
      </div>
      <Card title="Overdue accounts (by lease)" className="mt-4" padded={false}>
        {r.rows.length === 0 ? <div className="p-4"><EmptyState title="No arrears as at this date" /></div> : (
          <Table caption="Arrears aging"><thead><tr><Th>Tenant</Th><Th>Phone</Th><Th>Property · unit</Th><Th>Lease</Th><Th>Oldest due</Th>{r.buckets.map((b) => <Th key={b.key} align="right">{b.label}</Th>)}<Th align="right">Total</Th><Th align="right">Unapplied credit</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{r.rows.map((x) => (
              <tr key={x.leaseId} className="hover:bg-slate-50">
                <Td><Link className="font-medium text-brand-700 hover:underline" href={`/app/tenants/${x.tenantId}?tab=ledger`}>{x.tenantName}</Link></Td><Td className="tabular text-xs">{x.tenantPhone}</Td>
                <Td>{x.propertyName} · {x.unitRef}</Td><Td><Link className="text-xs hover:underline" href={`/app/leases/${x.leaseId}`}>{x.leaseRef}</Link></Td><Td>{date(x.oldestDueDate)}</Td>
                {r.buckets.map((b) => <Td key={b.key} align="right">{x.buckets[b.key] ? money(x.buckets[b.key]) : "—"}</Td>)}
                <Td align="right" className="font-semibold">{money(x.totalMinor)}</Td><Td align="right">{x.unappliedCreditMinor ? money(x.unappliedCreditMinor) : "—"}</Td>
              </tr>
            ))}</tbody>
            <tfoot><tr className="border-t-2 border-slate-300 font-semibold"><Td>Total</Td><Td /><Td /><Td /><Td />{r.buckets.map((b) => <Td key={b.key} align="right">{money(r.totals[b.key])}</Td>)}<Td align="right">{money(r.totals.totalMinor)}</Td><Td /></tr></tfoot>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">{r.meta.definition} Aging bands use days past due date. Unapplied credit is shown separately and is not netted against arrears automatically — allocate it from the payment page.</p>
    </>
  );
}
