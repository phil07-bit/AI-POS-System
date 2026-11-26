import Link from "next/link";
import { orNotFound } from "@/lib/auth/page-guards";
import { getStaffPageContext } from "@/lib/auth/next";
import { getVendor } from "@/server/services/vendor.service";
import { PageHeader, Card, DL, StatusBadge, Stat, humanize } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { VendorForm } from "@/components/forms/maintenance-forms";
import { addressLine, date, money } from "@/components/layout/format";
import { formatMoney } from "@/lib/money";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const v = await orNotFound(getVendor(ctx, id));
  const p = v.performance;
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/vendors", label: "Vendors" }]} title={<>{v.businessName} <span className="ml-1 align-middle"><StatusBadge status={v.status} /></span></>} subtitle={`${v.vendorRef} · ${v.serviceCategories.map(humanize).join(", ") || "No service categories"}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Work orders" value={p.workOrders} sub={`${p.open} open`} />
        <Stat label="Completed" value={p.completed} sub={p.completedLate ? `${p.completedLate} after due date` : "none late"} tone={p.completedLate ? "amber" : undefined} />
        <Stat label="Avg response" value={p.avgResponseHours != null ? `${p.avgResponseHours} h` : "—"} sub="assigned → started" />
        <Stat label="Avg completion" value={p.avgCompletionDays != null ? `${p.avgCompletionDays} d` : "—"} sub="assigned → completed" />
        <Stat label="Spend (completed)" value={p.totalSpendMinor !== undefined ? formatMoney(p.totalSpendMinor) : "—"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Contact"><DL items={[["Contact person", v.contactName], ["Phone", v.phone], ["Email", v.email], ["Address", addressLine(v.address)], ["Performance notes", v.notes]]} /></Card>
        <Card title="Service history" className="lg:col-span-2" padded={false}>
          {v.history.length === 0 ? <p className="p-4 text-sm text-slate-500">No work orders yet.</p> : (
            <Table><thead><tr><Th>Work order</Th><Th>Location</Th><Th>Status</Th><Th>Completed</Th><Th align="right">Cost</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{v.history.map((w) => <tr key={w.id}><Td><Link className="font-mono text-xs text-brand-700 hover:underline" href={`/app/work-orders/${w.id}`}>{w.workOrderRef}</Link><div className="text-xs text-slate-500">{humanize(w.category)}</div></Td><Td>{w.property.name}{w.unit ? ` · ${w.unit.unitRef}` : ""}{w.asset ? ` · ${w.asset.name}` : ""}</Td><Td><StatusBadge status={w.status} /></Td><Td>{w.completedAt ? date(w.completedAt.toISOString().slice(0, 10)) : "—"}</Td><Td align="right">{w.totalCostMinor !== undefined ? money(w.totalCostMinor) : "—"}</Td></tr>)}</tbody></Table>
          )}
        </Card>
      </div>
      {ctx.permissions.has("vendor.manage") && <Card title="Edit vendor" className="mt-4"><VendorForm initial={v} /></Card>}
    </>
  );
}
