"use client";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export function Topbar({ userName, roleName, orgs, activeOrgId }: { userName: string; roleName: string; orgs: { id: string; name: string }[]; activeOrgId: string }) {
  const router = useRouter();
  return (
    <header className="no-print flex h-14 items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 pl-20 lg:pl-4">
      {orgs.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Switch organization</span>
          <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={activeOrgId}
            onChange={async (e) => { await api("/auth/switch-organization", { body: { organizationId: e.target.value } }); router.push("/app"); router.refresh(); }}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      <div className="text-right text-sm leading-tight">
        <div className="font-medium">{userName}</div>
        <div className="text-xs text-slate-500">{roleName}</div>
      </div>
      <button type="button" className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50"
        onClick={async () => { await api("/auth/logout", { body: {} }); router.push("/login"); router.refresh(); }}>
        Sign out
      </button>
    </header>
  );
}
