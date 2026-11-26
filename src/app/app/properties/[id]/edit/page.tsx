import { orNotFound } from "@/lib/auth/page-guards";
import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { getProperty, listAssignableManagers } from "@/server/services/property.service";
import { PropertyForm } from "@/components/forms/property-form";
import { Card, PageHeader } from "@/components/ui";
import { minorToDecimalString } from "@/lib/money";

export const metadata = { title: "Edit property" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("property.update")) redirect(`/app/properties/${id}`);
  const p = await orNotFound(getProperty(ctx, id));
  const a = p.address ?? {};
  return (
    <>
      <PageHeader title={`Edit ${p.name}`} breadcrumbs={[{ href: "/app/properties", label: "Properties" }, { href: `/app/properties/${id}`, label: p.name }]} />
      <Card>
        <PropertyForm managers={await listAssignableManagers(ctx)} canSeeFinancials={ctx.permissions.has("property.financials.read")} initial={{
          id: p.id, name: p.name, propertyRef: p.propertyRef, propertyType: p.propertyType, description: p.description ?? "", status: p.status === "archived" ? "inactive" : p.status,
          ownerNameOrEntity: p.ownerNameOrEntity ?? "", region: a.region ?? "", district: a.district ?? "", community: a.community ?? "", landmark: a.landmark ?? "",
          digitalAddress: a.digitalAddress ?? "", notes: a.notes ?? "", latitude: p.latitude?.toString() ?? "", longitude: p.longitude?.toString() ?? "",
          acquisitionDate: p.acquisitionDate ?? "", acquisitionCost: p.acquisitionCostMinor != null ? minorToDecimalString(p.acquisitionCostMinor) : "", managerMembershipId: p.managerMembershipId ?? "",
        }} />
      </Card>
    </>
  );
}
