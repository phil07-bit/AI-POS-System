import { orNotFound } from "@/lib/auth/page-guards";
import Link from "next/link";
import { getStaffPageContext } from "@/lib/auth/next";
import { getTenant, listTenantLeases, listTenantNotes } from "@/server/services/tenant.service";
import { getTenantLedger } from "@/server/services/ledger.service";
import { PageHeader, Card, DL, StatusBadge, ButtonLink, Stat, humanize, cx, Badge } from "@/components/ui";
import { Table, Th, Td } from "@/components/ui/table";
import { TenantForm, NoteForm, RevealId } from "@/components/forms/tenant-form";
import { ActionButton } from "@/components/forms/action-button";
import { money, date, addressLine, FREQ } from "@/components/layout/format";
import { formatMoney } from "@/lib/money";
import { formatDateTime, toISODate } from "@/lib/dates";

const TABS = ["profile", "ledger", "leases", "notes", "edit"] as const;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const ctx = await getStaffPageContext();
  const can = (k: string) => ctx.permissions.has(k);
  const tabs = TABS.filter((t) => (t === "ledger" ? can("rent.read") : t === "edit" ? can("tenant.update") : true));
  const tab = ((await searchParams).tab ?? "profile") as (typeof TABS)[number];
  const t = await orNotFound(getTenant(ctx, id));
  const ledger = can("rent.read") ? await getTenantLedger(ctx, id) : null;
  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/app/tenants", label: "Tenants" }]}
        title={<>{t.displayName} <span className="ml-1 align-middle">{t.archivedAt ? <StatusBadge status="archived" /> : <StatusBadge status={t.status} />}</span></>}
        subtitle={`${t.tenantRef} · ${humanize(t.tenantType)}`}
        actions={<>
          {can("payment.record") && ledger && ledger.leases.length > 0 && <ButtonLink href={`/app/payments/new?tenantId=${id}`}>Record payment</ButtonLink>}
          {can("lease.create") && !t.archivedAt && <ButtonLink href={`/app/leases/new?tenantId=${id}`} variant="secondary">New lease</ButtonLink>}
          {can("tenant.archive") && !t.archivedAt && <ActionButton endpoint={`/tenants/${id}/archive`} label="Archive" variant="danger" confirm={{ title: "Archive tenant?", body: "Former tenants are archived, not deleted — their ledger and leases are kept. Blocked while the tenant is on an active or draft lease." }} />}
        </>} />
      {ledger && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Outstanding charges" value={formatMoney(ledger.summary.outstanding)} />
          <Stat label="Overdue" value={formatMoney(ledger.summary.overdueMinor)} tone={ledger.summary.overdueMinor > 0 ? "red" : "green"} />
          <Stat label="Unapplied credit" value={formatMoney(ledger.summary.unappliedCredit)} sub="Advance / prepayment" />
          <Stat label="Net balance" value={formatMoney(ledger.summary.netBalance)} sub={ledger.summary.netBalance > 0 ? "Tenant owes" : ledger.summary.netBalance < 0 ? "In credit" : "Settled"} />
        </div>
      )}
      <nav aria-label="Tenant sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((x) => <Link key={x} href={`/app/tenants/${id}?tab=${x}`} aria-current={tab === x ? "page" : undefined} className={cx("-mb-px border-b-2 px-3 py-2 text-sm capitalize", tab === x ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600")}>{x}</Link>)}
      </nav>

      {tab === "profile" && (
        <Card title="Profile">
          <DL items={[
            ["Phone", t.phone], ["Email", t.email], ["Alternative phone", t.alternatePhone], ["Address", addressLine(t.address)],
            ["Privacy notice", t.privacyNoticeAcceptedAt ? `v${t.privacyNoticeVersion} acknowledged ${formatDateTime(t.privacyNoticeAcceptedAt, ctx.timezone)}` : "Not recorded"],
            ...(t.canViewSensitive ? ([
              ["ID", t.identificationType ? <span key="id">{humanize(t.identificationType)} {t.identificationMasked} {t.identificationMasked && <RevealId tenantId={id} />}</span> : "Not recorded"],
              ["Emergency contact", t.emergencyContact?.name ? `${t.emergencyContact.name} (${t.emergencyContact.relationship || "—"}) ${t.emergencyContact.phone}` : "—"],
              ["Employment / business", t.employmentInfo],
            ] as [string, React.ReactNode][]) : [["Restricted fields", "Hidden for your role"] as [string, string]]),
          ]} />
        </Card>
      )}
      {tab === "ledger" && ledger && (
        <Card title="Tenant ledger" padded={false} actions={<span className="text-xs text-slate-500">Positive balance = tenant owes · pending payments are not counted</span>}>
          {ledger.entries.length === 0 ? <p className="p-4 text-sm text-slate-500">No ledger activity yet.</p> : (
            <Table caption="Tenant ledger"><thead><tr><Th>Date</Th><Th>Reference</Th><Th>Lease</Th><Th>Description</Th><Th align="right">Debit</Th><Th align="right">Credit</Th><Th align="right">Balance</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{ledger.entries.map((e) => (
                <tr key={e.sortKey} className={cx(!e.counted && "text-slate-400", e.kind === "reversal" && "bg-red-50/40")}>
                  <Td>{date(e.date)}</Td>
                  <Td className="font-mono text-xs">{e.kind.startsWith("payment") && e.linkId ? <Link className="text-brand-700 hover:underline" href={`/app/payments/${e.linkId}`}>{e.reference}</Link> : e.reference}</Td>
                  <Td className="text-xs">{e.leaseRef}</Td>
                  <Td>{e.description} {e.kind === "payment_pending" && <Badge tone="amber">Pending</Badge>}</Td>
                  <Td align="right">{e.debitMinor ? money(e.debitMinor) : ""}</Td><Td align="right">{e.creditMinor ? money(e.creditMinor) : ""}</Td><Td align="right">{money(e.balanceMinor)}</Td>
                </tr>
              ))}</tbody></Table>
          )}
        </Card>
      )}
      {tab === "leases" && <LeasesTab />}
      {tab === "notes" && <NotesTab />}
      {tab === "edit" && can("tenant.update") && !t.archivedAt && (
        <Card title="Edit tenant">
          <TenantForm canSensitive={t.canViewSensitive} initial={{
            id: t.id, tenantType: t.tenantType, displayName: t.displayName, email: t.email ?? "", phone: t.phone ?? "", alternatePhone: t.alternatePhone ?? "",
            community: t.address?.community ?? "", district: t.address?.district ?? "", region: t.address?.region ?? "Greater Accra", digitalAddress: t.address?.digitalAddress ?? "",
            ecName: t.emergencyContact?.name ?? "", ecPhone: t.emergencyContact?.phone ?? "", ecRelationship: t.emergencyContact?.relationship ?? "",
            identificationType: t.identificationType ?? "", employmentInfo: t.employmentInfo ?? "", status: t.status, privacyNoticeAccepted: !!t.privacyNoticeAcceptedAt,
          }} />
        </Card>
      )}
    </>
  );

  async function LeasesTab() {
    const leases = can("lease.read") ? await listTenantLeases(ctx, id) : [];
    return (
      <Card title="Tenancy timeline" padded={false}>
        {leases.length === 0 ? <p className="p-4 text-sm text-slate-500">No leases.</p> : (
          <ol className="divide-y divide-slate-100">{leases.map(({ lease: l, partyRole }) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div><Link className="font-medium text-brand-700 hover:underline" href={`/app/leases/${l.id}`}>{l.leaseRef}</Link> · {l.property.name} · unit {l.unit.unitRef} <span className="text-xs text-slate-500">({humanize(partyRole)})</span>
                <div className="text-xs text-slate-500">{date(toISODate(l.startDate))} – {date(toISODate(l.endDate))} · {money(l.rentAmountMinor)} {FREQ[l.billingFrequency]}{l.terminatedAt ? ` · terminated ${date(toISODate(l.terminatedAt))}` : ""}</div></div>
              <StatusBadge status={l.status} />
            </li>
          ))}</ol>
        )}
      </Card>
    );
  }
  async function NotesTab() {
    const notes = await listTenantNotes(ctx, id);
    return (
      <Card title="Communications & notes (staff only)">
        {can("tenant.update") && <div className="mb-4"><NoteForm tenantId={id} /></div>}
        {notes.length === 0 ? <p className="text-sm text-slate-500">No notes yet.</p> : (
          <ul className="space-y-3">{notes.map((n) => <li key={n.id} className="rounded-md border border-slate-100 p-3 text-sm"><div className="mb-1 text-xs text-slate-500"><Badge>{humanize(n.kind)}</Badge> {n.authorName} · {formatDateTime(n.createdAt, ctx.timezone)}</div><p className="whitespace-pre-wrap">{n.body}</p></li>)}</ul>
        )}
      </Card>
    );
  }
}
