import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { orNotFound } from "@/lib/auth/page-guards";
import { listRequests } from "@/server/services/maintenance-request.service";
import { listProperties } from "@/server/services/property.service";
import { MAINTENANCE_CATEGORIES as CATEGORIES } from "@/server/domain/maintenance";
import { PageHeader, Card, Input, Select, Button, ButtonLink, StatusBadge, EmptyState, Alert, Badge, humanize } from "@/components/ui";
import { Table, Th, Td, SortTh, Pagination } from "@/components/ui/table";
import { date, qs } from "@/components/layout/format";

export const metadata = { title: "Maintenance" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const status = sp.status ?? "open";
  const [data, props, emergencies] = await orNotFound(Promise.all([
    listRequests(ctx, qs(sp, { status: status === "all" ? undefined : status })),
    listProperties(ctx, { pageSize: 100 }),
    listRequests(ctx, { status: "open", priority: "emergency", pageSize: 5 }),
  ]));
  const base = "/app/maintenance";
  return (
    <>
      <PageHeader title="Maintenance requests" subtitle="Requests from tenants and staff. Triage, approve, then raise a work order."
        actions={ctx.permissions.has("maintenance.request.create") && <ButtonLink href="/app/maintenance/new">Log request</ButtonLink>} />
      {emergencies.total > 0 && (
        <div className="mb-4"><Alert tone="error"><strong>{emergencies.total} open emergency request{emergencies.total > 1 ? "s" : ""}:</strong>{" "}
          {emergencies.items.map((r, i) => <span key={r.id}>{i > 0 && ", "}<Link className="underline" href={`${base}/${r.id}`}>{r.requestRef} {r.title}</Link></span>)}
        </Alert></div>
      )}
      <Card padded={false}>
        <form method="get" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Ref, title or requester" defaultValue={sp.search} className="max-w-56" aria-label="Search requests" />
          <Select name="status" defaultValue={status} className="max-w-48" aria-label="Status"><option value="open">Open</option><option value="all">All statuses</option>{["submitted", "triaged", "approved", "assigned", "in_progress", "waiting_for_parts", "completed", "closed", "rejected", "cancelled"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="priority" defaultValue={sp.priority ?? ""} className="max-w-40" aria-label="Priority"><option value="">Any priority</option>{["emergency", "high", "normal", "low"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="category" defaultValue={sp.category ?? ""} className="max-w-44" aria-label="Category"><option value="">Any category</option>{CATEGORIES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No requests match" body="Tenants can submit requests from the tenant portal; staff can log them here." /></div> : (
          <>
            <Table caption="Maintenance requests"><thead><tr>
              <SortTh label="Ref" field="requestRef" params={sp} basePath={base} /><Th>Request</Th><Th>Location</Th><SortTh label="Priority" field="priority" params={sp} basePath={base} />
              <SortTh label="Status" field="status" params={sp} basePath={base} /><SortTh label="Submitted" field="submittedAt" params={sp} basePath={base} /><SortTh label="Target" field="targetDate" params={sp} basePath={base} /><Th>Work orders</Th>
            </tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((r) => (
                <tr key={r.id} className={r.isEmergency && r.status !== "closed" ? "bg-red-50/50" : "hover:bg-slate-50"}>
                  <Td><Link className="font-mono text-xs font-medium text-brand-700 hover:underline" href={`${base}/${r.id}`}>{r.requestRef}</Link></Td>
                  <Td><div className="font-medium">{r.title}</div><div className="text-xs text-slate-500">{humanize(r.category)} · {r.requesterName}{r.source === "tenant_portal" ? " · via portal" : ""}</div></Td>
                  <Td>{r.property.name}{r.unit ? ` · ${r.unit.unitRef}` : ""}{r.asset ? <div className="text-xs text-slate-500">{r.asset.name}</div> : null}</Td>
                  <Td><StatusBadge status={r.priority} /></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td>{date(r.submittedAt.toISOString().slice(0, 10))}</Td>
                  <Td>{date(r.targetDate)} {r.overdue && <Badge tone="red">Late</Badge>}</Td>
                  <Td>{r.workOrders.map((w) => <div key={w.id} className="text-xs">{w.workOrderRef} · {humanize(w.status)}</div>)}</Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={{ ...sp, status }} basePath={base} />
          </>
        )}
      </Card>
    </>
  );
}
