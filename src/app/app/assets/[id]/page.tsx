import Link from "next/link";
import { orNotFound } from "@/lib/auth/page-guards";
import { getStaffPageContext } from "@/lib/auth/next";
import { todayInTz } from "@/lib/dates";
import { getAsset, getAssetServiceHistory } from "@/server/services/asset.service";
import { listPlans } from "@/server/services/preventive-maintenance.service";
import { listRequests } from "@/server/services/maintenance-request.service";
import { facilitiesOptions } from "@/server/views/facilities-options";
import { PageHeader, Card, DL, StatusBadge, Badge, ButtonLink, humanize } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { AssetForm, PlanForm } from "@/components/forms/maintenance-forms";
import { date, money } from "@/components/layout/format";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const a = await orNotFound(getAsset(ctx, id));
  const can = (k: string) => ctx.permissions.has(k);
  const [history, plans, requests] = await Promise.all([
    getAssetServiceHistory(ctx, id), listPlans(ctx, { assetId: id, includeInactive: true }),
    can("maintenance.request.read") ? listRequests(ctx, { assetId: id, pageSize: 10, sortBy: "submittedAt", sortOrder: "desc" }) : null,
  ]);
  const manage = can("asset.manage") && a.status !== "disposed";
  const o = manage ? await facilitiesOptions(ctx, { assignees: true, vendors: true }) : null;
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/assets", label: "Assets" }]}
        title={<>{a.name} <span className="ml-1 align-middle"><StatusBadge status={a.status === "active" ? a.serviceStatus : a.status} /></span></>}
        subtitle={`${a.assetRef} · ${humanize(a.category)} · ${a.property.name}${a.unit ? ` · ${a.unit.unitRef}` : ""}`}
        actions={can("maintenance.request.create") && a.status === "active" && <ButtonLink variant="secondary" href="/app/maintenance/new">Report a fault</ButtonLink>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <DL items={[
            ["Make / model", [a.make, a.model].filter(Boolean).join(" ") || "—"], ["Serial number", a.serialNumber], ["Location", a.location],
            ["Criticality", <StatusBadge key="c" status={a.criticality} />], ["Condition", <StatusBadge key="d" status={a.condition} />],
            ["Installed", date(a.installedAt)], ["Warranty", a.warrantyExpiresAt ? <>{date(a.warrantyExpiresAt)} {a.underWarranty ? <Badge tone="green">Active</Badge> : <Badge>Expired</Badge>}</> : "—"],
            ["Service interval", a.serviceIntervalDays ? `${a.serviceIntervalDays} days` : "—"], ["Last serviced", date(a.lastServicedAt)], ["Next due", date(a.nextDueAt)],
            ["Notes", a.notes], ["Disposed", date(a.disposedAt)],
          ]} />
        </Card>
        <Card title="Preventive plans" padded={false}>
          {plans.length === 0 ? <p className="p-4 text-sm text-slate-500">No plans. {manage ? "Add one below." : ""}</p> : (
            <ul className="divide-y divide-slate-100">{plans.map((p) => (
              <li key={p.id} className="px-4 py-2 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{p.planName}</span>{p.active ? <StatusBadge status={p.dueStatus} /> : <Badge>Inactive</Badge>}</div>
                <div className="text-xs text-slate-500">Every {p.intervalDays} days · due {date(p.effectiveDueAt)} · {p.assignedUser?.fullName ?? p.assignedVendor?.businessName ?? "unassigned"}</div></li>
            ))}</ul>
          )}
        </Card>
      </div>
      <Card title="Service history" className="mt-4" padded={false}>
        {history.length === 0 ? <p className="p-4 text-sm text-slate-500">No work recorded on this asset yet.</p> : (
          <Table><thead><tr><Th>Work order</Th><Th>Type</Th><Th>Done by</Th><Th>Status</Th><Th>Completed</Th><Th>Notes</Th><Th align="right">Cost</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{history.map((h) => (
              <tr key={h.id}><Td><Link className="font-mono text-xs text-brand-700 hover:underline" href={`/app/work-orders/${h.id}`}>{h.workOrderRef}</Link></Td><Td>{h.kind === "preventive" ? <Badge tone="violet">PM</Badge> : humanize(h.category)}</Td>
                <Td>{h.assignedUser?.fullName ?? h.vendor?.businessName ?? "—"}</Td><Td><StatusBadge status={h.status} /></Td><Td>{h.completedAt ? date(h.completedAt.toISOString().slice(0, 10)) : "—"}</Td>
                <Td className="max-w-xs text-xs">{h.completionNotes ?? "—"}</Td><Td align="right">{h.totalCostMinor !== undefined ? money(h.totalCostMinor) : "—"}</Td></tr>
            ))}</tbody></Table>
        )}
      </Card>
      {requests && requests.items.length > 0 && (
        <Card title="Fault reports" className="mt-4" padded={false}>
          <ul className="divide-y divide-slate-100">{requests.items.map((r) => <li key={r.id} className="flex justify-between px-4 py-2 text-sm"><Link className="text-brand-700 hover:underline" href={`/app/maintenance/${r.id}`}>{r.requestRef} {r.title}</Link><StatusBadge status={r.status} /></li>)}</ul>
        </Card>
      )}
      {manage && o && a.status === "active" && <Card title="Add a preventive plan" className="mt-4"><PlanForm assetId={a.id} users={o.users} vendors={o.vendors} today={todayInTz(ctx.timezone)} defaultInterval={a.serviceIntervalDays} /></Card>}
      {manage && o && <Card title="Edit asset" className="mt-4"><AssetForm properties={o.properties} units={o.units} initial={a} /></Card>}
    </>
  );
}
