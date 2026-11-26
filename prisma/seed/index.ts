/**
 * Demo seed — "Caxaze Property Solutions" (fictional, Ghana).
 * All names, phone numbers, addresses and payment references are SYNTHETIC.
 * Data is created through the real service layer so every business rule, ledger entry
 * and audit event is produced exactly as in normal use. Dates are relative to "today" (Africa/Accra).
 *
 * Refuses to run when NODE_ENV=production unless ALLOW_DEMO_SEED=true.
 */
import { prisma } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/auth/password";
import { loadContext, type RequestContext } from "../../src/lib/auth/context";
import { syncSystemRoles } from "../../src/server/services/rbac-seed";
import { createProperty } from "../../src/server/services/property.service";
import { createUnit } from "../../src/server/services/unit.service";
import { createTenant, addTenantNote } from "../../src/server/services/tenant.service";
import { activateLease, createLease, markPendingSignature, renewLease, terminateLease } from "../../src/server/services/lease.service";
import { createManualCharge, listCharges } from "../../src/server/services/rent.service";
import { confirmPayment, recordPayment, reversePayment } from "../../src/server/services/payment.service";
import { addDays, addMonths, todayInTz, withDayOfMonth } from "../../src/lib/dates";

const DEMO_PASSWORD = "DemoPass2026!";
const GHS = (cedis: number) => Math.round(cedis * 100);

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=true only for an isolated demo environment.");
  }
  const today = todayInTz("Africa/Accra");
  const thisMonth = withDayOfMonth(today, 1);
  const m = (n: number) => addMonths(thisMonth, n); // first of month, n months from now
  console.log(`Seeding demo data relative to ${today}…`);

  await syncSystemRoles(prisma);
  // Idempotent: remove a previous demo workspace (TRUNCATE-style wipe only of demo orgs).
  const old = await prisma.organization.findMany({ where: { isDemo: true }, select: { id: true } });
  if (old.length) {
    console.log("Demo data already present; nothing to do. To start fresh run `npm run db:reset` (drops ALL data in this database).");
    return;
  }

  const pw = await hashPassword(DEMO_PASSWORD);
  const org = await prisma.organization.create({
    data: {
      name: "Caxaze Property Solutions", slug: "caxaze-demo", legalName: "Caxaze Property Solutions Ltd (DEMO)", email: "hello@caxaze.demo", phone: "+233302000100",
      isDemo: true, plan: "demo", paymentsRequireConfirmation: true,
      addressJson: { country: "GH", region: "Greater Accra", district: "Ayawaso West Municipal", community: "East Legon", landmark: "Off Lagos Avenue", digitalAddress: "GA-492-7710", notes: "" },
    },
  });
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
  async function user(email: string, fullName: string, role: string, extra: { tenantId?: string; propertyIds?: string[] } = {}) {
    const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, fullName, passwordHash: pw, phone: null } });
    await prisma.organizationMembership.create({
      data: { organizationId: org.id, userId: u.id, roleId: await roleId(role), tenantId: extra.tenantId ?? null, scopeAllProperties: !extra.propertyIds && !extra.tenantId,
        propertyScopes: extra.propertyIds ? { create: extra.propertyIds.map((propertyId) => ({ propertyId })) } : undefined },
    });
    return u;
  }
  const ctxOf = (userId: string): Promise<RequestContext> => loadContext(userId, org.id, "seed");

  const owner = await user("owner@caxaze.demo", "Akosua Caxaze (Demo Owner)", "org_owner");
  const managerU = await user("manager@caxaze.demo", "Kwame Asiedu", "property_manager");
  const financeU = await user("finance@caxaze.demo", "Efua Mensah", "finance_officer");
  await user("facility@caxaze.demo", "Yaw Boateng", "facility_manager");
  await user("tech@caxaze.demo", "Kojo Amponsah", "technician");
  await user("auditor@caxaze.demo", "Adjoa Sarpong", "auditor");
  const O = await ctxOf(owner.id), M = await ctxOf(managerU.id), F = await ctxOf(financeU.id);

  // ── Properties & units ───────────────────────────────────────────
  const airport = await createProperty(O, {
    name: "Airport Hills Residences", propertyRef: "AHR", propertyType: "residential", status: "active", ownerNameOrEntity: "Caxaze Holdings (Demo)",
    description: "Gated block of 2- and 3-bedroom apartments with standby generator and borehole.",
    address: { country: "GH", region: "Greater Accra", district: "La Dade-Kotopon Municipal", community: "Airport Residential Area", landmark: "Behind the Airport Police Station", digitalAddress: "GL-089-1234", notes: "Second gate on the left" },
    latitude: 5.6037, longitude: -0.1870, acquisitionDate: "2019-04-15", acquisitionCostMinor: GHS(4_800_000), managerMembershipId: M.membershipId,
  });
  const spintex = await createProperty(O, {
    name: "Spintex Road Commercial Plaza", propertyRef: "SRP", propertyType: "commercial", status: "active", ownerNameOrEntity: "Spintex Plaza Partners (Demo)",
    description: "Two-storey roadside plaza: ground-floor shops, first-floor offices.",
    address: { country: "GH", region: "Greater Accra", district: "Ledzokuku Municipal", community: "Spintex", landmark: "Opposite the Coca-Cola roundabout", digitalAddress: "GT-021-5567", notes: "" },
    managerMembershipId: M.membershipId,
  });
  const adum = await createProperty(O, {
    name: "Adum Heights", propertyRef: "ADH", propertyType: "mixed_use", status: "active", ownerNameOrEntity: "Nana Owusu Estate (Demo)",
    description: "Mixed residential compound in central Kumasi: chamber-and-hall, single rooms and self-contained units.",
    address: { country: "GH", region: "Ashanti", district: "Kumasi Metropolitan", community: "Adum", landmark: "Near Kejetia market", digitalAddress: "AK-039-5521", notes: "Blue gate, ask for the caretaker" },
  });
  await user("kumasi.manager@caxaze.demo", "Ama Pokuaa", "property_manager", { propertyIds: [adum.id] });
  await user("landlord@caxaze.demo", "Nana Owusu (Owner Viewer)", "owner_viewer", { propertyIds: [adum.id] });

  const U: Record<string, string> = {};
  const unit = async (pid: string, ref: string, type: string, rent: number, extra: Record<string, unknown> = {}) => {
    const u = await createUnit(O, pid, { unitRef: ref, unitType: type as "apartment", askingRentMinor: GHS(rent), ...extra });
    U[ref] = u.id;
  };
  await unit(airport.id, "A1", "apartment", 3500, { bedrooms: 2, bathrooms: 2, floor: "Ground", block: "A", furnishingStatus: "semi_furnished", areaValue: 95 });
  await unit(airport.id, "A2", "apartment", 3500, { bedrooms: 2, bathrooms: 2, floor: "1st", block: "A", rentFrequency: "yearly" });
  await unit(airport.id, "A3", "apartment", 4200, { bedrooms: 3, bathrooms: 3, floor: "1st", block: "A", areaValue: 130 });
  await unit(airport.id, "A4", "apartment", 3500, { bedrooms: 2, bathrooms: 2, floor: "2nd", block: "B", rentFrequency: "quarterly" });
  await unit(airport.id, "A5", "apartment", 4500, { bedrooms: 3, bathrooms: 3, floor: "2nd", block: "B", furnishingStatus: "furnished" });
  await unit(airport.id, "A6", "apartment", 3200, { bedrooms: 2, bathrooms: 1, floor: "Ground", block: "B", availability: "under_maintenance", description: "Ceiling repair after roof leak" });
  await unit(spintex.id, "S01", "shop", 8000, { floor: "Ground", areaValue: 60 });
  await unit(spintex.id, "S02", "shop", 4500, { floor: "Ground", areaValue: 40, rentFrequency: "half_yearly" });
  await unit(spintex.id, "S03", "office", 6500, { floor: "1st", areaValue: 75 });
  await unit(spintex.id, "S04", "office", 6000, { floor: "1st", areaValue: 70 });
  await unit(spintex.id, "S05", "shop", 5000, { floor: "Ground", areaValue: 45, availability: "reserved", description: "Held for a prospective pharmacy" });
  await unit(spintex.id, "S06", "warehouse", 9000, { floor: "Rear yard", areaValue: 200 });
  await unit(adum.id, "K1", "chamber_and_hall", 1200, { bedrooms: 1, bathrooms: 1 });
  await unit(adum.id, "K2", "single_room", 650, { bedrooms: 1, bathrooms: 0, description: "Shared bathroom" });
  await unit(adum.id, "K3", "self_contained", 1800, { bedrooms: 1, bathrooms: 1 });
  await unit(adum.id, "K4", "self_contained", 1800, { bedrooms: 1, bathrooms: 1 });
  await unit(adum.id, "K5", "chamber_and_hall", 1300, { bedrooms: 1, bathrooms: 1 });

  // ── Tenants (synthetic) ───────────────────────────────────────────
  const T: Record<string, string> = {};
  const tenant = async (key: string, data: Parameters<typeof createTenant>[1]) => { T[key] = (await createTenant(M, { privacyNoticeAccepted: true, ...data })).id; };
  await tenant("ama", { tenantType: "individual", displayName: "Ama Owusu-Ansah", phone: "0240000101", email: "ama.oa@example.com", identificationType: "ghana_card", identificationReference: "GHA-700000101-1", emergencyContact: { name: "Kwesi Owusu-Ansah", phone: "0240000901", relationship: "Brother" } });
  await tenant("kofi", { tenantType: "individual", displayName: "Kofi Mensah-Bonsu", phone: "0200000102", email: "kofi.mb@example.com", identificationType: "passport", identificationReference: "G0000102" });
  await tenant("esi", { tenantType: "individual", displayName: "Esi Quaye", phone: "0550000103", email: "esi.quaye@example.com", identificationType: "ghana_card", identificationReference: "GHA-700000103-3" });
  await tenant("kojo", { tenantType: "individual", displayName: "Kojo Quaye", phone: "0550000104" });
  await tenant("yaw", { tenantType: "individual", displayName: "Yaw Darko-Asamoah", phone: "0270000105", email: "yaw.da@example.com" });
  await tenant("kente", { tenantType: "organization", displayName: "Kente Republic Ltd", phone: "0302000106", email: "accounts@kenterepublic.example", employmentInfo: "Textile retail; registered business (demo)" });
  await tenant("asaase", { tenantType: "organization", displayName: "Asaase Pharmacy Enterprise", phone: "0240000107", email: "asaase.pharm@example.com" });
  await tenant("volta", { tenantType: "organization", displayName: "Volta Tech Hub Ltd", phone: "0500000108", email: "finance@voltatech.example" });
  await tenant("abena", { tenantType: "individual", displayName: "Abena Serwaa Boateng", phone: "0240000109", email: "tenant@caxaze.demo" });
  await tenant("kwabena", { tenantType: "individual", displayName: "Kwabena Ofori Jnr", phone: "0260000110" });
  await tenant("adwoa", { tenantType: "individual", displayName: "Adwoa Pokuaa", phone: "0240000111" });
  await tenant("nana", { tenantType: "individual", displayName: "Nana Akua Frimpong", phone: "0200000112", status: "prospective" });

  // ── Leases ────────────────────────────────────────────────────────
  const L: Record<string, string> = {};
  const lease = async (key: string, unitRef: string, parties: [string, string][], start: string, end: string, rent: number, freq: string, extra: Record<string, unknown> = {}) => {
    const l = await createLease(M, { unitId: U[unitRef], parties: parties.map(([t, r]) => ({ tenantId: T[t], partyRole: r as "primary_tenant" })), startDate: start, endDate: end, rentAmountMinor: GHS(rent), billingFrequency: freq as "monthly", ...extra });
    L[key] = l.id;
    return l;
  };
  const activate = async (key: string) => activateLease(M, L[key]);

  await lease("ama", "A1", [["ama", "primary_tenant"]], m(-10), addDays(today, 35), 3500, "monthly", { depositAmountMinor: GHS(7000), depositStatus: "held", gracePeriodDays: 5, noticePeriodDays: 60 });
  await activate("ama");
  await lease("kofi", "A2", [["kofi", "primary_tenant"]], m(-8), addDays(m(16), -1), 42000, "yearly", { depositAmountMinor: GHS(7000), depositStatus: "held", advanceMonths: 12 });
  await activate("kofi");
  await lease("esi", "A3", [["esi", "primary_tenant"], ["kojo", "co_tenant"]], m(-11), addDays(m(7), -1), 4200, "monthly", { depositAmountMinor: GHS(8400), depositStatus: "held" });
  await activate("esi");
  await lease("yaw", "A4", [["yaw", "primary_tenant"]], m(-5), addDays(m(7), -1), 10500, "quarterly", { dueDay: 5 });
  await activate("yaw");
  await lease("kente", "S01", [["kente", "primary_tenant"]], m(-14), addDays(m(10), -1), 8000, "monthly", { depositAmountMinor: GHS(16000), depositStatus: "held", noticePeriodDays: 90 });
  await activate("kente");
  await lease("asaase", "S02", [["asaase", "primary_tenant"]], m(-10), addDays(m(14), -1), 27000, "half_yearly");
  await activate("asaase");
  await lease("volta", "S03", [["volta", "primary_tenant"]], m(-1), addDays(m(11), -1), 6500, "monthly");
  await activate("volta");
  await lease("abena", "K1", [["abena", "primary_tenant"]], addDays(m(-11), 14), addDays(today, 18), 1200, "monthly");
  await activate("abena");
  await lease("kwabena", "K2", [["kwabena", "primary_tenant"]], m(-9), addDays(today, 66), 650, "monthly");
  await activate("kwabena");
  await lease("adwoa", "K3", [["adwoa", "primary_tenant"]], m(-12), addDays(m(1), -1), 1800, "monthly");
  await activate("adwoa");
  // Draft / pending-signature lease starting next month.
  await lease("nana", "K4", [["nana", "primary_tenant"]], m(1), addDays(m(13), -1), 1800, "monthly", { depositAmountMinor: GHS(3600), depositStatus: "pending" });
  await markPendingSignature(M, L.nana);

  // ── Payments (synthetic MoMo / bank references) ──────────────────
  let seq = 0;
  async function pay(leaseKey: string, amount: number, receivedAt: string, method: string, ref: string | null, opts: { confirm?: boolean; payer?: string } = {}) {
    const r = await recordPayment(F, { leaseId: L[leaseKey], amountMinor: GHS(amount), paymentMethod: method as "cash", receivedAt, externalReference: ref, payerName: opts.payer ?? null, idempotencyKey: `seed-${leaseKey}-${++seq}`, allocation: "auto" });
    if (opts.confirm !== false) await confirmPayment(F, r.payment.id, { allocation: "auto" });
    return r.payment.id;
  }
  const charges = async (k: string) => (await listCharges(F, { leaseId: L[k], pageSize: 100 })).items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const momo = () => `MP${String(2_600_000_000 + Math.floor(Math.random() * 99_999_999)).slice(0, 10)}`;

  // Ama: paid every month except the current one (0–30 days arrears).
  for (const c of (await charges("ama")).filter((c) => c.dueDate < thisMonth)) await pay("ama", c.amountMinor / 100, addDays(c.dueDate, 2), "mobile_money", momo());
  // Kofi: Ghana-style one-year advance by bank transfer.
  await pay("kofi", 42000, addDays(m(-8), -4), "bank_transfer", "GCB-TRF-DEMO-55120");
  // Esi: paid until 4 months ago, partial on the oldest unpaid → arrears across 0–30 / 31–60 / 61–90 / 90+.
  for (const c of (await charges("esi")).filter((c) => c.dueDate < m(-3))) await pay("esi", 4200, addDays(c.dueDate, 1), "bank_transfer", `ECO-DEMO-${c.chargeRef.slice(-4)}`);
  await pay("esi", 2000, addDays(m(-3), 9), "mobile_money", momo(), { payer: "Kojo Quaye" });
  // Yaw: first quarter paid, second quarter part-paid.
  await pay("yaw", 10500, addDays(m(-5), 3), "cheque", "CHQ 000451");
  await pay("yaw", 6000, addDays(m(-2), 8), "cash", null);
  // Kente: paid until two months ago; a recent MoMo payment awaiting confirmation (pending, not counted).
  for (const c of (await charges("kente")).filter((c) => c.dueDate < m(-1))) await pay("kente", 8000, addDays(c.dueDate, 3), "bank_transfer", `CAL-DEMO-${c.chargeRef.slice(-4)}`);
  await pay("kente", 8000, addDays(today, -2), "mobile_money", momo(), { confirm: false });
  // Asaase: first half-year paid, second half-year unpaid (90+ days).
  await pay("asaase", 27000, addDays(m(-10), 5), "bank_transfer", "STANBIC-DEMO-8812");
  // Volta: paid first month plus an advance → unapplied credit / prepayment.
  await pay("volta", 26000, addDays(m(-1), 1), "bank_transfer", "ABSA-DEMO-3301");
  // Abena: fully paid by MoMo; one duplicate entry recorded then reversed (Scenario C).
  for (const c of (await charges("abena")).filter((c) => c.dueDate <= today)) await pay("abena", 1200, addDays(c.dueDate, 1), "mobile_money", momo());
  const dup = await pay("abena", 1200, addDays(today, -6), "mobile_money", "MP-DUPLICATE-DEMO");
  await reversePayment(F, dup, { reason: "Duplicate entry — the same MoMo transfer was recorded twice" });
  // Kwabena: paid until two months ago (31–60 and 0–30 arrears).
  for (const c of (await charges("kwabena")).filter((c) => c.dueDate < m(-1))) await pay("kwabena", 650, addDays(c.dueDate, 4), "cash", null);
  // Adwoa: paid to date, then lease terminated (relocation) → future charges voided.
  for (const c of (await charges("adwoa")).filter((c) => c.dueDate <= addDays(today, -40))) await pay("adwoa", 1800, addDays(c.dueDate, 2), "mobile_money", momo());
  await terminateLease(M, L.adwoa, { terminationDate: addDays(today, -40), reason: "Tenant relocated to Takoradi for work", settlementNotes: "Deposit refund pending final inspection (demo)" });

  // Service charge on the plaza (manual charge) and a renewal draft for an expiring lease.
  await createManualCharge(F, { leaseId: L.kente, chargeType: "service_charge", periodStart: thisMonth, periodEnd: addDays(m(1), -1), dueDate: addDays(thisMonth, 9), amountMinor: GHS(450), description: "Plaza security, cleaning and waste levy" });
  await renewLease(M, L.abena, { rentAmountMinor: GHS(1350) });

  await addTenantNote(M, T.esi, { kind: "call", body: "Called about August–November arrears. Tenant says salary delayed; promised part-payment by month end." });
  await addTenantNote(M, T.asaase, { kind: "visit", body: "Visited shop S02. Owner requested a payment plan for the second half-year rent. Escalated to finance." });
  await addTenantNote(M, T.ama, { kind: "note", body: "Lease ends soon — tenant interested in renewal at current rent." });

  // Tenant portal login for Abena.
  await user("tenant@caxaze.demo", "Abena Serwaa Boateng", "tenant_portal", { tenantId: T.abena });

  // ── Second organization (isolation demo) ──────────────────────────
  const other = await prisma.organization.create({ data: { name: "Osu Homes Ltd (Demo)", slug: "osu-homes-demo", isDemo: true, plan: "demo", addressJson: { country: "GH", region: "Greater Accra", community: "Osu" } } });
  const otherOwner = await prisma.user.upsert({ where: { email: "owner@osuhomes.demo" }, update: {}, create: { email: "owner@osuhomes.demo", fullName: "Selorm Agbeko", passwordHash: pw } });
  await prisma.organizationMembership.create({ data: { organizationId: other.id, userId: otherOwner.id, roleId: await roleId("org_owner") } });
  const OO = await loadContext(otherOwner.id, other.id, "seed");
  await createProperty(OO, { name: "Oxford Street Flats", propertyType: "residential", status: "active", address: { country: "GH", region: "Greater Accra", district: "Korle Klottey Municipal", community: "Osu", landmark: "Near the Osu Castle road", digitalAddress: "GA-017-0042", notes: "" } });

  const counts = {
    properties: await prisma.property.count(), units: await prisma.unit.count(), tenants: await prisma.tenant.count(), leases: await prisma.lease.count(),
    charges: await prisma.rentCharge.count(), payments: await prisma.payment.count(), auditEvents: await prisma.auditLog.count(),
  };
  console.log("Seed complete:", counts);
  console.log(`Demo logins (password ${DEMO_PASSWORD}): owner@, manager@, finance@, facility@, tech@, auditor@, kumasi.manager@, landlord@, tenant@caxaze.demo; owner@osuhomes.demo`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
