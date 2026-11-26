import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { orNotFound } from "@/lib/auth/page-guards";
import { listWorkOrders } from "@/server/services/work-order.service";
import { listProperties } from "@/server/services/property.service";
import { PageHeader, Card, Input, Select, Button, ButtonLink, StatusBadge, EmptyState, Badge, humanize } from "@/components/ui";
import { Table, Th, Td, SortTh, Pagination } from "@/components/ui/table";
import { date, money, qs } from "@/components/layout/format";

export const metadata = { title: "Work orders" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const coordinator = ctx.permissions.has("work_order.assign");
  const status = sp.status ?? "active";
  const [data, props] = await orNotFound(Promise.all([
    listWorkOrders(ctx, qs(sp, { status: status === "all" ? undefined : status })),
    listProperties(ctx, { pageSize: 100 }),
  ]));
  const base = "/app/work-orders";
  return (
    <>
      <PageHeader title={coordinator ? "Work orders" : "My work orders"} subtitle={coordinator ? "Reactive and preventive jobs across your properties." : "Jobs assigned to you."}
        actions={coordinator && <ButtonLink href="/app/work-orders/new">New work order</ButtonLink>} />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Ref or scope" defaultValue={sp.search} className="max-w-56" aria-label="Search work orders" />
          <Select name="status" defaultValue={status} className="max-w-48" aria-label="Status"><option value="active">Active</option><option value="overdue">Overdue</option><option value="all">All statuses</option>{["open", "assigned", "in_progress", "waiting_for_parts", "completed", "closed", "cancelled"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="kind" defaultValue={sp.kind ?? ""} className="max-w-40" aria-label="Kind"><option value="">Reactive + preventive</option><option value="reactive">Reactive</option><option value="preventive">Preventive</option></Select>
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          {coordinator && <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="mine" value="true" defaultChecked={sp.mine === "true"} />Assigned to me</label>}
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No work orders" body={coordinator ? "Raise one from an approved maintenance request, or create one directly." : "Nothing is assigned to you right now."} /></div> : (
          <>
            <Table caption="Work orders"><thead><tr>
              <SortTh label="Ref" field="workOrderRef" params={sp} basePath={base} /><Th>Scope</Th><Th>Location</Th><SortTh label="Priority" field="priority" params={sp} basePath={base} />
              <SortTh label="Status" field="status" params={sp} basePath={base} /><Th>Assigned to</Th><SortTh label="Due" field="dueAt" params={sp} basePath={base} /><Th align="right">Cost</Th>
            </tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50">
                  <Td><Link className="font-mono text-xs font-medium text-brand-700 hover:underline" href={`${base}/${w.id}`}>{w.workOrderRef}</Link>{w.kind === "preventive" && <div><Badge tone="violet">PM</Badge></div>}</Td>
                  <Td className="max-w-xs"><div className="line-clamp-2">{w.scope}</div>{w.maintenanceRequest && <div className="text-xs text-slate-500">{w.maintenanceRequest.requestRef}</div>}</Td>
                  <Td>{w.property.name}{w.unit ? ` · ${w.unit.unitRef}` : ""}{w.asset && <div className="text-xs text-slate-500">{w.asset.name}</div>}</Td>
                  <Td><StatusBadge status={w.priority} /></Td>
                  <Td><StatusBadge status={w.status} /></Td>
                  <Td>{w.assignedUser?.fullName ?? w.vendor?.businessName ?? <span className="text-slate-400">Unassigned</span>}</Td>
                  <Td>{date(w.dueAt)} {w.overdue && <Badge tone="red">Overdue</Badge>}</Td>
                  <Td align="right">{w.totalCostMinor ? money(w.totalCostMinor) : "—"}</Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={{ ...sp, status }} basePath={base} />
          </>
        )}
      </Card>
    </>
  );
}
