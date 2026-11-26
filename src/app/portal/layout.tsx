import { redirect } from "next/navigation";
import { getPageContext } from "@/lib/auth/next";
import { Topbar } from "@/components/layout/topbar";

export const dynamic = "force-dynamic";
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPageContext();
  if (!ctx.tenantId) redirect("/app");
  return (
    <div className="min-h-screen">
      <div className="flex items-center border-b border-slate-200 bg-white"><div className="px-4 text-sm font-semibold">{ctx.organizationName} · Tenant portal</div><div className="flex-1"><Topbar userName={ctx.userName} roleName="Tenant" orgs={[]} activeOrgId={ctx.organizationId} /></div></div>
      <main id="main" className="mx-auto max-w-4xl p-4 lg:p-6">{children}</main>
    </div>
  );
}
