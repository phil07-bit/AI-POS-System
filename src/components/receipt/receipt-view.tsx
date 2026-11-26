import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { buildReceipt } from "@/server/services/payment.service";

type R = NonNullable<Awaited<ReturnType<typeof buildReceipt>>>;

/** Immutable evidence of a recorded payment. A reversed payment's receipt is shown as VOID. */
export function ReceiptView({ r }: { r: R }) {
  const p = r.payment;
  const addr = (r.organization.address ?? {}) as Record<string, string>;
  return (
    <article className="relative mx-auto max-w-xl rounded-lg border border-slate-300 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
      {p.status === "reversed" && <div className="absolute right-6 top-6 rotate-12 rounded border-4 border-red-600 px-3 py-1 text-xl font-bold text-red-600">VOID — REVERSED</div>}
      {r.organization.isDemo && <p className="mb-3 rounded bg-amber-50 px-2 py-1 text-center text-xs text-amber-900">DEMO DATA — not a real receipt</p>}
      <header className="mb-6 border-b border-slate-200 pb-4">
        <h1 className="text-lg font-bold">{r.organization.legalName ?? r.organization.name}</h1>
        <p className="text-xs text-slate-600">{[addr.community, addr.district, addr.region].filter(Boolean).join(", ")} {addr.digitalAddress ? `· ${addr.digitalAddress}` : ""}</p>
        <p className="text-xs text-slate-600">{[r.organization.phone, r.organization.email].filter(Boolean).join(" · ")}</p>
      </header>
      <div className="mb-6 flex items-end justify-between">
        <div><div className="text-xs uppercase tracking-wide text-slate-500">Official receipt</div><div className="font-mono text-lg font-semibold">{r.receiptNumber}</div></div>
        <div className="text-right text-xs text-slate-600">Issued {formatDateTime(r.issuedAt, r.organization.timezone)}</div>
      </div>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-slate-500">Received from</dt><dd>{p.payerName ?? p.tenant.displayName}{p.payerName ? ` (for ${p.tenant.displayName})` : ""}</dd>
        <dt className="text-slate-500">Tenant ref</dt><dd>{p.tenant.tenantRef}</dd>
        <dt className="text-slate-500">Property / unit</dt><dd>{p.lease?.property.name} · {p.lease?.unit.unitRef}</dd>
        <dt className="text-slate-500">Lease</dt><dd>{p.lease?.leaseRef}</dd>
        <dt className="text-slate-500">Date received</dt><dd>{formatDate(p.receivedAt)}</dd>
        <dt className="text-slate-500">Method</dt><dd className="capitalize">{p.paymentMethod.replace("_", " ")}{p.externalReference ? ` · ${p.externalReference}` : ""}</dd>
        <dt className="text-slate-500">Payment ref</dt><dd className="font-mono">{p.paymentRef}</dd>
      </dl>
      <div className="my-6 rounded-md bg-slate-50 p-4 text-center">
        <div className="text-xs uppercase tracking-wide text-slate-500">Amount received</div>
        <div className="text-3xl font-bold tabular">{formatMoney(p.amountMinor, p.currency)}</div>
      </div>
      {p.allocations.filter((a) => !a.reversedAt).length > 0 && (
        <table className="mb-4 w-full text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-1">Applied to</th><th className="py-1 text-right">Amount</th></tr></thead>
          <tbody>{p.allocations.filter((a) => !a.reversedAt).map((a) => <tr key={a.id} className="border-b border-slate-100"><td className="py-1">{a.charge.chargeRef} · {a.charge.chargeType.replace("_", " ")} {formatDate(a.charge.periodStart)} – {formatDate(a.charge.periodEnd)}</td><td className="py-1 text-right tabular">{formatMoney(a.amountMinor)}</td></tr>)}</tbody></table>
      )}
      {p.unallocatedMinor > 0 && <p className="text-sm">Held as credit / advance: <strong>{formatMoney(p.unallocatedMinor)}</strong></p>}
      <footer className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-500">
        Received by {r.receivedByName ?? "—"}{r.confirmedByName ? ` · confirmed by ${r.confirmedByName}` : ""}. This receipt records a payment received by {r.organization.name}; AI-POS does not process funds.
      </footer>
    </article>
  );
}
