/**
 * Phase 4 demo data: vendors, assets, preventive plans, maintenance requests and work orders
 * at every workflow stage. Created through the real services (so rules, refs and audit entries
 * are genuine); afterwards a few timestamps are back-dated so cost reports and response times
 * span recent months instead of all landing on the seed day.
 */
import { prisma } from "../../src/lib/db";
import type { RequestContext } from "../../src/lib/auth/context";
import { addDays, dateOnly, todayInTz } from "../../src/lib/dates";
import { createVendor } from "../../src/server/services/vendor.service";
import { createAsset } from "../../src/server/services/asset.service";
import { createPlan, generatePreventiveWorkOrders } from "../../src/server/services/preventive-maintenance.service";
import { approveRequest, closeRequest, createRequest, createWorkOrderFromRequest, rejectRequest, triageRequest, addRequestUpdate } from "../../src/server/services/maintenance-request.service";
import { closeWorkOrder, completeWorkOrder, createWorkOrder, progressWorkOrder, updateWorkOrder } from "../../src/server/services/work-order.service";
import { portalRequestFeedback, portalSubmitRequest } from "../../src/server/services/portal.service";

const GHS = (cedis: number) => Math.round(cedis * 100);

interface Args {
  today: string;
  O: RequestContext; M: RequestContext; FM: RequestContext; TECH: RequestContext; PORTAL: RequestContext;
  props: { airport: string; spintex: string; adum: string };
  U: Record<string, string>; T: Record<string, string>;
}

/** Move a work order's lifecycle timestamps back so reports show realistic history. */
async function backdate(woId: string, createdDaysAgo: number, durations: { startH?: number; completeD?: number; closeD?: number } = {}) {
  const today = todayInTz();
  const created = new Date(`${addDays(today, -createdDaysAgo)}T08:30:00Z`);
  const h = (base: Date, hours: number) => new Date(base.getTime() + hours * 3_600_000);
  const started = durations.startH != null ? h(created, durations.startH) : undefined;
  const completed = durations.completeD != null ? h(created, durations.completeD * 24) : undefined;
  const closed = durations.closeD != null ? h(created, durations.closeD * 24) : undefined;
  const wo = await prisma.workOrder.update({
    where: { id: woId },
    data: { createdAt: created, assignedAt: created, ...(started ? { startedAt: started } : {}), ...(completed ? { completedAt: completed } : {}), ...(closed ? { closedAt: closed } : {}) },
  });
  if (wo.maintenanceRequestId) {
    await prisma.maintenanceRequest.update({ where: { id: wo.maintenanceRequestId }, data: { submittedAt: h(created, -6), ...(completed ? { completedAt: completed } : {}), ...(closed ? { closedAt: closed } : {}) } });
  }
}

