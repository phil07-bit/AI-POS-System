import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { TenantForm } from "@/components/forms/tenant-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Add tenant" };
export default async function Page() {
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("tenant.create")) redirect("/app/tenants");
  return (<><PageHeader title="Add tenant" breadcrumbs={[{ href: "/app/tenants", label: "Tenants" }]} /><Card><TenantForm canSensitive={ctx.permissions.has("tenant.sensitive.read")} /></Card></>);
}
