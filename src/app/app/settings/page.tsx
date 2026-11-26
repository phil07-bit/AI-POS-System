import { redirect } from "next/navigation";
import { getStaffPageContext } from "@/lib/auth/next";
import { getOrganization } from "@/server/services/organization.service";
import { PageHeader, Card, Alert } from "@/components/ui";
import { OrgSettingsForm } from "@/components/forms/team-forms";

export const metadata = { title: "Settings" };
export default async function Page({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const ctx = await getStaffPageContext();
  if (!ctx.permissions.has("organization.settings.manage")) redirect("/app");
  const org = await getOrganization(ctx, ctx.organizationId);
  return (
    <>
      <PageHeader title="Organization settings" subtitle="Profile, localization and operating policies." />
      {sp.welcome && <div className="mb-4"><Alert tone="success">Workspace created. Confirm your details below, then add your first property.</Alert></div>}
      <Card>
        <OrgSettingsForm org={{ id: org.id, name: org.name, legalName: org.legalName, email: org.email, phone: org.phone, countryCode: org.countryCode, defaultCurrency: org.defaultCurrency, timezone: org.timezone, address: (org.addressJson ?? {}) as Record<string, string>, paymentsRequireConfirmation: org.paymentsRequireConfirmation, chargeGenerationHorizonDays: org.chargeGenerationHorizonDays, leaseExpiryWarningDays: org.leaseExpiryWarningDays, plan: org.plan }} />
      </Card>
      <Card title="Integrations" className="mt-4">
        <ul className="space-y-1 text-sm">
          <li>Email: <strong>{process.env.EMAIL_PROVIDER ?? "mock"}</strong> {(process.env.EMAIL_PROVIDER ?? "mock") === "mock" && "— simulated, nothing is sent"}</li>
          <li>Payments: <strong>{process.env.PAYMENT_PROVIDER ?? "mock"}</strong> — no direct collection; payments are recorded manually and reconciled against statements</li>
          <li>AI: <strong>{process.env.AI_PROVIDER ?? "mock"}</strong> — AI features arrive in phase 6</li>
          <li>SMS / WhatsApp: deferred until provider and consent requirements are confirmed</li>
        </ul>
      </Card>
    </>
  );
}
