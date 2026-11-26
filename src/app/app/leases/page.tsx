import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { listLeases } from "@/server/services/lease.service";
import { listProperties } from "@/server/services/property.service";
import { PageHeader, Card, Input, Select, Button, StatusBadge, EmptyState, ButtonLink, humanize } from "@/components/ui";
import { Table, Th, Td, SortTh, Pagination } from "@/components/ui/table";
import { money, date, FREQ, qs } from "@/components/layout/format";

export const metadata = { title: "Leases" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const [data, props] = await Promise.all([listLeases(ctx, qs(sp)), listProperties(ctx, { pageSize: 100 })]);
  return (
    <>
      <PageHeader title="Leases" subtitle="Tenancy agreements, their status and expiry." actions={ctx.permissions.has("lease.create") && <ButtonLink href="/app/leases/new">New lease</ButtonLink>} />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Lease ref, tenant or unit" defaultValue={sp.search} className="max-w-64" aria-label="Search leases" />
          <Select name="status" defaultValue={sp.status ?? ""} className="max-w-48" aria-label="Status"><option value="">Any status</option>{["draft", "pending_signature", "active", "expiring", "upcoming", "expired", "terminated"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select name="expiringWithinDays" defaultValue={sp.expiringWithinDays ?? ""} className="max-w-48" aria-label="Expiring within"><option value="">Any expiry</option><option value="30">Expiring ≤ 30 days</option><option value="60">Expiring ≤ 60 days</option><option value="90">Expiring ≤ 90 days</option></Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No leases found" action={ctx.permissions.has("lease.create") ? <ButtonLink href="/app/leases/new">Create lease</ButtonLink> : undefined} /></div> : (
          <>
            <Table caption="Leases"><thead><tr>
              <SortTh label="Lease" field="leaseRef" params={sp} basePath="/app/leases" /><Th>Tenant</Th><Th>Property · unit</Th>
              <SortTh label="Start" field="startDate" params={sp} basePath="/app/leases" /><SortTh label="End" field="endDate" params={sp} basePath="/app/leases" />
              <SortTh label="Rent" field="rentAmountMinor" params={sp} basePath="/app/leases" align="right" /><Th>Status</Th>
            </tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`/app/leases/${l.id}`}>{l.leaseRef}</Link></Td>
                  <Td>{l.primaryTenant?.displayName}{l.parties.length > 1 && <span className="text-xs text-slate-500"> +{l.parties.length - 1}</span>}</Td>
                  <Td>{l.property.name} · {l.unit.unitRef}</Td><Td>{date(l.startDate)}</Td>
                  <Td>{date(l.endDate)}{l.displayStatus === "expiring" && <span className="block text-xs text-amber-700">{l.daysToExpiry} days left</span>}</Td>
                  <Td align="right">{money(l.rentAmountMinor)} <span className="text-xs text-slate-500">{FREQ[l.billingFrequency]}</span></Td>
                  <Td><StatusBadge status={l.displayStatus} /></Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath="/app/leases" />
          </>
        )}
      </Card>
    </>
  );
}
