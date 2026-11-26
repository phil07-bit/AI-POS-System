"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV } from "./nav";
import { cx } from "@/components/ui";

export function Sidebar({ permissions, orgName }: { permissions: string[]; orgName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => n.anyOf.some((p) => permissions.includes(p)));
  const isActive = (href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));
  return (
    <>
      <button type="button" className="no-print fixed left-3 top-3 z-40 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm lg:hidden" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}>
        {open ? "Close" : "Menu"}
      </button>
      <aside id="sidebar" className={cx("no-print fixed inset-y-0 left-0 z-30 w-60 shrink-0 border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">AI</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">AI-POS</div>
            <div className="truncate text-xs text-slate-500" title={orgName}>{orgName}</div>
          </div>
        </div>
        <nav aria-label="Main" className="overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 3.5rem)" }}>
          <ul className="space-y-0.5">
            {items.map((n) => (
              <li key={n.href}>
                {n.phase ? (
                  <span className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm text-slate-400" title={`Arrives in phase ${n.phase}`}>
                    {n.label}<span className="rounded bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">Phase {n.phase}</span>
                  </span>
                ) : (
                  <Link href={n.href} onClick={() => setOpen(false)} aria-current={isActive(n.href) ? "page" : undefined}
                    className={cx("block rounded-md px-3 py-1.5 text-sm", isActive(n.href) ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-100")}>
                    {n.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
