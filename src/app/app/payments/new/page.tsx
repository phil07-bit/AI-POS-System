import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getStaffPageContext } from "@/lib/auth/next";
import { PaymentForm } from "@/components/forms/finance-forms";
import { Card, PageHeader } from "@/components/ui";
import { todayInTz } from "@/lib/dates";

export const metadata = { title: "Record payment" };
export default async function Page({ searchParams }: { searchParams: Promise<{ leaseId?: string; tenantId?: string }> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("payment.record")) redirect("/app/payments");
  const leases = await prisma.lease.findMany({
    where: { organizationId: ctx.organizationId, status: { in: ["active", "expired", "terminated"] }, ...(ctx.scopeAllProperties ? {} : { propertyId: { in: [...ctx.propertyIds] } }), ...(sp.tenantId ? { parties: { some: { tenantId: sp.tenantId } } } : {}) },
    select: { id: true, leaseRef: true, status: true, unit: { select: { unitRef: true } }, property: { select: { name: true } }, parties: { where: { isPrimary: true }, select: { tenant: { select: { id: true, displayName: true } } } } },
    orderBy: [{ status: "asc" }, { leaseRef: "asc" }], take: 500,
  });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const opts = leases.map((l) => ({ id: l.id, tenantId: l.parties[0]?.tenant.id ?? "", label: `${l.parties[0]?.tenant.displayName ?? "?"} — ${l.property.name} ${l.unit.unitRef} (${l.leaseRef}${l.status !== "active" ? `, ${l.status}` : ""})` }));
  return (
    <>
      <PageHeader title="Record payment" breadcrumbs={[{ href: "/app/payments", label: "Payments" }]} />
      <Card><PaymentForm leases={opts} defaultLeaseId={sp.leaseId ?? (opts.length === 1 ? opts[0].id : undefined)} today={todayInTz(ctx.timezone)} requiresConfirmation={org.paymentsRequireConfirmation} /></Card>
    </>
  );
}
