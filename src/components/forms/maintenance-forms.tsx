"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api, toMinor } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

/** Option lists passed from server pages (already filtered to the user's scope). */
export type Opt = { id: string; label: string };
export type UnitOpt = Opt & { propertyId: string };
export type AssetOpt = Opt & { propertyId: string; unitId?: string | null };

// Client copies of the domain enums (server components must import them from @/server/domain/maintenance).
const CATEGORIES = ["plumbing", "electrical", "structural", "hvac", "cleaning", "security", "pest_control", "appliance", "grounds", "other"];
const ASSET_CATEGORIES = ["generator", "water_pump", "borehole", "lift", "air_conditioner", "fire_equipment", "water_system", "security_system", "electrical", "solar", "appliance", "other"];
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()).replace(/^Hvac$/, "HVAC / air-con");
const opts = (xs: string[]) => xs.map((x) => <option key={x} value={x}>{label(x)}</option>);
type Ch = React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
const minorOrNull = (s: string) => (s.trim() === "" ? 0 : toMinor(s));
const centsToStr = (m: number | null | undefined) => (m ? (m / 100).toFixed(2) : "");

function EmergencyNotice() {
  return <Alert tone="warning"><strong>Emergency</strong> requests alert the staff responsible for this property in the app and by email. This is not a monitored 24/7 service: for fire, gas or immediate danger call emergency services (112 / 192 fire) first.</Alert>;
}

