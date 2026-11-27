/* AI-POS browser demo — UI layer. Hash-routed views over window.Engine. */
(function () {
  "use strict";
  const E = window.Engine;
  const { money, byId, ROLES } = E;
  const S = () => E.S;
  const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (s) => (s ? new Date(s.length <= 10 ? `${s}T00:00:00Z` : s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
  const fmtDT = (s) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "—");
  const cap = (s) => String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
  const toMinor = (v) => Math.round(parseFloat(String(v).replace(/,/g, "")) * 100);

  // ───────────────────────── session ─────────────────────────
  const SKEY = "aipos-demo-user";
  let me = null;
  function restore() { try { const id = sessionStorage.getItem(SKEY); me = id ? S().users.find((u) => u.id === id) || null : null; } catch (e) { me = null; } E.setActor(me); }
  function signIn(id) { me = S().users.find((u) => u.id === id); try { sessionStorage.setItem(SKEY, id); } catch (e) { /* ignore */ } E.setActor(me); E.audit("auth.login", "User", me.email, `Signed in as ${ROLES[me.role].name}`); E.save(); go(me.role === "tenant_portal" ? "#/portal" : me.role === "technician" ? "#/work-orders" : "#/dashboard"); }
  function signOut() { me = null; try { sessionStorage.removeItem(SKEY); } catch (e) { /* ignore */ } E.setActor(null); go("#/login"); }
  const can = (p) => !!me && ROLES[me.role].perms.includes(p);
  const seeProp = (pid) => !me?.scope || me.scope.includes(pid);
  const propOfLease = (l) => byId("units", l.unitId).propertyId;
  const vLeases = () => S().leases.filter((l) => seeProp(propOfLease(l)));
  const vUnits = () => S().units.filter((u) => seeProp(u.propertyId));
  const vProps = () => S().properties.filter((p) => seeProp(p.id));
  const vTenants = () => { if (!me?.scope) return S().tenants; const ids = new Set(vLeases().flatMap((l) => l.tenantIds)); return S().tenants.filter((t) => ids.has(t.id)); };
  const vRequests = () => S().requests.filter((r) => seeProp(r.propertyId));
  const vWOs = () => S().workOrders.filter((w) => seeProp(w.propertyId) && (me.role !== "technician" || w.assigneeId === me.id));
  const leaseName = (l) => byId("tenants", l.tenantIds[0]).name;
  const unitLabel = (unitId) => { const u = byId("units", unitId); return u ? `${u.ref} · ${byId("properties", u.propertyId).name}` : "—"; };

  // ───────────────────────── routing ─────────────────────────
  // Top-level pages (Netlify) route on location.hash so the back button works; inside an embedded
  // viewer (iframe) the route is kept in memory because the host may not pass hash paths through.
  const FRAMED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  let memHash = "#/login";
  const curHash = () => (FRAMED ? memHash : location.hash || "#/login");
  function go(hash) { if (FRAMED) { memHash = hash; render(); return; } if (location.hash === hash) render(); else location.hash = hash; }
  const routes = [];
  const route = (pattern, perm, fn) => routes.push({ re: new RegExp(`^${pattern.replace(/:\w+/g, "([^/]+)")}$`), perm, fn });

  // ───────────────────────── UI primitives ─────────────────────────
  const STATUS_BADGE = {
    paid: "b-green", confirmed: "b-green", active: "b-green", occupied: "b-green", closed: "b-green", completed: "b-green", scheduled: "b-green", held: "b-green",
    partially_paid: "b-amber", pending: "b-amber", pending_signature: "b-amber", draft: "", reserved: "b-amber", due_soon: "b-amber", waiting_for_parts: "b-amber", triaged: "b-blue", submitted: "b-blue", approved: "b-blue", in_progress: "b-blue", assigned: "b-blue", prospective: "b-blue",
    overdue: "b-red", reversed: "b-red", void: "", terminated: "", rejected: "b-red", vacant: "b-red", under_maintenance: "b-amber", emergency: "b-red", high: "b-amber", inactive: "", cancelled: "", expired: "",
    critical: "b-red", normal: "", low: "",
  };
  const badge = (s, label) => `<span class="badge ${STATUS_BADGE[s] ?? ""}">${h(label || cap(s))}</span>`;
  const kpi = (l, v, s = "", cls = "") => `<div class="card kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
  const table = (cols, rows, empty = "Nothing here yet.") => rows.length
    ? `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${c.t}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<div class="empty">${empty}</div>`;
  const head = (title, sub = "", actions = "", crumbs = "") => `${crumbs ? `<div class="crumbs">${crumbs}</div>` : ""}<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
  const btn = (label, act, id = "", cls = "") => `<button class="btn ${cls}" data-act="${act}" data-id="${h(id)}">${label}</button>`;
  const opt = (v, l, sel) => `<option value="${h(v)}" ${sel ? "selected" : ""}>${h(l)}</option>`;

  function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }

  let modalSubmit = null;
  function modal(title, body, onSubmit, submitLabel = "Save", danger = false) {
    closeModal();
    const o = document.createElement("div"); o.className = "overlay"; o.id = "overlay";
    o.innerHTML = `<form class="modal" id="mf" novalidate><header><h2>${title}</h2><button type="button" class="x" data-act="close-modal" aria-label="Close">×</button></header><div class="body">${body}<div class="err" id="merr" role="alert"></div></div><footer><button type="button" class="btn" data-act="close-modal">Cancel</button><button type="submit" class="btn ${danger ? "danger" : "primary"}">${submitLabel}</button></footer></form>`;
    document.body.appendChild(o);
    modalSubmit = onSubmit;
    const first = o.querySelector("input,select,textarea"); if (first) first.focus();
  }
  function closeModal() { const o = document.getElementById("overlay"); if (o) o.remove(); modalSubmit = null; }
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "mf") return; e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try { const msg = modalSubmit(data); closeModal(); E.save(); if (msg) toast(msg); }
    catch (err) { document.getElementById("merr").textContent = err.message; }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ───────────────────────── shell ─────────────────────────
  const NAV = [
    ["Overview", [["#/dashboard", "Dashboard", ["report.financial.read", "maintenance.report.read", "property.read"]], ["#/ai", "AI assistant", ["ai.insight.read"]]]],
    ["Portfolio", [["#/properties", "Properties", ["property.read"]], ["#/units", "Units", ["unit.read"]], ["#/tenants", "Tenants", ["tenant.read"]], ["#/leases", "Leases", ["lease.read"]]]],
    ["Finance", [["#/rent", "Rent charges", ["rent.read"]], ["#/payments", "Payments & receipts", ["rent.read"]], ["#/arrears", "Arrears", ["rent.read"]]]],
    ["Facilities", [["#/maintenance", "Maintenance requests", ["maintenance.request.read"]], ["#/work-orders", "Work orders", ["work_order.read"]], ["#/assets", "Assets & preventive", ["asset.read"]], ["#/vendors", "Vendors", ["vendor.read"]]]],
    ["Admin", [["#/reports", "Reports", ["report.financial.read", "maintenance.report.read"]], ["#/notifications", "Notifications", ["organization.settings.manage", "payment.record", "maintenance.request.manage"]], ["#/team", "Team & roles", ["user.manage", "audit.read"]], ["#/audit", "Audit log", ["audit.read"]]]],
  ];
  function shell(inner) {
    const cur = curHash().split("?")[0].split("/").slice(0, 2).join("/");
    const counts = { "#/payments": can("payment.confirm") ? S().payments.filter((p) => p.status === "pending" && seeProp(propOfLease(byId("leases", p.leaseId)))).length : 0, "#/maintenance": can("maintenance.request.manage") ? vRequests().filter((r) => r.status === "submitted").length : 0 };
    const nav = NAV.map(([sec, items]) => {
      const vis = items.filter(([, , ps]) => ps.some(can)); if (!vis.length) return "";
      return `<div class="sec">${sec}</div>${vis.map(([href, label]) => `<a href="${href}" class="${cur === href ? "active" : ""}">${label}${counts[href] ? `<span class="count">${counts[href]}</span>` : ""}</a>`).join("")}`;
    }).join("");
    const scope = me.scope ? me.scope.map((p) => byId("properties", p).name).join(", ") : "All properties";
    return `<div class="shell"><aside class="sidebar" id="sidebar"><div class="brand"><div class="logo">AI</div><div><div class="t1">AI-POS</div><div class="t2">${h(S().org.name)}</div></div></div><nav class="nav" aria-label="Main">${nav}</nav></aside>
      <div class="main"><header class="topbar"><button class="btn sm menu-btn" data-act="menu" aria-controls="sidebar">Menu</button><div class="small muted">Scope: <b>${h(scope)}</b></div>
      <div class="actions" style="align-items:center"><div class="who"><div class="n">${h(me.name)}</div><div class="r">${h(ROLES[me.role].name)}</div></div><button class="btn sm" data-act="logout">Switch role</button></div></header>
      <main class="content" id="content">${inner}</main></div></div>`;
  }

  // ───────────────────────── login ─────────────────────────
  function loginView() {
    const order = ["u_owner", "u_mgr", "u_fin", "u_fm", "u_tech", "u_land", "u_aud", "u_tenant", "u_kmgr"];
    const users = order.map((id) => S().users.find((u) => u.id === id));
    return `<div class="login"><div class="hero"><div>
      <div class="brand" style="padding:0;border:0;margin-bottom:22px"><div class="logo">AI</div><div><div class="t1">AI-POS</div><div class="t2">AI Property Operating System</div></div></div>
      <h1>Run your rental portfolio from one place: rent, tenants, receipts and repairs.</h1>
      <p class="lead">Built for landlords and property managers in Ghana. Bill rent monthly, quarterly or the usual one-year advance, record MoMo and bank payments, issue receipts automatically, see who is in arrears and by how long, and keep generators, boreholes and pumps serviced.</p>
      <ul class="feat"><li>Rent billing in GH₵ for any frequency</li><li>MTN MoMo, Telecel Cash, bank, cheque, cash</li><li>Automatic receipts and tenant statements</li><li>Arrears aging: 0–30, 31–60, 61–90, 90+ days</li><li>Maintenance requests to work orders</li><li>Preventive servicing for generators, boreholes</li><li>Role-based access for every team member</li><li>Tenant self-service portal</li><li>Full audit trail of every action</li><li>AI assistant for insights (preview)</li></ul>
      <div class="card" style="margin-top:22px"><h2>Suggested 5-minute walkthrough</h2><ol class="tour">
        <li>Sign in as the <b>Property Manager</b>. Open <b>Dashboard</b>, then <b>Arrears</b> to see who owes and for how long.</li>
        <li>Open <b>Esi Quaye</b>'s lease and <b>Record payment</b> by MTN MoMo. It waits for Finance to confirm (two-person control).</li>
        <li>Switch to <b>Finance Officer</b>, open <b>Payments</b>, confirm the MoMo payment and open its receipt. Esi's arrears drop, oldest debt first.</li>
        <li>As the <b>Facility Manager</b>, approve the dripping-tap request and assign it to the technician.</li>
        <li>Sign in as the <b>Tenant</b> to see the self-service portal, then the <b>Landlord</b> to see a read-only owner view.</li>
      </ol></div>
    </div><div>
      <div class="card"><h2>Choose a demo role</h2><p class="muted small" style="margin:-4px 0 12px">One click, no password. Each role sees only what it is allowed to.</p><div class="roles">
      ${users.map((u) => `<button class="role-card" data-act="login" data-id="${u.id}"><span class="av">${initials(u.name)}</span><span><span class="n">${h(ROLES[u.role].name)}${u.scope ? " · Kumasi only" : ""}</span><br><span class="d">${h(u.name)} — ${h(ROLES[u.role].desc)}</span></span></button>`).join("")}
      </div></div>
      <p class="small muted" style="margin-top:12px">Demo organization: <b>${h(S().org.name)}</b> with 3 properties in Accra and Kumasi, 17 units and 12 tenants. All names, phone numbers and references are fictional. Changes you make are saved only in this browser; use “Reset demo data” in the banner to start over.</p>
    </div></div></div>`;
  }

  // ───────────────────────── dashboard ─────────────────────────
  function monthKey(s) { return s.slice(0, 7); }
  function dashboard() {
    const today = S().today, mk = monthKey(today);
    const units = vUnits(); const occ = units.filter((u) => E.unitOccupancy(u) === "occupied").length;
    const leases = vLeases();
    const leaseIds = new Set(leases.map((l) => l.id));
    const charges = S().charges.filter((c) => leaseIds.has(c.leaseId) && c.status !== "void");
    const pays = S().payments.filter((p) => leaseIds.has(p.leaseId));
    const billedM = charges.filter((c) => monthKey(c.due) === mk).reduce((s, c) => s + c.amount, 0);
    const paidOnM = charges.filter((c) => monthKey(c.due) === mk).reduce((s, c) => s + E.chargePaid(c.id), 0);
    const collectedM = pays.filter((p) => p.status === "confirmed" && monthKey(p.received) === mk).reduce((s, p) => s + p.amount, 0);
    const ar = E.arrears(seeProp); const arT = ar.reduce((s, r) => s + r.total, 0);
    const bk = [0, 1, 2, 3].map((i) => ar.reduce((s, r) => s + r.buckets[i], 0));
    const pending = pays.filter((p) => p.status === "pending");
    const expiring = leases.filter((l) => l.status === "active" && E.dates.diffDays(l.end, today) <= 60 && l.end >= today).sort((a, b) => a.end.localeCompare(b.end));
    const wos = vWOs(); const openWO = wos.filter((w) => !["closed", "cancelled", "completed"].includes(w.status));
    const overdueWO = openWO.filter((w) => w.dueAt && w.dueAt < today);
    const fin = can("report.financial.read"), mnt = can("maintenance.report.read") || can("work_order.read");

    let out = head(`Good ${new Date().getUTCHours() < 12 ? "morning" : "afternoon"}, ${h(me.name.split(" ")[0])}`, `${fmtDate(today)} · ${me.scope ? vProps().map((p) => p.name).join(", ") : `${vProps().length} properties`}`, can("payment.record") ? btn("Record payment", "pay-new", "", "primary") : "");
    out += `<div class="grid g4">`;
    out += kpi("Occupancy", `${units.length ? Math.round((occ / units.length) * 100) : 0}%`, `${occ} of ${units.length} units let`);
    if (fin) {
      out += kpi("Billed this month", money(billedM), `${billedM ? Math.round((paidOnM / billedM) * 100) : 0}% of it already paid`);
      out += kpi("Collected this month", money(collectedM), `${pending.length} payment(s) awaiting confirmation`);
      out += kpi("Total arrears", money(arT), `${ar.length} lease(s) overdue`, arT ? "alert" : "");
    } else {
      out += kpi("Open work orders", openWO.length, `${overdueWO.length} overdue`, overdueWO.length ? "alert" : "");
      out += kpi("Requests awaiting triage", vRequests().filter((r) => r.status === "submitted").length, "From staff and tenant portal");
      out += kpi("Preventive tasks due", S().plans.filter((p) => seeProp(byId("assets", p.assetId).propertyId) && E.planStatus(p) !== "scheduled").length, "Overdue or within lead time");
    }
    out += `</div><div class="grid g-side" style="margin-top:16px"><div class="stack">`;
    if (fin) {
      const max = Math.max(...bk, 1); const colors = ["#7fc4a1", "#e3b04b", "#e07a52", "#b42318"];
      out += `<div class="card"><div class="page-head" style="margin:0 0 10px"><h2 style="margin:0">Arrears aging</h2><a href="#/arrears" class="small">View all →</a></div><div class="aging">${bk.map((v, i) => `<div class="col"><div class="stick"><i style="height:${Math.round((v / max) * 110) + 2}px;background:${colors[i]}"></i></div><div class="amt">${money(v)}</div><div class="lbl">${E.BUCKETS[i]} days</div></div>`).join("")}</div></div>`;
      // collections trend
      const months = [...Array(6)].map((_, i) => E.dates.addMonths(E.dates.firstOfMonth(today), i - 5));
      const vals = months.map((m) => pays.filter((p) => p.status === "confirmed" && monthKey(p.received) === monthKey(m)).reduce((s, p) => s + p.amount, 0));
      const vmax = Math.max(...vals, 1);
      out += `<div class="card"><h2>Collections, last 6 months</h2><div class="aging" style="grid-template-columns:repeat(6,1fr)">${months.map((m, i) => `<div class="col"><div class="stick"><i style="height:${Math.round((vals[i] / vmax) * 110) + 2}px;background:var(--brand-500);width:34px"></i></div><div class="amt small">${(vals[i] / 100000).toFixed(1)}k</div><div class="lbl">${new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</div></div>`).join("")}</div><p class="small muted" style="margin:8px 0 0">GH₵ thousands, confirmed payments by date received. Annual and half-yearly advances create spikes, as is normal in Ghana.</p></div>`;
      out += `<div class="card"><h2>Top arrears</h2>${table([{ t: "Tenant" }, { t: "Unit" }, { t: "Oldest", num: 1 }, { t: "Owed", num: 1 }], ar.slice(0, 5).map((r) => `<tr><td><a href="#/leases/${r.lease.id}">${h(leaseName(r.lease))}</a></td><td>${h(r.unit.ref)}</td><td class="num">${r.oldest} days</td><td class="num"><b>${money(r.total)}</b></td></tr>`), "No arrears. Everyone is paid up.")}</div>`;
    }
    if (mnt) {
      out += `<div class="card"><div class="page-head" style="margin:0 0 10px"><h2 style="margin:0">Open work orders</h2><a href="#/work-orders" class="small">View all →</a></div>${table([{ t: "Ref" }, { t: "Job" }, { t: "Status" }, { t: "Due" }], openWO.sort((a, b) => (a.dueAt || "9").localeCompare(b.dueAt || "9")).slice(0, 6).map((w) => `<tr><td><a href="#/work-orders/${w.id}">${w.ref}</a></td><td>${h(w.scope)}<div class="small muted">${h(E.propName(w.propertyId))}</div></td><td>${badge(w.status)} ${w.priority === "emergency" ? badge("emergency") : ""}</td><td class="nowrap">${w.dueAt && w.dueAt < today ? badge("overdue", `Overdue ${fmtDate(w.dueAt)}`) : fmtDate(w.dueAt)}</td></tr>`), "No open work orders.")}</div>`;
    }
    out += `</div><div class="stack">`;
    if (can("payment.confirm") && pending.length) out += `<div class="card"><h2>Awaiting your confirmation</h2>${pending.map((p) => { const l = byId("leases", p.leaseId); return `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0"><div><b>${money(p.amount)}</b> · ${h(E.methodLabel(p))}<div class="small muted">${h(leaseName(l))} · ${fmtDate(p.received)}</div></div>${btn("Confirm", "pay-confirm", p.id, "sm primary")}</div>`; }).join("")}</div>`;
    out += `<div class="card"><h2>Leases ending within 60 days</h2>${expiring.length ? expiring.map((l) => { const renewal = S().leases.find((x) => x.renewalOf === l.id); return `<div style="padding:6px 0"><a href="#/leases/${l.id}">${h(leaseName(l))}</a> · ${h(byId("units", l.unitId).ref)}<div class="small muted">Ends ${fmtDate(l.end)} (${E.dates.diffDays(l.end, today)} days)${renewal ? ` · renewal ${badge(renewal.status)}` : ""}</div></div>`; }).join("") : `<div class="muted small">None.</div>`}</div>`;
    out += `<div class="card"><h2>Occupancy by property</h2>${vProps().map((p) => { const us = S().units.filter((u) => u.propertyId === p.id); const o = us.filter((u) => E.unitOccupancy(u) === "occupied").length; return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between" class="small"><a href="#/properties/${p.id}">${h(p.name)}</a><span>${o}/${us.length}</span></div><div class="bar"><i style="width:${(o / us.length) * 100}%"></i></div></div>`; }).join("")}</div>`;
    if (can("ai.insight.read")) out += `<div class="card"><h2>AI insight</h2>${insights().slice(0, 2).map(insightHtml).join("")}<a href="#/ai" class="small">Open AI assistant →</a></div>`;
    out += `</div></div>`;
    return out;
  }

  // ───────────────────────── portfolio ─────────────────────────
  function propertiesView() {
    const rows = vProps().map((p) => {
      const us = S().units.filter((u) => u.propertyId === p.id); const o = us.filter((u) => E.unitOccupancy(u) === "occupied").length;
      const ar = E.arrears((pid) => pid === p.id).reduce((s, r) => s + r.total, 0);
      return `<tr><td><a href="#/properties/${p.id}"><b>${h(p.name)}</b></a><div class="small muted">${h(p.ref)} · ${cap(p.type)}</div></td><td>${h(p.community)}, ${h(p.region)}<div class="small muted">${h(p.gps)}</div></td><td class="num">${o}/${us.length}</td>${can("rent.read") ? `<td class="num">${money(ar)}</td>` : ""}<td>${badge(p.status)}</td></tr>`;
    });
    return head("Properties", "Each property holds its units, assets and maintenance history. Addresses use GhanaPost GPS digital addresses.") + `<div class="card">${table([{ t: "Property" }, { t: "Location" }, { t: "Occupied", num: 1 }, ...(can("rent.read") ? [{ t: "Arrears", num: 1 }] : []), { t: "Status" }], rows)}</div>`;
  }
  function propertyView(id) {
    const p = byId("properties", id); if (!p || !seeProp(id)) return notFound();
    const us = S().units.filter((u) => u.propertyId === id);
    const assets = S().assets.filter((a) => a.propertyId === id);
    let out = head(h(p.name), `${h(p.desc)}`, "", `<a href="#/properties">Properties</a> / ${h(p.ref)}`);
    out += `<div class="grid g-side"><div class="stack"><div class="card"><h2>Units</h2>${table([{ t: "Unit" }, { t: "Type" }, { t: "Status" }, { t: "Tenant" }, { t: "Rent", num: 1 }], us.map((u) => { const l = E.unitLease(u.id); return `<tr><td><b>${u.ref}</b>${u.note ? `<div class="small muted">${h(u.note)}</div>` : ""}</td><td>${h(u.type)}${u.bedrooms ? ` · ${u.bedrooms} bed` : ""}</td><td>${badge(E.unitOccupancy(u))}</td><td>${l ? `<a href="#/leases/${l.id}">${h(leaseName(l))}</a>` : "—"}</td><td class="num">${l ? `${money(l.rent)} <span class="small muted">${E.FREQ_LABEL[l.freq].toLowerCase()}</span>` : `<span class="muted">${money(u.asking)} asking</span>`}</td></tr>`; }))}</div>`;
    if (can("asset.read")) out += `<div class="card"><h2>Assets</h2>${table([{ t: "Asset" }, { t: "Criticality" }, { t: "Condition" }, { t: "Last serviced" }], assets.map((a) => `<tr><td>${h(a.name)}<div class="small muted">${h(a.location)}</div></td><td>${badge(a.criticality)}</td><td>${cap(a.condition)}</td><td>${fmtDate(a.lastServicedAt)}</td></tr>`), "No assets registered.")}</div>`;
    out += `</div><div class="stack"><div class="card"><h2>Details</h2><dl class="kv"><dt>Reference</dt><dd>${h(p.ref)}</dd><dt>Type</dt><dd>${cap(p.type)}</dd><dt>Address</dt><dd>${h(p.community)}, ${h(p.district)}, ${h(p.region)}</dd><dt>Digital address</dt><dd>${h(p.gps)}</dd><dt>Landmark</dt><dd>${h(p.landmark)}</dd><dt>Owner</dt><dd>${h(p.owner)}</dd><dt>Manager</dt><dd>${h(E.userName(p.managerId))}</dd>${can("property.financials.read") && p.acquisitionCost ? `<dt>Acquisition cost</dt><dd>${money(p.acquisitionCost)}</dd>` : ""}</dl>${!can("property.financials.read") && p.acquisitionCost ? `<p class="small muted" style="margin:10px 0 0">Acquisition cost is hidden for your role (needs property.financials.read).</p>` : ""}</div></div></div>`;
    return out;
  }
  function unitsView() {
    const q = params();
    const list = vUnits().filter((u) => (!q.p || u.propertyId === q.p) && (!q.s || E.unitOccupancy(u) === q.s));
    const filters = `<div class="filters"><select data-filter="p">${opt("", "All properties")}${vProps().map((p) => opt(p.id, p.name, q.p === p.id)).join("")}</select><select data-filter="s">${opt("", "Any status")}${["occupied", "vacant", "reserved", "under_maintenance"].map((s) => opt(s, cap(s), q.s === s)).join("")}</select></div>`;
    return head("Units", `${list.length} unit(s). Vacant units are lost income: every month a unit stays empty costs its asking rent.`) + `<div class="card">${filters}${table([{ t: "Unit" }, { t: "Property" }, { t: "Type" }, { t: "Status" }, { t: "Current tenant" }, { t: "Rent / asking", num: 1 }], list.map((u) => { const l = E.unitLease(u.id); return `<tr><td><b>${u.ref}</b></td><td><a href="#/properties/${u.propertyId}">${h(E.propName(u.propertyId))}</a></td><td>${h(u.type)}${u.area ? `<div class="small muted">${u.area} m²</div>` : ""}</td><td>${badge(E.unitOccupancy(u))}</td><td>${l ? `<a href="#/leases/${l.id}">${h(leaseName(l))}</a>` : "—"}</td><td class="num">${money(l ? l.rent : u.asking)}${l ? `<div class="small muted">${E.FREQ_LABEL[l.freq]}</div>` : ""}</td></tr>`; }))}</div>`;
  }
  function tenantsView() {
    const list = vTenants();
    return head("Tenants", "Individuals and businesses. Ghana Card and other ID details are visible only to roles with permission.", can("tenant.create") ? btn("Add tenant", "tenant-new", "", "primary") : "") +
      `<div class="card">${table([{ t: "Tenant" }, { t: "Contact" }, { t: "Unit(s)" }, { t: "Status" }, ...(can("rent.read") ? [{ t: "Balance", num: 1 }] : [])], list.map((t) => {
        const ls = S().leases.filter((l) => l.tenantIds.includes(t.id));
        const bal = ls.filter((l) => l.tenantIds[0] === t.id).reduce((s, l) => s + E.leaseBalance(l.id).overdue, 0);
        return `<tr><td><a href="#/tenants/${t.id}"><b>${h(t.name)}</b></a><div class="small muted">${t.type === "organization" ? "Business" : "Individual"}</div></td><td>${h(t.phone)}<div class="small muted">${h(t.email || "")}</div></td><td>${ls.filter((l) => l.status === "active").map((l) => h(byId("units", l.unitId).ref)).join(", ") || "—"}</td><td>${badge(t.status)}</td>${can("rent.read") ? `<td class="num">${bal ? `<span style="color:var(--red-600)">${money(bal)}</span>` : money(0)}</td>` : ""}</tr>`;
      }))}</div>`;
  }
  function tenantView(id) {
    const t = byId("tenants", id); if (!t || !vTenants().includes(t)) return notFound();
    const ls = S().leases.filter((l) => l.tenantIds.includes(t.id));
    const notes = S().notes.filter((n) => n.tenantId === id).sort((a, b) => b.at.localeCompare(a.at));
    const sens = can("tenant.sensitive.read");
    const mask = (v) => (v ? (sens ? h(v) : `<span class="muted">•••••• hidden for your role</span>`) : "—");
    let out = head(h(t.name), t.type === "organization" ? "Business tenant" : "Individual tenant", can("tenant.update") ? btn("Add note", "note-new", t.id) : "", `<a href="#/tenants">Tenants</a> / ${h(t.name)}`);
    out += `<div class="grid g-side"><div class="stack"><div class="card"><h2>Leases</h2>${table([{ t: "Lease" }, { t: "Unit" }, { t: "Term" }, { t: "Status" }, ...(can("rent.read") ? [{ t: "Overdue", num: 1 }] : [])], ls.map((l) => `<tr><td><a href="#/leases/${l.id}">${l.ref}</a>${l.tenantIds[0] !== t.id ? `<div class="small muted">Co-tenant</div>` : ""}</td><td>${h(unitLabel(l.unitId))}</td><td class="nowrap">${fmtDate(l.start)} – ${fmtDate(l.end)}</td><td>${badge(l.status, cap(l.status))}</td>${can("rent.read") ? `<td class="num">${money(E.leaseBalance(l.id).overdue)}</td>` : ""}</tr>`), "No leases.")}</div>
      <div class="card"><h2>Notes & contact history</h2>${notes.length ? `<ul class="timeline">${notes.map((n) => `<li><b>${h(n.kind)}</b> · ${h(n.body)}<div class="m">${h(n.by)} · ${fmtDT(n.at)}</div></li>`).join("")}</ul>` : `<div class="muted small">No notes yet.</div>`}</div></div>
      <div class="card"><h2>Profile</h2><dl class="kv"><dt>Phone</dt><dd>${h(t.phone)}</dd><dt>Email</dt><dd>${h(t.email || "—")}</dd><dt>ID type</dt><dd>${mask(t.idType)}</dd><dt>ID number</dt><dd>${mask(t.idRef)}</dd><dt>Emergency contact</dt><dd>${mask(t.emergency)}</dd><dt>Status</dt><dd>${badge(t.status)}</dd></dl>${!sens ? `<p class="small muted" style="margin:10px 0 0">Your role cannot see identification details (data-protection control under Ghana's Data Protection Act, 2012).</p>` : ""}</div></div>`;
    return out;
  }
  function leasesView() {
    const q = params();
    const list = vLeases().filter((l) => !q.s || l.status === q.s).sort((a, b) => a.ref.localeCompare(b.ref));
    const filters = `<div class="filters"><select data-filter="s">${opt("", "All statuses")}${["active", "pending_signature", "draft", "terminated"].map((s) => opt(s, cap(s), q.s === s)).join("")}</select></div>`;
    return head("Leases", "Monthly, quarterly, half-yearly or yearly billing. Advance payments are applied automatically to future charges.", can("lease.create") ? btn("New lease", "lease-new", "", "primary") : "") +
      `<div class="card">${filters}${table([{ t: "Lease" }, { t: "Tenant" }, { t: "Unit" }, { t: "Rent", num: 1 }, { t: "Term" }, { t: "Status" }], list.map((l) => `<tr><td><a href="#/leases/${l.id}">${l.ref}</a>${l.renewalOf ? `<div class="small muted">Renewal</div>` : ""}</td><td>${h(leaseName(l))}${l.tenantIds.length > 1 ? ` <span class="small muted">+${l.tenantIds.length - 1}</span>` : ""}</td><td>${h(unitLabel(l.unitId))}</td><td class="num">${money(l.rent)}<div class="small muted">${E.FREQ_LABEL[l.freq]}</div></td><td class="nowrap">${fmtDate(l.start)} – ${fmtDate(l.end)}</td><td>${badge(l.status)}</td></tr>`))}</div>`;
  }
  function leaseView(id) {
    const l = byId("leases", id); if (!l || !seeProp(propOfLease(l))) return notFound();
    const b = E.leaseBalance(l.id); const lines = E.ledger(l.id);
    const charges = S().charges.filter((c) => c.leaseId === l.id).sort((a, b2) => b2.due.localeCompare(a.due));
    const pays = S().payments.filter((p) => p.leaseId === l.id).sort((a, b2) => b2.received.localeCompare(a.received));
    let acts = "";
    if (l.status === "active" && can("payment.record")) acts += btn("Record payment", "pay-new", l.id, "primary");
    if (l.status === "active" && b.overdue && can("payment.record")) acts += btn("Send reminder", "remind", l.id);
    if (l.status === "draft" && can("lease.update")) acts += btn("Send for signature", "lease-pending", l.id);
    if (["draft", "pending_signature"].includes(l.status) && can("lease.activate")) acts += btn("Activate lease", "lease-activate", l.id, "primary");
    if (l.status === "active" && can("lease.terminate")) acts += btn("Terminate", "lease-terminate", l.id, "danger");
    let out = head(`${l.ref} ${badge(l.status)}`, `${h(l.tenantIds.map((t) => byId("tenants", t).name).join(" & "))} · ${h(unitLabel(l.unitId))}`, acts, `<a href="#/leases">Leases</a> / ${l.ref}`);
    if (can("rent.read")) out += `<div class="grid g4">${kpi("Total billed", money(b.billed))}${kpi("Total paid", money(b.paid))}${kpi("Overdue now", money(b.overdue), "", b.overdue ? "alert" : "")}${kpi("Credit / advance", money(b.credit), b.credit ? "Applied to next charges automatically" : "")}</div>`;
    out += `<div class="grid g-side" style="margin-top:16px"><div class="stack">`;
    if (can("rent.read")) {
      out += `<div class="card"><h2>Statement</h2>${table([{ t: "Date" }, { t: "Reference" }, { t: "Description" }, { t: "Charge", num: 1 }, { t: "Payment", num: 1 }, { t: "Balance", num: 1 }], lines.map((x) => `<tr class="${x.voided ? "void" : ""}"><td class="nowrap">${fmtDate(x.date)}</td><td class="small">${h(x.ref)}</td><td>${h(x.desc)}</td><td class="num">${x.debit ? money(x.debit) : ""}</td><td class="num">${x.credit ? money(x.credit) : ""}</td><td class="num"><b>${money(x.balance)}</b></td></tr>`), "No transactions yet.")}<p class="small muted" style="margin:10px 0 0">The ledger is append-only: mistakes are corrected with a visible reversal, never deleted.</p></div>`;
      out += `<div class="card"><h2>Charges</h2>${table([{ t: "Ref" }, { t: "Period" }, { t: "Due" }, { t: "Amount", num: 1 }, { t: "Outstanding", num: 1 }, { t: "Status" }, { t: "" }], charges.map((c) => `<tr class="${c.status === "void" ? "void" : ""}"><td class="small">${c.ref}</td><td>${h(c.desc)} <span class="small muted">${E.fmtPeriod(c)}</span></td><td class="nowrap">${fmtDate(c.due)}</td><td class="num">${money(c.amount)}</td><td class="num">${money(E.chargeOutstanding(c))}</td><td>${badge(E.chargeStatus(c))}</td><td>${can("rent.charge.void") && c.status !== "void" && E.chargePaid(c.id) === 0 ? btn("Void", "charge-void", c.id, "sm") : ""}</td></tr>`))}</div>`;
      out += `<div class="card"><h2>Payments</h2>${paymentsTable(pays)}</div>`;
    }
    out += `</div><div class="stack"><div class="card"><h2>Terms</h2><dl class="kv"><dt>Rent</dt><dd>${money(l.rent)} ${E.FREQ_LABEL[l.freq].toLowerCase()}</dd><dt>Start</dt><dd>${fmtDate(l.start)}</dd><dt>End</dt><dd>${fmtDate(l.end)}</dd><dt>Due day</dt><dd>Day ${l.dueDay} of each period</dd><dt>Grace period</dt><dd>${l.grace} days</dd><dt>Notice period</dt><dd>${l.notice} days</dd><dt>Deposit</dt><dd>${l.deposit ? `${money(l.deposit)} ${badge(l.depositStatus)}` : "None"}</dd>${l.terminatedOn ? `<dt>Terminated</dt><dd>${fmtDate(l.terminatedOn)}: ${h(l.terminationReason)}</dd>` : ""}</dl></div>
      <div class="card"><h2>Parties</h2>${l.tenantIds.map((tid, i) => `<div style="padding:4px 0"><a href="#/tenants/${tid}">${h(byId("tenants", tid).name)}</a> <span class="small muted">${i === 0 ? "Primary tenant" : "Co-tenant"}</span></div>`).join("")}</div></div></div>`;
    return out;
  }

  // ───────────────────────── finance ─────────────────────────
  function paymentsTable(pays, showLease = false) {
    return table([{ t: "Received" }, { t: "Reference" }, ...(showLease ? [{ t: "Tenant / unit" }] : []), { t: "Method" }, { t: "Amount", num: 1 }, { t: "Status" }, { t: "" }], pays.map((p) => {
      const l = byId("leases", p.leaseId);
      const a = [];
      if (p.status === "pending" && can("payment.confirm")) a.push(btn("Confirm", "pay-confirm", p.id, "sm primary"));
      if (p.receiptNo) a.push(`<a class="btn sm" href="#/receipt/${p.id}">Receipt</a>`);
      if (p.status === "confirmed" && can("payment.reverse")) a.push(btn("Reverse", "pay-reverse", p.id, "sm danger"));
      return `<tr><td class="nowrap">${fmtDate(p.received)}</td><td class="small">${p.receiptNo || p.ref}${p.extRef ? `<div class="muted">${h(p.extRef)}</div>` : ""}</td>${showLease ? `<td><a href="#/leases/${l.id}">${h(leaseName(l))}</a><div class="small muted">${h(byId("units", l.unitId).ref)}</div></td>` : ""}<td>${h(E.methodLabel(p))}${p.payer ? `<div class="small muted">Paid by ${h(p.payer)}</div>` : ""}</td><td class="num"><b>${money(p.amount)}</b>${E.unapplied(p) ? `<div class="small muted">${money(E.unapplied(p))} credit</div>` : ""}</td><td>${badge(p.status)}${p.status === "reversed" ? `<div class="small muted">${h(p.reverseReason)}</div>` : ""}</td><td><div class="actions">${a.join("")}</div></td></tr>`;
    }), "No payments.");
  }
  function rentView() {
    const q = params(); const leaseIds = new Set(vLeases().map((l) => l.id));
    const list = S().charges.filter((c) => leaseIds.has(c.leaseId)).filter((c) => (!q.s || E.chargeStatus(c) === q.s) && (!q.p || propOfLease(byId("leases", c.leaseId)) === q.p)).sort((a, b) => b.due.localeCompare(a.due));
    const filters = `<div class="filters"><select data-filter="p">${opt("", "All properties")}${vProps().map((p) => opt(p.id, p.name, q.p === p.id)).join("")}</select><select data-filter="s">${opt("", "Any status")}${["overdue", "partially_paid", "unpaid", "paid", "void"].map((s) => opt(s, cap(s), q.s === s)).join("")}</select></div>`;
    const acts = can("rent.charge.create") ? btn("Add manual charge", "charge-new") + btn("Run billing now", "billing", "", "primary") : "";
    return head("Rent charges", "Charges are generated automatically for every billing period of each active lease (a scheduled daily job in the full system).", acts) + `<div class="card">${filters}${table([{ t: "Ref" }, { t: "Tenant / unit" }, { t: "Description" }, { t: "Due" }, { t: "Amount", num: 1 }, { t: "Outstanding", num: 1 }, { t: "Status" }], list.map((c) => { const l = byId("leases", c.leaseId); return `<tr class="${c.status === "void" ? "void" : ""}"><td class="small">${c.ref}</td><td><a href="#/leases/${l.id}">${h(leaseName(l))}</a><div class="small muted">${h(unitLabel(l.unitId))}</div></td><td>${h(c.desc)} <div class="small muted">${E.fmtPeriod(c)}</div></td><td class="nowrap">${fmtDate(c.due)}</td><td class="num">${money(c.amount)}</td><td class="num">${money(E.chargeOutstanding(c))}</td><td>${badge(E.chargeStatus(c))}</td></tr>`; }))}</div>`;
  }
  function paymentsView() {
    const q = params(); const leaseIds = new Set(vLeases().map((l) => l.id));
    const list = S().payments.filter((p) => leaseIds.has(p.leaseId) && (!q.s || p.status === q.s) && (!q.m || p.method === q.m)).sort((a, b) => b.received.localeCompare(a.received) || b.ref.localeCompare(a.ref));
    const filters = `<div class="filters"><select data-filter="s">${opt("", "Any status")}${["pending", "confirmed", "reversed"].map((s) => opt(s, cap(s), q.s === s)).join("")}</select><select data-filter="m">${opt("", "Any method")}${Object.entries(E.METHODS).map(([k, v]) => opt(k, v, q.m === k)).join("")}</select></div>`;
    const momoTotal = list.filter((p) => p.status === "confirmed" && p.method === "mobile_money").reduce((s, p) => s + p.amount, 0);
    return head("Payments & receipts", `Payments are recorded by staff and confirmed by finance (maker-checker). A receipt is issued on confirmation. ${momoTotal ? `Mobile money in this view: ${money(momoTotal)}.` : ""}`, can("payment.record") ? btn("Record payment", "pay-new", "", "primary") : "") + `<div class="card">${filters}${paymentsTable(list, true)}</div><p class="small muted">Mobile money and bank payments are recorded with their transaction ID and reconciled manually. Direct MoMo collection (e.g. via Hubtel or Paystack) is a mock adapter in this MVP, switched off until merchant credentials are configured.</p>`;
  }
  function receiptView(id, portal = false) {
    const p = byId("payments", id); if (!p || !p.receiptNo) return notFound();
    const l = byId("leases", p.leaseId); if (portal ? !l.tenantIds.includes(me.tenantId) : !seeProp(propOfLease(l))) return notFound();
    const t = byId("tenants", l.tenantIds[0]); const o = S().org;
    const allocs = p.alloc.map((a) => { const c = byId("charges", a.chargeId); return `<tr><td>${h(c.desc)} ${E.fmtPeriod(c)}</td><td class="num">${money(a.amount)}</td></tr>`; }).join("");
    return `<div class="no-print" style="margin-bottom:12px"><a href="${portal ? "#/portal" : `#/leases/${l.id}`}">← Back</a> ${FRAMED ? "" : `<button class="btn sm" data-act="print" style="margin-left:8px">Print / save as PDF</button>`}</div>
    <div class="card receipt"><div class="head"><div><div style="font-weight:700;font-size:17px">${h(o.legal)}</div><div class="small muted">${h(o.address)}<br>${h(o.phone)} · ${h(o.email)}</div></div><div style="text-align:right"><div class="small muted">OFFICIAL RECEIPT</div><div style="font-weight:700">${p.receiptNo}</div><div class="small">${fmtDate(p.received)}</div></div></div>
      <div class="row2"><div><h3>Received from</h3><div><b>${h(p.payer || t.name)}</b></div><div class="small">${h(t.name)} · Lease ${l.ref}</div><div class="small">${h(unitLabel(l.unitId))}</div></div><div style="text-align:right"><h3>Amount</h3><div class="big">${money(p.amount)}</div><div class="small">${h(E.methodLabel(p))}${p.extRef ? ` · Ref ${h(p.extRef)}` : ""}</div></div></div>
      <h3 style="margin-top:18px">Applied to</h3><table><tbody>${allocs || `<tr><td class="muted">—</td><td></td></tr>`}${E.unapplied(p) ? `<tr><td>Held as credit for future rent</td><td class="num">${money(E.unapplied(p))}</td></tr>` : ""}</tbody></table>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:22px"><div class="small muted">Recorded by ${h(p.recordedBy)} · Confirmed by ${h(p.confirmedBy || "—")}<br>Balance on lease after this receipt: ${money(E.leaseBalance(l.id).overdue)} overdue</div><span class="stamp ${p.status === "reversed" ? "rev" : ""}">${p.status === "reversed" ? "REVERSED" : "PAID"}</span></div>
      ${p.status === "reversed" ? `<div class="notice warn" style="margin-top:12px">This payment was reversed on ${fmtDate(p.reversedOn)}: ${h(p.reverseReason)}</div>` : ""}
      <p class="small muted" style="margin-top:16px;border-top:1px solid var(--line);padding-top:8px">Demo receipt generated by AI-POS. Fictional organization and data.</p></div>`;
  }
  function arrearsView() {
    const rows = E.arrears(seeProp); const tot = [0, 1, 2, 3].map((i) => rows.reduce((s, r) => s + r.buckets[i], 0));
    return head("Arrears", "Outstanding charges by how many days past the due date. Payments always clear the oldest debt first.", can("report.export") && !FRAMED ? btn("Export CSV", "export-arrears") : "") +
      `<div class="grid g4">${tot.map((v, i) => kpi(`${E.BUCKETS[i]} days`, money(v), "", i === 3 && v ? "alert" : "")).join("")}</div>
      <div class="card" style="margin-top:16px">${table([{ t: "Tenant" }, { t: "Unit" }, ...E.BUCKETS.map((b) => ({ t: b, num: 1 })), { t: "Total", num: 1 }, { t: "" }], rows.map((r) => `<tr><td><a href="#/leases/${r.lease.id}">${h(leaseName(r.lease))}</a><div class="small muted">${h(r.lease.ref)} ${r.lease.status !== "active" ? badge(r.lease.status) : ""}</div></td><td>${h(r.unit.ref)}<div class="small muted">${h(E.propName(r.unit.propertyId))}</div></td>${r.buckets.map((v) => `<td class="num">${v ? money(v) : `<span class="muted">—</span>`}</td>`).join("")}<td class="num"><b>${money(r.total)}</b></td><td><div class="actions">${can("payment.record") ? btn("Record payment", "pay-new", r.lease.id, "sm") + btn("Remind", "remind", r.lease.id, "sm") : ""}</div></td></tr>`), "No arrears.")}</div>`;
  }

  // ───────────────────────── facilities ─────────────────────────
  function requestsView() {
    const q = params();
    const list = vRequests().filter((r) => !q.s || r.status === q.s).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    const filters = `<div class="filters"><select data-filter="s">${opt("", "Any status")}${["submitted", "triaged", "approved", "in_progress", "completed", "closed", "rejected"].map((s) => opt(s, cap(s), q.s === s)).join("")}</select></div>`;
    return head("Maintenance requests", "From staff or tenants via the portal. Triage, approve, then turn into a work order.", can("maintenance.request.create") ? btn("New request", "req-new", "", "primary") : "") +
      `<div class="card">${filters}${table([{ t: "Ref" }, { t: "Issue" }, { t: "Where" }, { t: "Priority" }, { t: "Status" }, { t: "Submitted" }], list.map((r) => `<tr><td><a href="#/maintenance/${r.id}">${r.ref}</a></td><td>${h(r.title)}<div class="small muted">${cap(r.category)}${r.source === "portal" ? " · via tenant portal" : ""}</div></td><td>${h(r.unitId ? unitLabel(r.unitId) : E.propName(r.propertyId))}</td><td>${badge(r.priority)}</td><td>${badge(r.status)}</td><td class="nowrap">${fmtDT(r.submittedAt)}</td></tr>`))}</div>`;
  }
  function requestView(id) {
    const r = byId("requests", id); if (!r || !seeProp(r.propertyId)) return notFound();
    const mg = can("maintenance.request.manage"); let acts = "";
    if (mg && r.status === "submitted") acts += btn("Triage", "req-triage", r.id);
    if (mg && ["submitted", "triaged"].includes(r.status)) acts += btn("Approve", "req-approve", r.id, "primary") + btn("Reject", "req-reject", r.id, "danger");
    if (can("work_order.assign") && r.status === "approved" && !r.workOrderId) acts += btn("Create work order", "wo-from-req", r.id, "primary");
    if (mg && r.status === "completed") acts += btn("Close request", "req-close", r.id, "primary");
    const w = r.workOrderId && byId("workOrders", r.workOrderId);
    return head(`${r.ref} ${badge(r.status)}`, h(r.title), acts, `<a href="#/maintenance">Maintenance requests</a> / ${r.ref}`) +
      `<div class="grid g-side"><div class="stack"><div class="card"><h2>Description</h2><p style="margin:0">${h(r.description)}</p>${r.rejectReason ? `<div class="notice warn" style="margin-top:12px">Rejected: ${h(r.rejectReason)}</div>` : ""}${r.rating ? `<div class="notice ok" style="margin-top:12px">Tenant rating: ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} “${h(r.feedback)}”</div>` : ""}</div>
      ${w ? `<div class="card"><h2>Work order</h2><a href="#/work-orders/${w.id}">${w.ref}</a> ${badge(w.status)} · ${h(w.vendorId ? byId("vendors", w.vendorId).name : E.userName(w.assigneeId))}</div>` : ""}
      <div class="card"><h2>Updates</h2>${r.updates.length ? `<ul class="timeline">${r.updates.map((u) => `<li>${h(u.body)}<div class="m">${h(u.by)} · ${fmtDT(u.at)} · ${u.visibility === "internal" ? "Internal" : "Visible to tenant"}</div></li>`).join("")}</ul>` : `<div class="muted small">No updates.</div>`}</div></div>
      <div class="card"><h2>Details</h2><dl class="kv"><dt>Property</dt><dd>${h(E.propName(r.propertyId))}</dd><dt>Unit</dt><dd>${r.unitId ? h(byId("units", r.unitId).ref) : "Common area"}</dd><dt>Category</dt><dd>${cap(r.category)}</dd><dt>Priority</dt><dd>${badge(r.priority)}</dd><dt>Asset</dt><dd>${r.assetId ? h(byId("assets", r.assetId).name) : "—"}</dd><dt>Reported by</dt><dd>${r.tenantId ? h(byId("tenants", r.tenantId).name) : "Staff"}${r.source === "portal" ? " (portal)" : ""}</dd><dt>Submitted</dt><dd>${fmtDT(r.submittedAt)}</dd></dl></div></div>`;
  }
  function workOrdersView() {
    const q = params();
    const list = vWOs().filter((w) => !q.s || w.status === q.s).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const filters = `<div class="filters"><select data-filter="s">${opt("", "Any status")}${Object.keys(E.WO_FLOW).map((s) => opt(s, cap(s), q.s === s)).join("")}</select></div>`;
    const sub = me.role === "technician" ? "Showing only the jobs assigned to you." : "Assigned to an in-house technician or an external vendor. Costs roll up into maintenance reports.";
    return head("Work orders", sub, can("work_order.assign") ? btn("New work order", "wo-new", "", "primary") : "") + `<div class="card">${filters}${table([{ t: "Ref" }, { t: "Job" }, { t: "Assigned to" }, { t: "Status" }, { t: "Due" }, { t: "Cost", num: 1 }], list.map((w) => `<tr><td><a href="#/work-orders/${w.id}">${w.ref}</a>${w.planId ? `<div class="small muted">Preventive</div>` : ""}</td><td>${h(w.scope)}<div class="small muted">${h(w.unitId ? unitLabel(w.unitId) : E.propName(w.propertyId))}</div></td><td>${h(w.vendorId ? byId("vendors", w.vendorId).name : E.userName(w.assigneeId))}</td><td>${badge(w.status)} ${["emergency", "high"].includes(w.priority) ? badge(w.priority) : ""}</td><td class="nowrap">${w.dueAt && w.dueAt < S().today && !["completed", "closed", "cancelled"].includes(w.status) ? badge("overdue", `Overdue · ${fmtDate(w.dueAt)}`) : fmtDate(w.dueAt)}</td><td class="num">${E.woCost(w) ? money(E.woCost(w)) : "—"}</td></tr>`), me.role === "technician" ? "No jobs assigned to you." : "No work orders.")}</div>`;
  }
  function workOrderView(id) {
    const w = byId("workOrders", id); if (!w || !vWOs().includes(w)) return notFound();
    const up = can("work_order.update"); let acts = "";
    if (up && w.status === "assigned") acts += btn("Start work", "wo-move", `${w.id}|in_progress`, "primary");
    if (up && w.status === "in_progress") acts += btn("Waiting for parts", "wo-move", `${w.id}|waiting_for_parts`) + btn("Mark completed", "wo-complete", w.id, "primary");
    if (up && w.status === "waiting_for_parts") acts += btn("Resume work", "wo-move", `${w.id}|in_progress`, "primary");
    if (can("work_order.close") && w.status === "completed") acts += btn("Sign off & close", "wo-move", `${w.id}|closed`, "primary");
    if (can("work_order.assign") && w.status === "assigned") acts += btn("Cancel", "wo-move", `${w.id}|cancelled`, "danger");
    const r = w.requestId && byId("requests", w.requestId);
    return head(`${w.ref} ${badge(w.status)}`, h(w.scope), acts, `<a href="#/work-orders">Work orders</a> / ${w.ref}`) +
      `<div class="grid g-side"><div class="stack">${w.checklist.length ? `<div class="card"><h2>Checklist</h2>${w.checklist.map((c, i) => `<label style="display:flex;gap:8px;padding:4px 0;align-items:center"><input type="checkbox" style="width:auto" data-act="wo-check" data-id="${w.id}|${i}" ${c.done ? "checked" : ""} ${up && !["closed", "cancelled"].includes(w.status) ? "" : "disabled"}> ${h(c.item)}</label>`).join("")}</div>` : ""}
      <div class="card"><h2>Costs</h2><dl class="kv"><dt>Labour</dt><dd>${money(w.labour)}</dd><dt>Materials</dt><dd>${money(w.materials)}</dd><dt>Vendor invoice</dt><dd>${money(w.vendorCost)}</dd><dt><b>Total</b></dt><dd><b>${money(E.woCost(w))}</b></dd>${w.purchaseRef ? `<dt>Purchase ref</dt><dd>${h(w.purchaseRef)}</dd>` : ""}</dl>${w.completionNotes ? `<div class="notice ok" style="margin-top:12px">${h(w.completionNotes)}</div>` : ""}</div>
      <div class="card"><h2>Activity</h2>${w.log.length ? `<ul class="timeline">${w.log.map((x) => `<li>${cap(x.to)}${x.note ? ` · ${h(x.note)}` : ""}<div class="m">${h(x.by)} · ${fmtDT(x.at)}</div></li>`).join("")}</ul>` : `<div class="muted small">Not started.</div>`}</div></div>
      <div class="card"><h2>Details</h2><dl class="kv"><dt>Property</dt><dd>${h(E.propName(w.propertyId))}</dd><dt>Unit</dt><dd>${w.unitId ? h(byId("units", w.unitId).ref) : "Common area"}</dd><dt>Asset</dt><dd>${w.assetId ? h(byId("assets", w.assetId).name) : "—"}</dd><dt>Priority</dt><dd>${badge(w.priority)}</dd><dt>Assigned to</dt><dd>${h(w.vendorId ? `${byId("vendors", w.vendorId).name} (vendor)` : E.userName(w.assigneeId))}</dd><dt>Due</dt><dd>${fmtDate(w.dueAt)}</dd><dt>Created</dt><dd>${fmtDT(w.createdAt)}</dd>${r && can("maintenance.request.read") ? `<dt>Request</dt><dd><a href="#/maintenance/${r.id}">${r.ref}</a></dd>` : ""}</dl></div></div>`;
  }
  function assetsView() {
    const assets = S().assets.filter((a) => seeProp(a.propertyId));
    const plans = S().plans.filter((p) => seeProp(byId("assets", p.assetId).propertyId)).sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
    const due = plans.filter((p) => E.planStatus(p) !== "scheduled").length;
    return head("Assets & preventive maintenance", "Generators, boreholes, pumps and fire equipment serviced on schedule instead of after they fail.", can("asset.manage") ? btn(`Generate due work orders${due ? ` (${due} due)` : ""}`, "pm-run", "", "primary") : "") +
      `<div class="card"><h2>Preventive maintenance plans</h2>${table([{ t: "Plan" }, { t: "Asset" }, { t: "Every" }, { t: "Next due" }, { t: "Status" }, { t: "Assigned" }], plans.map((p) => { const a = byId("assets", p.assetId); const open = S().workOrders.find((w) => w.planId === p.id && !["completed", "closed", "cancelled"].includes(w.status)); return `<tr><td>${h(p.name)}${p.estimate ? `<div class="small muted">Est. ${money(p.estimate)}</div>` : ""}</td><td>${h(a.name)}<div class="small muted">${h(E.propName(a.propertyId))}</div></td><td>${p.intervalDays} days</td><td class="nowrap">${fmtDate(p.nextDueAt)}</td><td>${badge(E.planStatus(p))}${open ? `<div class="small"><a href="#/work-orders/${open.id}">${open.ref}</a> open</div>` : ""}</td><td>${h(p.vendorId ? byId("vendors", p.vendorId).name : p.assigneeId ? E.userName(p.assigneeId) : "Unassigned")}</td></tr>`; }))}</div>
      <div class="card"><h2>Asset register</h2>${table([{ t: "Asset" }, { t: "Property" }, { t: "Criticality" }, { t: "Condition" }, { t: "Last serviced" }, { t: "Repairs (90 days)", num: 1 }], assets.map((a) => { const n = S().workOrders.filter((w) => w.assetId === a.id && !w.planId && E.dates.diffDays(S().today, w.createdAt.slice(0, 10)) <= 90).length; return `<tr><td>${h(a.name)}<div class="small muted">${h(a.make || a.category)}${a.notes ? ` · ${h(a.notes)}` : ""}</div></td><td>${h(E.propName(a.propertyId))}</td><td>${badge(a.criticality)}</td><td>${cap(a.condition)}</td><td>${fmtDate(a.lastServicedAt)}</td><td class="num">${n >= 3 ? badge("overdue", `${n} repeat`) : n}</td></tr>`; }))}</div>`;
  }
  function vendorsView() {
    return head("Vendors", "External contractors with their job history and spend.") + `<div class="card">${table([{ t: "Vendor" }, { t: "Contact" }, { t: "Services" }, { t: "Jobs", num: 1 }, { t: "Spend", num: 1 }, { t: "Status" }], S().vendors.map((v) => { const ws = S().workOrders.filter((w) => w.vendorId === v.id); return `<tr><td><b>${h(v.name)}</b><div class="small muted">${h(v.area)}${v.notes ? ` · ${h(v.notes)}` : ""}</div></td><td>${h(v.contact)}<div class="small muted">${h(v.phone)}</div></td><td>${v.categories.map((c) => badge("", cap(c))).join(" ")}</td><td class="num">${ws.length}</td><td class="num">${money(ws.reduce((s, w) => s + E.woCost(w), 0))}</td><td>${badge(v.status)}</td></tr>`; }))}</div>`;
  }

  // ───────────────────────── reports ─────────────────────────
  function financialRows() {
    return vProps().map((p) => {
      const ls = S().leases.filter((l) => propOfLease(l) === p.id); const ids = new Set(ls.map((l) => l.id));
      const ch = S().charges.filter((c) => ids.has(c.leaseId) && c.status !== "void");
      const billed = ch.reduce((s, c) => s + c.amount, 0); const collected = S().payments.filter((x) => ids.has(x.leaseId) && x.status === "confirmed").reduce((s, x) => s + x.amount, 0);
      const ar = E.arrears((pid) => pid === p.id).reduce((s, r) => s + r.total, 0);
      const us = S().units.filter((u) => u.propertyId === p.id); const occ = us.filter((u) => E.unitOccupancy(u) === "occupied").length;
      const vacancyLoss = us.filter((u) => E.unitOccupancy(u) !== "occupied").reduce((s, u) => s + u.asking, 0);
      const mcost = S().workOrders.filter((w) => w.propertyId === p.id).reduce((s, w) => s + E.woCost(w), 0);
      return { p, billed, collected, ar, occ, units: us.length, vacancyLoss, mcost };
    });
  }
  function reportsView() {
    let out = head("Reports", "Portfolio performance for owners and managers.", can("report.export") && !FRAMED ? btn("Export CSV", "export-fin") : "");
    if (can("report.financial.read")) {
      const rows = financialRows();
      out += `<div class="card"><h2>Financial summary by property (lease to date)</h2>${table([{ t: "Property" }, { t: "Occupancy", num: 1 }, { t: "Billed", num: 1 }, { t: "Collected", num: 1 }, { t: "Arrears", num: 1 }, { t: "Vacancy loss / month", num: 1 }, { t: "Maintenance spend", num: 1 }], rows.map((r) => `<tr><td>${h(r.p.name)}</td><td class="num">${r.occ}/${r.units}</td><td class="num">${money(r.billed)}</td><td class="num">${money(r.collected)}</td><td class="num">${money(r.ar)}</td><td class="num">${money(r.vacancyLoss)}</td><td class="num">${money(r.mcost)}</td></tr>`))}<p class="small muted" style="margin:10px 0 0">Collected can exceed billed where tenants paid in advance (credit held for future rent).</p></div>`;
    }
    if (can("maintenance.report.read")) {
      const ws = vWOs(); const cats = {};
      ws.forEach((w) => { cats[w.category] = cats[w.category] || { n: 0, cost: 0 }; cats[w.category].n++; cats[w.category].cost += E.woCost(w); });
      const done = ws.filter((w) => w.completedAt); const avgH = done.length ? done.reduce((s, w) => s + (new Date(w.completedAt) - new Date(w.createdAt)) / 36e5, 0) / done.length : 0;
      out += `<div class="grid g3" style="margin-top:16px">${kpi("Work orders (all time)", ws.length)}${kpi("Average time to complete", `${(avgH / 24).toFixed(1)} days`)}${kpi("Total maintenance spend", money(ws.reduce((s, w) => s + E.woCost(w), 0)))}</div>`;
      out += `<div class="card" style="margin-top:16px"><h2>Maintenance cost by category</h2>${table([{ t: "Category" }, { t: "Jobs", num: 1 }, { t: "Cost", num: 1 }], Object.entries(cats).sort((a, b) => b[1].cost - a[1].cost).map(([k, v]) => `<tr><td>${cap(k)}</td><td class="num">${v.n}</td><td class="num">${money(v.cost)}</td></tr>`))}</div>`;
    }
    return out;
  }
  function download(name, rows) {
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name; a.click();
    E.audit("report.exported", "Report", name, ""); E.save(); toast(`Downloaded ${name}`);
  }

  // ───────────────────────── admin ─────────────────────────
  function auditView() {
    const q = params(); const term = (q.q || "").toLowerCase();
    const list = S().audit.filter((a) => !term || `${a.actor} ${a.action} ${a.ref} ${a.detail}`.toLowerCase().includes(term)).slice(0, 300);
    return head("Audit log", "Every create, change, payment and sign-in is recorded with who did it and when. Entries cannot be edited or deleted.") +
      `<div class="card"><div class="filters"><input data-filter="q" placeholder="Search actor, action, reference…" value="${h(q.q || "")}" style="min-width:280px"></div>${table([{ t: "When" }, { t: "Who" }, { t: "Action" }, { t: "Record" }, { t: "Detail" }], list.map((a) => `<tr><td class="nowrap small">${fmtDT(a.at)}</td><td>${h(a.actor)}<div class="small muted">${h(ROLES[a.role]?.name || a.role)}</div></td><td><code class="small">${h(a.action)}</code></td><td class="small">${h(a.entity)} ${h(a.ref)}</td><td class="small">${h(a.detail)}</td></tr>`))}</div>`;
  }
  function notificationsView() {
    return head("Notifications", "Outgoing messages. In this demo the email provider is a mock: messages are captured here instead of being sent.") + `<div class="notice" style="margin-bottom:16px">SMS and WhatsApp reminders are planned after the MVP. Connecting a real provider (e.g. an email API, Hubtel or mNotify SMS) only needs credentials in configuration; the workflow is already built.</div><div class="card">${table([{ t: "Queued" }, { t: "To" }, { t: "Message" }, { t: "Provider" }], S().outbox.map((o) => `<tr><td class="nowrap small">${fmtDT(o.at)}</td><td class="small">${h(o.to)}</td><td><b>${h(o.subject)}</b><div class="small muted">${h(o.body)}</div></td><td>${badge("", `${o.channel} · mock`)}</td></tr>`), "No messages yet. Try “Send reminder” on a lease in arrears.")}</div>`;
  }
  function teamView() {
    const keys = ["property.read", "tenant.sensitive.read", "lease.activate", "payment.record", "payment.confirm", "payment.reverse", "rent.charge.void", "maintenance.request.manage", "work_order.assign", "report.export", "audit.read", "user.manage"];
    const roleKeys = Object.keys(ROLES);
    return head("Team & roles", "Access is controlled by permission, and optionally limited to specific properties.") +
      `<div class="card"><h2>Members</h2>${table([{ t: "Name" }, { t: "Email" }, { t: "Role" }, { t: "Property scope" }], S().users.map((u) => `<tr><td>${h(u.name)}</td><td class="small">${h(u.email)}</td><td>${h(ROLES[u.role].name)}</td><td>${u.scope ? u.scope.map((p) => h(byId("properties", p).name)).join(", ") : u.tenantId ? "Own tenancy only" : "All properties"}</td></tr>`))}</div>
      <div class="card"><h2>Permission matrix (selected)</h2>${table([{ t: "Permission" }, ...roleKeys.map((r) => ({ t: ROLES[r].name.replace(/ \(.*\)/, "") }))], keys.map((k) => `<tr><td><code class="small">${k}</code></td>${roleKeys.map((r) => `<td style="text-align:center">${ROLES[r].perms.includes(k) ? "✓" : `<span class="muted">·</span>`}</td>`).join("")}</tr>`))}</div>`;
  }

  // ───────────────────────── AI (mock provider) ─────────────────────────
  function insights() {
    const out = []; const today = S().today;
    const ar = E.arrears(seeProp);
    const old = ar.filter((r) => r.buckets[3] > 0);
    if (old.length) out.push({ sev: "high", t: `${old.length} tenant(s) are more than 90 days behind`, b: `${old.map((r) => `${leaseName(r.lease)} (${money(r.buckets[3])} over 90 days)`).join("; ")}. Debts this old are much harder to recover; agree a written payment plan now.`, link: "#/arrears" });
    const exp = vLeases().filter((l) => l.status === "active" && E.dates.diffDays(l.end, today) <= 45 && l.end >= today && !S().leases.some((x) => x.renewalOf === l.id));
    if (exp.length) out.push({ sev: "med", t: `${exp.length} lease(s) end within 45 days with no renewal drafted`, b: exp.map((l) => `${leaseName(l)} at ${byId("units", l.unitId).ref}, ends ${fmtDate(l.end)}`).join("; ") + ". Starting renewals early avoids vacancy.", link: "#/leases" });
    const rep = S().assets.filter((a) => seeProp(a.propertyId)).map((a) => ({ a, ws: S().workOrders.filter((w) => w.assetId === a.id && !w.planId && E.dates.diffDays(today, w.createdAt.slice(0, 10)) <= 90) })).filter((x) => x.ws.length >= 3);
    rep.forEach(({ a, ws }) => out.push({ sev: "med", t: `${a.name} failed ${ws.length} times in 90 days`, b: `Repairs cost ${money(ws.reduce((s, w) => s + E.woCost(w), 0))} so far. Replacement is likely cheaper than continued repair.`, link: "#/assets" }));
    const vac = vUnits().filter((u) => E.unitOccupancy(u) === "vacant");
    if (vac.length) out.push({ sev: "low", t: `${vac.length} vacant unit(s) losing ${money(vac.reduce((s, u) => s + u.asking, 0))} a month`, b: vac.map((u) => `${u.ref} (${E.propName(u.propertyId)})`).join(", ") + ".", link: "#/units?s=vacant" });
    const credit = vLeases().map((l) => ({ l, c: E.leaseBalance(l.id).credit })).filter((x) => x.c > 0);
    if (credit.length) out.push({ sev: "low", t: "Advance payments held as credit", b: credit.map((x) => `${leaseName(x.l)}: ${money(x.c)}`).join("; ") + ". These will clear future charges automatically.", link: "#/payments" });
    return out;
  }
  const insightHtml = (i) => `<div class="insight ${i.sev}"><div class="t">${h(i.t)}</div><div class="small">${h(i.b)}</div>${i.link ? `<a class="small" href="${i.link}">Review →</a>` : ""}</div>`;
  const QUESTIONS = ["Who owes the most?", "What is our occupancy?", "Summarise this month's collections", "Which leases expire soon?", "Which assets keep failing?", "Draft a reminder for Esi Quaye"];
  function answer(q) {
    const s = q.toLowerCase(); const today = S().today;
    if (/owe|arrear|debt|behind/.test(s)) { const ar = E.arrears(seeProp).slice(0, 5); return `Total arrears are <b>${money(E.arrears(seeProp).reduce((x, r) => x + r.total, 0))}</b>. The largest balances:<ul>${ar.map((r) => `<li>${h(leaseName(r.lease))} (${h(r.unit.ref)}): ${money(r.total)}, oldest ${r.oldest} days</li>`).join("")}</ul>`; }
    if (/occup|vacan|empty/.test(s)) return `Portfolio occupancy:<ul>${vProps().map((p) => { const us = S().units.filter((u) => u.propertyId === p.id); const o = us.filter((u) => E.unitOccupancy(u) === "occupied").length; return `<li>${h(p.name)}: ${o} of ${us.length} units (${Math.round((o / us.length) * 100)}%)</li>`; }).join("")}</ul>`;
    if (/collect|this month|income|revenue/.test(s)) { const mk = today.slice(0, 7); const ids = new Set(vLeases().map((l) => l.id)); const ps = S().payments.filter((p) => ids.has(p.leaseId) && p.status === "confirmed" && p.received.slice(0, 7) === mk); const pend = S().payments.filter((p) => ids.has(p.leaseId) && p.status === "pending"); const by = {}; ps.forEach((p) => { const k = E.methodLabel(p); by[k] = (by[k] || 0) + p.amount; }); return `This month you have collected <b>${money(ps.reduce((x, p) => x + p.amount, 0))}</b> across ${ps.length} confirmed payment(s)${Object.keys(by).length ? `:<ul>${Object.entries(by).map(([k, v]) => `<li>${h(k)}: ${money(v)}</li>`).join("")}</ul>` : "."} ${pend.length ? `${pend.length} payment(s) worth ${money(pend.reduce((x, p) => x + p.amount, 0))} are waiting for finance confirmation.` : ""}`; }
    if (/expir|renew|end/.test(s)) { const ls = vLeases().filter((l) => l.status === "active" && E.dates.diffDays(l.end, today) <= 90 && l.end >= today).sort((a, b) => a.end.localeCompare(b.end)); return ls.length ? `Leases ending in the next 90 days:<ul>${ls.map((l) => `<li>${h(leaseName(l))}, ${h(byId("units", l.unitId).ref)}: ends ${fmtDate(l.end)}${S().leases.some((x) => x.renewalOf === l.id) ? " (renewal drafted)" : ""}</li>`).join("")}</ul>` : "No leases end in the next 90 days."; }
    if (/asset|fail|repair|pump|generator/.test(s)) { const rows = S().assets.filter((a) => seeProp(a.propertyId)).map((a) => ({ a, ws: S().workOrders.filter((w) => w.assetId === a.id && !w.planId) })).filter((x) => x.ws.length).sort((a, b) => b.ws.length - a.ws.length); return `Repair history by asset:<ul>${rows.map(({ a, ws }) => `<li>${h(a.name)} (${h(E.propName(a.propertyId))}): ${ws.length} repair(s), ${money(ws.reduce((x, w) => x + E.woCost(w), 0))}</li>`).join("")}</ul>${rows[0] && rows[0].ws.length >= 3 ? `Recommendation: get a replacement quote for the ${h(rows[0].a.name.toLowerCase())}.` : ""}`; }
    const m = s.match(/remind(?:er)?(?: for)? (.+)/);
    if (m || /draft|letter|message/.test(s)) { const name = (m ? m[1] : "").replace(/[?.]/g, "").trim(); const t = vTenants().find((x) => name && x.name.toLowerCase().includes(name.split(" ")[0])) || byId("tenants", E.arrears(seeProp)[0]?.lease.tenantIds[0]); if (!t) return "No tenant found."; const l = vLeases().find((x) => x.tenantIds[0] === t.id && x.status === "active") || vLeases().find((x) => x.tenantIds[0] === t.id); const b = E.leaseBalance(l.id); return `Draft for <b>${h(t.name)}</b> (review before sending):<div class="card" style="margin-top:8px;font-size:13px">Dear ${h(t.name.split(" ")[0])},<br><br>We hope you are well. Our records show an outstanding balance of <b>${money(b.overdue)}</b> on your tenancy at ${h(unitLabel(l.unitId))} (lease ${l.ref}).<br><br>Kindly settle by mobile money or bank transfer, quoting ${l.ref}, or call us to agree a payment plan. If you have already paid, please share the transaction ID and we will update your statement.<br><br>Thank you,<br>${h(S().org.name)}</div>`; }
    return `I can answer questions about arrears, occupancy, collections, lease expiries and asset repairs, and draft tenant reminders. Try one of the suggestions.`;
  }
  let chat = [];
  function aiView() {
    return head("AI assistant", "Insights and answers computed from your live portfolio data.") +
      `<div class="notice" style="margin-bottom:16px"><b>Preview, using a mock AI provider.</b> Answers come from deterministic rules over your data, so no tenant data leaves the system. In production a large language model plugs in behind the same interface (AI_PROVIDER setting), and anything it drafts still needs human approval before it is sent.</div>
      <div class="grid g2"><div class="card"><h2>Insights</h2>${insights().map(insightHtml).join("") || `<div class="muted">No issues detected.</div>`}</div>
      <div class="card"><h2>Ask about your portfolio</h2><div id="chat">${chat.map((c) => `<div class="ai-msg q">${h(c.q)}</div><div class="ai-msg a">${c.a}</div>`).join("")}</div>
      <form id="askf" style="display:flex;gap:8px;margin:10px 0"><input name="q" placeholder="e.g. Who owes the most?" autocomplete="off"><button class="btn primary">Ask</button></form><div class="chips">${QUESTIONS.map((q) => `<button class="chip" data-act="ask" data-id="${h(q)}">${h(q)}</button>`).join("")}</div></div></div>`;
  }
  function ask(q) { if (!q.trim()) return; chat.push({ q, a: answer(q) }); E.audit("ai.query", "AI", "assistant", q); E.save(); }
  document.addEventListener("submit", (e) => { if (e.target.id === "askf") { e.preventDefault(); ask(new FormData(e.target).get("q")); } });

  // ───────────────────────── tenant portal ─────────────────────────
  function portalView() {
    const t = byId("tenants", me.tenantId);
    const ls = S().leases.filter((l) => l.tenantIds.includes(t.id) && ["active", "terminated"].includes(l.status));
    const l = ls.find((x) => x.status === "active") || ls[0];
    const b = E.leaseBalance(l.id); const unit = byId("units", l.unitId);
    const pays = S().payments.filter((p) => p.leaseId === l.id && p.receiptNo).sort((a, c) => c.received.localeCompare(a.received));
    const reqs = S().requests.filter((r) => r.tenantId === t.id).sort((a, c) => c.submittedAt.localeCompare(a.submittedAt));
    const next = S().charges.filter((c) => c.leaseId === l.id && E.chargeOutstanding(c) > 0).sort((a, c) => a.due.localeCompare(c.due))[0];
    return `<div class="content" style="max-width:960px;margin:0 auto"><div class="page-head"><div><h1>Akwaaba, ${h(t.name.split(" ")[0])}</h1><p>${h(unit.ref)} · ${h(E.propName(unit.propertyId))} · Lease ${l.ref}</p></div><div class="actions">${btn("Report a problem", "req-portal", "", "primary")}${btn("Sign out", "logout")}</div></div>
      <div class="grid g3">${kpi("Amount due now", money(b.overdue), b.overdue ? "Please pay by MoMo or bank transfer" : "You are fully paid up", b.overdue ? "alert" : "")}${kpi("Monthly rent", money(l.rent), E.FREQ_LABEL[l.freq])}${kpi("Lease ends", fmtDate(l.end), `${E.dates.diffDays(l.end, S().today)} days from today`)}</div>
      ${next ? `<div class="notice" style="margin-top:16px">Next charge: ${h(next.desc)} ${E.fmtPeriod(next)}, ${money(E.chargeOutstanding(next))} due ${fmtDate(next.due)}.</div>` : ""}
      <div class="notice warn" style="margin-top:12px">Online payment from the portal (MoMo prompt) is switched off in this MVP. Pay as usual and your landlord records it; your receipt appears here once confirmed.</div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h2>My receipts</h2>${table([{ t: "Date" }, { t: "Receipt" }, { t: "Amount", num: 1 }, { t: "" }], pays.slice(0, 8).map((p) => `<tr><td class="nowrap">${fmtDate(p.received)}</td><td class="small">${p.receiptNo}${p.status === "reversed" ? ` ${badge("reversed")}` : ""}</td><td class="num">${money(p.amount)}</td><td><a class="btn sm" href="#/portal/receipt/${p.id}">View</a></td></tr>`), "No receipts yet.")}</div>
      <div class="card"><h2>My maintenance requests</h2>${reqs.length ? reqs.map((r) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px"><b>${h(r.title)}</b>${badge(r.status)}</div><div class="small muted">${r.ref} · ${fmtDT(r.submittedAt)}</div>${r.updates.filter((u) => u.visibility === "tenant").map((u) => `<div class="small" style="margin-top:4px">↳ ${h(u.body)}</div>`).join("")}${r.rating ? `<div class="small">Your rating: ${"★".repeat(r.rating)}</div>` : ["completed", "closed"].includes(r.status) ? `<div style="margin-top:6px">${btn("Rate this repair", "req-rate", r.id, "sm")}</div>` : ""}</div>`).join("") : `<div class="muted small">None.</div>`}</div></div>
      <div class="card" style="margin-top:16px"><h2>My statement</h2>${table([{ t: "Date" }, { t: "Description" }, { t: "Charge", num: 1 }, { t: "Paid", num: 1 }, { t: "Balance", num: 1 }], E.ledger(l.id).slice(-12).reverse().map((x) => `<tr class="${x.voided ? "void" : ""}"><td class="nowrap">${fmtDate(x.date)}</td><td>${h(x.desc)}</td><td class="num">${x.debit ? money(x.debit) : ""}</td><td class="num">${x.credit ? money(x.credit) : ""}</td><td class="num">${money(x.balance)}</td></tr>`))}<p class="small muted" style="margin:8px 0 0">Last 12 entries, newest first.</p></div></div>`;
  }

  function notFound() { return `<div class="card empty"><h2>Not found</h2><p>This record does not exist or is outside your access scope.</p><a href="#/dashboard">Back to dashboard</a></div>`; }
  function denied(perm) { return `<div class="card empty"><h2>Access denied</h2><p>Your role (${h(ROLES[me.role].name)}) does not have the <code>${h(perm)}</code> permission. The server enforces this on every request, not just the menu.</p><button class="btn" data-act="logout">Switch role</button></div>`; }

  // ───────────────────────── forms ─────────────────────────
  const today = () => S().today;
  function leaseOptions(sel, onlyActive = true) { return vLeases().filter((l) => !onlyActive || l.status === "active").map((l) => opt(l.id, `${leaseName(l)} — ${byId("units", l.unitId).ref} (${l.ref})`, sel === l.id)).join(""); }
  function payForm(leaseId) {
    const l = leaseId && byId("leases", leaseId); const due = l ? E.leaseBalance(l.id).overdue : 0;
    modal("Record payment", `<label class="f"><span>Lease</span><select name="leaseId" required>${leaseOptions(leaseId)}</select></label>
      <div class="row2"><label class="f"><span>Amount (GH₵)</span><input name="amount" inputmode="decimal" required value="${due ? (due / 100).toFixed(2) : ""}"><small>${l ? `Currently overdue: ${money(due)}` : ""}</small></label><label class="f"><span>Date received</span><input type="date" name="received" required value="${today()}" max="${today()}"></label></div>
      <div class="row2"><label class="f"><span>Method</span><select name="method">${Object.entries(E.METHODS).map(([k, v]) => opt(k, v, k === "mobile_money")).join("")}</select></label><label class="f"><span>MoMo network</span><select name="network">${Object.entries(E.MOMO_NETWORKS).map(([k, v]) => opt(k, v)).join("")}</select><small>Only used for mobile money</small></label></div>
      <label class="f"><span>Transaction ID / reference</span><input name="extRef" placeholder="e.g. MoMo transaction ID or bank slip"><small>Duplicate references are rejected automatically.</small></label>
      <label class="f"><span>Paid by (if not the tenant)</span><input name="payer" placeholder="Optional"></label>
      ${can("payment.confirm") ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="confirm" style="width:auto" checked> Confirm now and issue receipt</label>` : `<div class="notice">You can record this payment; a Finance Officer confirms it and the receipt is then issued.</div>`}`,
    (d) => { const amt = toMinor(d.amount); if (!(amt > 0)) throw new Error("Enter an amount greater than zero"); if (d.method === "mobile_money" && !d.extRef) throw new Error("Enter the MoMo transaction ID"); const p = E.recordPayment({ leaseId: d.leaseId, amount: amt, received: d.received, method: d.method, network: d.method === "mobile_money" ? d.network : null, extRef: d.extRef.trim(), payer: d.payer.trim(), confirm: !!d.confirm }); return p.status === "confirmed" ? `Payment confirmed. Receipt ${p.receiptNo} issued.` : `Payment ${p.ref} recorded, awaiting finance confirmation.`; }, "Record payment");
  }
  const actions = {
    login: (id) => signIn(id), logout: () => signOut(), menu: () => document.getElementById("sidebar").classList.toggle("open"), "close-modal": closeModal, print: () => window.print(),
    reset: () => { E.reset(); chat = []; restore(); toast("Demo data reset to the original sample portfolio."); render(); },
    "pay-new": (id) => payForm(id),
    "pay-confirm": (id) => { const p = E.confirmPayment(id); E.save(); toast(`Confirmed. Receipt ${p.receiptNo} issued.`); },
    "pay-reverse": (id) => { const p = byId("payments", id); modal(`Reverse ${p.receiptNo}`, `<p>Reversing ${money(p.amount)} adds a compensating entry to the ledger. The original stays visible for audit.</p><label class="f"><span>Reason</span><textarea name="reason" required placeholder="e.g. Cheque bounced / duplicate entry"></textarea></label>`, (d) => { E.reversePayment(id, d.reason); return "Payment reversed and charges reopened."; }, "Reverse payment", true); },
    "charge-void": (id) => { modal("Void charge", `<label class="f"><span>Reason</span><input name="reason" required placeholder="e.g. Rent-free month agreed"></label>`, (d) => { if (!d.reason.trim()) throw new Error("Reason required"); E.voidCharge(id, d.reason.trim()); return "Charge voided."; }, "Void charge", true); },
    "charge-new": () => modal("Add manual charge", `<label class="f"><span>Lease</span><select name="leaseId">${leaseOptions()}</select></label><div class="row2"><label class="f"><span>Type</span><select name="type">${opt("service_charge", "Service charge")}${opt("utility", "Utility (water / ECG)")}${opt("penalty", "Late fee")}${opt("other", "Other")}</select></label><label class="f"><span>Amount (GH₵)</span><input name="amount" required inputmode="decimal"></label></div><div class="row2"><label class="f"><span>Due date</span><input type="date" name="due" value="${today()}"></label><label class="f"><span>Description</span><input name="desc" required placeholder="e.g. Water bill, October"></label></div>`, (d) => { const amt = toMinor(d.amount); if (!(amt > 0)) throw new Error("Enter an amount"); if (!d.desc.trim()) throw new Error("Description required"); const S0 = S(); S0.charges.push({ id: `c${Date.now()}`, ref: `CHG-M${String(S0.charges.length + 1).padStart(4, "0")}`, leaseId: d.leaseId, type: d.type, periodStart: d.due, periodEnd: d.due, due: d.due, amount: amt, status: "open", desc: d.desc.trim() }); E.audit("charge.created", "RentCharge", d.desc, money(amt)); return "Charge added."; }, "Add charge"),
    billing: () => { const n = E.runBilling(); E.save(); toast(n ? `${n} new charge(s) generated.` : "All charges are up to date for the current period."); },
    remind: (id) => { E.sendReminder(id); E.save(); toast("Reminder queued (mock email). See Notifications."); },
    "lease-activate": (id) => { try { E.activateLease(id); E.save(); toast("Lease activated; charges generated."); } catch (e) { toast(e.message); } },
    "lease-pending": (id) => { E.markPending(id); E.save(); toast("Lease sent for signature."); },
    "lease-terminate": (id) => modal("Terminate lease", `<div class="row2"><label class="f"><span>Termination date</span><input type="date" name="on" value="${today()}" required></label></div><label class="f"><span>Reason</span><input name="reason" required></label><p class="small muted">Unpaid charges for periods starting on or after this date are voided automatically.</p>`, (d) => { if (!d.reason.trim()) throw new Error("Reason required"); E.terminateLease(id, d.on, d.reason.trim()); return "Lease terminated."; }, "Terminate", true),
    "lease-new": () => {
      const units = vUnits().filter((u) => ["vacant"].includes(E.unitOccupancy(u)));
      modal("New lease (draft)", `<label class="f"><span>Unit</span><select name="unitId">${units.map((u) => opt(u.id, `${u.ref} · ${E.propName(u.propertyId)} (asking ${money(u.asking)})`)).join("")}</select><small>Only vacant units are listed.</small></label><label class="f"><span>Tenant</span><select name="tenantId">${vTenants().map((t) => opt(t.id, t.name)).join("")}</select></label>
        <div class="row2"><label class="f"><span>Start</span><input type="date" name="start" value="${E.dates.firstOfMonth(E.dates.addMonths(today(), 1))}"></label><label class="f"><span>Length (months)</span><input name="months" value="12" inputmode="numeric"></label></div>
        <div class="row2"><label class="f"><span>Rent per period (GH₵)</span><input name="rent" required inputmode="decimal"></label><label class="f"><span>Billing</span><select name="freq">${Object.entries(E.FREQ_LABEL).map(([k, v]) => opt(k, v)).join("")}</select></label></div><label class="f"><span>Deposit (GH₵)</span><input name="deposit" inputmode="decimal" placeholder="0"></label>`,
        (d) => { if (!d.unitId) throw new Error("No vacant unit available"); const rent = toMinor(d.rent); if (!(rent > 0)) throw new Error("Enter the rent"); const months = parseInt(d.months, 10) || 12; const l = E.createLease({ unitId: d.unitId, tenantIds: [d.tenantId], start: d.start, end: E.dates.addDays(E.dates.addMonths(d.start, months), -1), rent, freq: d.freq, deposit: d.deposit ? toMinor(d.deposit) : 0 }); setTimeout(() => go(`#/leases/${l.id}`)); return `Draft lease ${l.ref} created. Activate it to start billing.`; }, "Create draft");
    },
    "tenant-new": () => modal("Add tenant", `<div class="row2"><label class="f"><span>Type</span><select name="type">${opt("individual", "Individual")}${opt("organization", "Business")}</select></label><label class="f"><span>Full name</span><input name="name" required></label></div><div class="row2"><label class="f"><span>Phone</span><input name="phone" required placeholder="024 000 0000"></label><label class="f"><span>Email</span><input name="email" type="email"></label></div><div class="row2"><label class="f"><span>ID type</span><select name="idType">${opt("Ghana Card", "Ghana Card")}${opt("Passport", "Passport")}${opt("Voter ID", "Voter ID")}${opt("Driver's licence", "Driver's licence")}</select></label><label class="f"><span>ID number</span><input name="idRef" placeholder="GHA-000000000-0"></label></div><label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="privacy" style="width:auto;margin-top:3px"> <span class="small">Tenant has been shown the privacy notice and consents to their data being processed (Data Protection Act, 2012).</span></label>`, (d) => { if (!d.name.trim() || !d.phone.trim()) throw new Error("Name and phone are required"); if (!d.privacy) throw new Error("Privacy notice consent is required"); const t = E.createTenant({ type: d.type, name: d.name.trim(), phone: d.phone.trim(), email: d.email.trim() || null, idType: d.idRef ? d.idType : null, idRef: d.idRef.trim() || null }); setTimeout(() => go(`#/tenants/${t.id}`)); return "Tenant added."; }, "Add tenant"),
    "note-new": (id) => modal("Add note", `<label class="f"><span>Type</span><select name="kind">${["Call", "Visit", "Note", "WhatsApp"].map((k) => opt(k, k)).join("")}</select></label><label class="f"><span>Note</span><textarea name="body" required></textarea></label>`, (d) => { if (!d.body.trim()) throw new Error("Write a note"); E.addNote(id, d.kind, d.body.trim()); return "Note added."; }),
    "req-new": () => modal("New maintenance request", reqFields(true), (d) => { const r = makeReq(d, "staff"); setTimeout(() => go(`#/maintenance/${r.id}`)); return `${r.ref} submitted.`; }, "Submit"),
    "req-portal": () => modal("Report a problem", reqFields(false), (d) => { const r = makeReq(d, "portal"); return `Thank you. Request ${r.ref} sent to the facility team.`; }, "Send request"),
    "req-triage": (id) => modal("Triage request", `<label class="f"><span>Internal note</span><textarea name="note" placeholder="e.g. Checked by caretaker"></textarea></label>`, (d) => { E.requestAction(id, "triage", d.note.trim()); return "Request triaged."; }, "Triage"),
    "req-approve": (id) => { E.requestAction(id, "approve", ""); E.save(); toast("Approved. Now create a work order."); },
    "req-reject": (id) => modal("Reject request", `<label class="f"><span>Reason (shown to tenant)</span><textarea name="note" required></textarea></label>`, (d) => { if (!d.note.trim()) throw new Error("Reason required"); E.requestAction(id, "reject", d.note.trim()); return "Request rejected."; }, "Reject", true),
    "req-close": (id) => modal("Close request", `<label class="f"><span>Resolution note (shown to tenant)</span><textarea name="note" required></textarea></label>`, (d) => { E.requestAction(id, "close", d.note.trim() || "Resolved."); return "Request closed."; }, "Close"),
    "req-rate": (id) => modal("Rate this repair", `<label class="f"><span>Rating</span><select name="rating">${[5, 4, 3, 2, 1].map((n) => opt(n, `${"★".repeat(n)} (${n})`)).join("")}</select></label><label class="f"><span>Comment</span><input name="comment"></label>`, (d) => { const r = byId("requests", id); r.rating = +d.rating; r.feedback = d.comment.trim(); E.audit("maintenance_request.rated", "MaintenanceRequest", r.ref, `${r.rating}/5`); return "Thanks for your feedback."; }, "Submit"),
    "wo-from-req": (id) => { const r = byId("requests", id); woForm({ requestId: r.id, propertyId: r.propertyId, unitId: r.unitId, assetId: r.assetId, category: r.category, priority: r.priority, scope: r.title }); },
    "wo-new": () => woForm(null),
    "wo-move": (v) => { const [id, to] = v.split("|"); try { E.woTransition(id, to); E.save(); toast(`Work order ${cap(to).toLowerCase()}.`); } catch (e) { toast(e.message); } },
    "wo-complete": (id) => { const w = byId("workOrders", id); modal(`Complete ${w.ref}`, `<label class="f"><span>What was done</span><textarea name="notes" required></textarea></label><div class="row2"><label class="f"><span>Labour (GH₵)</span><input name="labour" inputmode="decimal" value="${w.labour / 100 || ""}"></label><label class="f"><span>Materials (GH₵)</span><input name="materials" inputmode="decimal" value="${w.materials / 100 || ""}"></label></div><div class="row2"><label class="f"><span>Vendor invoice (GH₵)</span><input name="vendor" inputmode="decimal" value="${w.vendorCost / 100 || ""}"></label><label class="f"><span>Receipt / invoice ref</span><input name="ref"></label></div>`, (d) => { const n = (x) => (x ? toMinor(x) || 0 : 0); E.woTransition(id, "completed", { completionNotes: d.notes.trim(), labour: n(d.labour), materials: n(d.materials), vendorCost: n(d.vendor), purchaseRef: d.ref.trim() }); return "Marked completed. A manager signs off to close."; }, "Complete"); },
    "wo-check": (v) => { const [id, i] = v.split("|"); const w = byId("workOrders", id); w.checklist[+i].done = !w.checklist[+i].done; E.save(); },
    "pm-run": () => { const n = E.generatePM(); E.save(); toast(n ? `${n} preventive work order(s) created.` : "No new preventive work orders needed (open ones already exist)."); },
    ask: (q) => ask(q),
    "export-arrears": () => download(`arrears-${today()}.csv`, [["Tenant", "Lease", "Unit", "Property", ...E.BUCKETS, "Total"], ...E.arrears(seeProp).map((r) => [leaseName(r.lease), r.lease.ref, r.unit.ref, E.propName(r.unit.propertyId), ...r.buckets.map((b) => (b / 100).toFixed(2)), (r.total / 100).toFixed(2)])]),
    "export-fin": () => download(`portfolio-summary-${today()}.csv`, [["Property", "Units", "Occupied", "Billed GHS", "Collected GHS", "Arrears GHS", "Maintenance GHS"], ...financialRows().map((r) => [r.p.name, r.units, r.occ, (r.billed / 100).toFixed(2), (r.collected / 100).toFixed(2), (r.ar / 100).toFixed(2), (r.mcost / 100).toFixed(2)])]),
  };
  function reqFields(staff) {
    const units = staff ? vUnits() : S().units.filter((u) => S().leases.some((l) => l.unitId === u.id && l.status === "active" && l.tenantIds.includes(me.tenantId)));
    return `${staff ? `<label class="f"><span>Unit or property</span><select name="unitId">${vProps().map((p) => opt(`p:${p.id}`, `${p.name} — common area`)).join("")}${units.map((u) => opt(u.id, `${u.ref} · ${E.propName(u.propertyId)}`)).join("")}</select></label>` : `<input type="hidden" name="unitId" value="${units[0]?.id || ""}">`}
      <label class="f"><span>What is the problem?</span><input name="title" required placeholder="e.g. No water from the kitchen tap"></label><label class="f"><span>Details</span><textarea name="description" required></textarea></label>
      <div class="row2"><label class="f"><span>Category</span><select name="category">${["plumbing", "electrical", "hvac", "structural", "pest control", "security", "other"].map((c) => opt(c, cap(c))).join("")}</select></label><label class="f"><span>Urgency</span><select name="priority">${["low", "normal", "high", "emergency"].map((c) => opt(c, cap(c), c === "normal")).join("")}</select><small>Emergency alerts the facility team immediately.</small></label></div>`;
  }
  function makeReq(d, source) {
    if (!d.title.trim() || !d.description.trim()) throw new Error("Please describe the problem");
    const isProp = d.unitId.startsWith("p:"); const unit = isProp ? null : byId("units", d.unitId);
    const lease = unit && E.unitLease(unit.id);
    return E.createRequest({ propertyId: isProp ? d.unitId.slice(2) : unit.propertyId, unitId: unit?.id, tenantId: source === "portal" ? me.tenantId : lease?.tenantIds[0], category: d.category, priority: d.priority, title: d.title.trim(), description: d.description.trim(), source });
  }
  function woForm(pre) {
    const techs = S().users.filter((u) => u.role === "technician");
    modal(pre ? "Create work order from request" : "New work order", `${pre ? `<p class="small muted">${h(pre.scope)} · ${h(pre.unitId ? unitLabel(pre.unitId) : E.propName(pre.propertyId))}</p>` : `<label class="f"><span>Property</span><select name="propertyId">${vProps().map((p) => opt(p.id, p.name)).join("")}</select></label><label class="f"><span>Scope of work</span><textarea name="scope" required></textarea></label><label class="f"><span>Category</span><select name="category">${["plumbing", "electrical", "hvac", "structural", "generator", "other"].map((c) => opt(c, cap(c))).join("")}</select></label>`}
      <label class="f"><span>Assign to</span><select name="who">${techs.map((t) => opt(`u:${t.id}`, `${t.name} (in-house technician)`)).join("")}${S().vendors.filter((v) => v.status === "active").map((v) => opt(`v:${v.id}`, `${v.name} (vendor)`)).join("")}</select></label>
      <label class="f"><span>Due date</span><input type="date" name="dueAt" value="${E.dates.addDays(today(), pre?.priority === "emergency" ? 0 : 3)}"></label>`,
    (d) => { const [k, id] = d.who.split(":"); const base = pre || { propertyId: d.propertyId, scope: d.scope.trim(), category: d.category, priority: "normal" }; if (!base.scope) throw new Error("Describe the work"); const w = E.createWorkOrder({ ...base, vendorId: k === "v" ? id : null, assigneeId: k === "u" ? id : null, dueAt: d.dueAt }); setTimeout(() => go(`#/work-orders/${w.id}`)); return `${w.ref} created and assigned.`; }, "Create work order");
  }

  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="#/"]');
    if (link && FRAMED) { e.preventDefault(); document.getElementById("sidebar")?.classList.remove("open"); go(link.getAttribute("href")); return; }
    const el = e.target.closest("[data-act]"); if (!el) return;
    if (el.tagName === "INPUT" && el.type === "checkbox") { actions[el.dataset.act]?.(el.dataset.id); return; }
    e.preventDefault(); const fn = actions[el.dataset.act];
    if (fn) { try { fn(el.dataset.id); } catch (err) { toast(err.message); } }
  });
  document.addEventListener("change", (e) => {
    const f = e.target.closest("[data-filter]"); if (!f) return;
    const q = params(); q[f.dataset.filter] = f.value; setParams(q);
  });
  let filterTimer;
  document.addEventListener("input", (e) => {
    const f = e.target.closest("input[data-filter]"); if (!f) return;
    clearTimeout(filterTimer); filterTimer = setTimeout(() => { const q = params(); q[f.dataset.filter] = f.value; setParams(q, true); }, 300);
  });
  function params() { const qs = curHash().split("?")[1] || ""; return Object.fromEntries(new URLSearchParams(qs)); }
  function setParams(q, keepFocus) {
    const base = curHash().split("?")[0]; const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
    const next = s ? `${base}?${s}` : base;
    if (keepFocus) { if (FRAMED) memHash = next; else history.replaceState(null, "", next); render(); const i = document.querySelector("input[data-filter]"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    else go(next);
  }

  // ───────────────────────── routes ─────────────────────────
  route("#/dashboard", null, dashboard);
  route("#/properties", "property.read", propertiesView);
  route("#/properties/:id", "property.read", propertyView);
  route("#/units", "unit.read", unitsView);
  route("#/tenants", "tenant.read", tenantsView);
  route("#/tenants/:id", "tenant.read", tenantView);
  route("#/leases", "lease.read", leasesView);
  route("#/leases/:id", "lease.read", leaseView);
  route("#/rent", "rent.read", rentView);
  route("#/payments", "rent.read", paymentsView);
  route("#/receipt/:id", "rent.read", (id) => receiptView(id));
  route("#/arrears", "rent.read", arrearsView);
  route("#/maintenance", "maintenance.request.read", requestsView);
  route("#/maintenance/:id", "maintenance.request.read", requestView);
  route("#/work-orders", "work_order.read", workOrdersView);
  route("#/work-orders/:id", "work_order.read", workOrderView);
  route("#/assets", "asset.read", assetsView);
  route("#/vendors", "vendor.read", vendorsView);
  route("#/reports", null, () => (can("report.financial.read") || can("maintenance.report.read") ? reportsView() : denied("report.financial.read")));
  route("#/ai", "ai.insight.read", aiView);
  route("#/audit", "audit.read", auditView);
  route("#/notifications", null, notificationsView);
  route("#/team", null, () => (can("user.manage") || can("audit.read") ? teamView() : denied("user.manage")));

  const app = document.getElementById("app");
  function render() {
    const hash = curHash().split("?")[0];
    window.scrollTo(0, 0);
    if (!me || hash === "#/login") { if (me && hash === "#/login") { /* show picker while signed in */ } app.innerHTML = loginView(); document.title = "AI-POS demo"; return; }
    if (me.role === "tenant_portal") {
      const m = hash.match(/^#\/portal\/receipt\/(.+)$/);
      app.innerHTML = m ? `<div class="content" style="max-width:960px;margin:0 auto">${receiptView(m[1], true)}</div>` : portalView();
      return;
    }
    for (const r of routes) {
      const m = hash.match(r.re);
      if (m) { app.innerHTML = shell(r.perm && !can(r.perm) ? denied(r.perm) : r.fn(...m.slice(1))); return; }
    }
    app.innerHTML = shell(notFound());
  }

  E.load(); restore();
  E.onChange(render);
  window.addEventListener("hashchange", render);
  document.getElementById("reset").addEventListener("click", () => actions.reset());
  render();
})();
