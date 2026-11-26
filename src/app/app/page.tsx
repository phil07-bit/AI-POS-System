import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { portfolioOverview, collectionSummary, arrearsReport } from "@/server/services/report.service";
import { listProperties } from "@/server/services/property.service";
import { Card, PageHeader, Stat, StatusBadge, ButtonLink, EmptyState, Select, Button } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { money, date } from "@/components/layout/format";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<{ propertyId?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const props = await listProperties(ctx, { pageSize: 100 });
  const ov = await portfolioOverview(ctx, { propertyId: sp.propertyId || undefined });
  const fin = ctx.permissions.has("report.financial.read");
  const col = fin ? await collectionSummary(ctx, { propertyId: sp.propertyId || undefined, from: sp.from || undefined, to: sp.to || undefined }) : null;
  const arr = fin ? await arrearsReport(ctx, { propertyId: sp.propertyId || undefined }) : null;
  const o = ov.occupancy;

  if (ov.totalProperties === 0) {
    return (<>
      <PageHeader title={`Welcome, ${ctx.userName.split(" ")[0]}`} subtitle={ctx.organizationName} />
      <EmptyState title="No properties yet" body="Start by adding your first property, then its units, tenants and leases." action={ctx.permissions.has("property.create") ? <ButtonLink href="/app/properties/new">Add a property</ButtonLink> : undefined} />
    </>);
  }
  const maxTrend = col ? Math.max(1, ...col.trend.map((t) => Math.max(t.billedMinor, t.cashReceivedMinor))) : 1;

  return (
    <>
      <PageHeader title="Portfolio overview" subtitle={`As at ${date(ov.asOf)} · ${ctx.timezone} · ${ctx.currency}`} />
      <form className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3" method="get">
        <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-600">Property</span>
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="min-w-52"><option value="">All properties in scope</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </label>
        {fin && <>
          <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-600">Period from</span><input type="date" name="from" defaultValue={col?.period.from} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /></label>
          <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-600">to</span><input type="date" name="to" defaultValue={col?.period.to} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /></label>
        </>}
        <Button type="submit" variant="secondary">Apply</Button>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Properties" value={ov.totalProperties} />
        <Stat label="Rentable units" value={o.rentableUnits} sub={`${o.totalUnits} total · ${o.excludedUnits} unavailable/maintenance`} />
        <Stat label="Occupied / vacant" value={`${o.occupiedUnits} / ${o.vacantUnits}`} sub={o.reservedUnits ? `${o.reservedUnits} reserved` : undefined} />
        <Stat label="Occupancy rate" value={o.occupancyRate === null ? "N/A" : `${o.occupancyRate}%`} sub="Active leases ÷ rentable units" tone={o.occupancyRate !== null && o.occupancyRate < 75 ? "amber" : "green"} />
      </div>

      {col && arr && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Rent billed (period)" value={formatMoney(col.billedMinor)} sub={`Charges due ${date(col.period.from)} – ${date(col.period.to)}`} />
          <Stat label="Collected against period" value={formatMoney(col.collectedAgainstPeriodMinor)} sub={`Collection rate ${col.collectionRate === null ? "N/A" : col.collectionRate + "%"}`} tone="green" />
          <Stat label="Cash received (period)" value={formatMoney(col.cashReceivedMinor)} sub={`${col.cashReceiptsCount} confirmed payment(s); ${col.pendingPaymentsCount} pending`} />
          <Stat label="Outstanding arrears" value={formatMoney(arr.totals.totalMinor)} sub={`${arr.totals.overdueAccounts} overdue account(s)`} tone={arr.totals.totalMinor > 0 ? "red" : "green"} />
          <Stat label="Upcoming due (30 days)" value={formatMoney(col.upcomingDueMinor)} sub={`${col.upcomingDueCount} charge(s)`} />
          <Stat label="Prepaid / advance credit" value={formatMoney(col.prepaidBalancesMinor)} sub="Unapplied confirmed payments" />
          <Stat label="Leases expiring" value={`${ov.leasesExpiring.d30} / ${ov.leasesExpiring.d60} / ${ov.leasesExpiring.d90}`} sub="within 30 / 60 / 90 days" tone={ov.leasesExpiring.d30 ? "amber" : undefined} />
          <Stat label="Pending confirmation" value={formatMoney(col.pendingPaymentsMinor)} sub="Not counted as collected" />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {col && (
          <Card title="Billed vs cash received — last 6 months">
            <div className="space-y-2" aria-hidden>
              {col.trend.map((t) => (
                <div key={t.month} className="grid grid-cols-[4rem_1fr] items-center gap-2 text-xs">
                  <span className="text-slate-500">{t.month}</span>
                  <div className="space-y-0.5">
                    <div className="h-2.5 rounded bg-slate-300" style={{ width: `${(t.billedMinor / maxTrend) * 100}%` }} />
                    <div className="h-2.5 rounded bg-brand-500" style={{ width: `${(t.cashReceivedMinor / maxTrend) * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="pt-1 text-xs text-slate-500"><span className="mr-1 inline-block h-2 w-3 rounded bg-slate-300" />Billed (by due date) <span className="ml-3 mr-1 inline-block h-2 w-3 rounded bg-brand-500" />Cash received (by date received)</p>
            </div>
            <details className="mt-3 text-sm"><summary className="cursor-pointer text-brand-700">View as table</summary>
              <Table caption="Monthly billed vs received"><thead><tr><Th>Month</Th><Th align="right">Billed</Th><Th align="right">Collected against</Th><Th align="right">Cash received</Th></tr></thead>
                <tbody>{col.trend.map((t) => <tr key={t.month}><Td>{t.month}</Td><Td align="right">{money(t.billedMinor)}</Td><Td align="right">{money(t.collectedAgainstMinor)}</Td><Td align="right">{money(t.cashReceivedMinor)}</Td></tr>)}</tbody></Table>
            </details>
            <p className="mt-2 text-xs text-slate-500">{col.meta.definition}</p>
          </Card>
        )}
        <Card title="Leases expiring in the next 90 days" actions={<Link href="/app/leases?status=expiring" className="text-sm text-brand-700 hover:underline">All expiring</Link>} padded={false}>
          {ov.expiringSoon.length === 0 ? <p className="p-4 text-sm text-slate-500">No leases expire in the next 90 days.</p> : (
            <Table><thead><tr><Th>Lease</Th><Th>Tenant</Th><Th>Unit</Th><Th>Ends</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{ov.expiringSoon.map((l) => (
                <tr key={l.id}><Td><Link className="text-brand-700 hover:underline" href={`/app/leases/${l.id}`}>{l.leaseRef}</Link></Td><Td>{l.tenantName}</Td><Td>{l.propertyName} · {l.unitRef}</Td><Td>{date(l.endDate)}</Td><Td><StatusBadge status={l.displayStatus} /></Td></tr>
              ))}</tbody></Table>
          )}
        </Card>
        {arr && arr.byProperty.length > 0 && (
          <Card title="Arrears by property" actions={<Link href="/app/arrears" className="text-sm text-brand-700 hover:underline">Aging report</Link>} padded={false}>
            <Table><thead><tr><Th>Property</Th><Th align="right">Accounts</Th><Th align="right">Arrears</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{arr.byProperty.map((p) => <tr key={p.propertyId}><Td><Link className="text-brand-700 hover:underline" href={`/app/properties/${p.propertyId}`}>{p.propertyName}</Link></Td><Td align="right">{p.accounts}</Td><Td align="right">{money(p.totalMinor)}</Td></tr>)}</tbody></Table>
          </Card>
        )}
      </div>
      <p className="mt-4 text-xs text-slate-500">{ov.definitions.occupancy}</p>
    </>
  );
}