// ── Maintenance request (staff) ───────────────────────────────────────────
export function RequestForm({ properties, units, assets, tenants, today }: { properties: Opt[]; units: UnitOpt[]; assets: AssetOpt[]; tenants: Opt[]; today: string }) {
  const router = useRouter();
  const [v, setV] = useState({ propertyId: properties[0]?.id ?? "", unitId: "", assetId: "", tenantId: "", category: "plumbing", priority: "normal", title: "", description: "", requesterName: "", requesterContact: "", targetDate: "" });
  const { pending, error, fe, run } = useSubmit();
  const set = (k: keyof typeof v) => (e: Ch) => setV({ ...v, [k]: e.target.value, ...(k === "propertyId" ? { unitId: "", assetId: "" } : {}) });
  const u = units.filter((x) => x.propertyId === v.propertyId);
  const a = assets.filter((x) => x.propertyId === v.propertyId && (!v.unitId || !x.unitId || x.unitId === v.unitId));
  return (
    <form className="space-y-4" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const res = await run(() => api<{ id: string }>("/maintenance-requests", { body: { ...v, unitId: v.unitId || null, assetId: v.assetId || null, tenantId: v.tenantId || null, requesterName: v.requesterName || null, requesterContact: v.requesterContact || null, targetDate: v.targetDate || null } }));
      if (res) { router.push(`/app/maintenance/${res.id}`); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      {v.priority === "emergency" && <EmergencyNotice />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Property" htmlFor="r-prop" required error={fe("propertyId")}><Select id="r-prop" value={v.propertyId} onChange={set("propertyId")}>{properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field label="Unit" htmlFor="r-unit" error={fe("unitId")} hint="Leave blank for common areas."><Select id="r-unit" value={v.unitId} onChange={set("unitId")}><option value="">Common area / whole property</option>{u.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
        <Field label="Related asset" htmlFor="r-asset" error={fe("assetId")}><Select id="r-asset" value={v.assetId} onChange={set("assetId")}><option value="">None</option>{a.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
        <Field label="Category" htmlFor="r-cat"><Select id="r-cat" value={v.category} onChange={set("category")}>{opts(CATEGORIES)}</Select></Field>
        <Field label="Priority" htmlFor="r-pri"><Select id="r-pri" value={v.priority} onChange={set("priority")}>{opts(["low", "normal", "high", "emergency"])}</Select></Field>
        <Field label="Target date" htmlFor="r-target" hint="Defaults by priority (emergency 1 day … low 14 days)."><Input id="r-target" type="date" min={today} value={v.targetDate} onChange={set("targetDate")} /></Field>
        <Field label="Title" htmlFor="r-title" required error={fe("title")} className="sm:col-span-3"><Input id="r-title" value={v.title} onChange={set("title")} placeholder="e.g. Kitchen sink leaking" /></Field>
        <Field label="Description" htmlFor="r-desc" required error={fe("description")} className="sm:col-span-3"><Textarea id="r-desc" value={v.description} onChange={set("description")} /></Field>
        <Field label="Reported by tenant" htmlFor="r-tenant"><Select id="r-tenant" value={v.tenantId} onChange={set("tenantId")}><option value="">Not a tenant / staff</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
        <Field label="Requester name" htmlFor="r-name" hint="Defaults to the tenant or you."><Input id="r-name" value={v.requesterName} onChange={set("requesterName")} /></Field>
        <Field label="Requester contact" htmlFor="r-contact"><Input id="r-contact" value={v.requesterContact} onChange={set("requesterContact")} placeholder="024 123 4567" /></Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Log request"}</Button>
    </form>
  );
}

// ── Triage ────────────────────────────────────────────────────────────────
export function TriageForm({ requestId, category, priority, targetDate, managers, managerId }: { requestId: string; category: string; priority: string; targetDate: string | null; managers: Opt[]; managerId: string | null }) {
  const router = useRouter();
  const [v, setV] = useState({ category, priority, targetDate: targetDate ?? "", assignedManagerMembershipId: managerId ?? "", note: "" });
  const { pending, error, run } = useSubmit();
  const set = (k: keyof typeof v) => (e: Ch) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => api(`/maintenance-requests/${requestId}/triage`, { body: { ...v, targetDate: v.targetDate || null, assignedManagerMembershipId: v.assignedManagerMembershipId || null, note: v.note || null } }));
      if (ok) router.refresh();
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      {v.priority === "emergency" && <EmergencyNotice />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" htmlFor="t-cat"><Select id="t-cat" value={v.category} onChange={set("category")}>{opts(CATEGORIES)}</Select></Field>
        <Field label="Priority" htmlFor="t-pri"><Select id="t-pri" value={v.priority} onChange={set("priority")}>{opts(["low", "normal", "high", "emergency"])}</Select></Field>
        <Field label="Target date" htmlFor="t-target"><Input id="t-target" type="date" value={v.targetDate} onChange={set("targetDate")} /></Field>
        <Field label="Responsible manager" htmlFor="t-mgr"><Select id="t-mgr" value={v.assignedManagerMembershipId} onChange={set("assignedManagerMembershipId")}><option value="">Unassigned</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        <Field label="Triage note (internal)" htmlFor="t-note" className="sm:col-span-2"><Textarea id="t-note" rows={2} value={v.note} onChange={set("note")} /></Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save triage"}</Button>
    </form>
  );
}

// ── Assignment (create from request, or reassign a work order) ────────────
function AssignFields({ v, set, users, vendors, today }: { v: { mode: string; assignedUserId: string; vendorId: string; scheduledAt: string; dueAt: string; priority: string }; set: (k: string) => (e: Ch) => void; users: Opt[]; vendors: Opt[]; today: string }) {
  return (
    <>
      <Field label="Assign to" htmlFor="a-mode"><Select id="a-mode" value={v.mode} onChange={set("mode")}><option value="user">Internal technician</option><option value="vendor">External vendor</option><option value="none">Leave unassigned</option></Select></Field>
      {v.mode === "user" && <Field label="Technician" htmlFor="a-user"><Select id="a-user" value={v.assignedUserId} onChange={set("assignedUserId")}><option value="">Select…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>}
      {v.mode === "vendor" && <Field label="Vendor" htmlFor="a-vendor"><Select id="a-vendor" value={v.vendorId} onChange={set("vendorId")}><option value="">Select…</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>}
      <Field label="Priority" htmlFor="a-pri"><Select id="a-pri" value={v.priority} onChange={set("priority")}>{opts(["low", "normal", "high", "emergency"])}</Select></Field>
      <Field label="Scheduled for" htmlFor="a-sched"><Input id="a-sched" type="date" min={today} value={v.scheduledAt} onChange={set("scheduledAt")} /></Field>
      <Field label="Due by" htmlFor="a-due"><Input id="a-due" type="date" value={v.dueAt} onChange={set("dueAt")} /></Field>
    </>
  );
}
const assignBody = (v: { mode: string; assignedUserId: string; vendorId: string; scheduledAt: string; dueAt: string; priority: string }) => ({
  assignedUserId: v.mode === "user" ? v.assignedUserId || null : null, vendorId: v.mode === "vendor" ? v.vendorId || null : null,
  scheduledAt: v.scheduledAt || null, dueAt: v.dueAt || null, priority: v.priority,
});

export function CreateWorkOrderFromRequestForm({ requestId, users, vendors, defaultScope, priority, dueAt, today }: { requestId: string; users: Opt[]; vendors: Opt[]; defaultScope: string; priority: string; dueAt: string | null; today: string }) {
  const router = useRouter();
  const [v, setV] = useState({ mode: "user", assignedUserId: "", vendorId: "", scheduledAt: "", dueAt: dueAt ?? "", priority, scope: defaultScope, checklist: "" });
  const { pending, error, run } = useSubmit();
  const set = (k: string) => (e: Ch) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const checklist = v.checklist.split("\n").map((s) => s.trim()).filter(Boolean).map((item) => ({ item, done: false }));
      const res = await run(() => api<{ workOrderId: string }>(`/maintenance-requests/${requestId}/create-work-order`, { body: { ...assignBody(v), scope: v.scope, ...(checklist.length ? { checklist } : {}) } }));
      if (res) { router.push(`/app/work-orders/${res.workOrderId}`); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3"><AssignFields v={v} set={set} users={users} vendors={vendors} today={today} /></div>
      <Field label="Scope of work" htmlFor="a-scope"><Textarea id="a-scope" rows={3} value={v.scope} onChange={set("scope")} /></Field>
      <Field label="Checklist (one item per line, optional)" htmlFor="a-check"><Textarea id="a-check" rows={2} value={v.checklist} onChange={set("checklist")} /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create work order"}</Button>
    </form>
  );
}

export function ReassignForm({ workOrderId, users, vendors, current, today }: { workOrderId: string; users: Opt[]; vendors: Opt[]; current: { assignedUserId: string | null; vendorId: string | null; scheduledAt: string | null; dueAt: string | null; priority: string }; today: string }) {
  const router = useRouter();
  const [v, setV] = useState({ mode: current.vendorId ? "vendor" : current.assignedUserId ? "user" : "none", assignedUserId: current.assignedUserId ?? "", vendorId: current.vendorId ?? "", scheduledAt: current.scheduledAt ?? "", dueAt: current.dueAt ?? "", priority: current.priority });
  const { pending, error, run } = useSubmit();
  const set = (k: string) => (e: Ch) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/work-orders/${workOrderId}`, { method: "PATCH", body: assignBody(v) }))) router.refresh(); }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3"><AssignFields v={v} set={set} users={users} vendors={vendors} today={today} /></div>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save assignment"}</Button>
    </form>
  );
}

// ── Standalone work order ─────────────────────────────────────────────────
export function WorkOrderForm({ properties, units, assets, users, vendors, today }: { properties: Opt[]; units: UnitOpt[]; assets: AssetOpt[]; users: Opt[]; vendors: Opt[]; today: string }) {
  const router = useRouter();
  const [v, setV] = useState({ propertyId: properties[0]?.id ?? "", unitId: "", assetId: "", category: "other", scope: "", mode: "user", assignedUserId: "", vendorId: "", scheduledAt: "", dueAt: "", priority: "normal" });
  const { pending, error, fe, run } = useSubmit();
  const set = (k: string) => (e: Ch) => setV({ ...v, [k]: e.target.value, ...(k === "propertyId" ? { unitId: "", assetId: "" } : {}) });
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const res = await run(() => api<{ id: string }>("/work-orders", { body: { propertyId: v.propertyId, unitId: v.unitId || null, assetId: v.assetId || null, category: v.category, scope: v.scope, ...assignBody(v) } }));
      if (res) { router.push(`/app/work-orders/${res.id}`); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Property" htmlFor="w-prop"><Select id="w-prop" value={v.propertyId} onChange={set("propertyId")}>{properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field label="Unit" htmlFor="w-unit"><Select id="w-unit" value={v.unitId} onChange={set("unitId")}><option value="">Common area</option>{units.filter((u) => u.propertyId === v.propertyId).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
        <Field label="Asset" htmlFor="w-asset"><Select id="w-asset" value={v.assetId} onChange={set("assetId")}><option value="">None</option>{assets.filter((a) => a.propertyId === v.propertyId).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></Field>
        <Field label="Category" htmlFor="w-cat"><Select id="w-cat" value={v.category} onChange={set("category")}>{opts(CATEGORIES)}</Select></Field>
        <AssignFields v={v} set={set} users={users} vendors={vendors} today={today} />
        <Field label="Scope of work" htmlFor="w-scope" required error={fe("scope")} className="sm:col-span-3"><Textarea id="w-scope" value={v.scope} onChange={set("scope")} /></Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create work order"}</Button>
    </form>
  );
}

// ── Progress: costs, checklist, notes (technician) ────────────────────────
type Check = { item: string; done: boolean; reading?: string | null; note?: string | null };
export function WorkOrderProgressForm({ workOrderId, initial, complete }: {
  workOrderId: string; complete?: boolean;
  initial: { labourCostMinor: number; materialsCostMinor: number; vendorCostMinor: number; otherCostMinor: number; purchaseReference: string | null; completionNotes: string | null; checklist: Check[]; returnVisitDate: string | null };
}) {
  const router = useRouter();
  const [v, setV] = useState({ labour: centsToStr(initial.labourCostMinor), materials: centsToStr(initial.materialsCostMinor), vendor: centsToStr(initial.vendorCostMinor), other: centsToStr(initial.otherCostMinor), purchaseReference: initial.purchaseReference ?? "", completionNotes: initial.completionNotes ?? "", returnVisitDate: initial.returnVisitDate ?? "" });
  const [checklist, setChecklist] = useState<Check[]>(initial.checklist);
  const { pending, error, run, setError } = useSubmit();
  const set = (k: keyof typeof v) => (e: Ch) => setV({ ...v, [k]: e.target.value });
  const total = useMemo(() => [v.labour, v.materials, v.vendor, v.other].reduce((s, x) => s + (minorOrNull(x) ?? 0), 0), [v]);
  async function save(finish: boolean) {
    const costs = { labourCostMinor: minorOrNull(v.labour), materialsCostMinor: minorOrNull(v.materials), vendorCostMinor: minorOrNull(v.vendor), otherCostMinor: minorOrNull(v.other) };
    if (Object.values(costs).some((c) => c === null)) return setError("Costs must be amounts like 150 or 150.00");
    if (finish && v.completionNotes.trim().length < 1) return setError("Describe the work done before marking it complete.");
    const body = { ...costs, purchaseReference: v.purchaseReference || null, completionNotes: v.completionNotes || null, returnVisitDate: v.returnVisitDate || null, ...(checklist.length ? { checklist } : {}) };
    const ok = await run(() => finish
      ? api(`/work-orders/${workOrderId}/complete`, { body: { ...body, completionNotes: v.completionNotes } })
      : api(`/work-orders/${workOrderId}`, { method: "PATCH", body }));
    if (ok) router.refresh();
  }
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); save(false); }}>
      {error && <Alert tone="error">{error}</Alert>}
      {checklist.length > 0 && (
        <fieldset className="space-y-2"><legend className="text-sm font-medium text-slate-700">Checklist</legend>
          {checklist.map((c, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-[auto_1fr_12rem]">
              <input id={`c-${i}`} type="checkbox" checked={c.done} onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} className="h-4 w-4" />
              <label htmlFor={`c-${i}`} className="text-sm">{c.item}</label>
              <Input aria-label={`Reading for ${c.item}`} placeholder="Reading / note" value={c.reading ?? ""} onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? { ...x, reading: e.target.value } : x)))} />
            </div>
          ))}
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Labour (GH₵)" htmlFor="pc-l"><Input id="pc-l" inputMode="decimal" value={v.labour} onChange={set("labour")} /></Field>
        <Field label="Materials (GH₵)" htmlFor="pc-m"><Input id="pc-m" inputMode="decimal" value={v.materials} onChange={set("materials")} /></Field>
        <Field label="Vendor invoice (GH₵)" htmlFor="pc-v"><Input id="pc-v" inputMode="decimal" value={v.vendor} onChange={set("vendor")} /></Field>
        <Field label="Other (GH₵)" htmlFor="pc-o"><Input id="pc-o" inputMode="decimal" value={v.other} onChange={set("other")} /></Field>
        <Field label="Purchase / receipt ref" htmlFor="pc-ref" className="sm:col-span-2"><Input id="pc-ref" value={v.purchaseReference} onChange={set("purchaseReference")} /></Field>
        <Field label="Return visit / warranty check" htmlFor="pc-rv"><Input id="pc-rv" type="date" value={v.returnVisitDate} onChange={set("returnVisitDate")} /></Field>
        <div className="self-end pb-2 text-sm">Total: <strong className="tabular">GH₵ {(total / 100).toLocaleString("en-GH", { minimumFractionDigits: 2 })}</strong></div>
        <Field label="Work done / completion notes" htmlFor="pc-notes" className="sm:col-span-4"><Textarea id="pc-notes" rows={3} value={v.completionNotes} onChange={set("completionNotes")} /></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save progress"}</Button>
        {complete && <Button type="button" disabled={pending} onClick={() => save(true)}>Mark complete</Button>}
      </div>
    </form>
  );
}

// ── Notes ─────────────────────────────────────────────────────────────────
export function RequestNoteForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("internal");
  const { pending, error, run } = useSubmit();
  return (
    <form className="space-y-2" noValidate onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/maintenance-requests/${requestId}/updates`, { body: { body, visibility } }))) { setBody(""); router.refresh(); } }}>
      {error && <Alert tone="error">{error}</Alert>}
      <Textarea aria-label="Update" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note or an update for the requester…" />
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)} className="max-w-56"><option value="internal">Internal note (staff only)</option><option value="tenant">Update visible to tenant</option></Select>
        <Button type="submit" variant="secondary" disabled={pending || !body.trim()}>{pending ? "Adding…" : "Add"}</Button>
      </div>
    </form>
  );
}

