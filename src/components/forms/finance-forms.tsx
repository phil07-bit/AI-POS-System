"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api, newIdempotencyKey, toMinor } from "@/lib/client/api";
import { useSubmit } from "./use-submit";

type LeaseOpt = { id: string; label: string; tenantId: string };

export function PaymentForm({ leases, defaultLeaseId, today, requiresConfirmation }: { leases: LeaseOpt[]; defaultLeaseId?: string; today: string; requiresConfirmation: boolean }) {
  const router = useRouter();
  // One idempotency key per form instance: double-clicks and retries cannot create duplicates.
  const [idem] = useState(newIdempotencyKey);
  const [v, setV] = useState({ leaseId: defaultLeaseId ?? "", amount: "", paymentMethod: "mobile_money", receivedAt: today, externalReference: "", payerName: "", notes: "", allocation: "auto" });
  const { pending, error, fe, run, setError } = useSubmit();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-4" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const amountMinor = toMinor(v.amount);
      if (!amountMinor) return setError("Enter the amount received, e.g. 1500.00");
      const res = await run(() => api<{ id: string }>("/payments", { body: { ...v, amount: undefined, amountMinor, externalReference: v.externalReference || null, payerName: v.payerName || null, notes: v.notes || null }, headers: { "Idempotency-Key": idem } }));
      if (res) { router.push(`/app/payments/${res.id}`); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      {requiresConfirmation && <Alert>Organization policy: payments are saved as <strong>pending</strong> and only count as collected after an authorized user confirms them.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tenant · lease" htmlFor="p-lease" error={fe("leaseId")} required className="sm:col-span-2"><Select id="p-lease" value={v.leaseId} onChange={set("leaseId")}><option value="">Select…</option>{leases.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
        <Field label="Amount received (GH₵)" htmlFor="p-amt" error={fe("amountMinor")} required><Input id="p-amt" inputMode="decimal" value={v.amount} onChange={set("amount")} /></Field>
        <Field label="Date received" htmlFor="p-date" error={fe("receivedAt")} required><Input id="p-date" type="date" max={today} value={v.receivedAt} onChange={set("receivedAt")} /></Field>
        <Field label="Method" htmlFor="p-method"><Select id="p-method" value={v.paymentMethod} onChange={set("paymentMethod")}><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
        <Field label="External reference" htmlFor="p-ref" error={fe("externalReference")} hint="MoMo transaction ID, bank ref or cheque no. Never enter PINs or card numbers."><Input id="p-ref" autoComplete="off" value={v.externalReference} onChange={set("externalReference")} /></Field>
        <Field label="Paid by (if not the tenant)" htmlFor="p-payer"><Input id="p-payer" value={v.payerName} onChange={set("payerName")} /></Field>
        <Field label="Allocation" htmlFor="p-alloc" hint="Auto applies to the oldest unpaid charges first; any excess stays as credit."><Select id="p-alloc" value={v.allocation} onChange={set("allocation")}><option value="auto">Auto — oldest due first</option><option value="none">Leave unallocated (allocate later)</option></Select></Field>
        <Field label="Notes" htmlFor="p-notes" className="sm:col-span-2"><Textarea id="p-notes" rows={2} value={v.notes} onChange={set("notes")} /></Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record payment"}</Button>
      <p className="text-xs text-slate-500">AI-POS records money received; it does not collect or move funds. Reconcile against bank / MoMo statements manually.</p>
    </form>
  );
}

export function ManualAllocationForm({ paymentId, unallocatedMinor, openCharges }: { paymentId: string; unallocatedMinor: number; openCharges: { id: string; label: string; balanceMinor: number }[] }) {
  const router = useRouter();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const { pending, error, run, setError } = useSubmit();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const allocations = Object.entries(amounts).filter(([, a]) => a).map(([chargeId, a]) => ({ chargeId, amountMinor: toMinor(a) ?? -1 }));
      if (allocations.some((a) => a.amountMinor <= 0)) return setError("Amounts must be positive, e.g. 500.00");
      if (await run(() => api(`/payments/${paymentId}/allocate`, { body: { allocations } }))) { setAmounts({}); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm text-slate-600">Unallocated: <strong>GH₵ {(unallocatedMinor / 100).toFixed(2)}</strong>. Enter amounts against specific charges.</p>
      {openCharges.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-sm">
          <label htmlFor={`a-${c.id}`} className="flex-1">{c.label} <span className="text-slate-500">(balance GH₵ {(c.balanceMinor / 100).toFixed(2)})</span></label>
          <Input id={`a-${c.id}`} inputMode="decimal" className="max-w-32" value={amounts[c.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })} />
        </div>
      ))}
      <Button type="submit" variant="secondary" disabled={pending}>Allocate manually</Button>
    </form>
  );
}

