import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { facilitiesOptions } from "@/server/views/facilities-options";
import { AssetForm } from "@/components/forms/maintenance-forms";
import { PageHeader, Card } from "@/components/ui";

export const metadata = { title: "Register asset" };
export default async function Page() {
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("asset.manage")) redirect("/app/assets");
  const o = await facilitiesOptions(ctx);
  return (<><PageHeader breadcrumbs={[{ href: "/app/assets", label: "Assets" }]} title="Register asset" /><Card><AssetForm properties={o.properties} units={o.units} /></Card></>);
}