// ── Vendor ────────────────────────────────────────────────────────────────
export function VendorForm({ initial }: { initial?: { id: string; businessName: string; contactName: string | null; phone: string | null; email: string | null; serviceCategories: string[]; status: string; notes: string | null; address: Record<string, string> | null } }) {
  const router = useRouter();
  const [v, setV] = useState({ businessName: initial?.businessName ?? "", contactName: initial?.contactName ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", status: initial?.status ?? "active", notes: initial?.notes ?? "", community: initial?.address?.community ?? "", region: initial?.address?.region ?? "", digitalAddress: initial?.address?.digitalAddress ?? "" });
  const [cats, setCats] = useState<string[]>(initial?.serviceCategories ?? []);
  const { pending, error, fe, run } = useSubmit();
  const set = (k: keyof typeof v) => (e: Ch) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const body = { businessName: v.businessName, contactName: v.contactName || null, phone: v.phone || null, email: v.email || null, status: v.status, notes: v.notes || null, serviceCategories: cats, address: { country: "GH", community: v.community, region: v.region, digitalAddress: v.digitalAddress } };
      const res = await run(() => api<{ id: string }>(initial ? `/vendors/${initial.id}` : "/vendors", { method: initial ? "PATCH" : "POST", body }));
      if (res) { if (!initial) router.push(`/app/vendors/${res.id}`); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Business name" htmlFor="v-name" required error={fe("businessName")}><Input id="v-name" value={v.businessName} onChange={set("businessName")} /></Field>
        <Field label="Contact person" htmlFor="v-contact"><Input id="v-contact" value={v.contactName} onChange={set("contactName")} /></Field>
        <Field label="Status" htmlFor="v-status"><Select id="v-status" value={v.status} onChange={set("status")}>{opts(["active", "inactive", "suspended"])}</Select></Field>
        <Field label="Phone" htmlFor="v-phone" error={fe("phone")}><Input id="v-phone" value={v.phone} onChange={set("phone")} placeholder="024 123 4567" /></Field>
        <Field label="Email" htmlFor="v-email" error={fe("email")}><Input id="v-email" type="email" value={v.email} onChange={set("email")} /></Field>
        <Field label="GhanaPostGPS" htmlFor="v-gps" error={fe("address.digitalAddress")}><Input id="v-gps" value={v.digitalAddress} onChange={set("digitalAddress")} placeholder="GA-123-4567" /></Field>
        <Field label="Community / area" htmlFor="v-comm"><Input id="v-comm" value={v.community} onChange={set("community")} /></Field>
        <Field label="Region" htmlFor="v-region"><Input id="v-region" value={v.region} onChange={set("region")} /></Field>
      </div>
      <fieldset><legend className="mb-1 text-sm font-medium text-slate-700">Service categories</legend>
        <div className="flex flex-wrap gap-3">{CATEGORIES.map((c) => (
          <label key={c} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={cats.includes(c)} onChange={(e) => setCats(e.target.checked ? [...cats, c] : cats.filter((x) => x !== c))} />{label(c)}</label>
        ))}</div>
      </fieldset>
      <Field label="Performance notes" htmlFor="v-notes"><Textarea id="v-notes" rows={2} value={v.notes} onChange={set("notes")} /></Field>
      <p className="text-xs text-slate-500">Bank details are not collected: AI-POS records maintenance costs but does not pay vendors.</p>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : initial ? "Save vendor" : "Add vendor"}</Button>
    </form>
  );
}

// ── Asset ─────────────────────────────────────────────────────────────────
type AssetInitial = { id: string; name: string; category: string; propertyId: string; unitId: string | null; location: string | null; make: string | null; model: string | null; serialNumber: string | null; installedAt: string | null; warrantyExpiresAt: string | null; criticality: string; condition: string; status: string; serviceIntervalDays: number | null; lastServicedAt: string | null; notes: string | null };
export function AssetForm({ properties, units, initial }: { properties: Opt[]; units: UnitOpt[]; initial?: AssetInitial }) {
  const router = useRouter();
  const [v, setV] = useState({
    propertyId: initial?.propertyId ?? properties[0]?.id ?? "", unitId: initial?.unitId ?? "", name: initial?.name ?? "", category: initial?.category ?? "generator", location: initial?.location ?? "",
    make: initial?.make ?? "", model: initial?.model ?? "", serialNumber: initial?.serialNumber ?? "", installedAt: initial?.installedAt ?? "", warrantyExpiresAt: initial?.warrantyExpiresAt ?? "",
    criticality: initial?.criticality ?? "medium", condition: initial?.condition ?? "good", status: initial?.status ?? "active", serviceIntervalDays: initial?.serviceIntervalDays?.toString() ?? "", lastServicedAt: initial?.lastServicedAt ?? "", notes: initial?.notes ?? "",
  });
  const { pending, error, fe, run } = useSubmit();
  const set = (k: keyof typeof v) => (e: Ch) => setV({ ...v, [k]: e.target.value, ...(k === "propertyId" ? { unitId: "" } : {}) });
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const n = (s: string) => s || null;
      const body = { unitId: n(v.unitId), name: v.name, category: v.category, location: n(v.location), make: n(v.make), model: n(v.model), serialNumber: n(v.serialNumber), installedAt: n(v.installedAt), warrantyExpiresAt: n(v.warrantyExpiresAt), criticality: v.criticality, condition: v.condition, status: v.status, serviceIntervalDays: v.serviceIntervalDays ? Number(v.serviceIntervalDays) : null, lastServicedAt: n(v.lastServicedAt), notes: n(v.notes) };
      const res = await run(() => api<{ id: string }>(initial ? `/assets/${initial.id}` : "/assets", { method: initial ? "PATCH" : "POST", body: initial ? body : { ...body, propertyId: v.propertyId } }));
      if (res) { if (!initial) router.push(`/app/assets/${res.id}`); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Property" htmlFor="as-prop"><Select id="as-prop" value={v.propertyId} onChange={set("propertyId")} disabled={!!initial}>{properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field label="Unit (optional)" htmlFor="as-unit" error={fe("unitId")}><Select id="as-unit" value={v.unitId} onChange={set("unitId")}><option value="">Shared / building-wide</option>{units.filter((u) => u.propertyId === v.propertyId).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
        <Field label="Location" htmlFor="as-loc"><Input id="as-loc" value={v.location} onChange={set("location")} placeholder="e.g. Generator house, rear yard" /></Field>
        <Field label="Name" htmlFor="as-name" required error={fe("name")}><Input id="as-name" value={v.name} onChange={set("name")} /></Field>
        <Field label="Category" htmlFor="as-cat"><Select id="as-cat" value={v.category} onChange={set("category")}>{opts(ASSET_CATEGORIES)}</Select></Field>
        <Field label="Criticality" htmlFor="as-crit"><Select id="as-crit" value={v.criticality} onChange={set("criticality")}>{opts(["low", "medium", "high", "critical"])}</Select></Field>
        <Field label="Make" htmlFor="as-make"><Input id="as-make" value={v.make} onChange={set("make")} /></Field>
        <Field label="Model" htmlFor="as-model"><Input id="as-model" value={v.model} onChange={set("model")} /></Field>
        <Field label="Serial number" htmlFor="as-serial"><Input id="as-serial" value={v.serialNumber} onChange={set("serialNumber")} /></Field>
        <Field label="Installed / commissioned" htmlFor="as-inst" error={fe("installedAt")}><Input id="as-inst" type="date" value={v.installedAt} onChange={set("installedAt")} /></Field>
        <Field label="Warranty expires" htmlFor="as-warr" error={fe("warrantyExpiresAt")}><Input id="as-warr" type="date" value={v.warrantyExpiresAt} onChange={set("warrantyExpiresAt")} /></Field>
        <Field label="Condition" htmlFor="as-cond"><Select id="as-cond" value={v.condition} onChange={set("condition")}>{opts(["good", "fair", "poor", "failed"])}</Select></Field>
        <Field label="Service interval (days)" htmlFor="as-int" error={fe("serviceIntervalDays")}><Input id="as-int" inputMode="numeric" value={v.serviceIntervalDays} onChange={set("serviceIntervalDays")} /></Field>
        <Field label="Last serviced" htmlFor="as-last" error={fe("lastServicedAt")}><Input id="as-last" type="date" value={v.lastServicedAt} onChange={set("lastServicedAt")} /></Field>
        <Field label="Lifecycle status" htmlFor="as-status" hint={initial ? "Disposed is final." : undefined}><Select id="as-status" value={v.status} onChange={set("status")}>{opts(initial ? ["active", "inactive", "disposed"] : ["active", "inactive"])}</Select></Field>
        <Field label="Notes" htmlFor="as-notes" className="sm:col-span-3"><Textarea id="as-notes" rows={2} value={v.notes} onChange={set("notes")} /></Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : initial ? "Save asset" : "Register asset"}</Button>
    </form>
  );
}

