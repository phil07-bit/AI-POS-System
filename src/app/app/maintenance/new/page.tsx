import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { todayInTz } from "@/lib/dates";
import { facilitiesOptions } from "@/server/views/facilities-options";
import { RequestForm } from "@/components/forms/maintenance-forms";
import { PageHeader, Card } from "@/components/ui";

export const metadata = { title: "Log maintenance request" };
export default async function Page() {
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("maintenance.request.create")) redirect("/app/maintenance");
  const o = await facilitiesOptions(ctx, { tenants: true });
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/maintenance", label: "Maintenance" }]} title="Log maintenance request" subtitle="For a tenant phone call, a caretaker report or an inspection finding." />
      <Card><RequestForm properties={o.properties} units={o.units} assets={o.assets} tenants={o.tenants} today={todayInTz(ctx.timezone)} /></Card>
    </>
  );
}