export function ManualChargeForm({ leases, today }: { leases: { id: string; label: string }[]; today: string }) {
  const router = useRouter();
  const [v, setV] = useState({ leaseId: "", chargeType: "service_charge", periodStart: today, periodEnd: today, dueDate: today, amount: "", description: "" });
  const { pending, error, fe, run, setError } = useSubmit();
  const [ok, setOk] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault(); setOk(false);
      const amountMinor = toMinor(v.amount);
      if (!amountMinor) return setError("Enter an amount, e.g. 250.00");
      if (await run(() => api("/rent-charges", { body: { ...v, amount: undefined, amountMinor, description: v.description || null } }))) { setOk(true); setV({ ...v, amount: "", description: "" }); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      {ok && <Alert tone="success">Charge created.</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Lease" htmlFor="c-lease" error={fe("leaseId")} className="sm:col-span-2"><Select id="c-lease" value={v.leaseId} onChange={set("leaseId")}><option value="">Select…</option>{leases.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
        <Field label="Type" htmlFor="c-type"><Select id="c-type" value={v.chargeType} onChange={set("chargeType")}><option value="service_charge">Service charge</option><option value="utility">Utility</option><option value="rent">Rent (manual)</option><option value="other">Other agreed fee</option></Select></Field>
        <Field label="Period start" htmlFor="c-ps"><Input id="c-ps" type="date" value={v.periodStart} onChange={set("periodStart")} /></Field>
        <Field label="Period end" htmlFor="c-pe" error={fe("periodEnd")}><Input id="c-pe" type="date" value={v.periodEnd} onChange={set("periodEnd")} /></Field>
        <Field label="Due date" htmlFor="c-due"><Input id="c-due" type="date" value={v.dueDate} onChange={set("dueDate")} /></Field>
        <Field label="Amount (GH₵)" htmlFor="c-amt" error={fe("amountMinor")}><Input id="c-amt" inputMode="decimal" value={v.amount} onChange={set("amount")} /></Field>
        <Field label="Description" htmlFor="c-desc" className="sm:col-span-2"><Input id="c-desc" value={v.description} onChange={set("description")} placeholder="e.g. ECG prepaid top-up recharge, estate security levy" /></Field>
      </div>
      <Button type="submit" disabled={pending}>Create charge</Button>
    </form>
  );
}

export function CreditForm({ chargeId }: { chargeId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(""); const [reason, setReason] = useState("");
  const { pending, error, run, setError } = useSubmit();
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      const amountMinor = toMinor(amount);
      if (!amountMinor) return setError("Enter an amount");
      if (await run(() => api(`/rent-charges/${chargeId}/credit`, { body: { amountMinor, reason } }))) { setAmount(""); setReason(""); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Credit amount (GH₵)" htmlFor="cr-a"><Input id="cr-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Reason / approval reference" htmlFor="cr-r"><Textarea id="cr-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Button type="submit" variant="secondary" disabled={pending}>Record credit</Button>
    </form>
  );
}

export function RefundForm({ leaseId, maxMinor }: { leaseId: string; maxMinor: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(""); const [reason, setReason] = useState(""); const [reference, setReference] = useState("");
  const { pending, error, run, setError } = useSubmit();
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      const amountMinor = toMinor(amount);
      if (!amountMinor) return setError("Enter an amount");
      if (await run(() => api("/refunds", { body: { leaseId, amountMinor, reason, reference: reference || null } }))) { setAmount(""); setReason(""); router.refresh(); }
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-xs text-slate-500">Up to GH₵ {(maxMinor / 100).toFixed(2)} unapplied credit. Recording a refund does not send money.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input aria-label="Refund amount" placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input aria-label="Refund reference" placeholder="MoMo / bank ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>Record refund</Button>
    </form>
  );
}
