import { orNotFound } from "@/lib/auth/page-guards";
import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { getProperty } from "@/server/services/property.service";
import { listUnits } from "@/server/services/unit.service";
import { listLeases } from "@/server/services/lease.service";
import { arrearsReport, collectionSummary } from "@/server/services/report.service";
import { listAuditLogs } from "@/server/services/audit-query.service";
import { PageHeader, Card, DL, StatusBadge, ButtonLink, Stat, EmptyState, humanize, cx } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { ActionButton } from "@/components/forms/action-button";
import { UnitForm } from "@/components/forms/unit-form";
import { money, date, addressLine, FREQ } from "@/components/layout/format";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";

const TABS = ["overview", "units", "leases", "finance", "activity"] as const;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tab = ((await searchParams).tab ?? "overview") as (typeof TABS)[number];
  const ctx = await getStaffPageContext();
  const p = await orNotFound(getProperty(ctx, id));
  const can = (k: string) => ctx.permissions.has(k);
  const o = p.occupancy;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/app/properties", label: "Properties" }]}
        title={<>{p.name} <span className="ml-1 align-middle"><StatusBadge status={p.status} /></span></>}
        subtitle={`${p.propertyRef} · ${humanize(p.propertyType)} · ${addressLine(p.address)}`}
        actions={<>
          {can("property.update") && p.status !== "archived" && <ButtonLink href={`/app/properties/${id}/edit`} variant="secondary">Edit</ButtonLink>}
          {can("lease.create") && <ButtonLink href={`/app/leases/new?propertyId=${id}`}>New lease</ButtonLink>}
          {can("property.archive") && p.status !== "archived" && <ActionButton endpoint={`/properties/${id}/archive`} label="Archive" variant="danger" confirm={{ title: "Archive this property?", body: "Archived properties are hidden from active lists and cannot be edited. Blocked while any lease is active. Financial history is kept." }} />}
        </>}
      />
      <nav aria-label="Property sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <Link key={t} href={`/app/properties/${id}?tab=${t}`} aria-current={tab === t ? "page" : undefined}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm capitalize", tab === t ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}>{t}</Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Units" value={o.totalUnits} sub={`${o.rentableUnits} rentable`} />
            <Stat label="Occupied" value={o.occupiedUnits} />
            <Stat label="Vacant" value={o.vacantUnits} sub={o.reservedUnits ? `${o.reservedUnits} reserved` : undefined} />
            <Stat label="Occupancy" value={o.occupancyRate === null ? "N/A" : `${o.occupancyRate}%`} />
          </div>
          <Card title="Details">
            <DL items={[
              ["Owner / entity", p.ownerNameOrEntity], ["Property manager", p.managerName ?? "Unassigned"],
              ["Region", p.address?.region], ["District / municipality", p.address?.district], ["Community", p.address?.community],
              ["Landmark", p.address?.landmark], ["Digital address", p.address?.digitalAddress], ["Directions", p.address?.notes],
              ["GPS", p.latitude != null ? `${p.latitude}, ${p.longitude}` : null], ["Acquired", date(p.acquisitionDate)],
              ...(p.acquisitionCostMinor !== undefined ? [["Acquisition cost (restricted)", formatMoney(p.acquisitionCostMinor)] as [string, string]] : []),
              ["Description", p.description],
            ]} />
          </Card>
          <p className="text-xs text-slate-500">{o.definition}</p>
        </div>
      )}

      {tab === "units" && <UnitsTab ctxPerm={can("unit.manage")} propertyId={id} archived={p.status === "archived"} />}
      {tab === "leases" && <LeasesTab propertyId={id} />}
      {tab === "finance" && (can("report.financial.read") ? <FinanceTab propertyId={id} /> : <EmptyState title="Financial summary restricted" body="Your role does not include financial reports." />)}
      {tab === "activity" && (can("audit.read") ? <ActivityTab propertyId={id} /> : <EmptyState title="Activity restricted" body="Your role does not include the audit log." />)}
    </>
  );

  async function UnitsTab({ propertyId, ctxPerm, archived }: { propertyId: string; ctxPerm: boolean; archived: boolean }) {
    const units = await listUnits(ctx, { propertyId, pageSize: 100 });
    return (
      <div className="space-y-4">
        <Card title={`Units (${units.total})`} padded={false}>
          {units.items.length === 0 ? <p className="p-4 text-sm text-slate-500">No units yet. Add the first unit below.</p> : (
            <Table caption="Units"><thead><tr><Th>Unit</Th><Th>Type</Th><Th>Beds</Th><Th align="right">Asking rent</Th><Th>Status</Th><Th>Current tenant</Th><Th>Lease ends</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{units.items.map((u) => (
                <tr key={u.id}>
                  <Td><Link href={`/app/units/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.unitRef}</Link> <span className="text-xs text-slate-500">{u.unitName !== u.unitRef ? u.unitName : ""}</span></Td>
                  <Td>{humanize(u.unitType)}</Td><Td>{u.bedrooms ?? "—"}</Td>
                  <Td align="right">{u.askingRentMinor != null ? <>{money(u.askingRentMinor)} <span className="text-xs text-slate-500">/{FREQ[u.rentFrequency]?.toLowerCase()}</span></> : "—"}</Td>
                  <Td><StatusBadge status={u.occupancyStatus} /></Td>
                  <Td>{u.currentLease?.tenant ? <Link className="hover:underline" href={`/app/tenants/${u.currentLease.tenant.id}`}>{u.currentLease.tenant.displayName}</Link> : "—"}</Td>
                  <Td>{u.currentLease ? date(u.currentLease.endDate) : u.upcomingLease ? `Starts ${date(u.upcomingLease.startDate)}` : "—"}</Td>
                </tr>
              ))}</tbody></Table>
          )}
        </Card>
        {ctxPerm && !archived && <Card title="Add unit"><UnitForm propertyId={propertyId} /></Card>}
      </div>
    );
  }

  async function LeasesTab({ propertyId }: { propertyId: string }) {
    const leases = await listLeases(ctx, { propertyId, pageSize: 100, sortBy: "startDate", sortOrder: "desc" });
    if (!leases.items.length) return <EmptyState title="No leases for this property" action={can("lease.create") ? <ButtonLink href={`/app/leases/new?propertyId=${propertyId}`}>Create lease</ButtonLink> : undefined} />;
    return (
      <Card padded={false}><Table><thead><tr><Th>Lease</Th><Th>Unit</Th><Th>Tenant</Th><Th>Term</Th><Th align="right">Rent</Th><Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">{leases.items.map((l) => (
          <tr key={l.id}><Td><Link href={`/app/leases/${l.id}`} className="text-brand-700 hover:underline">{l.leaseRef}</Link></Td><Td>{l.unit.unitRef}</Td><Td>{l.primaryTenant?.displayName}</Td>
            <Td>{date(l.startDate)} – {date(l.endDate)}</Td><Td align="right">{money(l.rentAmountMinor)} <span className="text-xs text-slate-500">{FREQ[l.billingFrequency]}</span></Td><Td><StatusBadge status={l.displayStatus} /></Td></tr>
        ))}</tbody></Table></Card>
    );
  }

  async function FinanceTab({ propertyId }: { propertyId: string }) {
    const [col, arr] = await Promise.all([collectionSummary(ctx, { propertyId }), arrearsReport(ctx, { propertyId })]);
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Billed this month" value={formatMoney(col.billedMinor)} />
          <Stat label="Collected against" value={formatMoney(col.collectedAgainstPeriodMinor)} sub={`Rate ${col.collectionRate ?? "N/A"}${col.collectionRate !== null ? "%" : ""}`} />
          <Stat label="Cash received" value={formatMoney(col.cashReceivedMinor)} />
          <Stat label="Arrears" value={formatMoney(arr.totals.totalMinor)} sub={`${arr.totals.overdueAccounts} account(s)`} tone={arr.totals.totalMinor ? "red" : "green"} />
        </div>
        <Card title="Overdue accounts" actions={<Link href={`/app/arrears?propertyId=${propertyId}`} className="text-sm text-brand-700 hover:underline">Aging report</Link>} padded={false}>
          {arr.rows.length === 0 ? <p className="p-4 text-sm text-slate-500">No arrears. 🎉</p> : (
            <Table><thead><tr><Th>Tenant</Th><Th>Unit</Th><Th align="right">Overdue</Th><Th>Oldest due</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{arr.rows.map((r) => <tr key={r.leaseId}><Td><Link className="text-brand-700 hover:underline" href={`/app/tenants/${r.tenantId}?tab=ledger`}>{r.tenantName}</Link></Td><Td>{r.unitRef}</Td><Td align="right">{money(r.totalMinor)}</Td><Td>{date(r.oldestDueDate)}</Td></tr>)}</tbody></Table>
          )}
        </Card>
        <p className="text-xs text-slate-500">{col.meta.definition}</p>
      </div>
    );
  }

  async function ActivityTab({ propertyId }: { propertyId: string }) {
    const logs = await listAuditLogs(ctx, { entityId: propertyId, pageSize: 50 });
    return (
      <Card padded={false}>{logs.items.length === 0 ? <p className="p-4 text-sm text-slate-500">No recorded activity.</p> : (
        <ul className="divide-y divide-slate-100">{logs.items.map((l) => <li key={l.id} className="px-4 py-2 text-sm"><span className="font-medium">{l.actorName}</span> — {l.summary ?? l.action} <span className="text-xs text-slate-500">· {formatDateTime(l.createdAt, ctx.timezone)}</span></li>)}</ul>
      )}</Card>
    );
  }
}
