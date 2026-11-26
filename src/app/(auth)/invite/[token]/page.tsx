import Link from "next/link";
import { AcceptInviteForm } from "@/components/forms/auth-forms";
import { Alert } from "@/components/ui";
import { getInvitationByToken } from "@/server/services/organization.service";
export const metadata = { title: "Accept invitation" };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvitationByToken(token);
  if (!inv) return <div className="space-y-3"><Alert tone="error">This invitation is invalid, already used, or expired.</Alert><Link href="/login" className="text-sm text-brand-700 hover:underline">Go to sign in</Link></div>;
  return <AcceptInviteForm token={token} email={inv.email} orgName={inv.organizationName} roleName={inv.roleName} userExists={inv.userExists} />;
}
