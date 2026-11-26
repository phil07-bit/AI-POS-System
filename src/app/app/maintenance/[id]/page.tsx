import Link from "next/link";
import { orNotFound } from "@/lib/auth/page-guards";
import { getStaffPageContext } from "@/lib/auth/next";
import { formatDateTime, todayInTz } from "@/lib/dates";
import { getRequest } from "@/server/services/maintenance-request.service";
import { facilitiesOptions } from "@/server/views/facilities-options";
import { PageHeader, Card, DL, StatusBadge, Badge, Alert, humanize } from "@/components/ui";
import { ActionButton } from "@/components/forms/action-button";
import { CreateWorkOrderFromRequestForm, RequestNoteForm, TriageForm } from "@/components/forms/maintenance-forms";
import { date } from "@/components/layout/format";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const r = await orNotFound(getRequest(ctx, id));
  const can = (k: string) => ctx.permissions.has(k);
  const manage = can("maintenance.request.manage");
  const today = todayInTz(ctx.timezone);
  const pre = ["submitted", "triaged"].includes(r.status);
  const live = ["approved", "assigned", "in_progress", "waiting_for_parts"].includes(r.status);
  const o = (live && can("work_order.assign")) || (manage && pre) ? await facilitiesOptions(ctx, { assignees: true, vendors: true, managers: true }) : null;
  const ep = `/maintenance-requests/${r.id}`;
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/maintenance", label: "Maintenance" }]}
        title={<>{r.requestRef} <span className="ml-1 align-middle"><StatusBadge status={r.status} /></span> {r.isEmergency && <Badge tone="red">Emergency</Badge>}</>}
        subtitle={r.title}
        actions={<>
          {manage && pre && <ActionButton endpoint={`${ep}/approve`} label="Approve" variant="primary" />}
          {manage && pre && <ActionButton endpoint={`${ep}/reject`} label="Reject" variant="danger" confirm={{ title: "Reject this request?", body: "The requester will see that it was not approved, with your reason." }} reasonLabel="Reason (shown to the requester)" />}
          {manage && r.status === "completed" && <ActionButton endpoint={`${ep}/close`} label="Close request" variant="primary" confirm={{ title: "Close after review?", body: "Confirm the work is satisfactory. The resolution is shown to the requester." }} reasonLabel="Resolution notes" reasonField="resolutionNotes" />}
          {manage && (pre || live) && <ActionButton endpoint={`${ep}/cancel`} label="Cancel request" variant="ghost" confirm={{ title: "Cancel this request?", body: "Blocked while it has open work orders." }} reasonLabel="Reason" />}
        </>} />
      {r.isEmergency && r.status !== "closed" && <div className="mb-4"><Alert tone="error">Emergency request{r.escalatedAt ? ` — escalated to responsible staff ${formatDateTime(r.escalatedAt, ctx.timezone)}` : ""}. AI-POS alerts staff in the app and by email; it is not a monitored 24/7 service.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Request" className="lg:col-span-2">
          <p className="mb-4 whitespace-pre-line text-sm text-slate-800">{r.description}</p>
          <DL items={[
            ["Property · unit", <>{r.property.name}{r.unit && <> · <Link className="text-brand-700 hover:underline" href={`/app/units/${r.unit.id}`}>{r.unit.unitRef}</Link></>}</>],
            ["Related asset", r.asset ? <Link className="text-brand-700 hover:underline" href={`/app/assets/${r.asset.id}`}>{r.asset.assetRef} {r.asset.name}</Link> : "—"],
            ["Category", humanize(r.category)], ["Priority", <StatusBadge key="p" status={r.priority} />],
            ["Requester", <>{r.requesterName}{r.tenant && <> (<Link className="text-brand-700 hover:underline" href={`/app/tenants/${r.tenant.id}`}>tenant</Link>)</>}</>], ["Contact", r.requesterContact],
            ["Submitted", formatDateTime(r.submittedAt, ctx.timezone)], ["Target date", <>{date(r.targetDate)} {r.overdue && <Badge tone="red">Late</Badge>}</>],
            ["Responsible manager", r.assignedManager?.name], ["Source", r.source === "tenant_portal" ? "Tenant portal" : "Staff"],
            ["Decision", r.decisionReason], ["Resolution", r.resolutionNotes],
            ["Requester feedback", r.feedbackRating ? `${r.feedbackRating}/5${r.feedbackComment ? ` — ${r.feedbackComment}` : ""}` : "—"],
          ]} />
        </Card>
        <Card title="Work orders" padded={false}>
          {r.workOrders.length === 0 ? <p className="p-4 text-sm text-slate-500">{pre ? "Approve the request to raise a work order." : "No work orders yet."}</p> : (
            <ul className="divide-y divide-slate-100">{r.workOrders.map((w) => (
              <li key={w.id} className="px-4 py-2 text-sm"><Link className="font-mono text-xs text-brand-700 hover:underline" href={`/app/work-orders/${w.id}`}>{w.workOrderRef}</Link> <StatusBadge status={w.status} />
                <div className="text-xs text-slate-500">{w.assignedUser?.fullName ?? w.vendor?.businessName ?? "Unassigned"} · due {date(w.dueAt)}</div></li>
            ))}</ul>
          )}
        </Card>
      </div>
      {manage && pre && o && <Card title="Triage" className="mt-4"><TriageForm requestId={r.id} category={r.category} priority={r.priority} targetDate={r.targetDate} managers={o.managers} managerId={r.assignedManager?.membershipId ?? null} /></Card>}
      {live && can("work_order.assign") && o && (
        <Card title="Raise a work order" className="mt-4"><CreateWorkOrderFromRequestForm requestId={r.id} users={o.users} vendors={o.vendors} defaultScope={`${r.title}\n\n${r.description}`} priority={r.priority} dueAt={r.targetDate} today={today} /></Card>
      )}
      <Card title="Timeline" className="mt-4">
        <ol className="space-y-3">{r.updates.map((u) => (
          <li key={u.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">{formatDateTime(u.createdAt, ctx.timezone)} · {u.authorName} {u.visibility === "tenant" ? <Badge tone="blue">Visible to requester</Badge> : <Badge>Internal</Badge>}</div>
            <p className="whitespace-pre-line">{u.body}</p>
          </li>
        ))}</ol>
        {manage && !["closed", "rejected", "cancelled"].includes(r.status) && <div className="mt-4 border-t border-slate-100 pt-4"><RequestNoteForm requestId={r.id} /></div>}
      </Card>
    </>
  );
}
