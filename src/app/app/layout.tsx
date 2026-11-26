import { getStaffPageContext } from "@/lib/auth/next";
import { listMyOrganizations } from "@/server/services/organization.service";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffPageContext();
  const orgs = await listMyOrganizations(ctx.userId);
  return (
    <div className="flex min-h-screen">
      <Sidebar permissions={[...ctx.permissions]} orgName={ctx.organizationName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userName={ctx.userName} roleName={ctx.roleName} orgs={orgs} activeOrgId={ctx.organizationId} />
        {ctx.isDemoOrg && (
          <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
            Demo workspace — all people, phone numbers, addresses and payment references are fictional seed data.
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
