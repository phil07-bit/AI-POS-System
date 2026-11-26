import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { listCharges } from "@/server/services/rent.service";
import { listProperties } from "@/server/services/property.service";
import { listLeases } from "@/server/services/lease.service";
import { PageHeader, Card, Select, Button, StatusBadge, EmptyState, humanize, Input } from "@/components/ui";
import { Table, Th, Td, Pagination } from "@/components/ui/table";
import { ActionButton } from "@/components/forms/action-button";
import { ManualChargeForm } from "@/components/forms/finance-forms";
import { money, date, qs } from "@/components/layout/format";
import { todayInTz } from "@/lib/dates";

export const metadata = { title: "Rent & charges" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const can = (k: string) => ctx.permissions.has(k);
  const [data, props] = await Promise.all([listCharges(ctx, qs(sp, { pageSize: sp.pageSize ?? "25" })), listProperties(ctx, { pageSize: 100 })]);
  const leases = can("rent.charge.create") ? await listLeases(ctx, { pageSize: 100, status: "active" }) : null;
  const expiring = can("rent.charge.create") ? await listLeases(ctx, { pageSize: 100, status: "expiring" }) : null;
  const leaseOpts = [...(leases?.items ?? []), ...(expiring?.items ?? [])].map((l) => ({ id: l.id, label: `${l.primaryTenant?.displayName} · ${l.property.name} ${l.unit.unitRef} (${l.leaseRef})` }));
  return (
    <>
      <PageHeader title="Rent & charges" subtitle="Rent schedule, service and utility charges. Balances are derived from confirmed allocations and credits."
        actions={can("rent.charge.create") && <ActionButton endpoint="/rent-charges/generate" label="Generate upcoming charges" variant="primary" confirm={{ title: "Generate charges for all active leases?", body: "Creates any missing rent charges up to the organization's horizon (default 31 days ahead). Safe to re-run: existing periods are never duplicated.", confirmLabel: "Generate" }} />} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-white p-3 text-sm">Billed (filtered): <strong>{money(data.totals.amount)}</strong></div>
        <div className="rounded-lg border bg-white p-3 text-sm">Paid / credited: <strong>{money(data.totals.paid)}</strong></div>
        <div className="rounded-lg border bg-white p-3 text-sm">Balance: <strong>{money(data.totals.balance)}</strong></div>
      </div>
      <Card padded={false}>
        <form method="get" className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
          <Select name="status" defaultValue={sp.status ?? ""} className="max-w-44" aria-label="Status"><option value="">Any status</option>{["open", "due", "partially_paid", "overdue", "paid", "void"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <label className="text-xs text-slate-600">Due from <Input type="date" name="dueFrom" defaultValue={sp.dueFrom} /></label>
          <label className="text-xs text-slate-600">Due to <Input type="date" name="dueTo" defaultValue={sp.dueTo} /></label>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No charges match" body="Charges are generated when leases are activated, or by running generation." /></div> : (
          <>
            <Table caption="Charges"><thead><tr><Th>Charge</Th><Th>Tenant</Th><Th>Property · unit</Th><Th>Type</Th><Th>Period</Th><Th>Due</Th><Th align="right">Amount</Th><Th align="right">Paid</Th><Th align="right">Balance</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td><Link className="font-mono text-xs text-brand-700 hover:underline" href={`/app/rent/${c.id}`}>{c.chargeRef}</Link></Td>
                  <Td><Link className="hover:underline" href={`/app/tenants/${c.tenantId}?tab=ledger`}>{c.tenantName}</Link></Td>
                  <Td>{c.propertyName} · {c.unitRef}</Td><Td>{humanize(c.chargeType)}</Td><Td className="text-xs">{date(c.periodStart)} – {date(c.periodEnd)}</Td><Td>{date(c.dueDate)}</Td>
                  <Td align="right">{money(c.amountMinor)}</Td><Td align="right">{money(c.paidMinor + c.creditedMinor)}</Td><Td align="right">{money(c.balanceMinor)}</Td><Td><StatusBadge status={c.status} /></Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath="/app/rent" />
          </>
        )}
      </Card>
      {can("rent.charge.create") && <Card title="Raise a manual charge" className="mt-4"><ManualChargeForm leases={leaseOpts} today={todayInTz(ctx.timezone)} /></Card>}
    </>
  );
}
