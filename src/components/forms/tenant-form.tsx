"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

export interface TenantFormValue {
  id?: string; tenantType: string; displayName: string; email: string; phone: string; alternatePhone: string;
  community: string; district: string; region: string; digitalAddress: string;
  ecName: string; ecPhone: string; ecRelationship: string; identificationType: string; identificationReference: string; employmentInfo: string;
  status: string; privacyNoticeAccepted: boolean;
}

export function TenantForm({ initial, canSensitive, redirectOnCreate = true }: { initial?: Partial<TenantFormValue>; canSensitive: boolean; redirectOnCreate?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<TenantFormValue>({
    tenantType: "individual", displayName: "", email: "", phone: "", alternatePhone: "", community: "", district: "", region: "Greater Accra", digitalAddress: "",
    ecName: "", ecPhone: "", ecRelationship: "", identificationType: "", identificationReference: "", employmentInfo: "", status: "prospective", privacyNoticeAccepted: false, ...initial,
  });
  const { pending, error, fe, run } = useSubmit();
  const set = (k: keyof TenantFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      tenantType: v.tenantType, displayName: v.displayName, email: v.email, phone: v.phone, alternatePhone: v.alternatePhone, status: v.status,
      address: { country: "GH", region: v.region, district: v.district, community: v.community, digitalAddress: v.digitalAddress },
      privacyNoticeAccepted: v.privacyNoticeAccepted,
    };
    if (canSensitive) {
      Object.assign(body, {
        emergencyContact: v.ecName || v.ecPhone ? { name: v.ecName, phone: v.ecPhone, relationship: v.ecRelationship } : null,
        identificationType: v.identificationType || null, employmentInfo: v.employmentInfo || null,
        ...(v.identificationReference ? { identificationReference: v.identificationReference } : {}),
      });
    }
    const res = await run(() => api<{ id: string }>(v.id ? `/tenants/${v.id}` : "/tenants", { method: v.id ? "PATCH" : "POST", body }));
    if (res) { if (!v.id && redirectOnCreate) router.push(`/app/tenants/${res.id}`); router.refresh(); }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Contact</legend>
        <Field label="Tenant type" htmlFor="t-type"><Select id="t-type" value={v.tenantType} onChange={set("tenantType")}><option value="individual">Individual</option><option value="organization">Organization / company</option></Select></Field>
        <Field label={v.tenantType === "individual" ? "Full name" : "Organization name"} htmlFor="t-name" error={fe("displayName")} required><Input id="t-name" value={v.displayName} onChange={set("displayName")} /></Field>
        <Field label="Primary phone" htmlFor="t-phone" error={fe("phone")} hint="Ghana numbers like 024 123 4567 are stored as +233…"><Input id="t-phone" type="tel" value={v.phone} onChange={set("phone")} /></Field>
        <Field label="Email" htmlFor="t-email" error={fe("email")}><Input id="t-email" type="email" value={v.email} onChange={set("email")} /></Field>
        <Field label="Alternative phone" htmlFor="t-alt" error={fe("alternatePhone")}><Input id="t-alt" type="tel" value={v.alternatePhone} onChange={set("alternatePhone")} /></Field>
        <Field label="Status" htmlFor="t-status"><Select id="t-status" value={v.status} onChange={set("status")}><option value="prospective">Prospective</option><option value="active">Active</option><option value="former">Former</option></Select></Field>
        <Field label="Community / area" htmlFor="t-comm"><Input id="t-comm" value={v.community} onChange={set("community")} /></Field>
        <Field label="District" htmlFor="t-dist"><Input id="t-dist" value={v.district} onChange={set("district")} /></Field>
        <Field label="Digital address" htmlFor="t-gps" error={fe("address.digitalAddress")}><Input id="t-gps" value={v.digitalAddress} onChange={set("digitalAddress")} /></Field>
      </fieldset>
      {canSensitive ? (
        <fieldset className="grid gap-4 rounded-md border border-amber-200 bg-amber-50/40 p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Restricted information <span className="font-normal text-slate-600">— collect only if needed for a defined purpose</span></legend>
          <Field label="Emergency contact name" htmlFor="ec-n"><Input id="ec-n" value={v.ecName} onChange={set("ecName")} /></Field>
          <Field label="Emergency contact phone" htmlFor="ec-p"><Input id="ec-p" value={v.ecPhone} onChange={set("ecPhone")} /></Field>
          <Field label="Relationship" htmlFor="ec-r"><Input id="ec-r" value={v.ecRelationship} onChange={set("ecRelationship")} /></Field>
          <Field label="ID type" htmlFor="id-t"><Select id="id-t" value={v.identificationType} onChange={set("identificationType")}><option value="">None recorded</option><option value="ghana_card">Ghana Card</option><option value="passport">Passport</option><option value="drivers_licence">Driver&apos;s licence</option><option value="voter_id">Voter ID</option><option value="ssnit">SSNIT</option><option value="other">Other</option></Select></Field>
          <Field label="ID number" htmlFor="id-r" hint={v.id ? "Leave blank to keep the stored number. Encrypted at rest." : "Encrypted at rest; shown masked."}><Input id="id-r" autoComplete="off" value={v.identificationReference} onChange={set("identificationReference")} /></Field>
          <Field label="Employment / business info" htmlFor="emp"><Textarea id="emp" rows={2} value={v.employmentInfo} onChange={set("employmentInfo")} /></Field>
        </fieldset>
      ) : <p className="text-xs text-slate-500">Identification and emergency-contact fields are restricted for your role.</p>}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={v.privacyNoticeAccepted} onChange={(e) => setV({ ...v, privacyNoticeAccepted: e.target.checked })} />
        <span>Tenant has been given the privacy notice (version 2026-01) explaining what data is held, why, and who can access it.</span>
      </label>
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Saving…" : v.id ? "Save tenant" : "Create tenant"}</Button></div>
    </form>
  );
}

export function NoteForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState("note"); const [body, setBody] = useState("");
  const { pending, error, run } = useSubmit();
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/tenants/${tenantId}/notes`, { body: { kind, body } }))) { setBody(""); router.refresh(); } }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Select aria-label="Note type" value={kind} onChange={(e) => setKind(e.target.value)} className="max-w-32"><option value="note">Note</option><option value="call">Call</option><option value="visit">Visit</option><option value="email">Email</option><option value="sms">SMS</option></Select>
        <Input aria-label="Note" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Record a communication or internal note (staff only)" />
        <Button type="submit" disabled={pending || !body.trim()}>Add</Button>
      </div>
    </form>
  );
}

export function RevealId({ tenantId }: { tenantId: string }) {
  const [val, setVal] = useState<string | null>(null);
  const { pending, error, run } = useSubmit();
  if (val) return <span className="font-mono">{val}</span>;
  return (<><button type="button" disabled={pending} className="text-xs text-brand-700 underline" onClick={async () => { const r = await run(() => api<{ identificationReference: string | null }>(`/tenants/${tenantId}/identification`, { body: {} })); if (r) setVal(r.identificationReference ?? "Not recorded"); }}>Reveal (audited)</button>{error && <span className="text-xs text-red-600"> {error}</span>}</>);
}
