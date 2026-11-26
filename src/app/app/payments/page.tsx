import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { listPayments } from "@/server/services/payment.service";
import { PageHeader, Card, Select, Button, StatusBadge, EmptyState, ButtonLink, humanize, Input } from "@/components/ui";
import { Table, Th, Td, Pagination } from "@/components/ui/table";
import { money, date, qs } from "@/components/layout/format";

export const metadata = { title: "Payments" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const data = await listPayments(ctx, qs(sp, { sortOrder: sp.sortOrder ?? "desc" }));
  return (
    <>
      <PageHeader title="Payments" subtitle="Money received and recorded. Pending payments are not counted until confirmed." actions={ctx.permissions.has("payment.record") && <ButtonLink href="/app/payments/new">Record payment</ButtonLink>} />
      <Card padded={false}>
        <form method="get" className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
          <Input name="search" placeholder="Ref, receipt, MoMo ID or tenant" defaultValue={sp.search} className="max-w-64" aria-label="Search payments" />
          <Select name="status" defaultValue={sp.status ?? ""} className="max-w-40" aria-label="Status"><option value="">Any status</option>{["pending", "confirmed", "reversed"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select name="method" defaultValue={sp.method ?? ""} className="max-w-44" aria-label="Method"><option value="">Any method</option>{["mobile_money", "bank_transfer", "cash", "cheque", "card", "other"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <label className="text-xs text-slate-600">From <Input type="date" name="from" defaultValue={sp.from} /></label>
          <label className="text-xs text-slate-600">To <Input type="date" name="to" defaultValue={sp.to} /></label>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title="No payments found" action={ctx.permissions.has("payment.record") ? <ButtonLink href="/app/payments/new">Record payment</ButtonLink> : undefined} /></div> : (
          <>
            <Table caption="Payments"><thead><tr><Th>Payment</Th><Th>Received</Th><Th>Tenant</Th><Th>Property · unit</Th><Th>Method · ref</Th><Th align="right">Amount</Th><Th align="right">Unallocated</Th><Th>Status</Th><Th>Receipt</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td><Link className="font-mono text-xs text-brand-700 hover:underline" href={`/app/payments/${p.id}`}>{p.paymentRef}</Link></Td>
                  <Td>{date(p.receivedAt)}</Td><Td>{p.tenant.displayName}</Td><Td>{p.lease?.property.name} · {p.lease?.unit.unitRef}</Td>
                  <Td className="text-xs">{humanize(p.paymentMethod)}{p.externalReference ? ` · ${p.externalReference}` : ""}</Td>
                  <Td align="right">{money(p.amountMinor)}</Td><Td align="right">{p.unallocatedMinor ? money(p.unallocatedMinor) : "—"}</Td>
                  <Td><StatusBadge status={p.status} /></Td><Td className="font-mono text-xs">{p.receipt?.receiptNumber ?? "—"}</Td>
                </tr>
              ))}</tbody></Table>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} params={sp} basePath="/app/payments" />
          </>
        )}
      </Card>
    </>
  );
}
