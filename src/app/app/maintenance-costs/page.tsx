import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { orNotFound } from "@/lib/auth/page-guards";
import { maintenanceReport } from "@/server/services/maintenance-report.service";
import { listProperties } from "@/server/services/property.service";
import { PageHeader, Card, Input, Select, Button, Stat, Badge, humanize } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { money, qs } from "@/components/layout/format";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Maintenance costs" };
type SP = Record<string, string | undefined>;
const nice = (s: string) => (s === "hvac" ? "HVAC / air-con" : humanize(s));
type Row = { id: string | null; label: string; workOrders: number; labourMinor: number; materialsMinor: number; vendorMinor: number; otherMinor: number; totalMinor: number };

function Breakdown({ title, rows, href, total }: { title: string; rows: Row[]; href?: (id: string) => string; total: number }) {
  return (
    <Card title={title} padded={false}>
      {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">No completed work in this period.</p> : (
        <Table><thead><tr><Th>{title.replace("By ", "")}</Th><Th align="right">Jobs</Th><Th align="right">Labour</Th><Th align="right">Materials</Th><Th align="right">Vendor</Th><Th align="right">Other</Th><Th align="right">Total</Th><Th align="right">Share</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r) => (
            <tr key={r.id ?? r.label}><Td>{href && r.id ? <Link className="text-brand-700 hover:underline" href={href(r.id)}>{nice(r.label)}</Link> : nice(r.label)}</Td><Td align="right">{r.workOrders}</Td><Td align="right">{money(r.labourMinor)}</Td><Td align="right">{money(r.materialsMinor)}</Td><Td align="right">{money(r.vendorMinor)}</Td><Td align="right">{money(r.otherMinor)}</Td><Td align="right"><strong>{money(r.totalMinor)}</strong></Td><Td align="right">{total ? Math.round((r.totalMinor / total) * 100) : 0}%</Td></tr>
          ))}</tbody></Table>
      )}
    </Card>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const [r, props] = await Promise.all([orNotFound(maintenanceReport(ctx, qs(sp))), listProperties(ctx, { pageSize: 100 })]);
  const s = r.snapshot;
  return (
    <>
      <PageHeader title="Maintenance costs & performance" subtitle={`Completed work orders from ${r.range.from} to ${r.range.to}. Operating spend only; not part of the tenant ledger.`} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div><label htmlFor="f-from" className="mb-1 block text-xs font-medium text-slate-600">From</label><Input id="f-from" type="date" name="from" defaultValue={r.range.from} /></div>
        <div><label htmlFor="f-to" className="mb-1 block text-xs font-medium text-slate-600">To</label><Input id="f-to" type="date" name="to" defaultValue={r.range.to} /></div>
        <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Total spend" value={formatMoney(r.totals.totalMinor)} sub={`${r.totals.workOrders} completed jobs`} />
        <Stat label="Open requests" value={s.openRequests} sub={s.openEmergencies ? `${s.openEmergencies} emergency` : "no emergencies"} tone={s.openEmergencies ? "red" : undefined} />
        <Stat label="Open work orders" value={s.openWorkOrders} />
        <Stat label="Overdue work orders" value={s.overdueWorkOrders} tone={s.overdueWorkOrders ? "red" : "green"} />
        <Stat label="Avg response" value={s.avgResponseHours != null ? `${s.avgResponseHours} h` : "—"} sub="assigned → started" />
        <Stat label="Avg completion" value={s.avgCompletionDays != null ? `${s.avgCompletionDays} d` : "—"} sub="raised → completed" />
        <Stat label="On time" value={s.completedOnTimePct != null ? `${s.completedOnTimePct}%` : "—"} sub="completed by due date" />
      </div>
      {r.repeatRepairs.length > 0 && (
        <Card title={<>Repeat repairs <Badge tone="red">{r.repeatRepairs.length}</Badge></>} className="mt-4" padded={false}>
          <p className="px-4 pt-3 text-xs text-slate-500">Three or more reactive jobs of the same kind on one asset or unit in the last 90 days. Consider replacement or a root-cause inspection.</p>
          <Table><thead><tr><Th>Asset / unit</Th><Th>Property</Th><Th>Category</Th><Th align="right">Jobs</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{r.repeatRepairs.map((g) => <tr key={`${g.targetId}${g.category}`}><Td>{g.targetType === "asset" ? <Link className="text-brand-700 hover:underline" href={`/app/assets/${g.targetId}`}>{g.label}</Link> : <Link className="text-brand-700 hover:underline" href={`/app/units/${g.targetId}`}>{g.label}</Link>}</Td><Td>{g.propertyName}</Td><Td>{nice(g.category)}</Td><Td align="right">{g.count}</Td></tr>)}</tbody></Table>
        </Card>
      )}
      <div className="mt-4 grid gap-4">
        <Breakdown title="By property" rows={r.byProperty} href={(id) => `/app/properties/${id}`} total={r.totals.totalMinor} />
        <Breakdown title="By category" rows={r.byCategory} total={r.totals.totalMinor} />
        <Breakdown title="By vendor" rows={r.byVendor} href={(id) => `/app/vendors/${id}`} total={r.totals.totalMinor} />
        <Breakdown title="By asset" rows={r.byAsset} href={(id) => `/app/assets/${id}`} total={r.totals.totalMinor} />
        <Breakdown title="By type (reactive vs preventive)" rows={r.byKind} total={r.totals.totalMinor} />
      </div>
    </>
  );
}
