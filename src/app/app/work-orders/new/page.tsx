import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { todayInTz } from "@/lib/dates";
import { facilitiesOptions } from "@/server/views/facilities-options";
import { WorkOrderForm } from "@/components/forms/maintenance-forms";
import { PageHeader, Card } from "@/components/ui";

export const metadata = { title: "New work order" };
export default async function Page() {
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("work_order.assign")) redirect("/app/work-orders");
  const o = await facilitiesOptions(ctx, { assignees: true, vendors: true });
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/work-orders", label: "Work orders" }]} title="New work order" subtitle="For planned jobs that did not start as a maintenance request." />
      <Card><WorkOrderForm properties={o.properties} units={o.units} assets={o.assets} users={o.users} vendors={o.vendors} today={todayInTz(ctx.timezone)} /></Card>
    </>
  );
}
