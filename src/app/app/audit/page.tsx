import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { listAuditLogs } from "@/server/services/audit-query.service";
import { PageHeader, Card, Input, Button, Badge, EmptyState, Select } from "@/components/ui";
import { Table, Th, Td, Pagination } from "@/components/ui/table";
import { qs } from "@/components/layout/format";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Audit log" };
type SP = Record<string, string | undefined>;
const ENTITY_TYPES = ["organization", "membership", "invitation", "user", "property", "unit", "tenant", "lease", "rent_charge", "payment", "receipt"];

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("audit.read")) redirect("/app");
  const data = await listAuditLogs(ctx, qs(sp, { pageSize: "50" }));
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of material changes. Sensitive values are redacted." />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Summary or actor" defaultValue={sp.search} className="max-w-56" aria-label="Search" />
          <Input name="action" placeholder="Action prefix e.g. payment." defaultValue={sp.action} className="max-w-56" aria-label="Action" />
          <Select name="entityType" defaultValue={sp.entityType ?? ""} className="max-w-44" aria-label="Entity"><option value="">Any entity</option>{ENTITY_TYPES.map((e) => <option key={e}>{e}</option>)}</Select>
          <label className="text-xs text-slate-600">From <Input type="date" name="from" defaultValue={sp.from} /></label>
          <label className="text-xs text-slate-600">To <Input type="date" name="to" defaultValue={sp.to} /></label>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No audit events match" /></div> : (
          <>
            <Table caption="Audit log"><thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Summary</Th><Th>Details</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt, ctx.timezone)}</Td><Td>{l.actorName ?? "System"}</Td>
                  <Td><Badge>{l.action}</Badge>{l.isDemo && <span className="ml-1 text-[10px] text-amber-700">demo</span>}</Td><Td className="text-xs">{l.entityType}</Td>
                  <Td>{l.summary}</Td>
                  <Td>{(l.beforeJson || l.afterJson || l.metadataJson) ? <details className="text-xs"><summary className="cursor-pointer text-brand-700">View</summary><pre className="mt-1 max-h-64 max-w-md overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{JSON.stringify({ before: l.beforeJson, after: l.afterJson, meta: l.metadataJson, requestId: l.requestId }, null, 2)}</pre></details> : null}</Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath="/app/audit" />
          </>
        )}
      </Card>
    </>
  );
}
