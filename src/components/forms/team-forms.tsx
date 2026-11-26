"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

type Role = { key: string; name: string; rank: number };
type Prop = { id: string; name: string };

export function InviteForm({ orgId, roles, properties, tenants, myRank }: { orgId: string; roles: Role[]; properties: Prop[]; tenants: { id: string; name: string }[]; myRank: number }) {
  const router = useRouter();
  const [v, setV] = useState({ email: "", roleKey: "property_manager", scopeAllProperties: true, propertyIds: [] as string[], tenantId: "" });
  const [link, setLink] = useState<string | null>(null);
  const { pending, error, fe, run } = useSubmit();
  const grantable = roles.filter((r) => r.rank <= myRank);
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault(); setLink(null);
      const r = await run(() => api<{ devAcceptUrl?: string }>(`/organizations/${orgId}/invitations`, { body: { ...v, tenantId: v.tenantId || null } }));
      if (r) { setLink(r.devAcceptUrl ?? null); setV({ ...v, email: "" }); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      {link && <Alert tone="success">Invitation recorded. Email is in mock mode, so nothing was sent — share this link for the demo: <code className="break-all">{link}</code></Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Email" htmlFor="inv-email" error={fe("email")}><Input id="inv-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Role" htmlFor="inv-role"><Select id="inv-role" value={v.roleKey} onChange={(e) => setV({ ...v, roleKey: e.target.value })}>{grantable.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></Field>
        {v.roleKey === "tenant_portal" ? (
          <Field label="Tenant record" htmlFor="inv-tenant" error={fe("tenantId")}><Select id="inv-tenant" value={v.tenantId} onChange={(e) => setV({ ...v, tenantId: e.target.value })}><option value="">Select tenant…</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        ) : (
          <Field label="Property scope" htmlFor="inv-scope"><Select id="inv-scope" value={v.scopeAllProperties ? "all" : "some"} onChange={(e) => setV({ ...v, scopeAllProperties: e.target.value === "all" })}><option value="all">All properties</option><option value="some">Selected properties only</option></Select></Field>
        )}
      </div>
      {!v.scopeAllProperties && v.roleKey !== "tenant_portal" && (
        <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="mb-1 text-xs font-medium text-slate-600">Properties</legend>
          {properties.map((p) => <label key={p.id} className="flex items-center gap-1"><input type="checkbox" checked={v.propertyIds.includes(p.id)} onChange={(e) => setV({ ...v, propertyIds: e.target.checked ? [...v.propertyIds, p.id] : v.propertyIds.filter((x) => x !== p.id) })} />{p.name}</label>)}
        </fieldset>
      )}
      <Button type="submit" disabled={pending}>Send invitation</Button>
    </form>
  );
}

export function MemberControls({ membershipId, roleKey, status, roles, myRank, isSelf }: { membershipId: string; roleKey: string; status: string; roles: Role[]; myRank: number; isSelf: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  if (isSelf) return <span className="text-xs text-slate-500">You</span>;
  const patch = async (body: Record<string, unknown>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    if (await run(() => api(`/memberships/${membershipId}`, { method: "PATCH", body }))) router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Change role" className="max-w-52 py-1 text-xs" value={roleKey} disabled={pending} onChange={(e) => patch({ roleKey: e.target.value }, "Change this member's role?")}>
        {roles.filter((r) => r.rank <= myRank || r.key === roleKey).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
      </Select>
      {status === "active"
        ? <Button type="button" variant="ghost" className="px-2 py-1 text-xs text-red-700" disabled={pending} onClick={() => patch({ status: "suspended" }, "Suspend this member? They will lose access immediately.")}>Suspend</Button>
        : <Button type="button" variant="ghost" className="px-2 py-1 text-xs" disabled={pending} onClick={() => patch({ status: "active" })}>Reactivate</Button>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function OrgSettingsForm({ org }: { org: { id: string; name: string; legalName: string | null; email: string | null; phone: string | null; countryCode: string; defaultCurrency: string; timezone: string; address: Record<string, string>; paymentsRequireConfirmation: boolean; chargeGenerationHorizonDays: number; leaseExpiryWarningDays: number; plan: string } }) {
  const router = useRouter();
  const [v, setV] = useState({ ...org, legalName: org.legalName ?? "", email: org.email ?? "", phone: org.phone ?? "", region: org.address.region ?? "", district: org.address.district ?? "", community: org.address.community ?? "", digitalAddress: org.address.digitalAddress ?? "", landmark: org.address.landmark ?? "" });
  const [saved, setSaved] = useState(false);
  const { pending, error, fe, run } = useSubmit();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-5" noValidate onSubmit={async (e) => {
      e.preventDefault(); setSaved(false);
      const body = { name: v.name, legalName: v.legalName || null, email: v.email, phone: v.phone, countryCode: v.countryCode, defaultCurrency: v.defaultCurrency, timezone: v.timezone,
        address: { country: v.countryCode, region: v.region, district: v.district, community: v.community, digitalAddress: v.digitalAddress, landmark: v.landmark },
        paymentsRequireConfirmation: v.paymentsRequireConfirmation, chargeGenerationHorizonDays: Number(v.chargeGenerationHorizonDays), leaseExpiryWarningDays: Number(v.leaseExpiryWarningDays) };
      if (await run(() => api(`/organizations/${org.id}`, { method: "PATCH", body }))) { setSaved(true); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">Settings saved.</Alert>}
      <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold">Profile</legend>
        <Field label="Trading name" htmlFor="o-name" error={fe("name")}><Input id="o-name" value={v.name} onChange={set("name")} /></Field>
        <Field label="Legal name" htmlFor="o-legal"><Input id="o-legal" value={v.legalName} onChange={set("legalName")} /></Field>
        <Field label="Email" htmlFor="o-email" error={fe("email")}><Input id="o-email" type="email" value={v.email} onChange={set("email")} /></Field>
        <Field label="Phone" htmlFor="o-phone" error={fe("phone")}><Input id="o-phone" value={v.phone} onChange={set("phone")} /></Field>
        <Field label="Region" htmlFor="o-reg"><Input id="o-reg" value={v.region} onChange={set("region")} /></Field>
        <Field label="District" htmlFor="o-dist"><Input id="o-dist" value={v.district} onChange={set("district")} /></Field>
        <Field label="Community" htmlFor="o-comm"><Input id="o-comm" value={v.community} onChange={set("community")} /></Field>
        <Field label="Digital address" htmlFor="o-gps" error={fe("address.digitalAddress")}><Input id="o-gps" value={v.digitalAddress} onChange={set("digitalAddress")} /></Field>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Localization</legend>
        <Field label="Country (ISO)" htmlFor="o-cc"><Input id="o-cc" value={v.countryCode} onChange={set("countryCode")} maxLength={2} /></Field>
        <Field label="Currency (ISO)" htmlFor="o-cur" hint="Applies to new records."><Input id="o-cur" value={v.defaultCurrency} onChange={set("defaultCurrency")} maxLength={3} /></Field>
        <Field label="Timezone" htmlFor="o-tz" error={fe("timezone")}><Input id="o-tz" value={v.timezone} onChange={set("timezone")} /></Field>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Policies</legend>
        <label className="flex items-start gap-2 text-sm sm:col-span-3"><input type="checkbox" className="mt-1" checked={v.paymentsRequireConfirmation} onChange={(e) => setV({ ...v, paymentsRequireConfirmation: e.target.checked })} /><span>Payments require confirmation by an authorized user before they count as collected (recommended maker-checker control).</span></label>
        <Field label="Charge generation horizon (days ahead)" htmlFor="o-hz" error={fe("chargeGenerationHorizonDays")}><Input id="o-hz" inputMode="numeric" value={String(v.chargeGenerationHorizonDays)} onChange={set("chargeGenerationHorizonDays")} /></Field>
        <Field label="Lease expiry warning (days)" htmlFor="o-exp" error={fe("leaseExpiryWarningDays")}><Input id="o-exp" inputMode="numeric" value={String(v.leaseExpiryWarningDays)} onChange={set("leaseExpiryWarningDays")} /></Field>
        <div className="text-sm"><div className="text-xs font-medium text-slate-600">Plan</div><div className="mt-2 capitalize">{v.plan} <span className="text-xs text-slate-500">(billing integration deferred)</span></div></div>
      </fieldset>
      <Button type="submit" disabled={pending}>Save settings</Button>
    </form>
  );
}
