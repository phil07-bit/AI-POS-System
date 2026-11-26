import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { orNotFound } from "@/lib/auth/page-guards";
import { listAssets } from "@/server/services/asset.service";
import { listProperties } from "@/server/services/property.service";
import { ASSET_CATEGORIES } from "@/server/domain/maintenance";
import { PageHeader, Card, Input, Select, Button, ButtonLink, StatusBadge, EmptyState, Badge, humanize } from "@/components/ui";
import { Table, Th, Td, SortTh, Pagination } from "@/components/ui/table";
import { date, qs } from "@/components/layout/format";

export const metadata = { title: "Assets" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const [data, props, overdue] = await orNotFound(Promise.all([listAssets(ctx, qs(sp)), listProperties(ctx, { pageSize: 100 }), listAssets(ctx, { service: "overdue", pageSize: 1 })]));
  const base = "/app/assets";
  return (
    <>
      <PageHeader title="Asset register" subtitle="Generators, pumps, lifts, air-conditioners and other maintainable equipment."
        actions={<>{overdue.total > 0 && <ButtonLink variant="secondary" href="/app/assets?service=overdue">{overdue.total} overdue for service</ButtonLink>}{ctx.permissions.has("asset.manage") && <ButtonLink href="/app/assets/new">Register asset</ButtonLink>}</>} />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Name, ref or serial" defaultValue={sp.search} className="max-w-56" aria-label="Search assets" />
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select name="category" defaultValue={sp.category ?? ""} className="max-w-48" aria-label="Category"><option value="">Any category</option>{ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select>
          <Select name="service" defaultValue={sp.service ?? ""} className="max-w-44" aria-label="Service status"><option value="">Any service status</option><option value="overdue">Overdue</option><option value="due_soon">Due in 14 days</option><option value="ok">OK</option><option value="not_scheduled">Not scheduled</option></Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="max-w-40" aria-label="Lifecycle"><option value="">Active + inactive</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="disposed">Disposed</option></Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No assets match" body="Register equipment so its servicing can be planned and tracked." /></div> : (
          <>
            <Table caption="Assets"><thead><tr><SortTh label="Ref" field="assetRef" params={sp} basePath={base} /><SortTh label="Asset" field="name" params={sp} basePath={base} /><Th>Location</Th><SortTh label="Criticality" field="criticality" params={sp} basePath={base} /><Th>Condition</Th><Th>Last serviced</Th><SortTh label="Next due" field="nextServiceAt" params={sp} basePath={base} /><Th>Service</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{a.assetRef}</Td>
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`${base}/${a.id}`}>{a.name}</Link><div className="text-xs text-slate-500">{humanize(a.category)}{a.make ? ` · ${a.make}` : ""}{a.underWarranty ? " · under warranty" : ""}</div></Td>
                  <Td>{a.property.name}{a.unit ? ` · ${a.unit.unitRef}` : ""}{a.location && <div className="text-xs text-slate-500">{a.location}</div>}</Td>
                  <Td><StatusBadge status={a.criticality} /></Td>
                  <Td><StatusBadge status={a.condition} /></Td>
                  <Td>{date(a.lastServicedAt)}</Td>
                  <Td>{date(a.nextDueAt)}</Td>
                  <Td>{a.status !== "active" ? <StatusBadge status={a.status} /> : <StatusBadge status={a.serviceStatus} />}{a.plans.length > 0 && <div className="mt-0.5"><Badge tone="violet">{a.plans.length} plan{a.plans.length > 1 ? "s" : ""}</Badge></div>}</Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath={base} />
          </>
        )}
      </Card>
    </>
  );
}
