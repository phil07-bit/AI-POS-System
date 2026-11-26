"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api, toMinor } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

type UnitOpt = { id: string; label: string; propertyId: string; propertyName: string; status: string; askingRentMinor: number | null; rentFrequency: string };
type TenantOpt = { id: string; name: string };

function addMonthsISO(s: string, m: number) {
  const [y, mo, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export function LeaseForm({ units, tenants, defaults, lease }: {
  units: UnitOpt[]; tenants: TenantOpt[];
  defaults: { propertyId?: string; unitId?: string; tenantId?: string; today: string };
  lease?: { id: string; unitId: string; parties: { tenantId: string; partyRole: string }[]; startDate: string; endDate: string; rent: string; billingFrequency: string; dueDay: string; deposit: string; depositStatus: string; advanceMonths: string; gracePeriodDays: string; noticePeriodDays: string; renewalTerms: string; internalNotes: string };
}) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(defaults.propertyId ?? units.find((u) => u.id === (lease?.unitId ?? defaults.unitId))?.propertyId ?? "");
  const [v, setV] = useState(lease ?? {
    id: "", unitId: defaults.unitId ?? "", parties: defaults.tenantId ? [{ tenantId: defaults.tenantId, partyRole: "primary_tenant" }] : [{ tenantId: "", partyRole: "primary_tenant" }],
    startDate: defaults.today, endDate: addMonthsISO(defaults.today, 12), rent: "", billingFrequency: "monthly", dueDay: "", deposit: "", depositStatus: "not_applicable",
    advanceMonths: "", gracePeriodDays: "0", noticePeriodDays: "", renewalTerms: "", internalNotes: "",
  });
  const { pending, error, fe, run, setError } = useSubmit();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const properties = useMemo(() => [...new Map(units.map((u) => [u.propertyId, u.propertyName])).entries()], [units]);
  const unitChoices = units.filter((u) => !propertyId || u.propertyId === propertyId);

  function pickUnit(id: string) {
    const u = units.find((x) => x.id === id);
    setV({ ...v, unitId: id, ...(u?.askingRentMinor && !v.rent ? { rent: (u.askingRentMinor / 100).toFixed(2), billingFrequency: u.rentFrequency } : {}) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const rent = toMinor(v.rent);
    if (rent === null || rent <= 0) return setError("Enter the rent per billing period, e.g. 2500.00");
    const deposit = v.deposit ? toMinor(v.deposit) : 0;
    if (deposit === null) return setError("Deposit must be an amount like 5000.00");
    const body = {
      unitId: v.unitId, parties: v.parties.filter((p) => p.tenantId), startDate: v.startDate, endDate: v.endDate, rentAmountMinor: rent,
      billingFrequency: v.billingFrequency, dueDay: v.dueDay ? Number(v.dueDay) : null, depositAmountMinor: deposit, depositStatus: deposit ? (v.depositStatus === "not_applicable" ? "pending" : v.depositStatus) : "not_applicable",
      advanceMonths: v.advanceMonths ? Number(v.advanceMonths) : null, gracePeriodDays: Number(v.gracePeriodDays || 0), noticePeriodDays: v.noticePeriodDays ? Number(v.noticePeriodDays) : null,
      renewalTerms: v.renewalTerms || null, internalNotes: v.internalNotes || null,
    };
    const res = await run(() => api<{ id: string }>(v.id ? `/leases/${v.id}` : "/leases", { method: v.id ? "PATCH" : "POST", body }));
    if (res) { router.push(`/app/leases/${res.id}`); router.refresh(); }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">1. Tenant(s)</legend>
        {v.parties.map((p, i) => (
          <div key={i} className="flex gap-2 sm:col-span-2">
            <Select aria-label="Tenant" value={p.tenantId} onChange={(e) => { const ps = [...v.parties]; ps[i] = { ...p, tenantId: e.target.value }; setV({ ...v, parties: ps }); }}>
              <option value="">Select tenant…</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Select aria-label="Party role" value={p.partyRole} className="max-w-44" onChange={(e) => { const ps = [...v.parties]; ps[i] = { ...p, partyRole: e.target.value }; setV({ ...v, parties: ps }); }}>
              <option value="primary_tenant">Primary tenant</option><option value="co_tenant">Co-tenant</option><option value="guarantor">Guarantor</option><option value="occupant">Occupant</option>
            </Select>
            {i > 0 && <Button type="button" variant="ghost" onClick={() => setV({ ...v, parties: v.parties.filter((_, j) => j !== i) })}>Remove</Button>}
          </div>
        ))}
        <div className="sm:col-span-2 flex gap-3 text-sm">
          <button type="button" className="text-brand-700 underline" onClick={() => setV({ ...v, parties: [...v.parties, { tenantId: "", partyRole: "co_tenant" }] })}>+ Add another party</button>
          <a href="/app/tenants/new" target="_blank" className="text-brand-700 underline">Create a new tenant ↗</a>
        </div>
        {fe("parties") && <p className="text-xs text-red-600 sm:col-span-2">{fe("parties")}</p>}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">2. Property and unit</legend>
        <Field label="Property" htmlFor="l-prop"><Select id="l-prop" value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setV({ ...v, unitId: "" }); }}><option value="">All properties</option>{properties.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select></Field>
        <Field label="Unit" htmlFor="l-unit" error={fe("unitId")} required hint="Occupied units can still take a future-dated lease; overlaps are blocked on activation.">
          <Select id="l-unit" value={v.unitId} onChange={(e) => pickUnit(e.target.value)}><option value="">Select unit…</option>{unitChoices.map((u) => <option key={u.id} value={u.id}>{u.propertyName} · {u.label} ({u.status})</option>)}</Select>
        </Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">3. Terms</legend>
        <Field label="Start date" htmlFor="l-start" error={fe("startDate")} required><Input id="l-start" type="date" value={v.startDate} onChange={set("startDate")} /></Field>
        <Field label="End date (inclusive)" htmlFor="l-end" error={fe("endDate")} required><Input id="l-end" type="date" value={v.endDate} onChange={set("endDate")} /></Field>
        <Field label="Quick term" htmlFor="l-term"><Select id="l-term" value="" onChange={(e) => e.target.value && setV({ ...v, endDate: addMonthsISO(v.startDate, Number(e.target.value)) })}><option value="">Set end from start…</option><option value="6">6 months</option><option value="12">1 year</option><option value="24">2 years</option><option value="36">3 years</option></Select></Field>
        <Field label="Rent per billing period (GH₵)" htmlFor="l-rent" error={fe("rentAmountMinor")} required><Input id="l-rent" inputMode="decimal" value={v.rent} onChange={set("rent")} /></Field>
        <Field label="Billing frequency" htmlFor="l-freq"><Select id="l-freq" value={v.billingFrequency} onChange={set("billingFrequency")}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Half-yearly</option><option value="yearly">Yearly (1 year advance)</option><option value="custom">Custom (manual charges)</option></Select></Field>
        <Field label="Due day of month" htmlFor="l-due" hint="Blank = first day of each period."><Input id="l-due" inputMode="numeric" value={v.dueDay} onChange={set("dueDay")} /></Field>
        <Field label="Security deposit (GH₵)" htmlFor="l-dep"><Input id="l-dep" inputMode="decimal" value={v.deposit} onChange={set("deposit")} /></Field>
        <Field label="Deposit status" htmlFor="l-deps"><Select id="l-deps" value={v.depositStatus} onChange={set("depositStatus")}><option value="not_applicable">Not applicable</option><option value="pending">Pending</option><option value="held">Held</option><option value="refunded">Refunded</option><option value="applied">Applied</option></Select></Field>
        <Field label="Advance agreed (months)" htmlFor="l-adv" hint="Informational; record actual payments separately."><Input id="l-adv" inputMode="numeric" value={v.advanceMonths} onChange={set("advanceMonths")} /></Field>
        <Field label="Grace period (days)" htmlFor="l-grace"><Input id="l-grace" inputMode="numeric" value={v.gracePeriodDays} onChange={set("gracePeriodDays")} /></Field>
        <Field label="Notice period (days)" htmlFor="l-notice"><Input id="l-notice" inputMode="numeric" value={v.noticePeriodDays} onChange={set("noticePeriodDays")} /></Field>
        <div className="text-xs text-slate-500 sm:col-span-3">Late fees are disabled by default. AI-POS never imposes penalties automatically; any fee policy needs organization approval and legal review.</div>
        <Field label="Renewal terms" htmlFor="l-ren" className="sm:col-span-3"><Textarea id="l-ren" rows={2} value={v.renewalTerms} onChange={set("renewalTerms")} /></Field>
        <Field label="Internal notes (staff only)" htmlFor="l-notes" className="sm:col-span-3"><Textarea id="l-notes" rows={2} value={v.internalNotes} onChange={set("internalNotes")} /></Field>
      </fieldset>
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Saving…" : v.id ? "Save draft" : "Save as draft"}</Button><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button></div>
      <p className="text-xs text-slate-500">Leases are saved as drafts. Activate from the lease page once signed — activation checks for overlapping leases and generates the rent schedule.</p>
    </form>
  );
}
