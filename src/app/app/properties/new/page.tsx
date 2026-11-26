import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { listAssignableManagers } from "@/server/services/property.service";
import { PropertyForm } from "@/components/forms/property-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Add property" };
export default async function Page() {
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("property.create")) redirect("/app/properties");
  return (<><PageHeader title="Add property" breadcrumbs={[{ href: "/app/properties", label: "Properties" }]} /><Card><PropertyForm managers={await listAssignableManagers(ctx)} canSeeFinancials={ctx.permissions.has("property.financials.read")} /></Card></>);
}
