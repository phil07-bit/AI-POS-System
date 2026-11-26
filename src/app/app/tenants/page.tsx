import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { listTenants } from "@/server/services/tenant.service";
import { PageHeader, Card, Input, Select, Button, StatusBadge, EmptyState, ButtonLink, humanize } from "@/components/ui";
import { Table, Th, Td, SortTh, Pagination } from "@/components/ui/table";
import { qs } from "@/components/layout/format";

export const metadata = { title: "Tenants" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const data = await listTenants(ctx, qs(sp));
  return (
    <>
      <PageHeader title="Tenants" subtitle="Individuals and organizations renting from you." actions={ctx.permissions.has("tenant.create") && <ButtonLink href="/app/tenants/new">Add tenant</ButtonLink>} />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Name, phone, email or ref" defaultValue={sp.search} className="max-w-64" aria-label="Search tenants" />
          <Select name="status" defaultValue={sp.status ?? ""} className="max-w-44" aria-label="Status"><option value="">Any status</option>{["prospective", "active", "former"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="includeArchived" value="true" defaultChecked={sp.includeArchived === "true"} /> Include archived</label>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No tenants found" action={ctx.permissions.has("tenant.create") ? <ButtonLink href="/app/tenants/new">Add tenant</ButtonLink> : undefined} /></div> : (
          <>
            <Table caption="Tenants"><thead><tr><SortTh label="Ref" field="tenantRef" params={sp} basePath="/app/tenants" /><SortTh label="Name" field="displayName" params={sp} basePath="/app/tenants" /><Th>Type</Th><Th>Phone</Th><Th>Email</Th><Th>Active lease</Th><SortTh label="Status" field="status" params={sp} basePath="/app/tenants" /></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{t.tenantRef}</Td>
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`/app/tenants/${t.id}`}>{t.displayName}</Link></Td>
                  <Td>{humanize(t.tenantType)}</Td><Td className="tabular">{t.phone ?? "—"}</Td><Td>{t.email ?? "—"}</Td>
                  <Td>{t.activeLeases.map((l) => <div key={l.id}><Link className="hover:underline" href={`/app/leases/${l.id}`}>{l.property.name} · {l.unit.unitRef}</Link></div>)}{t.activeLeases.length === 0 && "—"}</Td>
                  <Td>{t.archivedAt ? <StatusBadge status="archived" /> : <StatusBadge status={t.status} />}</Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath="/app/tenants" />
          </>
        )}
      </Card>
    </>
  );
}
