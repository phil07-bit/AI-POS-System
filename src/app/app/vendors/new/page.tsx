import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { VendorForm } from "@/components/forms/maintenance-forms";
import { PageHeader, Card } from "@/components/ui";

export const metadata = { title: "Add vendor" };
export default async function Page() {
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("vendor.manage")) redirect("/app/vendors");
  return (<><PageHeader breadcrumbs={[{ href: "/app/vendors", label: "Vendors" }]} title="Add vendor" /><Card><VendorForm /></Card></>);
}
