import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { orNotFound } from "@/lib/auth/page-guards";
import { listVendors } from "@/server/services/vendor.service";
import { MAINTENANCE_CATEGORIES as CATEGORIES } from "@/server/domain/maintenance";
import { PageHeader, Card, Input, Select, Button, ButtonLink, StatusBadge, EmptyState, humanize } from "@/components/ui";
import { Table, Th, Td, SortTh, Pagination } from "@/components/ui/table";
import { qs } from "@/components/layout/format";

export const metadata = { title: "Vendors" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const data = await orNotFound(listVendors(ctx, qs(sp)));
  const base = "/app/vendors";
  return (
    <>
      <PageHeader title="Vendors" subtitle="Contractors and service providers for maintenance work." actions={ctx.permissions.has("vendor.manage") && <ButtonLink href="/app/vendors/new">Add vendor</ButtonLink>} />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Name, contact or ref" defaultValue={sp.search} className="max-w-56" aria-label="Search vendors" />
          <Select name="category" defaultValue={sp.category ?? ""} className="max-w-48" aria-label="Service"><option value="">Any service</option>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="max-w-40" aria-label="Status"><option value="">Any status</option>{["active", "inactive", "suspended"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No vendors yet" body="Add the plumbers, electricians and service companies you work with." /></div> : (
          <>
            <Table caption="Vendors"><thead><tr><SortTh label="Ref" field="vendorRef" params={sp} basePath={base} /><SortTh label="Business" field="businessName" params={sp} basePath={base} /><Th>Contact</Th><Th>Services</Th><SortTh label="Status" field="status" params={sp} basePath={base} /></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{v.vendorRef}</Td>
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`${base}/${v.id}`}>{v.businessName}</Link></Td>
                  <Td>{v.contactName ?? "—"}<div className="text-xs text-slate-500">{[v.phone, v.email].filter(Boolean).join(" · ")}</div></Td>
                  <Td>{v.serviceCategories.map(humanize).join(", ") || "—"}</Td>
                  <Td><StatusBadge status={v.status} /></Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath={base} />
          </>
        )}
      </Card>
    </>
  );
}