export async function seedFacilities({ today, O, M, FM, TECH, PORTAL, props, U, T }: Args) {
  const d = (n: number) => addDays(today, n);

  // ── Vendors ──
  const plumber = await createVendor(FM, { businessName: "Tema Plumbing & Borehole Services", contactName: "Emmanuel Tetteh", phone: "0244100201", email: "jobs@temaplumbing.example", serviceCategories: ["plumbing", "grounds"], address: { country: "GH", region: "Greater Accra", community: "Tema Community 4", digitalAddress: "GT-245-1180" }, notes: "Reliable on borehole pumps. Usually same-day for Accra sites." });
  const electric = await createVendor(FM, { businessName: "Kasoa Electricals & Generators", contactName: "Abdul-Rahman Issah", phone: "0277100202", email: "service@kasoaelec.example", serviceCategories: ["electrical", "appliance"], address: { country: "GH", region: "Central", community: "Kasoa" }, notes: "Authorised Perkins generator service agent (demo)." });
  const aircon = await createVendor(FM, { businessName: "CoolBreeze Air-Con Services", contactName: "Akua Mensah", phone: "0209100203", serviceCategories: ["hvac", "appliance"], address: { country: "GH", region: "Greater Accra", community: "Spintex" } });
  await createVendor(FM, { businessName: "Kumasi Pest Control Ltd", contactName: "Osei Kwaku", phone: "0322100204", serviceCategories: ["pest_control", "cleaning"], status: "inactive", notes: "Contract paused after missed visits (demo)." });

  // ── Assets ──
  const gen = await createAsset(FM, { propertyId: props.airport, name: "Standby generator 100kVA", category: "generator", location: "Generator house, rear yard", make: "Perkins", model: "1104A-44TG2", serialNumber: "PK-DEMO-55821", installedAt: "2019-06-01", warrantyExpiresAt: "2022-06-01", criticality: "critical", condition: "good", serviceIntervalDays: 90, lastServicedAt: d(-85) });
  const borehole = await createAsset(FM, { propertyId: props.airport, name: "Borehole submersible pump", category: "borehole", location: "Borehole, near gate 2", make: "Grundfos", model: "SP 5A-12", criticality: "high", condition: "fair", serviceIntervalDays: 30, lastServicedAt: d(-40) });
  const tank = await createAsset(FM, { propertyId: props.airport, name: "Polytank water storage & treatment", category: "water_system", location: "Roof, block A", criticality: "medium", condition: "good", serviceIntervalDays: 180, lastServicedAt: d(-60) });
  const fire = await createAsset(FM, { propertyId: props.airport, name: "Fire extinguishers (12 units) & hose reels", category: "fire_equipment", location: "All stairwells", criticality: "critical", condition: "good", serviceIntervalDays: 365, lastServicedAt: d(-200), notes: "Ghana National Fire Service certificate renewal due with annual service." });
  const ac = await createAsset(FM, { propertyId: props.spintex, unitId: U.S03, name: "Split air-conditioner 2.5HP", category: "air_conditioner", location: "Office S03", make: "LG", model: "Dual Inverter", warrantyExpiresAt: d(150), installedAt: d(-215), criticality: "medium", condition: "fair", serviceIntervalDays: 90, lastServicedAt: d(-80) });
  const cctv = await createAsset(FM, { propertyId: props.spintex, name: "CCTV system (8 cameras, NVR)", category: "security_system", location: "Security post", make: "Hikvision", criticality: "high", condition: "good", serviceIntervalDays: 180, lastServicedAt: d(-30) });
  const adumPump = await createAsset(FM, { propertyId: props.adum, name: "Surface water pump 1HP", category: "water_pump", location: "Courtyard pump house", make: "Pedrollo", criticality: "high", condition: "poor", serviceIntervalDays: 60, lastServicedAt: d(-75), notes: "Frequent failures; consider replacement." });
  await createAsset(FM, { propertyId: props.adum, name: "Old prepaid meter bank", category: "electrical", location: "Entrance", criticality: "low", condition: "failed", status: "inactive", notes: "Replaced by ECG smart meters; kept for records." });

  // ── Preventive plans (dates chosen so the demo shows overdue, due soon and on-schedule) ──
  await createPlan(FM, { assetId: gen.id, planName: "Quarterly generator service", intervalDays: 90, nextDueAt: d(5), leadDays: 7, assignedVendorId: electric.id, estimatedCostMinor: GHS(1850), checklist: ["Change engine oil & filter", "Replace fuel filter", "Check coolant & belts", "Battery terminals and charge", "Load test 30 minutes and record kW"] });
  await createPlan(FM, { assetId: borehole.id, planName: "Monthly borehole pump inspection", intervalDays: 30, nextDueAt: d(-10), leadDays: 3, assignedUserId: TECH.userId, checklist: ["Record flow rate", "Check pressure switch", "Inspect cabling and float switch", "Water clarity check"] });
  await createPlan(FM, { assetId: tank.id, planName: "Tank cleaning & disinfection", intervalDays: 180, nextDueAt: d(120), leadDays: 14, assignedVendorId: plumber.id, checklist: ["Drain and scrub", "Disinfect", "Check inlet filter"] });
  await createPlan(FM, { assetId: fire.id, planName: "Annual fire equipment service & GNFS certificate", intervalDays: 365, nextDueAt: d(165), leadDays: 30, checklist: ["Weigh / pressure-test each extinguisher", "Hose reel flow test", "Update tags", "File GNFS certificate"] });
  await createPlan(FM, { assetId: ac.id, planName: "A/C filter clean & gas check", intervalDays: 90, nextDueAt: d(10), leadDays: 7, assignedVendorId: aircon.id, estimatedCostMinor: GHS(350), checklist: ["Clean filters", "Check refrigerant pressure", "Clear drain line"] });
  await createPlan(FM, { assetId: adumPump.id, planName: "Bi-monthly pump service", intervalDays: 60, nextDueAt: d(-15), leadDays: 7, assignedUserId: TECH.userId, checklist: ["Check impeller", "Inspect seals", "Test pressure"] });
  await createPlan(FM, { assetId: cctv.id, planName: "CCTV health check", intervalDays: 180, nextDueAt: d(150), leadDays: 14, checklist: ["All cameras recording", "NVR storage health", "Clean lenses"] });
  // Generate preventive work orders due today (borehole + Adum pump + generator + A/C in lead window).
  await generatePreventiveWorkOrders({ organizationId: O.organizationId, userId: null as unknown as string, userName: "System job", requestId: "seed", isDemoOrg: true }, today);

  // ── Requests & work orders across the workflow ──
  // 1. Closed: Spintex office A/C not cooling — vendor job with costs, rated by nobody (staff-logged).
  const r1 = await createRequest(M, { propertyId: props.spintex, unitId: U.S03, tenantId: T.volta, assetId: ac.id, category: "hvac", priority: "high", title: "Office air-conditioner not cooling", description: "Volta Tech Hub reports the A/C in S03 blows warm air since Monday." });
  await approveRequest(M, r1.id, {});
  const w1 = await createWorkOrderFromRequest(FM, r1.id, { vendorId: aircon.id, dueAt: d(-40) });
  await progressWorkOrder(FM, w1.workOrderId, { status: "in_progress" });
  await completeWorkOrder(FM, w1.workOrderId, { completionNotes: "Refrigerant topped up (R410A), capacitor replaced. Cooling restored to 18°C.", vendorCostMinor: GHS(650), materialsCostMinor: GHS(180), purchaseReference: "CoolBreeze INV-2211" });
  await closeWorkOrder(FM, w1.workOrderId, { signOffNotes: "Tenant confirmed cooling." });
  await closeRequest(M, r1.id, { resolutionNotes: "Capacitor replaced and gas topped up by CoolBreeze." });
  await backdate(w1.workOrderId, 45, { startH: 20, completeD: 2, closeD: 3 });

  // 2–4. Repeat faults on the Adum Heights pump (flags in repeat-repair report).
  const pumpJobs = [
    { daysAgo: 70, notes: "Primed pump and replaced foot valve.", labour: 150, materials: 220 },
    { daysAgo: 38, notes: "Replaced pressure switch.", labour: 150, materials: 310 },
    { daysAgo: 9, notes: "Mechanical seal leaking; replaced seal kit.", labour: 200, materials: 450 },
  ];
  let lastPumpReq = "";
  for (const [i, j] of pumpJobs.entries()) {
    const r = await createRequest(M, { propertyId: props.adum, assetId: adumPump.id, category: "plumbing", priority: i === 2 ? "high" : "normal", title: "No water in the compound", description: "Tenants report no water pressure; pump runs but does not deliver." });
    await approveRequest(M, r.id, {});
    const w = await createWorkOrderFromRequest(FM, r.id, { assignedUserId: TECH.userId, dueAt: addDays(today, -j.daysAgo + 2) });
    await progressWorkOrder(TECH, w.workOrderId, { status: "in_progress" });
    await completeWorkOrder(TECH, w.workOrderId, { completionNotes: j.notes, labourCostMinor: GHS(j.labour), materialsCostMinor: GHS(j.materials), purchaseReference: `Adum Market receipt ${400 + i}` });
    await closeWorkOrder(FM, w.workOrderId, {});
    if (i < 2) await closeRequest(M, r.id, { resolutionNotes: j.notes });
    await backdate(w.workOrderId, j.daysAgo, { startH: 4 + i * 6, completeD: 1, closeD: 1.5 });
    lastPumpReq = r.id;
  }
  await addRequestUpdate(FM, lastPumpReq, { body: "Third pump failure in 90 days. Getting a replacement quote.", visibility: "internal" });

  // 5. In progress and OVERDUE: roof leak / ceiling repair at A6 (unit is under maintenance).
  const r5 = await createRequest(M, { propertyId: props.airport, unitId: U.A6, category: "structural", priority: "high", title: "Roof leak damaged ceiling in A6", description: "Water came through the ceiling during last week's rain. Ceiling boards sagging in the living room." });
  await triageRequest(M, r5.id, { note: "Unit vacant; set under maintenance until fixed." });
  await approveRequest(M, r5.id, {});
  const w5 = await createWorkOrderFromRequest(FM, r5.id, { assignedUserId: TECH.userId, scheduledAt: today, dueAt: today, checklist: [{ item: "Seal roof flashing", done: true }, { item: "Replace ceiling boards", done: false }, { item: "Repaint", done: false }] });
  await progressWorkOrder(TECH, w5.workOrderId, { status: "in_progress", note: "Roof flashing resealed. Waiting for dry weather to replace boards." });
  await updateWorkOrder(TECH, w5.workOrderId, { labourCostMinor: GHS(400), materialsCostMinor: GHS(260) });
  await prisma.workOrder.update({ where: { id: w5.workOrderId }, data: { dueAt: dateOnly(d(-4)), scheduledAt: dateOnly(d(-8)) } });
  await backdate(w5.workOrderId, 9, { startH: 26 });

  // 6. Waiting for parts: generator ATS fault (vendor).
  const w6 = await createWorkOrder(FM, { propertyId: props.airport, assetId: gen.id, category: "electrical", priority: "high", scope: "Automatic transfer switch not switching back to mains. Diagnose and replace contactor.", vendorId: electric.id, dueAt: d(3) });
  await progressWorkOrder(FM, w6.id, { status: "in_progress" });
  await progressWorkOrder(FM, w6.id, { status: "waiting_for_parts", note: "Contactor ordered from Accra; arriving in 2 days." });
  await backdate(w6.id, 3, { startH: 5 });

  // 7. Emergency, triaged and assigned: sparking socket in A1 (escalation sent).
  const r7 = await createRequest(M, { propertyId: props.airport, unitId: U.A1, tenantId: T.ama, category: "electrical", priority: "emergency", title: "Sparks and burning smell from bedroom socket", description: "Tenant switched off the breaker for the bedroom circuit. Needs urgent inspection." });
  await triageRequest(M, r7.id, { note: "Breaker isolated by tenant. Electrician today." });
  await approveRequest(M, r7.id, {});
  await createWorkOrderFromRequest(FM, r7.id, { vendorId: electric.id, dueAt: d(1) });

  // 8. Tenant portal submission (Abena, K1), awaiting triage.
  const r8 = await portalSubmitRequest(PORTAL, { unitId: U.K1, category: "plumbing", title: "Bathroom tap dripping", description: "The hot tap in the bathroom drips all night even when fully closed.", priority: "normal" });
  void r8;
  // 9. Earlier portal request, completed and rated by Abena.
  const r9 = await portalSubmitRequest(PORTAL, { unitId: U.K1, category: "electrical", title: "Kitchen light not working", description: "Fluorescent tube in the kitchen flickers and goes off." });
  await approveRequest(M, r9.id, {});
  const w9 = await createWorkOrderFromRequest(FM, r9.id, { assignedUserId: TECH.userId, dueAt: d(-18) });
  await progressWorkOrder(TECH, w9.workOrderId, { status: "in_progress" });
  await completeWorkOrder(TECH, w9.workOrderId, { completionNotes: "Replaced starter and tube with LED batten.", labourCostMinor: GHS(60), materialsCostMinor: GHS(95) });
  await closeWorkOrder(FM, w9.workOrderId, {});
  await closeRequest(M, r9.id, { resolutionNotes: "LED batten fitted." });
  await backdate(w9.workOrderId, 20, { startH: 18, completeD: 1, closeD: 2 });
  await portalRequestFeedback(PORTAL, r9.id, { rating: 5, comment: "Fixed the next day. Thank you!" });

  // 10. Rejected: cosmetic repaint request.
  const r10 = await createRequest(M, { propertyId: props.spintex, unitId: U.S01, tenantId: T.kente, category: "structural", priority: "low", title: "Repaint shop front", description: "Tenant requests repainting the shop front in brand colours." });
  await rejectRequest(M, r10.id, { reason: "Shop-front branding is the tenant's responsibility under the lease (clause 9)." });

  // 11. Submitted: pest control at A3.
  await createRequest(M, { propertyId: props.airport, unitId: U.A3, tenantId: T.esi, category: "pest_control", priority: "normal", title: "Cockroaches in kitchen", description: "Tenant reports cockroaches in the kitchen cabinets." });
}
