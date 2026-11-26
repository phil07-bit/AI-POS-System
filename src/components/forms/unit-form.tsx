"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api, toMinor } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

const UNIT_TYPES = ["apartment", "studio", "chamber_and_hall", "single_room", "self_contained", "townhouse", "detached_house", "shop", "office", "warehouse", "parking", "other"];

export interface UnitFormValue {
  id?: string; unitRef: string; unitName: string; unitType: string; building: string; block: string; floor: string;
  bedrooms: string; bathrooms: string; areaValue: string; furnishingStatus: string; askingRent: string; rentFrequency: string; availability: string; description: string;
}

export function UnitForm({ propertyId, initial, onDone }: { propertyId: string; initial?: Partial<UnitFormValue>; onDone?: () => void }) {
  const router = useRouter();
  const blank: UnitFormValue = { unitRef: "", unitName: "", unitType: "apartment", building: "", block: "", floor: "", bedrooms: "", bathrooms: "", areaValue: "", furnishingStatus: "unfurnished", askingRent: "", rentFrequency: "monthly", availability: "available", description: "" };
  const [v, setV] = useState<UnitFormValue>({ ...blank, ...initial });
  const { pending, error, fe, run, setError } = useSubmit();
  const set = (k: keyof UnitFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const int = (s: string) => (s === "" ? null : Number.parseInt(s, 10));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const rent = v.askingRent ? toMinor(v.askingRent) : null;
    if (v.askingRent && rent === null) return setError("Asking rent must be an amount like 2500 or 2500.00");
    const body = {
      unitRef: v.unitRef, unitName: v.unitName || null, unitType: v.unitType, building: v.building || null, block: v.block || null, floor: v.floor || null,
      bedrooms: int(v.bedrooms), bathrooms: int(v.bathrooms), areaValue: v.areaValue ? Number(v.areaValue) : null, furnishingStatus: v.furnishingStatus,
      askingRentMinor: rent, rentFrequency: v.rentFrequency, availability: v.availability, description: v.description || null,
    };
    const res = await run(() => api<{ id: string }>(v.id ? `/units/${v.id}` : `/properties/${propertyId}/units`, { method: v.id ? "PATCH" : "POST", body }));
    if (res) { if (!v.id) setV(blank); onDone?.(); router.refresh(); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Unit number / ref" htmlFor="u-ref" error={fe("unitRef")} required><Input id="u-ref" value={v.unitRef} onChange={set("unitRef")} placeholder="e.g. A2" /></Field>
        <Field label="Display name" htmlFor="u-name"><Input id="u-name" value={v.unitName} onChange={set("unitName")} placeholder="e.g. 2-bed flat, block A" /></Field>
        <Field label="Unit type" htmlFor="u-type"><Select id="u-type" value={v.unitType} onChange={set("unitType")}>{UNIT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</Select></Field>
        <Field label="Building" htmlFor="u-bld"><Input id="u-bld" value={v.building} onChange={set("building")} /></Field>
        <Field label="Block / wing" htmlFor="u-blk"><Input id="u-blk" value={v.block} onChange={set("block")} /></Field>
        <Field label="Floor" htmlFor="u-flr"><Input id="u-flr" value={v.floor} onChange={set("floor")} /></Field>
        <Field label="Bedrooms" htmlFor="u-bed" error={fe("bedrooms")}><Input id="u-bed" inputMode="numeric" value={v.bedrooms} onChange={set("bedrooms")} /></Field>
        <Field label="Bathrooms" htmlFor="u-bath" error={fe("bathrooms")}><Input id="u-bath" inputMode="numeric" value={v.bathrooms} onChange={set("bathrooms")} /></Field>
        <Field label="Area (m²)" htmlFor="u-area" error={fe("areaValue")}><Input id="u-area" inputMode="decimal" value={v.areaValue} onChange={set("areaValue")} /></Field>
        <Field label="Furnishing" htmlFor="u-furn"><Select id="u-furn" value={v.furnishingStatus} onChange={set("furnishingStatus")}><option value="unfurnished">Unfurnished</option><option value="semi_furnished">Semi-furnished</option><option value="furnished">Furnished</option></Select></Field>
        <Field label="Asking rent (GH₵)" htmlFor="u-rent" error={fe("askingRentMinor")}><Input id="u-rent" inputMode="decimal" value={v.askingRent} onChange={set("askingRent")} /></Field>
        <Field label="Rent frequency" htmlFor="u-freq"><Select id="u-freq" value={v.rentFrequency} onChange={set("rentFrequency")}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Half-yearly</option><option value="yearly">Yearly</option><option value="custom">Custom</option></Select></Field>
        <Field label="Availability" htmlFor="u-avail" error={fe("availability")} hint="Occupied is derived from active leases."><Select id="u-avail" value={v.availability} onChange={set("availability")}><option value="available">Available</option><option value="reserved">Reserved</option><option value="unavailable">Unavailable</option><option value="under_maintenance">Under maintenance</option></Select></Field>
        <Field label="Condition / notes" htmlFor="u-desc" className="sm:col-span-3"><Textarea id="u-desc" rows={2} value={v.description} onChange={set("description")} /></Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : v.id ? "Save unit" : "Add unit"}</Button>
    </form>
  );
}