// ── Preventive plan ───────────────────────────────────────────────────────
export function PlanForm({ assetId, users, vendors, today, defaultInterval }: { assetId: string; users: Opt[]; vendors: Opt[]; today: string; defaultInterval: number | null }) {
  const router = useRouter();
  const [v, setV] = useState({ planName: "", intervalDays: String(defaultInterval ?? 90), nextDueAt: today, leadDays: "7", checklist: "", mode: "none", assignedUserId: "", assignedVendorId: "", estimated: "" });
  const { pending, error, fe, run, setError } = useSubmit();
  const set = (k: keyof typeof v) => (e: Ch) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const est = v.estimated ? toMinor(v.estimated) : null;
      if (v.estimated && est === null) return setError("Estimated cost must be an amount like 500.00");
      const ok = await run(() => api("/preventive-maintenance-plans", { body: {
        assetId, planName: v.planName, intervalDays: Number(v.intervalDays), nextDueAt: v.nextDueAt, leadDays: Number(v.leadDays || 0),
        checklist: v.checklist.split("\n").map((s) => s.trim()).filter(Boolean), estimatedCostMinor: est,
        assignedUserId: v.mode === "user" ? v.assignedUserId || null : null, assignedVendorId: v.mode === "vendor" ? v.assignedVendorId || null : null,
      } }));
      if (ok) { setV({ ...v, planName: "", checklist: "" }); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Plan name" htmlFor="pl-name" required error={fe("planName")} className="sm:col-span-2"><Input id="pl-name" value={v.planName} onChange={set("planName")} placeholder="e.g. Quarterly generator service" /></Field>
        <Field label="Every (days)" htmlFor="pl-int" error={fe("intervalDays")}><Input id="pl-int" inputMode="numeric" value={v.intervalDays} onChange={set("intervalDays")} /></Field>
        <Field label="First due" htmlFor="pl-due" error={fe("nextDueAt")}><Input id="pl-due" type="date" value={v.nextDueAt} onChange={set("nextDueAt")} /></Field>
        <Field label="Create work order (days before)" htmlFor="pl-lead" error={fe("leadDays")}><Input id="pl-lead" inputMode="numeric" value={v.leadDays} onChange={set("leadDays")} /></Field>
        <Field label="Assign to" htmlFor="pl-mode"><Select id="pl-mode" value={v.mode} onChange={set("mode")}><option value="none">Decide later</option><option value="user">Internal technician</option><option value="vendor">Vendor</option></Select></Field>
        {v.mode === "user" && <Field label="Technician" htmlFor="pl-user"><Select id="pl-user" value={v.assignedUserId} onChange={set("assignedUserId")}><option value="">Select…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>}
        {v.mode === "vendor" && <Field label="Vendor" htmlFor="pl-vendor"><Select id="pl-vendor" value={v.assignedVendorId} onChange={set("assignedVendorId")}><option value="">Select…</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>}
        <Field label="Estimated cost (GH₵)" htmlFor="pl-est"><Input id="pl-est" inputMode="decimal" value={v.estimated} onChange={set("estimated")} /></Field>
        <Field label="Inspection checklist (one item per line)" htmlFor="pl-check" className="sm:col-span-4"><Textarea id="pl-check" rows={3} value={v.checklist} onChange={set("checklist")} placeholder={"Check oil level\nReplace fuel filter\nLoad test 30 minutes"} /></Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add plan"}</Button>
    </form>
  );
}

