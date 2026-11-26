import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { orNotFound } from "@/lib/auth/page-guards";
import { listPlans } from "@/server/services/preventive-maintenance.service";
import { listProperties } from "@/server/services/property.service";
import { PageHeader, Card, Select, Button, StatusBadge, EmptyState, Stat } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { ActionButton } from "@/components/forms/action-button";
import { date, money } from "@/components/layout/format";

export const metadata = { title: "Preventive maintenance" };
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  const [all, props] = await orNotFound(Promise.all([listPlans(ctx, { propertyId: sp.propertyId || undefined }), listProperties(ctx, { pageSize: 100 })]));
  const plans = sp.due ? all.filter((p) => p.dueStatus === sp.due) : all;
  const count = (s: string) => all.filter((p) => p.dueStatus === s).length;
  const canGenerate = ctx.permissions.has("asset.manage") && ctx.permissions.has("work_order.assign");
  return (
    <>
      <PageHeader title="Preventive maintenance" subtitle="Recurring service plans. Work orders are created automatically by the daily job when a plan enters its lead window."
        actions={canGenerate && <ActionButton endpoint="/preventive-maintenance-plans/generate" label="Generate due work orders now" variant="primary" successMessage="Generated." />} />
      <div className="grid grid-cols-3 gap-3">
        <Link href="?due=overdue"><Stat label="Overdue" value={count("overdue")} tone={count("overdue") ? "red" : "green"} /></Link>
        <Link href="?due=due_soon"><Stat label="Due in 14 days" value={count("due_soon")} tone={count("due_soon") ? "amber" : undefined} /></Link>
        <Link href="?due=ok"><Stat label="On schedule" value={count("ok")} /></Link>
      </div>
      <Card padded={false} className="mt-4">
        <form method="get" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Select name="propertyId" defaultValue={sp.propertyId ?? ""} className="max-w-56" aria-label="Property"><option value="">All properties</option>{props.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select name="due" defaultValue={sp.due ?? ""} className="max-w-44" aria-label="Due status"><option value="">Any</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option><option value="ok">On schedule</option></Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {plans.length === 0 ? <div className="p-4"><EmptyState title="No plans" body="Open an asset and add a preventive plan (e.g. quarterly generator service)." /></div> : (
          <Table caption="Preventive maintenance plans"><thead><tr><Th>Plan</Th><Th>Asset</Th><Th>Every</Th><Th>Due</Th><Th>Status</Th><Th>Open work order</Th><Th>Assigned to</Th><Th align="right">Est. cost</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{plans.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-medium">{p.planName}<div className="text-xs text-slate-500">{p.checklist.length} checklist item{p.checklist.length === 1 ? "" : "s"}</div></Td>
                <Td><Link className="text-brand-700 hover:underline" href={`/app/assets/${p.asset.id}`}>{p.asset.assetRef} {p.asset.name}</Link><div className="text-xs text-slate-500">{p.asset.property.name}</div></Td>
                <Td>{p.intervalDays} days</Td>
                <Td>{date(p.effectiveDueAt)}{p.openWorkOrders.length === 0 && <div className="text-xs text-slate-500">WO created {p.leadDays}d before</div>}</Td>
                <Td><StatusBadge status={p.dueStatus} /></Td>
                <Td>{p.openWorkOrders.map((w) => <div key={w.id}><Link className="font-mono text-xs text-brand-700 hover:underline" href={`/app/work-orders/${w.id}`}>{w.workOrderRef}</Link> <StatusBadge status={w.status} /></div>)}{p.openWorkOrders.length === 0 && "—"}</Td>
                <Td>{p.assignedUser?.fullName ?? p.assignedVendor?.businessName ?? "—"}</Td>
                <Td align="right">{p.estimatedCostMinor ? money(p.estimatedCostMinor) : "—"}</Td>
              </tr>
            ))}</tbody></Table>
        )}
      </Card>
    </>
  );
}
