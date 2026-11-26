import Link from "next/link";
import { orNotFound } from "@/lib/auth/page-guards";
import { getStaffPageContext } from "@/lib/auth/next";
import { formatDateTime, todayInTz } from "@/lib/dates";
import { getWorkOrder } from "@/server/services/work-order.service";
import { facilitiesOptions } from "@/server/views/facilities-options";
import { PageHeader, Card, DL, StatusBadge, Badge, humanize } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { ActionButton } from "@/components/forms/action-button";
import { ReassignForm, WorkOrderProgressForm } from "@/components/forms/maintenance-forms";
import { date, money } from "@/components/layout/format";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const w = await orNotFound(getWorkOrder(ctx, id));
  const can = (k: string) => ctx.permissions.has(k);
  const ep = `/work-orders/${w.id}`;
  const open = ["open", "assigned", "in_progress", "waiting_for_parts"].includes(w.status);
  const working = ["in_progress", "waiting_for_parts"].includes(w.status);
  const o = open && can("work_order.assign") ? await facilitiesOptions(ctx, { assignees: true, vendors: true }) : null;
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/work-orders", label: "Work orders" }]}
        title={<>{w.workOrderRef} <span className="ml-1 align-middle"><StatusBadge status={w.status} /></span> {w.kind === "preventive" && <Badge tone="violet">Preventive</Badge>} {w.overdue && <Badge tone="red">Overdue</Badge>}</>}
        subtitle={`${humanize(w.category)} · ${w.property.name}${w.unit ? ` · ${w.unit.unitRef}` : ""}`}
        actions={<>
          {can("work_order.update") && (w.status === "open" || w.status === "assigned") && <ActionButton endpoint={`${ep}/progress`} body={{ status: "in_progress" }} label="Start work" variant="primary" />}
          {can("work_order.update") && w.status === "in_progress" && <ActionButton endpoint={`${ep}/progress`} body={{ status: "waiting_for_parts" }} label="Waiting for parts" confirm={{ title: "Put on hold for parts?", body: "Add what is needed; it is recorded on the request timeline." }} reasonLabel="What is needed?" reasonField="note" />}
          {can("work_order.update") && w.status === "waiting_for_parts" && <ActionButton endpoint={`${ep}/progress`} body={{ status: "in_progress" }} label="Resume work" variant="primary" />}
          {can("work_order.close") && w.status === "completed" && <ActionButton endpoint={`${ep}/close`} label="Sign off & close" variant="primary" confirm={{ title: "Sign off this work order?", body: "Confirms the work and costs are correct. Closed work orders cannot be edited; asset service dates update." }} />}
          {can("work_order.close") && w.status === "completed" && <ActionButton endpoint={`${ep}/return`} label="Return for rework" confirm={{ title: "Return for rework?", body: "The work order goes back to in progress." }} reasonLabel="What still needs doing?" />}
          {can("work_order.assign") && open && <ActionButton endpoint={`${ep}/cancel`} label="Cancel" variant="ghost" confirm={{ title: "Cancel this work order?", body: "Costs recorded so far are kept for history." }} reasonLabel="Reason" />}
        </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Job" className="lg:col-span-2">
          <p className="mb-4 whitespace-pre-line text-sm">{w.scope}</p>
          <DL items={[
            ["Request", w.maintenanceRequest ? (can("maintenance.request.read") ? <Link className="text-brand-700 hover:underline" href={`/app/maintenance/${w.maintenanceRequest.id}`}>{w.maintenanceRequest.requestRef} {w.maintenanceRequest.title}</Link> : `${w.maintenanceRequest.requestRef} ${w.maintenanceRequest.title}`) : "—"],
            ["Requester contact", w.maintenanceRequest ? `${w.maintenanceRequest.requesterName}${w.maintenanceRequest.requesterContact ? ` · ${w.maintenanceRequest.requesterContact}` : ""}` : "—"],
            ["Asset", w.asset ? <Link className="text-brand-700 hover:underline" href={`/app/assets/${w.asset.id}`}>{w.asset.assetRef} {w.asset.name}</Link> : "—"],
            ["Preventive plan", w.pmPlan ? `${w.pmPlan.planName} (due ${date(w.pmDueDate)})` : "—"],
            ["Priority", <StatusBadge key="p" status={w.priority} />],
            ["Assigned to", w.assignedUser?.fullName ?? (w.vendor ? `${w.vendor.businessName}${w.vendor.phone ? ` · ${w.vendor.phone}` : ""}` : "Unassigned")],
            ["Scheduled / due", `${date(w.scheduledAt)} / ${date(w.dueAt)}`], ["Started", formatDateTime(w.startedAt, ctx.timezone)],
            ["Completed", formatDateTime(w.completedAt, ctx.timezone)], ["Closed", w.closedAt ? `${formatDateTime(w.closedAt, ctx.timezone)} · ${w.signOffName}` : "—"],
            ["Sign-off notes", w.signOffNotes], ["Return visit", date(w.returnVisitDate)], ["Cancelled because", w.cancelReason],
          ]} />
        </Card>
        <Card title="Costs">
          {(
            <Table><tbody className="divide-y divide-slate-100">
              {([["Labour", w.labourCostMinor], ["Materials", w.materialsCostMinor], ["Vendor invoice", w.vendorCostMinor], ["Other", w.otherCostMinor]] as const).map(([k, v]) => <tr key={k}><Td>{k}</Td><Td align="right">{money(v)}</Td></tr>)}
              <tr className="font-semibold"><Td>Total</Td><Td align="right">{money(w.totalCostMinor)}</Td></tr>
              <tr><Td>Purchase ref</Td><Td align="right">{w.purchaseReference ?? "—"}</Td></tr>
            </tbody></Table>
          )}
          <p className="mt-2 text-xs text-slate-500">Maintenance spend is reported in Maintenance Costs. It is not charged to the tenant ledger.</p>
        </Card>
      </div>
      {(w.status === "completed" || w.status === "closed") && (
        <Card title="Completion" className="mt-4">
          <p className="whitespace-pre-line text-sm">{w.completionNotes ?? "—"}</p>
          {w.checklist.length > 0 && <Table><thead><tr><Th>Checklist item</Th><Th>Done</Th><Th>Reading / note</Th></tr></thead><tbody className="divide-y divide-slate-100">{w.checklist.map((c, i) => <tr key={i}><Td>{c.item}</Td><Td>{c.done ? "Yes" : <Badge tone="amber">No</Badge>}</Td><Td>{c.reading ?? c.note ?? "—"}</Td></tr>)}</tbody></Table>}
        </Card>
      )}
      {can("work_order.update") && open && (
        <Card title={working ? "Record work, costs and checklist" : "Costs and notes"} className="mt-4">
          <WorkOrderProgressForm workOrderId={w.id} complete={working} initial={w} />
          {!working && <p className="mt-2 text-xs text-slate-500">Start the work to mark it complete.</p>}
        </Card>
      )}
      {o && <Card title="Assignment" className="mt-4"><ReassignForm workOrderId={w.id} users={o.users} vendors={o.vendors} today={todayInTz(ctx.timezone)} current={{ assignedUserId: w.assignedUser?.id ?? null, vendorId: w.vendor?.id ?? null, scheduledAt: w.scheduledAt, dueAt: w.dueAt, priority: w.priority }} /></Card>}
    </>
  );
}
