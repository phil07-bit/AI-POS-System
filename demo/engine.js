/*
 * AI-POS browser demo — data engine.
 * A faithful, simplified port of the real app's business rules (integer pesewas, append-only
 * payments with compensating reversals, oldest-first allocation, aging buckets, work-order
 * lifecycle, role permissions). All data is FICTIONAL and lives only in the viewer's browser.
 */
(function () {
  "use strict";

  // ───────────────────────── dates ─────────────────────────
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parse = (s) => new Date(`${s}T00:00:00Z`);
  const todayISO = () => iso(new Date()); // Africa/Accra is UTC+0 year-round
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const addMonths = (s, n) => {
    const d = parse(s); const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last)); return iso(d);
  };
  const firstOfMonth = (s) => s.slice(0, 8) + "01";
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000); // a - b
  const stamp = (dateStr, hh = 9, mm = 0) => `${dateStr}T${pad(hh)}:${pad(mm)}:00Z`;

  // ───────────────────────── roles & permissions (mirrors src/lib/permissions) ─────────────────────────
  const ALL = ["organization.settings.manage", "user.invite", "user.manage", "audit.read", "property.read", "property.create", "property.update", "property.archive", "property.financials.read", "unit.read", "unit.manage", "tenant.read", "tenant.create", "tenant.update", "tenant.archive", "tenant.sensitive.read", "lease.read", "lease.create", "lease.update", "lease.activate", "lease.terminate", "rent.read", "rent.charge.create", "rent.charge.void", "rent.adjust", "payment.record", "payment.confirm", "payment.allocate", "payment.reverse", "report.financial.read", "report.export", "maintenance.request.read", "maintenance.request.create", "maintenance.request.manage", "work_order.read", "work_order.assign", "work_order.update", "work_order.close", "maintenance.report.read", "vendor.read", "vendor.manage", "asset.read", "asset.manage", "document.read", "document.manage", "ai.insight.read", "ai.insight.generate"];
  const readOnlyOps = ["property.read", "unit.read", "lease.read", "rent.read", "report.financial.read", "maintenance.request.read", "work_order.read", "asset.read", "vendor.read", "maintenance.report.read"];
  const ROLES = {
    org_owner: { name: "Organization Owner", desc: "Full administration and data access.", perms: ALL },
    property_manager: { name: "Property Manager", desc: "Properties, tenants, leases, rent and maintenance within assigned scope.", perms: ["property.read", "property.create", "property.update", "unit.read", "unit.manage", "tenant.read", "tenant.create", "tenant.update", "tenant.archive", "tenant.sensitive.read", "lease.read", "lease.create", "lease.update", "lease.activate", "lease.terminate", "rent.read", "rent.charge.create", "payment.record", "report.financial.read", "maintenance.request.read", "maintenance.request.create", "maintenance.request.manage", "work_order.read", "work_order.assign", "work_order.update", "work_order.close", "vendor.read", "vendor.manage", "asset.read", "asset.manage", "maintenance.report.read", "document.read", "document.manage", "ai.insight.read", "ai.insight.generate"] },
    finance_officer: { name: "Finance Officer", desc: "Charges, payments, receipts, arrears and financial reports. No access to tenant ID documents.", perms: ["property.read", "property.financials.read", "unit.read", "tenant.read", "lease.read", "rent.read", "rent.charge.create", "rent.charge.void", "rent.adjust", "payment.record", "payment.confirm", "payment.allocate", "payment.reverse", "report.financial.read", "report.export", "ai.insight.read"] },
    facility_manager: { name: "Facility Manager", desc: "Assets, maintenance requests, work orders, vendors and maintenance reporting.", perms: ["property.read", "unit.read", "maintenance.request.read", "maintenance.request.create", "maintenance.request.manage", "work_order.read", "work_order.assign", "work_order.update", "work_order.close", "vendor.read", "vendor.manage", "asset.read", "asset.manage", "maintenance.report.read", "document.read", "ai.insight.read"] },
    technician: { name: "Maintenance Technician", desc: "Only the work orders assigned to them.", perms: ["property.read", "unit.read", "work_order.read", "work_order.update", "asset.read"] },
    owner_viewer: { name: "Landlord / Owner Viewer", desc: "Read-only view of their own properties and reports.", perms: [...readOnlyOps, "tenant.read"] },
    auditor: { name: "Auditor (read-only)", desc: "Read-only access including the audit log.", perms: [...readOnlyOps, "tenant.read", "audit.read"] },
    tenant_portal: { name: "Tenant (portal)", desc: "Own lease, statement, receipts and maintenance requests only.", perms: ["portal.self", "maintenance.request.create"] },
  };

  const GHS = (c) => Math.round(c * 100);
  const FREQ_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
  const FREQ_LABEL = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly" };
  const METHODS = { mobile_money: "Mobile money", bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card" };
  const MOMO_NETWORKS = { mtn: "MTN MoMo", telecel: "Telecel Cash", at: "AT Money" };

  // ───────────────────────── store ─────────────────────────
  const KEY = "aipos-demo-v2";
  let S = null;
  const listeners = [];

  function nextId(prefix) { S.seq[prefix] = (S.seq[prefix] || 0) + 1; return `${prefix}${S.seq[prefix]}`; }
  function nextRef(kind, width = 4) { S.refs[kind] = (S.refs[kind] || 0) + 1; return String(S.refs[kind]).padStart(width, "0"); }
  const byId = (arr, id) => S[arr].find((x) => x.id === id);

  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode: in-memory only */ } listeners.forEach((f) => f()); }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.version === 1 && s.seededOn === todayISO()) { S = s; return; } }
    } catch (e) { /* ignore */ }
    seed();
  }
  function reset() { seed(); save(); }

  // actor used for audit while seeding / acting
  let actor = { name: "System", role: "system", userId: null };
  function setActor(u) { actor = u ? { name: u.name, role: u.role, userId: u.id } : { name: "System", role: "system", userId: null }; }
  function audit(action, entity, ref, detail, at) {
    S.audit.unshift({ id: nextId("ev"), at: at || new Date().toISOString(), actor: actor.name, role: actor.role, action, entity, ref, detail: detail || "" });
  }

  // ───────────────────────── rent engine ─────────────────────────
  function chargePaid(chargeId) {
    let t = 0;
    for (const p of S.payments) if (p.status === "confirmed") for (const a of p.alloc) if (a.chargeId === chargeId) t += a.amount;
    return t;
  }
  function chargeOutstanding(c) { return c.status === "void" ? 0 : Math.max(0, c.amount - chargePaid(c.id)); }
  function chargeStatus(c) {
    if (c.status === "void") return "void";
    const paid = chargePaid(c.id);
    if (paid >= c.amount) return "paid";
    if (paid > 0) return "partially_paid";
    return c.due < S.today ? "overdue" : "unpaid";
  }
  function unapplied(p) { return p.status === "confirmed" ? p.amount - p.alloc.reduce((s, a) => s + a.amount, 0) : 0; }

  /** Allocate a confirmed payment's free balance to the lease's open charges, oldest due first. */
  function autoAllocate(p) {
    let free = unapplied(p);
    if (free <= 0) return;
    const open = S.charges.filter((c) => c.leaseId === p.leaseId && c.status !== "void").sort((a, b) => a.due.localeCompare(b.due));
    for (const c of open) {
      if (free <= 0) break;
      const out = chargeOutstanding(c);
      if (out <= 0) continue;
      const amt = Math.min(out, free);
      const ex = p.alloc.find((a) => a.chargeId === c.id);
      if (ex) ex.amount += amt; else p.alloc.push({ chargeId: c.id, amount: amt });
      free -= amt;
    }
  }
  /** After new charges exist, apply any unapplied credit (prepayments) on that lease. */
  function applyCredits(leaseId) {
    S.payments.filter((p) => p.leaseId === leaseId && p.status === "confirmed" && unapplied(p) > 0)
      .sort((a, b) => a.received.localeCompare(b.received)).forEach(autoAllocate);
  }

  function periodStarts(l, until) {
    const step = FREQ_MONTHS[l.freq]; const out = [];
    for (let s = l.start, i = 0; s <= until && s <= l.end && i < 200; i++, s = addMonths(l.start, step * i)) out.push(s);
    return out;
  }
  /** Generate rent charges for every billing period that has started up to `asOf` (idempotent). */
  function generateCharges(l, asOf) {
    if (!["active", "terminated", "expired"].includes(l.status)) return 0;
    const step = FREQ_MONTHS[l.freq];
    const limit = l.status === "terminated" ? addDays(l.terminatedOn, -1) : asOf;
    let n = 0;
    for (const ps of periodStarts(l, limit)) {
      if (S.charges.some((c) => c.leaseId === l.id && c.type === "rent" && c.periodStart === ps)) continue;
      const pe = addDays(addMonths(ps, step), -1);
      S.charges.push({ id: nextId("c"), ref: `CHG-${nextRef("chg", 5)}`, leaseId: l.id, type: "rent", periodStart: ps, periodEnd: pe < l.end ? pe : l.end, due: addDays(ps, (l.dueDay || 1) - 1), amount: l.rent, status: "open", desc: `${FREQ_LABEL[l.freq]} rent` });
      n++;
    }
    if (n) applyCredits(l.id);
    return n;
  }

  function leaseBalance(leaseId) {
    const charges = S.charges.filter((c) => c.leaseId === leaseId && c.status !== "void");
    const billed = charges.reduce((s, c) => s + c.amount, 0);
    const paidConfirmed = S.payments.filter((p) => p.leaseId === leaseId && p.status === "confirmed").reduce((s, p) => s + p.amount, 0);
    const overdue = charges.filter((c) => c.due <= S.today).reduce((s, c) => s + chargeOutstanding(c), 0);
    const credit = S.payments.filter((p) => p.leaseId === leaseId).reduce((s, p) => s + unapplied(p), 0);
    return { billed, paid: paidConfirmed, overdue, credit, balance: billed - paidConfirmed };
  }

  /** Statement: chronological ledger lines with a running balance (charges debit, payments credit, reversals re-debit). */
  function ledger(leaseId) {
    const lines = [];
    for (const c of S.charges.filter((c) => c.leaseId === leaseId)) {
      lines.push({ date: c.due, kind: "charge", ref: c.ref, desc: `${c.desc} ${fmtPeriod(c)}`, debit: c.amount, credit: 0, voided: c.status === "void" });
      if (c.status === "void") lines.push({ date: c.voidedOn, kind: "void", ref: c.ref, desc: `Charge voided: ${c.voidReason}`, debit: 0, credit: c.amount });
    }
    for (const p of S.payments.filter((p) => p.leaseId === leaseId)) {
      if (p.status === "pending") continue;
      lines.push({ date: p.received, kind: "payment", ref: p.receiptNo || p.ref, desc: `Payment — ${methodLabel(p)}${p.extRef ? ` (${p.extRef})` : ""}`, debit: 0, credit: p.amount });
      if (p.status === "reversed") lines.push({ date: p.reversedOn, kind: "reversal", ref: p.ref, desc: `Reversal: ${p.reverseReason}`, debit: p.amount, credit: 0 });
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "charge" ? -1 : 1));
    let bal = 0; for (const l of lines) { bal += l.debit - l.credit; l.balance = bal; }
    return lines;
  }
  function fmtPeriod(c) {
    const m = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
    const a = m(c.periodStart), b = m(c.periodEnd);
    return a === b ? `(${a})` : `(${a} – ${b})`;
  }
  function methodLabel(p) { return p.method === "mobile_money" && p.network ? MOMO_NETWORKS[p.network] : METHODS[p.method]; }

  const BUCKETS = ["0–30", "31–60", "61–90", "90+"];
  function bucketOf(days) { return days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3; }
  /** Arrears aging per lease, by days past due of each outstanding charge. */
  function arrears(propertyFilter) {
    const rows = [];
    for (const l of S.leases) {
      if (!["active", "terminated", "expired"].includes(l.status)) continue;
      const u = byId("units", l.unitId);
      if (propertyFilter && !propertyFilter(u.propertyId)) continue;
      const b = [0, 0, 0, 0]; let oldest = 0;
      for (const c of S.charges.filter((c) => c.leaseId === l.id && c.due <= S.today)) {
        const out = chargeOutstanding(c); if (!out) continue;
        const d = diffDays(S.today, c.due); b[bucketOf(d)] += out; oldest = Math.max(oldest, d);
      }
      const total = b.reduce((s, x) => s + x, 0);
      if (total > 0) rows.push({ lease: l, unit: u, buckets: b, total, oldest });
    }
    return rows.sort((a, b) => b.total - a.total);
  }

  // ───────────────────────── payment actions ─────────────────────────
  function recordPayment(input) {
    const l = byId("leases", input.leaseId); if (!l) throw new Error("Lease not found");
    if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
    if (input.extRef && S.payments.some((p) => p.extRef && p.extRef === input.extRef && p.status !== "reversed"))
      throw new Error(`A payment with reference ${input.extRef} is already recorded (duplicate protection).`);
    const p = { id: nextId("p"), ref: `PAY-${nextRef("pay", 5)}`, leaseId: l.id, amount: input.amount, method: input.method, network: input.network || null, received: input.received, extRef: input.extRef || null, payer: input.payer || null, status: "pending", alloc: [], receiptNo: null, recordedBy: actor.name, recordedAt: input.at || new Date().toISOString() };
    S.payments.push(p);
    audit("payment.recorded", "Payment", p.ref, `${money(p.amount)} via ${methodLabel(p)} for lease ${l.ref}`, input.at);
    if (input.confirm) confirmPayment(p.id, input.at);
    return p;
  }
  function confirmPayment(id, at) {
    const p = byId("payments", id); if (p.status !== "pending") throw new Error("Only pending payments can be confirmed");
    p.status = "confirmed"; p.confirmedBy = actor.name; p.confirmedAt = at || new Date().toISOString();
    p.receiptNo = `RCT-${p.received.slice(0, 4)}-${nextRef("rct", 5)}`;
    autoAllocate(p);
    audit("payment.confirmed", "Payment", p.ref, `Receipt ${p.receiptNo} issued; allocated oldest charge first`, at);
    return p;
  }
  function reversePayment(id, reason, on) {
    const p = byId("payments", id); if (p.status !== "confirmed") throw new Error("Only confirmed payments can be reversed");
    if (!reason || reason.trim().length < 5) throw new Error("A reversal reason is required");
    p.status = "reversed"; p.reverseReason = reason.trim(); p.reversedOn = on || S.today; p.reversedBy = actor.name; p.alloc = [];
    audit("payment.reversed", "Payment", p.ref, `Compensating reversal of ${money(p.amount)}: ${p.reverseReason}`);
    // charges previously covered are uncovered again; let remaining credits re-flow
    applyCredits(p.leaseId);
    return p;
  }
  function voidCharge(id, reason) {
    const c = byId("charges", id); if (chargePaid(c.id) > 0) throw new Error("Charges with payments allocated cannot be voided");
    c.status = "void"; c.voidReason = reason; c.voidedOn = S.today;
    audit("charge.voided", "RentCharge", c.ref, reason);
  }
  function runBilling() {
    let n = 0; for (const l of S.leases) n += generateCharges(l, S.today);
    audit("job.rent_charges", "Job", "generate-charges", `${n} new charge(s) created`);
    return n;
  }

  // ───────────────────────── lease actions ─────────────────────────
  function createLease(input) {
    const unit = byId("units", input.unitId);
    if (S.leases.some((l) => l.unitId === unit.id && ["active", "pending_signature"].includes(l.status) && l.start <= input.end && l.end >= input.start && !input.renewalOf))
      throw new Error(`Unit ${unit.ref} already has an overlapping active or pending lease.`);
    const l = { id: nextId("l"), ref: `LSE-${(input.start || S.today).slice(0, 4)}-${nextRef("lse")}`, unitId: unit.id, tenantIds: input.tenantIds, start: input.start, end: input.end, rent: input.rent, freq: input.freq, dueDay: input.dueDay || 1, deposit: input.deposit || 0, depositStatus: input.deposit ? "pending" : "none", grace: input.grace ?? 5, notice: input.notice ?? 60, status: "draft", renewalOf: input.renewalOf || null, createdAt: input.at || new Date().toISOString() };
    S.leases.push(l);
    audit("lease.created", "Lease", l.ref, `Draft lease for unit ${unit.ref} at ${money(l.rent)} ${FREQ_LABEL[l.freq].toLowerCase()}`, input.at);
    return l;
  }
  function markPending(id, at) { const l = byId("leases", id); l.status = "pending_signature"; audit("lease.pending_signature", "Lease", l.ref, "Sent for signature", at); }
  function activateLease(id, at) {
    const l = byId("leases", id); if (!["draft", "pending_signature"].includes(l.status)) throw new Error("Only draft or pending leases can be activated");
    const clash = S.leases.find((x) => x.id !== l.id && x.unitId === l.unitId && x.status === "active" && x.start <= l.end && x.end >= l.start);
    if (clash) throw new Error(`Unit already has active lease ${clash.ref} for overlapping dates.`);
    l.status = "active"; l.activatedAt = at || new Date().toISOString();
    l.tenantIds.forEach((t) => { const tn = byId("tenants", t); if (tn.status === "prospective") tn.status = "active"; });
    audit("lease.activated", "Lease", l.ref, "Lease approved and activated", at);
    generateCharges(l, S.today);
  }
  function terminateLease(id, on, reason, at) {
    const l = byId("leases", id); if (l.status !== "active") throw new Error("Only active leases can be terminated");
    l.status = "terminated"; l.terminatedOn = on; l.terminationReason = reason;
    let voided = 0;
    for (const c of S.charges.filter((c) => c.leaseId === l.id && c.periodStart >= on && c.status !== "void")) {
      if (chargePaid(c.id) === 0) { c.status = "void"; c.voidReason = "Lease terminated"; c.voidedOn = on; voided++; }
    }
    audit("lease.terminated", "Lease", l.ref, `${reason}. ${voided} future charge(s) voided`, at);
  }

  // ───────────────────────── maintenance ─────────────────────────
  const WO_FLOW = { assigned: ["in_progress", "cancelled"], in_progress: ["waiting_for_parts", "completed"], waiting_for_parts: ["in_progress"], completed: ["closed"], closed: [], cancelled: [] };
  function createRequest(input) {
    const r = { id: nextId("mr"), ref: `MR-${nextRef("mr")}`, propertyId: input.propertyId, unitId: input.unitId || null, tenantId: input.tenantId || null, assetId: input.assetId || null, category: input.category, priority: input.priority || "normal", title: input.title, description: input.description, status: "submitted", source: input.source || "staff", submittedAt: input.at || new Date().toISOString(), updates: [], workOrderId: null };
    S.requests.push(r);
    audit("maintenance_request.submitted", "MaintenanceRequest", r.ref, `${r.priority} · ${r.title}`, input.at);
    if (r.priority === "emergency") outbox("email", "Facility team", `EMERGENCY ${r.ref}: ${r.title}`, `Emergency request at ${propName(r.propertyId)}${r.unitId ? " unit " + byId("units", r.unitId).ref : ""}. Respond immediately.`, input.at);
    return r;
  }
  function requestAction(id, action, note, at) {
    const r = byId("requests", id);
    const allowed = { triage: ["submitted"], approve: ["submitted", "triaged"], reject: ["submitted", "triaged"], close: ["approved", "in_progress", "completed"] };
    if (!allowed[action].includes(r.status)) throw new Error(`Cannot ${action} a request that is ${r.status}`);
    r.status = { triage: "triaged", approve: "approved", reject: "rejected", close: "closed" }[action];
    if (note) r.updates.push({ at: at || new Date().toISOString(), by: actor.name, body: note, visibility: action === "reject" || action === "close" ? "tenant" : "internal" });
    if (action === "reject") r.rejectReason = note;
    if (action === "close") r.closedAt = at || new Date().toISOString();
    audit(`maintenance_request.${r.status}`, "MaintenanceRequest", r.ref, note || "", at);
  }
  function createWorkOrder(input) {
    const w = { id: nextId("wo"), ref: `WO-${nextRef("wo")}`, propertyId: input.propertyId, unitId: input.unitId || null, assetId: input.assetId || null, requestId: input.requestId || null, planId: input.planId || null, category: input.category, priority: input.priority || "normal", scope: input.scope, vendorId: input.vendorId || null, assigneeId: input.assigneeId || null, dueAt: input.dueAt || null, status: "assigned", createdAt: input.at || new Date().toISOString(), labour: 0, materials: 0, vendorCost: 0, checklist: (input.checklist || []).map((x) => typeof x === "string" ? { item: x, done: false } : x), log: [], completionNotes: "", purchaseRef: "" };
    S.workOrders.push(w);
    if (w.requestId) { const r = byId("requests", w.requestId); r.workOrderId = w.id; r.status = "in_progress"; }
    audit("work_order.created", "WorkOrder", w.ref, `Assigned to ${w.vendorId ? byId("vendors", w.vendorId).name : userName(w.assigneeId)}`, input.at);
    return w;
  }
  function woTransition(id, to, extra = {}, at) {
    const w = byId("workOrders", id);
    if (!WO_FLOW[w.status].includes(to)) throw new Error(`Cannot move from ${w.status} to ${to}`);
    if (to === "completed" && !(extra.completionNotes || "").trim()) throw new Error("Completion notes are required");
    Object.assign(w, extra); w.status = to;
    const t = at || new Date().toISOString();
    if (to === "in_progress" && !w.startedAt) w.startedAt = t;
    if (to === "completed") w.completedAt = t;
    if (to === "closed") w.closedAt = t;
    w.log.push({ at: t, by: actor.name, to, note: extra.note || "" });
    if (w.requestId) { const r = byId("requests", w.requestId); if (to === "completed") { r.status = "completed"; r.completedAt = t; } }
    if (w.planId && to === "completed") { const p = byId("plans", w.planId); p.lastDoneAt = t.slice(0, 10); p.nextDueAt = addDays(t.slice(0, 10), p.intervalDays); const a = byId("assets", p.assetId); a.lastServicedAt = t.slice(0, 10); }
    audit(`work_order.${to}`, "WorkOrder", w.ref, extra.note || extra.completionNotes || "", at);
  }
  const woCost = (w) => w.labour + w.materials + w.vendorCost;
  function planStatus(p) { const d = diffDays(p.nextDueAt, S.today); return d < 0 ? "overdue" : d <= p.leadDays ? "due_soon" : "scheduled"; }
  function generatePM(at) {
    let n = 0;
    for (const p of S.plans) {
      if (planStatus(p) === "scheduled") continue;
      if (S.workOrders.some((w) => w.planId === p.id && !["completed", "closed", "cancelled"].includes(w.status))) continue;
      const a = byId("assets", p.assetId);
      createWorkOrder({ propertyId: a.propertyId, unitId: a.unitId, assetId: a.id, planId: p.id, category: "preventive", priority: planStatus(p) === "overdue" ? "high" : "normal", scope: `${p.name} — ${a.name}`, vendorId: p.vendorId, assigneeId: p.assigneeId, dueAt: p.nextDueAt, checklist: p.checklist, at });
      n++;
    }
    audit("job.generate_pm", "Job", "generate-pm", `${n} preventive work order(s) created`, at);
    return n;
  }

  function outbox(channel, to, subject, body, at) { S.outbox.unshift({ id: nextId("ob"), at: at || new Date().toISOString(), channel, to, subject, body, provider: "mock" }); }
  function sendReminder(leaseId) {
    const l = byId("leases", leaseId); const t = byId("tenants", l.tenantIds[0]); const b = leaseBalance(l.id);
    const unit = byId("units", l.unitId);
    outbox("email", `${t.name} <${t.email || "no email on file"}>`, `Rent reminder — ${unit.ref}, ${propName(unit.propertyId)}`, `Dear ${t.name.split(" ")[0]}, our records show ${money(b.overdue)} outstanding on lease ${l.ref}. Kindly pay by mobile money or bank transfer quoting ${l.ref}. Ignore this message if you have already paid. — ${S.org.name}`);
    audit("notification.queued", "Lease", l.ref, `Arrears reminder (mock email) to ${t.name}`);
  }

  // ───────────────────────── helpers ─────────────────────────
  function money(m) { const neg = m < 0; const v = Math.abs(m) / 100; return `${neg ? "−" : ""}GH₵ ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  const propName = (id) => (byId("properties", id) || {}).name || "—";
  const userName = (id) => (S.users.find((u) => u.id === id) || {}).name || "Unassigned";
  function unitLease(unitId) { return S.leases.find((l) => l.unitId === unitId && l.status === "active"); }
  function unitOccupancy(u) {
    if (u.availability === "under_maintenance") return "under_maintenance";
    if (unitLease(u.id)) return "occupied";
    if (u.availability === "reserved" || S.leases.some((l) => l.unitId === u.id && l.status === "pending_signature")) return "reserved";
    return "vacant";
  }

  // ───────────────────────── seed ─────────────────────────
  function seed() {
    const today = todayISO();
    const thisMonth = firstOfMonth(today);
    const m = (n) => addMonths(thisMonth, n);
    const d = (n) => addDays(today, n);
    S = { version: 1, seededOn: today, today, seq: {}, refs: {}, users: [], properties: [], units: [], tenants: [], leases: [], charges: [], payments: [], notes: [], requests: [], workOrders: [], vendors: [], assets: [], plans: [], audit: [], outbox: [] };
    S.org = { name: "Caxaze Property Solutions", legal: "Caxaze Property Solutions Ltd (DEMO)", phone: "+233 30 200 0100", email: "hello@caxaze.demo", address: "Off Lagos Avenue, East Legon, Accra · GA-492-7710", currency: "GHS", tz: "Africa/Accra" };

    const user = (id, name, email, role, scope = null, tenantId = null) => S.users.push({ id, name, email, role, scope, tenantId });
    user("u_owner", "Akosua Caxaze", "owner@caxaze.demo", "org_owner");
    user("u_mgr", "Kwame Asiedu", "manager@caxaze.demo", "property_manager");
    user("u_fin", "Efua Mensah", "finance@caxaze.demo", "finance_officer");
    user("u_fm", "Yaw Boateng", "facility@caxaze.demo", "facility_manager");
    user("u_tech", "Kojo Amponsah", "tech@caxaze.demo", "technician");
    user("u_aud", "Adjoa Sarpong", "auditor@caxaze.demo", "auditor");
    const U = Object.fromEntries(S.users.map((u) => [u.id, u]));
    const as = (id) => setActor(U[id]);
    const at = (dateStr, h = 9) => stamp(dateStr, h, Math.floor(Math.random() * 59));

    as("u_owner");
    const prop = (id, o) => { S.properties.push({ id, status: "active", ...o }); audit("property.created", "Property", o.ref, o.name, at(m(-15))); };
    prop("p_ahr", { ref: "AHR", name: "Airport Hills Residences", type: "residential", community: "Airport Residential Area", district: "La Dade-Kotopon Municipal", region: "Greater Accra", gps: "GL-089-1234", landmark: "Behind the Airport Police Station", owner: "Caxaze Holdings (Demo)", managerId: "u_mgr", desc: "Gated block of 2- and 3-bedroom apartments with standby generator and borehole.", acquisitionCost: GHS(4800000) });
    prop("p_srp", { ref: "SRP", name: "Spintex Road Commercial Plaza", type: "commercial", community: "Spintex", district: "Ledzokuku Municipal", region: "Greater Accra", gps: "GT-021-5567", landmark: "Opposite the Coca-Cola roundabout", owner: "Spintex Plaza Partners (Demo)", managerId: "u_mgr", desc: "Two-storey roadside plaza: ground-floor shops, first-floor offices." });
    prop("p_adh", { ref: "ADH", name: "Adum Heights", type: "mixed_use", community: "Adum", district: "Kumasi Metropolitan", region: "Ashanti", gps: "AK-039-5521", landmark: "Near Kejetia market", owner: "Nana Owusu Estate (Demo)", managerId: "u_kmgr", desc: "Mixed residential compound in central Kumasi: chamber-and-hall, single rooms and self-contained units." });
    user("u_kmgr", "Ama Pokuaa", "kumasi.manager@caxaze.demo", "property_manager", ["p_adh"]);
    user("u_land", "Nana Owusu", "landlord@caxaze.demo", "owner_viewer", ["p_adh"]);

    const UN = {};
    const unit = (pid, ref, type, rent, x = {}) => { const id = `un_${ref}`; UN[ref] = id; S.units.push({ id, propertyId: pid, ref, type, asking: GHS(rent), bedrooms: null, bathrooms: null, floor: "", area: null, availability: "available", furnishing: "unfurnished", note: "", ...x }); };
    unit("p_ahr", "A1", "Apartment", 3500, { bedrooms: 2, bathrooms: 2, floor: "Ground", area: 95, furnishing: "semi-furnished" });
    unit("p_ahr", "A2", "Apartment", 3500, { bedrooms: 2, bathrooms: 2, floor: "1st" });
    unit("p_ahr", "A3", "Apartment", 4200, { bedrooms: 3, bathrooms: 3, floor: "1st", area: 130 });
    unit("p_ahr", "A4", "Apartment", 3500, { bedrooms: 2, bathrooms: 2, floor: "2nd" });
    unit("p_ahr", "A5", "Apartment", 4500, { bedrooms: 3, bathrooms: 3, floor: "2nd", furnishing: "furnished" });
    unit("p_ahr", "A6", "Apartment", 3200, { bedrooms: 2, bathrooms: 1, floor: "Ground", availability: "under_maintenance", note: "Ceiling repair after roof leak" });
    unit("p_srp", "S01", "Shop", 8000, { floor: "Ground", area: 60 });
    unit("p_srp", "S02", "Shop", 4500, { floor: "Ground", area: 40 });
    unit("p_srp", "S03", "Office", 6500, { floor: "1st", area: 75 });
    unit("p_srp", "S04", "Office", 6000, { floor: "1st", area: 70 });
    unit("p_srp", "S05", "Shop", 5000, { floor: "Ground", area: 45, availability: "reserved", note: "Held for a prospective pharmacy" });
    unit("p_srp", "S06", "Warehouse", 9000, { floor: "Rear yard", area: 200 });
    unit("p_adh", "K1", "Chamber & hall", 1200, { bedrooms: 1, bathrooms: 1 });
    unit("p_adh", "K2", "Single room", 650, { bedrooms: 1, bathrooms: 0, note: "Shared bathroom" });
    unit("p_adh", "K3", "Self-contained", 1800, { bedrooms: 1, bathrooms: 1 });
    unit("p_adh", "K4", "Self-contained", 1800, { bedrooms: 1, bathrooms: 1 });
    unit("p_adh", "K5", "Chamber & hall", 1300, { bedrooms: 1, bathrooms: 1 });

    as("u_mgr");
    const T = {};
    const tenant = (key, o) => { const id = `t_${key}`; T[key] = id; S.tenants.push({ id, type: "individual", status: "active", email: null, idType: null, idRef: null, emergency: null, ...o }); audit("tenant.created", "Tenant", o.name, "", at(m(-15))); };
    tenant("ama", { name: "Ama Owusu-Ansah", phone: "024 000 0101", email: "ama.oa@example.com", idType: "Ghana Card", idRef: "GHA-700000101-1", emergency: "Kwesi Owusu-Ansah (brother) · 024 000 0901" });
    tenant("kofi", { name: "Kofi Mensah-Bonsu", phone: "020 000 0102", email: "kofi.mb@example.com", idType: "Passport", idRef: "G0000102" });
    tenant("esi", { name: "Esi Quaye", phone: "055 000 0103", email: "esi.quaye@example.com", idType: "Ghana Card", idRef: "GHA-700000103-3" });
    tenant("kojo", { name: "Kojo Quaye", phone: "055 000 0104" });
    tenant("yaw", { name: "Yaw Darko-Asamoah", phone: "027 000 0105", email: "yaw.da@example.com" });
    tenant("kente", { type: "organization", name: "Kente Republic Ltd", phone: "030 200 0106", email: "accounts@kenterepublic.example" });
    tenant("asaase", { type: "organization", name: "Asaase Pharmacy Enterprise", phone: "024 000 0107", email: "asaase.pharm@example.com" });
    tenant("volta", { type: "organization", name: "Volta Tech Hub Ltd", phone: "050 000 0108", email: "finance@voltatech.example" });
    tenant("abena", { name: "Abena Serwaa Boateng", phone: "024 000 0109", email: "tenant@caxaze.demo", idType: "Ghana Card", idRef: "GHA-700000109-9" });
    tenant("kwabena", { name: "Kwabena Ofori Jnr", phone: "026 000 0110" });
    tenant("adwoa", { name: "Adwoa Pokuaa", phone: "024 000 0111" });
    tenant("nana", { name: "Nana Akua Frimpong", phone: "020 000 0112", status: "prospective" });
    user("u_tenant", "Abena Serwaa Boateng", "tenant@caxaze.demo", "tenant_portal", null, T.abena);

    const L = {};
    const lease = (key, unitRef, tenants, start, end, rent, freq, x = {}) => {
      const l = createLease({ unitId: UN[unitRef], tenantIds: tenants.map((t) => T[t]), start, end, rent: GHS(rent), freq, deposit: x.deposit ? GHS(x.deposit) : 0, dueDay: x.dueDay, at: at(addDays(start, -10)) });
      if (x.deposit) l.depositStatus = x.depositStatus || "held";
      L[key] = l.id; return l;
    };
    const act = (k) => activateLease(L[k], at(byId("leases", L[k]).start, 8));
    lease("ama", "A1", ["ama"], m(-10), d(35), 3500, "monthly", { deposit: 7000 }); act("ama");
    lease("kofi", "A2", ["kofi"], m(-8), addDays(m(16), -1), 42000, "yearly", { deposit: 7000 }); act("kofi");
    lease("esi", "A3", ["esi", "kojo"], m(-11), addDays(m(7), -1), 4200, "monthly", { deposit: 8400 }); act("esi");
    lease("yaw", "A4", ["yaw"], m(-5), addDays(m(7), -1), 10500, "quarterly", { dueDay: 5 }); act("yaw");
    lease("kente", "S01", ["kente"], m(-14), addDays(m(10), -1), 8000, "monthly", { deposit: 16000 }); act("kente");
    lease("asaase", "S02", ["asaase"], m(-10), addDays(m(14), -1), 27000, "half_yearly"); act("asaase");
    lease("volta", "S03", ["volta"], m(-1), addDays(m(11), -1), 6500, "monthly"); act("volta");
    lease("abena", "K1", ["abena"], addDays(m(-11), 14), d(18), 1200, "monthly"); act("abena");
    lease("kwabena", "K2", ["kwabena"], m(-9), d(66), 650, "monthly"); act("kwabena");
    lease("adwoa", "K3", ["adwoa"], m(-12), addDays(m(1), -1), 1800, "monthly"); act("adwoa");
    lease("nana", "K4", ["nana"], m(1), addDays(m(13), -1), 1800, "monthly", { deposit: 3600, depositStatus: "pending" }); markPending(L.nana, at(d(-5)));

    as("u_fin");
    const momo = () => `${Math.floor(10000000000 + Math.random() * 89999999999)}`;
    const pay = (k, amount, received, method, extRef, o = {}) => recordPayment({ leaseId: L[k], amount: GHS(amount), received, method, network: method === "mobile_money" ? (o.network || "mtn") : null, extRef, payer: o.payer, confirm: o.confirm !== false, at: at(received, 11) });
    const ch = (k) => S.charges.filter((c) => c.leaseId === L[k]).sort((a, b) => a.due.localeCompare(b.due));

    ch("ama").filter((c) => c.due < thisMonth).forEach((c) => pay("ama", c.amount / 100, addDays(c.due, 2), "mobile_money", momo()));
    pay("kofi", 42000, addDays(m(-8), 1), "bank_transfer", "GCB-TRF-DEMO-55120");
    ch("esi").filter((c) => c.due < m(-3)).forEach((c, i) => pay("esi", 4200, addDays(c.due, 1), "bank_transfer", `ECO-DEMO-${1100 + i}`));
    pay("esi", 2000, addDays(m(-3), 9), "mobile_money", momo(), { payer: "Kojo Quaye", network: "telecel" });
    pay("yaw", 10500, addDays(m(-5), 3), "cheque", "CHQ 000451");
    pay("yaw", 6000, addDays(m(-2), 8), "cash", null);
    ch("kente").filter((c) => c.due < m(-1)).forEach((c, i) => pay("kente", 8000, addDays(c.due, 3), "bank_transfer", `CAL-DEMO-${2200 + i}`));
    pay("asaase", 27000, addDays(m(-10), 5), "bank_transfer", "STANBIC-DEMO-8812");
    pay("volta", 26000, addDays(m(-1), 1), "bank_transfer", "ABSA-DEMO-3301");
    ch("abena").filter((c) => c.due <= today).forEach((c) => pay("abena", 1200, addDays(c.due, 1), "mobile_money", momo()));
    const dup = pay("abena", 1200, d(-6), "mobile_money", "MP-DUPLICATE-DEMO");
    reversePayment(dup.id, "Duplicate entry — the same MoMo transfer was recorded twice", d(-5));
    ch("kwabena").filter((c) => c.due < m(-1)).forEach((c) => pay("kwabena", 650, addDays(c.due, 4), "cash", null));
    ch("adwoa").filter((c) => c.due <= d(-40)).forEach((c) => pay("adwoa", 1800, addDays(c.due, 2), "mobile_money", momo(), { network: "at" }));
    as("u_mgr"); terminateLease(L.adwoa, d(-40), "Tenant relocated to Takoradi for work", at(d(-40)));
    // Recent MoMo payment awaiting finance confirmation (not yet counted)
    as("u_mgr"); pay("kente", 8000, d(-2), "mobile_money", momo(), { confirm: false });
    // Service charge
    as("u_fin");
    S.charges.push({ id: nextId("c"), ref: `CHG-${nextRef("chg", 5)}`, leaseId: L.kente, type: "service_charge", periodStart: thisMonth, periodEnd: addDays(m(1), -1), due: addDays(thisMonth, 9), amount: GHS(450), status: "open", desc: "Service charge — security, cleaning & waste levy" });
    audit("charge.created", "RentCharge", "Service charge", "Plaza security, cleaning and waste levy for Kente Republic", at(thisMonth));
    // Renewal draft for Abena
    as("u_mgr");
    const ab = byId("leases", L.abena);
    createLease({ unitId: UN.K1, tenantIds: [T.abena], start: addDays(ab.end, 1), end: addDays(addMonths(addDays(ab.end, 1), 12), -1), rent: GHS(1350), freq: "monthly", renewalOf: ab.id, at: at(d(-3)) });

    const note = (t, kind, body, on) => S.notes.push({ id: nextId("n"), tenantId: T[t], kind, body, by: "Kwame Asiedu", at: at(on) });
    note("esi", "Call", "Called about the arrears. Tenant says salary delayed; promised part-payment by month end.", d(-6));
    note("asaase", "Visit", "Visited shop S02. Owner requested a payment plan for the second half-year rent. Escalated to finance.", d(-12));
    note("ama", "Note", "Lease ends soon — tenant interested in renewal at current rent.", d(-4));

    seedFacilities({ d, at, as, UN, T });

    S.audit.sort((a, b) => b.at.localeCompare(a.at));
    setActor(null);
  }

  function seedFacilities({ d, at, as, UN, T }) {
    as("u_fm");
    const V = {};
    const vendor = (k, o) => { V[k] = `v_${k}`; S.vendors.push({ id: V[k], status: "active", ...o }); audit("vendor.created", "Vendor", o.name, "", at(d(-200))); };
    vendor("plumb", { name: "Tema Plumbing & Borehole Services", contact: "Emmanuel Tetteh", phone: "024 410 0201", categories: ["plumbing", "grounds"], area: "Tema Community 4", notes: "Reliable on borehole pumps. Usually same-day for Accra sites." });
    vendor("elec", { name: "Kasoa Electricals & Generators", contact: "Abdul-Rahman Issah", phone: "027 710 0202", categories: ["electrical", "generator"], area: "Kasoa", notes: "Authorised generator service agent (demo)." });
    vendor("ac", { name: "CoolBreeze Air-Con Services", contact: "Akua Mensah", phone: "020 910 0203", categories: ["hvac", "appliance"], area: "Spintex" });
    vendor("pest", { name: "Kumasi Pest Control Ltd", contact: "Osei Kwaku", phone: "032 210 0204", categories: ["pest control", "cleaning"], area: "Kumasi", status: "inactive", notes: "Contract paused after missed visits (demo)." });

    const A = {};
    const asset = (k, o) => { A[k] = `a_${k}`; S.assets.push({ id: A[k], unitId: null, status: "active", ...o }); };
    asset("gen", { propertyId: "p_ahr", name: "Standby generator 100kVA", category: "Generator", location: "Generator house, rear yard", make: "Perkins 1104A-44TG2", criticality: "critical", condition: "good", lastServicedAt: d(-85) });
    asset("bore", { propertyId: "p_ahr", name: "Borehole submersible pump", category: "Borehole", location: "Near gate 2", make: "Grundfos SP 5A-12", criticality: "high", condition: "fair", lastServicedAt: d(-40) });
    asset("tank", { propertyId: "p_ahr", name: "Polytank storage & treatment", category: "Water system", location: "Roof, block A", criticality: "medium", condition: "good", lastServicedAt: d(-60) });
    asset("fire", { propertyId: "p_ahr", name: "Fire extinguishers (12) & hose reels", category: "Fire equipment", location: "All stairwells", criticality: "critical", condition: "good", lastServicedAt: d(-200), notes: "GNFS certificate renewal due with annual service." });
    asset("ac", { propertyId: "p_srp", unitId: UN.S03, name: "Split air-conditioner 2.5HP", category: "Air conditioner", location: "Office S03", make: "LG Dual Inverter", criticality: "medium", condition: "fair", lastServicedAt: d(-80) });
    asset("cctv", { propertyId: "p_srp", name: "CCTV system (8 cameras, NVR)", category: "Security", location: "Security post", make: "Hikvision", criticality: "high", condition: "good", lastServicedAt: d(-30) });
    asset("pump", { propertyId: "p_adh", name: "Surface water pump 1HP", category: "Water pump", location: "Courtyard pump house", make: "Pedrollo", criticality: "high", condition: "poor", lastServicedAt: d(-75), notes: "Frequent failures; consider replacement." });

    const plan = (assetKey, name, interval, due, lead, o = {}) => S.plans.push({ id: nextId("pm"), assetId: A[assetKey], name, intervalDays: interval, nextDueAt: d(due), leadDays: lead, vendorId: o.vendor ? V[o.vendor] : null, assigneeId: o.tech ? "u_tech" : null, estimate: o.est ? GHS(o.est) : 0, checklist: o.checklist || [] });
    plan("gen", "Quarterly generator service", 90, 5, 7, { vendor: "elec", est: 1850, checklist: ["Change engine oil & filter", "Replace fuel filter", "Check coolant & belts", "Battery terminals and charge", "Load test 30 minutes"] });
    plan("bore", "Monthly borehole pump inspection", 30, -10, 3, { tech: true, checklist: ["Record flow rate", "Check pressure switch", "Inspect cabling and float switch", "Water clarity check"] });
    plan("tank", "Tank cleaning & disinfection", 180, 120, 14, { vendor: "plumb", checklist: ["Drain and scrub", "Disinfect", "Check inlet filter"] });
    plan("fire", "Annual fire equipment service & GNFS certificate", 365, 165, 30, { checklist: ["Pressure-test each extinguisher", "Hose reel flow test", "Update tags", "File GNFS certificate"] });
    plan("ac", "A/C filter clean & gas check", 90, 10, 7, { vendor: "ac", est: 350, checklist: ["Clean filters", "Check refrigerant pressure", "Clear drain line"] });
    plan("pump", "Bi-monthly pump service", 60, -15, 7, { tech: true, checklist: ["Check impeller", "Inspect seals", "Test pressure"] });
    plan("cctv", "CCTV health check", 180, 150, 14, { checklist: ["All cameras recording", "NVR storage health", "Clean lenses"] });
    setActor(null); generatePM(at(d(0), 6)); as("u_fm");

    const M = () => as("u_mgr"), FM = () => as("u_fm"), TECH = () => as("u_tech");
    // 1 — closed vendor job with costs
    M(); const r1 = createRequest({ propertyId: "p_srp", unitId: UN.S03, tenantId: T.volta, assetId: A.ac, category: "hvac", priority: "high", title: "Office air-conditioner not cooling", description: "Volta Tech Hub reports the A/C in S03 blows warm air since Monday.", at: at(d(-45), 8) });
    requestAction(r1.id, "approve", "", at(d(-45), 9));
    FM(); const w1 = createWorkOrder({ requestId: r1.id, propertyId: "p_srp", unitId: UN.S03, assetId: A.ac, category: "hvac", priority: "high", scope: r1.title, vendorId: V.ac, dueAt: d(-40), at: at(d(-45), 10) });
    woTransition(w1.id, "in_progress", {}, at(d(-44), 8));
    woTransition(w1.id, "completed", { completionNotes: "Refrigerant topped up (R410A), capacitor replaced. Cooling restored.", vendorCost: GHS(650), materials: GHS(180), purchaseRef: "CoolBreeze INV-2211" }, at(d(-43), 15));
    woTransition(w1.id, "closed", { note: "Tenant confirmed cooling." }, at(d(-42), 10));
    M(); requestAction(r1.id, "close", "Capacitor replaced and gas topped up by CoolBreeze.", at(d(-42), 11));
    // 2–4 repeat pump faults
    [{ ago: 70, notes: "Primed pump and replaced foot valve.", lab: 150, mat: 220 }, { ago: 38, notes: "Replaced pressure switch.", lab: 150, mat: 310 }, { ago: 9, notes: "Mechanical seal leaking; replaced seal kit.", lab: 200, mat: 450 }].forEach((j, i) => {
      M(); const r = createRequest({ propertyId: "p_adh", assetId: A.pump, category: "plumbing", priority: i === 2 ? "high" : "normal", title: "No water in the compound", description: "Tenants report no water pressure; pump runs but does not deliver.", at: at(d(-j.ago), 7) });
      requestAction(r.id, "approve", "", at(d(-j.ago), 8));
      FM(); const w = createWorkOrder({ requestId: r.id, propertyId: "p_adh", assetId: A.pump, category: "plumbing", priority: r.priority, scope: r.title, assigneeId: "u_tech", dueAt: d(-j.ago + 2), at: at(d(-j.ago), 9) });
      TECH(); woTransition(w.id, "in_progress", {}, at(d(-j.ago), 13)); woTransition(w.id, "completed", { completionNotes: j.notes, labour: GHS(j.lab), materials: GHS(j.mat), purchaseRef: `Adum Market receipt ${400 + i}` }, at(d(-j.ago + 1), 12));
      FM(); woTransition(w.id, "closed", {}, at(d(-j.ago + 1), 17));
      M(); if (i < 2) requestAction(r.id, "close", j.notes, at(d(-j.ago + 2), 9));
      else r.updates.push({ at: at(d(-8)), by: "Yaw Boateng", body: "Third pump failure in 90 days. Getting a replacement quote.", visibility: "internal" });
    });
    // 5 — in progress & overdue roof leak
    M(); const r5 = createRequest({ propertyId: "p_ahr", unitId: UN.A6, category: "structural", priority: "high", title: "Roof leak damaged ceiling in A6", description: "Water came through the ceiling during last week's rain. Ceiling boards sagging in the living room.", at: at(d(-9), 7) });
    requestAction(r5.id, "triage", "Unit vacant; set under maintenance until fixed.", at(d(-9), 8)); requestAction(r5.id, "approve", "", at(d(-9), 9));
    FM(); const w5 = createWorkOrder({ requestId: r5.id, propertyId: "p_ahr", unitId: UN.A6, category: "structural", priority: "high", scope: r5.title, assigneeId: "u_tech", dueAt: d(-4), checklist: [{ item: "Seal roof flashing", done: true }, { item: "Replace ceiling boards", done: false }, { item: "Repaint", done: false }], at: at(d(-9), 10) });
    TECH(); woTransition(w5.id, "in_progress", { note: "Roof flashing resealed. Waiting for dry weather to replace boards.", labour: GHS(400), materials: GHS(260) }, at(d(-8), 12));
    // 6 — waiting for parts
    FM(); const w6 = createWorkOrder({ propertyId: "p_ahr", assetId: A.gen, category: "electrical", priority: "high", scope: "Automatic transfer switch not switching back to mains. Diagnose and replace contactor.", vendorId: V.elec, dueAt: d(3), at: at(d(-3), 9) });
    woTransition(w6.id, "in_progress", {}, at(d(-3), 14)); woTransition(w6.id, "waiting_for_parts", { note: "Contactor ordered from Accra; arriving in 2 days." }, at(d(-2), 10));
    // 7 — emergency
    M(); const r7 = createRequest({ propertyId: "p_ahr", unitId: UN.A1, tenantId: T.ama, category: "electrical", priority: "emergency", title: "Sparks and burning smell from bedroom socket", description: "Tenant switched off the breaker for the bedroom circuit. Needs urgent inspection.", at: at(d(-1), 19) });
    requestAction(r7.id, "triage", "Breaker isolated by tenant. Electrician today.", at(d(-1), 19)); requestAction(r7.id, "approve", "", at(d(-1), 20));
    FM(); createWorkOrder({ requestId: r7.id, propertyId: "p_ahr", unitId: UN.A1, category: "electrical", priority: "emergency", scope: r7.title, vendorId: V.elec, dueAt: d(1), at: at(d(-1), 20) });
    // 8 — portal submission awaiting triage
    as("u_tenant"); createRequest({ propertyId: "p_adh", unitId: UN.K1, tenantId: T.abena, category: "plumbing", priority: "normal", title: "Bathroom tap dripping", description: "The hot tap in the bathroom drips all night even when fully closed.", source: "portal", at: at(d(-1), 7) });
    // 9 — portal, completed & rated
    const r9 = createRequest({ propertyId: "p_adh", unitId: UN.K1, tenantId: T.abena, category: "electrical", priority: "normal", title: "Kitchen light not working", description: "Fluorescent tube in the kitchen flickers and goes off.", source: "portal", at: at(d(-20), 7) });
    M(); requestAction(r9.id, "approve", "", at(d(-20), 9));
    FM(); const w9 = createWorkOrder({ requestId: r9.id, propertyId: "p_adh", unitId: UN.K1, category: "electrical", scope: r9.title, assigneeId: "u_tech", dueAt: d(-18), at: at(d(-20), 10) });
    TECH(); woTransition(w9.id, "in_progress", {}, at(d(-19), 9)); woTransition(w9.id, "completed", { completionNotes: "Replaced starter and tube with LED batten.", labour: GHS(60), materials: GHS(95) }, at(d(-19), 11));
    FM(); woTransition(w9.id, "closed", {}, at(d(-18), 10));
    M(); requestAction(r9.id, "close", "LED batten fitted.", at(d(-18), 11));
    r9.rating = 5; r9.feedback = "Fixed the next day. Thank you!";
    // 10 — rejected
    const r10 = createRequest({ propertyId: "p_srp", unitId: UN.S01, tenantId: T.kente, category: "structural", priority: "low", title: "Repaint shop front", description: "Tenant requests repainting the shop front in brand colours.", at: at(d(-14), 9) });
    requestAction(r10.id, "reject", "Shop-front branding is the tenant's responsibility under the lease (clause 9).", at(d(-13), 10));
    // 11 — submitted
    createRequest({ propertyId: "p_ahr", unitId: UN.A3, tenantId: T.esi, category: "pest control", priority: "normal", title: "Cockroaches in kitchen", description: "Tenant reports cockroaches in the kitchen cabinets.", at: at(d(-2), 15) });
  }

  window.Engine = {
    get S() { return S; }, load, reset, save, onChange: (f) => listeners.push(f), setActor,
    ROLES, FREQ_LABEL, METHODS, MOMO_NETWORKS, BUCKETS, WO_FLOW,
    dates: { addDays, addMonths, diffDays, firstOfMonth, todayISO },
    byId, money, propName, userName, unitLease, unitOccupancy, leaseBalance, ledger, chargeStatus, chargeOutstanding, chargePaid, unapplied, arrears, fmtPeriod, methodLabel, woCost, planStatus,
    recordPayment, confirmPayment, reversePayment, voidCharge, runBilling, createLease, markPending, activateLease, terminateLease,
    createRequest, requestAction, createWorkOrder, woTransition, generatePM, sendReminder, audit,
    addNote: (tenantId, kind, body) => { const t = byId("tenants", tenantId); S.notes.push({ id: nextId("n"), tenantId, kind, body, by: actor.name, at: new Date().toISOString() }); audit("tenant.note_added", "Tenant", t.name, kind); },
    createTenant: (o) => { const t = { id: nextId("t"), type: "individual", status: "prospective", ...o }; S.tenants.push(t); audit("tenant.created", "Tenant", t.name, ""); return t; },
  };
})();
