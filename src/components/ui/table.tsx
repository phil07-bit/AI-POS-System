import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from ".";

export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" }) {
  return <th scope="col" className={cx("bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600", align === "right" && "text-right", className)}>{children}</th>;
}
export function Td({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" }) {
  return <td className={cx("px-3 py-2 align-top text-slate-800", align === "right" && "text-right tabular", className)}>{children}</td>;
}

/** Sort header link that preserves current filters. */
export function SortTh({ label, field, params, basePath, align }: { label: string; field: string; params: Record<string, string | undefined>; basePath: string; align?: "right" }) {
  const active = params.sortBy === field;
  const nextOrder = active && params.sortOrder !== "desc" ? "desc" : "asc";
  const qs = new URLSearchParams(Object.entries({ ...params, sortBy: field, sortOrder: nextOrder, page: "1" }).filter(([, v]) => v) as [string, string][]);
  return (
    <Th align={align}>
      <Link href={`${basePath}?${qs}`} className="inline-flex items-center gap-1 hover:text-slate-900" aria-sort={active ? (params.sortOrder === "desc" ? "descending" : "ascending") : "none"}>
        {label}{active ? (params.sortOrder === "desc" ? " ↓" : " ↑") : ""}
      </Link>
    </Th>
  );
}

export function Pagination({ page, totalPages, total, params, basePath }: { page: number; totalPages: number; total: number; params: Record<string, string | undefined>; basePath: string }) {
  const href = (p: number) => `${basePath}?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
      <span>{total} record{total === 1 ? "" : "s"} · page {page} of {totalPages}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" href={href(page - 1)}>Previous</Link> : <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">Previous</span>}
        {page < totalPages ? <Link className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" href={href(page + 1)}>Next</Link> : <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">Next</span>}
      </span>
    </nav>
  );
}
