import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { listProperties, listAssignableManagers, PROPERTY_TYPES } from "@/server/services/property.service";
import { PageHeader, ButtonLink, Card, Input, Select, Button, StatusBadge, EmptyState, humanize } from "@/components/ui";
import { Table, Td, Th, SortTh, Pagination } from "@/components/ui/table";
import { addressLine, qs } from "@/components/layout/format";

export const metadata = { title: "Properties" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const data = await listProperties(ctx, qs(sp));
  const managers = await listAssignableManagers(ctx);
  return (
    <>
      <PageHeader title="Properties" subtitle="Buildings, estates, compounds and sites in your portfolio." actions={ctx.permissions.has("property.create") && <ButtonLink href="/app/properties/new">Add property</ButtonLink>} />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Search name, ref or community" defaultValue={sp.search} className="max-w-xs" aria-label="Search properties" />
          <Select name="propertyType" defaultValue={sp.propertyType ?? ""} className="max-w-44" aria-label="Type"><option value="">All types</option>{PROPERTY_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="max-w-44" aria-label="Status"><option value="">Active statuses</option>{["active", "inactive", "under_development", "archived"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="managerId" defaultValue={sp.managerId ?? ""} className="max-w-48" aria-label="Manager"><option value="">Any manager</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? (
          <div className="p-4"><EmptyState title={sp.search || sp.status ? "No properties match these filters" : "No properties yet"} body="Properties hold units, tenants and leases." action={ctx.permissions.has("property.create") ? <ButtonLink href="/app/properties/new">Add property</ButtonLink> : undefined} /></div>
        ) : (
          <>
            <Table caption="Properties">
              <thead><tr>
                <SortTh label="Ref" field="propertyRef" params={sp} basePath="/app/properties" />
                <SortTh label="Name" field="name" params={sp} basePath="/app/properties" />
                <SortTh label="Type" field="propertyType" params={sp} basePath="/app/properties" />
                <Th>Location</Th><Th>Manager</Th><Th align="right">Units</Th><Th align="right">Occupancy</Th><Th>Status</Th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td className="font-mono text-xs">{p.propertyRef}</Td>
                    <Td><Link href={`/app/properties/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link></Td>
                    <Td>{humanize(p.propertyType)}</Td>
                    <Td className="text-slate-600">{addressLine(p.address)}</Td>
                    <Td>{p.managerName ?? "—"}</Td>
                    <Td align="right">{p.occupancy.totalUnits}</Td>
                    <Td align="right">{p.occupancy.occupancyRate === null ? "N/A" : `${p.occupancy.occupancyRate}%`} <span className="text-xs text-slate-500">({p.occupancy.occupiedUnits}/{p.occupancy.rentableUnits})</span></Td>
                    <Td><StatusBadge status={p.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath="/app/properties" />
          </>
        )}
      </Card>
    </>
  );
}
