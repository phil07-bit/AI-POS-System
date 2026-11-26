import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { listUnits, UNIT_TYPES } from "@/server/services/unit.service";
import { listProperties } from "@/server/services/property.service";
import { PageHeader, Card, Input, Select, Button, StatusBadge, EmptyState, humanize } from "@/components/ui";
import { Table, Th, Td, SortTh, Pagination } from "@/components/ui/table";
import { money, date, FREQ, qs } from "@/components/layout/format";

export const metadata = { title: "Units" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const [data, props] = await Promise.all([
    listUnits(ctx, qs(sp)),
    listProperties(ctx, { pageSize: 100 }),
  ]);
  return (
    <>
      <PageHeader title="Units" subtitle="Rentable spaces across all properties. Add units from a property's Units tab." />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Unit ref or name" defaultValue={sp.search} className="max-w-56" aria-label="Search units" />
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select name="occupancy" defaultValue={sp.occupancy ?? ""} className="max-w-48" aria-label="Occupancy"><option value="">Any status</option>{["occupied", "vacant", "reserved", "unavailable", "under_maintenance"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="unitType" defaultValue={sp.unitType ?? ""} className="max-w-48" aria-label="Type"><option value="">Any type</option>{UNIT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No units found" body="Create units from a property's page." /></div> : (
          <>
            <Table caption="Units"><thead><tr>
              <Th>Property</Th><SortTh label="Unit" field="unitRef" params={sp} basePath="/app/units" /><SortTh label="Type" field="unitType" params={sp} basePath="/app/units" />
              <SortTh label="Asking rent" field="askingRentMinor" params={sp} basePath="/app/units" align="right" /><Th>Status</Th><Th>Tenant</Th><Th>Lease ends</Th>
            </tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <Td><Link className="hover:underline" href={`/app/properties/${u.property.id}`}>{u.property.name}</Link></Td>
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`/app/units/${u.id}`}>{u.unitRef}</Link></Td>
                  <Td>{humanize(u.unitType)}{u.bedrooms != null ? ` · ${u.bedrooms} bed` : ""}</Td>
                  <Td align="right">{u.askingRentMinor != null ? <>{money(u.askingRentMinor)} <span className="text-xs text-slate-500">{FREQ[u.rentFrequency]}</span></> : "—"}</Td>
                  <Td><StatusBadge status={u.occupancyStatus} /></Td>
                  <Td>{u.currentLease?.tenant?.displayName ?? "—"}</Td>
                  <Td>{u.currentLease ? date(u.currentLease.endDate) : "—"}</Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath="/app/units" />
          </>
        )}
      </Card>
    </>
  );
}