// ── Tenant portal ─────────────────────────────────────────────────────────
export function PortalRequestForm({ units }: { units: Opt[] }) {
  const router = useRouter();
  const [v, setV] = useState({ unitId: units[0]?.id ?? "", category: "plumbing", priority: "normal", title: "", description: "", contact: "" });
  const [done, setDone] = useState<string | null>(null);
  const { pending, error, fe, run } = useSubmit();
  const set = (k: keyof typeof v) => (e: Ch) => setV({ ...v, [k]: e.target.value });
  if (units.length === 0) return <p className="text-sm text-slate-500">You have no active tenancy to report a problem for. Contact your property manager.</p>;
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const res = await run(() => api<{ requestRef: string }>("/portal/maintenance-requests", { body: { ...v, contact: v.contact || null } }));
      if (res) { setDone(res.requestRef); setV({ ...v, title: "", description: "" }); router.refresh(); }
    }}>
      {done && <Alert tone="success">Request {done} received. You can follow its progress below.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {v.priority === "emergency" && <EmergencyNotice />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Unit" htmlFor="pr-unit"><Select id="pr-unit" value={v.unitId} onChange={set("unitId")}>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></Field>
        <Field label="Type of problem" htmlFor="pr-cat"><Select id="pr-cat" value={v.category} onChange={set("category")}>{opts(CATEGORIES)}</Select></Field>
        <Field label="How urgent?" htmlFor="pr-pri"><Select id="pr-pri" value={v.priority} onChange={set("priority")}><option value="low">Low — when convenient</option><option value="normal">Normal</option><option value="high">High — affects daily use</option><option value="emergency">Emergency — safety risk or serious damage</option></Select></Field>
        <Field label="Short title" htmlFor="pr-title" required error={fe("title")} className="sm:col-span-3"><Input id="pr-title" value={v.title} onChange={set("title")} placeholder="e.g. Bathroom tap leaking" /></Field>
        <Field label="What is happening?" htmlFor="pr-desc" required error={fe("description")} className="sm:col-span-3"><Textarea id="pr-desc" value={v.description} onChange={set("description")} /></Field>
        <Field label="Best contact number (optional)" htmlFor="pr-contact"><Input id="pr-contact" value={v.contact} onChange={set("contact")} /></Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Submit request"}</Button>
    </form>
  );
}

export function PortalFeedbackForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const { pending, error, run } = useSubmit();
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" noValidate onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/portal/maintenance-requests/${requestId}/feedback`, { body: { rating: Number(rating), comment: comment || null } }))) router.refresh(); }}>
      <Field label="Rate the work" htmlFor={`fb-${requestId}`}><Select id={`fb-${requestId}`} value={rating} onChange={(e) => setRating(e.target.value)} className="w-28">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}</Select></Field>
      <Input aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" className="max-w-xs" />
      <Button type="submit" variant="secondary" disabled={pending}>Send</Button>
      {error && <span className="text-xs text-red-600" role="alert">{error}</span>}
    </form>
  );
}
