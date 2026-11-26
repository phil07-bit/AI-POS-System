import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { listUnits } from "@/server/services/unit.service";
import { listTenants } from "@/server/services/tenant.service";
import { LeaseForm } from "@/components/forms/lease-form";
import { Card, PageHeader } from "@/components/ui";
import { todayInTz } from "@/lib/dates";

export const metadata = { title: "New lease" };
export default async function Page({ searchParams }: { searchParams: Promise<{ propertyId?: string; unitId?: string; tenantId?: string }> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("lease.create")) redirect("/app/leases");
  const [units, tenants] = await Promise.all([listUnits(ctx, { pageSize: 100 }), listTenants(ctx, { pageSize: 100 })]);
  // Fetch beyond 100 if needed (MVP: first 100 units/tenants, sorted).
  return (
    <>
      <PageHeader title="New lease" breadcrumbs={[{ href: "/app/leases", label: "Leases" }]} />
      <Card>
        <LeaseForm
          units={units.items.filter((u) => u.availability !== "unavailable").map((u) => ({ id: u.id, label: u.unitRef, propertyId: u.property.id, propertyName: u.property.name, status: u.occupancyStatus, askingRentMinor: u.askingRentMinor, rentFrequency: u.rentFrequency }))}
          tenants={tenants.items.map((t) => ({ id: t.id, name: `${t.displayName} (${t.tenantRef})` }))}
          defaults={{ ...sp, today: todayInTz(ctx.timezone) }}
        />
      </Card>
    </>
  );
}
