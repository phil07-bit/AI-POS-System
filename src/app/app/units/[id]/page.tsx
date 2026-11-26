import { orNotFound } from "@/lib/auth/page-guards";
import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { getUnit } from "@/server/services/unit.service";
import { listLeases } from "@/server/services/lease.service";
import { PageHeader, Card, DL, StatusBadge, ButtonLink, humanize } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { UnitForm } from "@/components/forms/unit-form";
import { ActionButton } from "@/components/forms/action-button";
import { money, date, FREQ } from "@/components/layout/format";
import { minorToDecimalString } from "@/lib/money";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const u = await orNotFound(getUnit(ctx, id));
  const leases = await listLeases(ctx, { unitId: id, pageSize: 50, sortBy: "startDate", sortOrder: "desc" });
  const canManage = ctx.permissions.has("unit.manage") && !u.archivedAt;
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/units", label: "Units" }, { href: `/app/properties/${u.property.id}?tab=units`, label: u.property.name }]}
        title={<>Unit {u.unitRef} <span className="ml-1 align-middle"><StatusBadge status={u.occupancyStatus} /></span></>} subtitle={`${u.unitName} · ${humanize(u.unitType)}`}
        actions={<>
          {ctx.permissions.has("lease.create") && u.occupancyStatus !== "occupied" && !u.archivedAt && <ButtonLink href={`/app/leases/new?unitId=${u.id}`}>Lease this unit</ButtonLink>}
          {canManage && <ActionButton endpoint={`/units/${u.id}/archive`} label="Archive unit" variant="danger" confirm={{ title: "Archive this unit?", body: "Blocked if the unit has an active/pending lease or unpaid charges. History is preserved." }} />}
        </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <DL items={[
            ["Property", u.property.name], ["Building / block / floor", [u.building, u.block, u.floor].filter(Boolean).join(" · ") || "—"],
            ["Bedrooms / bathrooms", `${u.bedrooms ?? "—"} / ${u.bathrooms ?? "—"}`], ["Area", u.areaValue != null ? `${u.areaValue} ${u.areaUnit}` : "—"],
            ["Furnishing", humanize(u.furnishingStatus)], ["Asking rent", u.askingRentMinor != null ? <>{money(u.askingRentMinor)} {FREQ[u.rentFrequency]}</> : "—"],
            ["Availability setting", humanize(u.availability)], ["Notes", u.description],
          ]} />
        </Card>
        <Card title="Current tenancy">
          {u.currentLease ? (
            <DL items={[["Lease", <Link key="l" className="text-brand-700 hover:underline" href={`/app/leases/${u.currentLease.id}`}>{u.currentLease.leaseRef}</Link>], ["Tenant", u.currentLease.tenant?.displayName], ["Ends", date(u.currentLease.endDate)], ["Rent", <>{money(u.currentLease.rentAmountMinor)} {FREQ[u.currentLease.billingFrequency]}</>]]} />
          ) : <p className="text-sm text-slate-500">No active lease covers today. {u.upcomingLease && <>Next lease {u.upcomingLease.leaseRef} starts {date(u.upcomingLease.startDate)}.</>}</p>}
        </Card>
      </div>
      <Card title="Lease history" className="mt-4" padded={false}>
        {leases.items.length === 0 ? <p className="p-4 text-sm text-slate-500">No leases yet.</p> : (
          <Table><thead><tr><Th>Lease</Th><Th>Tenant</Th><Th>Term</Th><Th align="right">Rent</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{leases.items.map((l) => <tr key={l.id}><Td><Link className="text-brand-700 hover:underline" href={`/app/leases/${l.id}`}>{l.leaseRef}</Link></Td><Td>{l.primaryTenant?.displayName}</Td><Td>{date(l.startDate)} – {date(l.endDate)}</Td><Td align="right">{money(l.rentAmountMinor)}</Td><Td><StatusBadge status={l.displayStatus} /></Td></tr>)}</tbody></Table>
        )}
      </Card>
      {canManage && (
        <Card title="Edit unit" className="mt-4">
          <UnitForm propertyId={u.property.id} initial={{
            id: u.id, unitRef: u.unitRef, unitName: u.unitName, unitType: u.unitType, building: u.building ?? "", block: u.block ?? "", floor: u.floor ?? "",
            bedrooms: u.bedrooms?.toString() ?? "", bathrooms: u.bathrooms?.toString() ?? "", areaValue: u.areaValue?.toString() ?? "", furnishingStatus: u.furnishingStatus,
            askingRent: u.askingRentMinor != null ? minorToDecimalString(u.askingRentMinor) : "", rentFrequency: u.rentFrequency, availability: u.availability, description: u.description ?? "",
          }} />
        </Card>
      )}
    </>
  );
}
