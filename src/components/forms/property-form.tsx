"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api, toMinor } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

const REGIONS = ["Greater Accra", "Ashanti", "Western", "Western North", "Central", "Eastern", "Volta", "Oti", "Northern", "Savannah", "North East", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo"];
const TYPES = ["residential", "commercial", "mixed_use", "industrial", "land", "hospitality", "institutional", "other"];

export interface PropertyFormValue {
  id?: string; name: string; propertyRef: string; propertyType: string; description: string; status: string; ownerNameOrEntity: string;
  region: string; district: string; community: string; landmark: string; digitalAddress: string; notes: string;
  latitude: string; longitude: string; acquisitionDate: string; acquisitionCost: string; managerMembershipId: string;
}

export function PropertyForm({ initial, managers, canSeeFinancials }: { initial?: Partial<PropertyFormValue>; managers: { id: string; name: string; roleName: string }[]; canSeeFinancials: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<PropertyFormValue>({
    name: "", propertyRef: "", propertyType: "residential", description: "", status: "active", ownerNameOrEntity: "",
    region: "Greater Accra", district: "", community: "", landmark: "", digitalAddress: "", notes: "",
    latitude: "", longitude: "", acquisitionDate: "", acquisitionCost: "", managerMembershipId: "", ...initial,
  });
  const { pending, error, fe, run, setError } = useSubmit();
  const set = (k: keyof PropertyFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cost = v.acquisitionCost ? toMinor(v.acquisitionCost) : null;
    if (v.acquisitionCost && cost === null) return setError("Acquisition cost must be a number like 1250000.00");
    const body = {
      name: v.name, propertyRef: v.propertyRef || null, propertyType: v.propertyType, description: v.description || null, status: v.status,
      ownerNameOrEntity: v.ownerNameOrEntity || null, managerMembershipId: v.managerMembershipId || null,
      address: { country: "GH", region: v.region, district: v.district, community: v.community, landmark: v.landmark, digitalAddress: v.digitalAddress, notes: v.notes },
      latitude: v.latitude ? Number(v.latitude) : null, longitude: v.longitude ? Number(v.longitude) : null,
      acquisitionDate: v.acquisitionDate || null, ...(canSeeFinancials ? { acquisitionCostMinor: cost } : {}),
    };
    const res = await run(() => api<{ id: string }>(v.id ? `/properties/${v.id}` : "/properties", { method: v.id ? "PATCH" : "POST", body }));
    if (res) { router.push(`/app/properties/${res.id}`); router.refresh(); }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Property</legend>
        <Field label="Property name" htmlFor="name" error={fe("name")} required><Input id="name" value={v.name} onChange={set("name")} required aria-invalid={!!fe("name")} /></Field>
        <Field label="Internal reference" htmlFor="ref" error={fe("propertyRef")} hint="Leave blank to auto-generate (PRP-0001)."><Input id="ref" value={v.propertyRef} onChange={set("propertyRef")} /></Field>
        <Field label="Type" htmlFor="type" required><Select id="type" value={v.propertyType} onChange={set("propertyType")}>{TYPES.map((t) => <option key={t} value={t}>{t.replace("_", "-")}</option>)}</Select></Field>
        <Field label="Management status" htmlFor="status"><Select id="status" value={v.status} onChange={set("status")}><option value="active">Active</option><option value="inactive">Inactive</option><option value="under_development">Under development</option></Select></Field>
        <Field label="Owner / ownership entity" htmlFor="owner"><Input id="owner" value={v.ownerNameOrEntity} onChange={set("ownerNameOrEntity")} /></Field>
        <Field label="Property manager" htmlFor="mgr"><Select id="mgr" value={v.managerMembershipId} onChange={set("managerMembershipId")}><option value="">Unassigned</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.roleName})</option>)}</Select></Field>
        <Field label="Description" htmlFor="desc" className="sm:col-span-2"><Textarea id="desc" value={v.description} onChange={set("description")} /></Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Location (Ghana address)</legend>
        <Field label="Region" htmlFor="region"><Select id="region" value={v.region} onChange={set("region")}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="District / municipality" htmlFor="district"><Input id="district" value={v.district} onChange={set("district")} placeholder="e.g. Ayawaso West Municipal" /></Field>
        <Field label="Community / area" htmlFor="community"><Input id="community" value={v.community} onChange={set("community")} placeholder="e.g. East Legon" /></Field>
        <Field label="Landmark" htmlFor="landmark"><Input id="landmark" value={v.landmark} onChange={set("landmark")} placeholder="e.g. Behind Shell filling station" /></Field>
        <Field label="GhanaPostGPS digital address" htmlFor="gps" error={fe("address.digitalAddress")} hint="Format GA-123-4567"><Input id="gps" value={v.digitalAddress} onChange={set("digitalAddress")} /></Field>
        <Field label="Directions / notes" htmlFor="notes"><Input id="notes" value={v.notes} onChange={set("notes")} /></Field>
        <Field label="Latitude (optional)" htmlFor="lat" error={fe("latitude")}><Input id="lat" inputMode="decimal" value={v.latitude} onChange={set("latitude")} /></Field>
        <Field label="Longitude (optional)" htmlFor="lng" error={fe("longitude")}><Input id="lng" inputMode="decimal" value={v.longitude} onChange={set("longitude")} /></Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Acquisition (restricted)</legend>
        <Field label="Acquisition date" htmlFor="acqd"><Input id="acqd" type="date" value={v.acquisitionDate} onChange={set("acquisitionDate")} /></Field>
        {canSeeFinancials && <Field label="Acquisition cost (GH₵)" htmlFor="acqc" hint="Visible only to roles with property financials access."><Input id="acqc" inputMode="decimal" value={v.acquisitionCost} onChange={set("acquisitionCost")} /></Field>}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : v.id ? "Save changes" : "Create property"}</Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
