import Link from "next/link";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-50",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
  ghost: "text-slate-700 hover:bg-slate-100",
};
const btnBase = "inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed whitespace-nowrap";

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...p} className={cx(btnBase, variants[variant], className)} />;
}
export function ButtonLink({ href, variant = "primary", children, className }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return <Link href={href} className={cx(btnBase, variants[variant], className)}>{children}</Link>;
}

const inputBase = "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 aria-[invalid=true]:border-red-500";
export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={cx(inputBase, p.className)} />; }
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={cx(inputBase, "pr-8", p.className)} />; }
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={3} {...p} className={cx(inputBase, p.className)} />; }

export function Field({ label, htmlFor, error, hint, children, required, className }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">{label}{required && <span className="text-red-600" aria-hidden> *</span>}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={`${htmlFor}-error`} className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

const badgeTones = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20", slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20", violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
} as const;
export type Tone = keyof typeof badgeTones;
export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", badgeTones[tone])}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  active: "green", occupied: "green", paid: "green", confirmed: "green", accepted: "green",
  vacant: "blue", due: "blue", upcoming: "blue", prospective: "blue", pending: "amber", pending_signature: "amber", draft: "slate",
  expiring: "amber", partially_paid: "amber", reserved: "violet", under_maintenance: "amber", under_development: "violet",
  overdue: "red", reversed: "red", terminated: "red", suspended: "red", unavailable: "slate", expired: "slate", void: "slate",
  former: "slate", archived: "slate", inactive: "slate", refunded: "violet",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "slate"}>{humanize(status)}</Badge>;
}
export function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: { href: string; label: string }[] }) {
  return (
    <div className="mb-5">
      {breadcrumbs && (
        <nav aria-label="Breadcrumb" className="mb-1 text-xs text-slate-500">
          {breadcrumbs.map((b, i) => (<span key={b.href}>{i > 0 && " / "}<Link href={b.href} className="hover:underline">{b.label}</Link></span>))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "green" | "amber" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular", tone === "red" && "text-red-700", tone === "green" && "text-emerald-700", tone === "amber" && "text-amber-700")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const c = { info: "bg-sky-50 text-sky-800 border-sky-200", error: "bg-red-50 text-red-800 border-red-200", success: "bg-emerald-50 text-emerald-800 border-emerald-200", warning: "bg-amber-50 text-amber-900 border-amber-200" }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (<div key={k}><dt className="text-xs font-medium text-slate-500">{k}</dt><dd className="mt-0.5 text-sm text-slate-900">{v ?? "—"}</dd></div>))}
    </dl>
  );
}
