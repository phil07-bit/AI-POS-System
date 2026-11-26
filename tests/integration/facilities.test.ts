import { beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { resetDb, makeOrg, makeMember, address } from "./helpers";
import { createProperty } from "@/server/services/property.service";
import { createUnit } from "@/server/services/unit.service";
import { createTenant } from "@/server/services/tenant.service";
import { activateLease, createLease } from "@/server/services/lease.service";
import { createVendor, getVendor, listVendors, updateVendor } from "@/server/services/vendor.service";
import { createAsset, getAsset, getAssetServiceHistory, listAssets, updateAsset } from "@/server/services/asset.service";
import {
  approveRequest, addRequestUpdate, cancelRequest, closeRequest, createRequest, createWorkOrderFromRequest, getRequest, listRequests, rejectRequest, triageRequest, updateRequest,
} from "@/server/services/maintenance-request.service";
import {
  cancelWorkOrder, closeWorkOrder, completeWorkOrder, createWorkOrder, getWorkOrder, listWorkOrders, progressWorkOrder, returnWorkOrder, updateWorkOrder,
} from "@/server/services/work-order.service";
import { createPlan, generatePreventiveWorkOrders, listPlans, updatePlan, generateDueNow } from "@/server/services/preventive-maintenance.service";
import { maintenanceReport } from "@/server/services/maintenance-report.service";
import { portalMaintenance, portalRequestFeedback, portalSubmitRequest } from "@/server/services/portal.service";
import { addDays, addMonths, todayInTz } from "@/lib/dates";
import { AppError } from "@/lib/api/errors";
import type { RequestContext } from "@/lib/auth/context";

// Services throw ZodError for bad input; the route handler maps it to VALIDATION_ERROR (400).
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof AppError ? e.code : e instanceof ZodError ? "VALIDATION_ERROR" : `ERROR ${String(e)}`; } };
const today = todayInTz();

describe("phase 4 — vendors, assets, maintenance requests, work orders, preventive maintenance", () => {
  let owner: RequestContext, manager: RequestContext, facility: RequestContext, tech: RequestContext, tech2: RequestContext, finance: RequestContext, viewer: RequestContext, scopedMgr: RequestContext, portal: RequestContext, outsider: RequestContext;
  let propA: string, propB: string, unitA1: string, unitB1: string, tenantId: string;
  let vendorId: string, inactiveVendorId: string, genId: string;

  beforeAll(async () => {
    await resetDb();
    const org = await makeOrg("Facilities Test");
    owner = await makeMember(org.id, "org_owner");
    const pA = await createProperty(owner, { name: "Airport Hills", propertyType: "residential", address, status: "active" });
    const pB = await createProperty(owner, { name: "Adum Heights", propertyType: "mixed_use", address, status: "active" });
    propA = pA.id; propB = pB.id;
    unitA1 = (await createUnit(owner, propA, { unitRef: "A1", unitType: "apartment", areaUnit: "sqm", furnishingStatus: "unfurnished", rentFrequency: "monthly", availability: "available" })).id;
    unitB1 = (await createUnit(owner, propB, { unitRef: "K1", unitType: "single_room", areaUnit: "sqm", furnishingStatus: "unfurnished", rentFrequency: "monthly", availability: "available" })).id;
    manager = await makeMember(org.id, "property_manager");
    facility = await makeMember(org.id, "facility_manager");
    tech = await makeMember(org.id, "technician");
    tech2 = await makeMember(org.id, "technician");
    finance = await makeMember(org.id, "finance_officer");
    viewer = await makeMember(org.id, "owner_viewer", { propertyIds: [propB] });
    scopedMgr = await makeMember(org.id, "property_manager", { propertyIds: [propB] });
    const t = await createTenant(manager, { tenantType: "individual", displayName: "Abena Serwaa", phone: "0240000109", status: "prospective" });
    tenantId = t.id;
    const l = await createLease(manager, { unitId: unitA1, parties: [{ tenantId, partyRole: "primary_tenant" }], startDate: addMonths(today, -1), endDate: addMonths(today, 11), rentAmountMinor: 120000, billingFrequency: "monthly", depositAmountMinor: 0, depositStatus: "not_applicable", gracePeriodDays: 0 });
    await activateLease(manager, l.id);
    portal = await makeMember(org.id, "tenant_portal", { tenantId });
    const other = await makeOrg("Other Org");
    outsider = await makeMember(other.id, "org_owner");
  });

  describe("vendors", () => {
    it("facility manager creates and edits vendors; refs are sequential; no bank fields accepted", async () => {
      const v = await createVendor(facility, { businessName: "Accra Plumbing Works", contactName: "Kwesi", phone: "024 555 0101", serviceCategories: ["plumbing"], status: "active" });
      expect(v.vendorRef).toBe("VND-0001");
      expect(v.phone).toBe("+233245550101");
      vendorId = v.id;
      const v2 = await createVendor(facility, { businessName: "Old Sparks Electrical", serviceCategories: ["electrical"], status: "active" });
      expect(v2.vendorRef).toBe("VND-0002");
      inactiveVendorId = v2.id;
      expect((await updateVendor(facility, v2.id, { status: "inactive" })).status).toBe("inactive");
      expect(await code(createVendor(facility, { businessName: "X", bankAccount: "123" } as never))).toBe("VALIDATION_ERROR");
      expect((await listVendors(manager, { category: "plumbing" })).items.map((x) => x.id)).toEqual([vendorId]);
      expect(await prisma.auditLog.count({ where: { action: { in: ["vendor.created", "vendor.status_changed"] } } })).toBe(3);
    });
    it("enforces permissions and org isolation", async () => {
      expect(await code(createVendor(tech, { businessName: "Nope", status: "active" }))).toBe("FORBIDDEN");
      expect(await code(listVendors(finance, {}))).toBe("FORBIDDEN");
      expect(await code(listVendors(portal, {}))).toBe("FORBIDDEN");
      expect(await code(getVendor(outsider, vendorId))).toBe("NOT_FOUND");
      expect((await listVendors(viewer, {})).total).toBe(2); // read-only roles can read the directory
      expect(await code(updateVendor(viewer, vendorId, { notes: "x" }))).toBe("FORBIDDEN");
    });
  });

  describe("assets", () => {
    it("registers an asset with derived next-service date and enforces unit/property consistency", async () => {
      const a = await createAsset(facility, { propertyId: propA, name: "Standby generator 60kVA", category: "generator", make: "Perkins", criticality: "critical", serviceIntervalDays: 90, lastServicedAt: addDays(today, -100), installedAt: "2022-01-10", warrantyExpiresAt: addDays(today, 30) });
      expect(a.assetRef).toBe("AST-0001");
      expect(a.nextServiceAt).toBe(addDays(today, -10));
      expect(a.serviceStatus).toBe("overdue");
      expect(a.underWarranty).toBe(true);
      genId = a.id;
      expect(await code(createAsset(facility, { propertyId: propA, unitId: unitB1, name: "Wrong", category: "appliance" }))).toBe("BUSINESS_RULE");
      expect(await code(createAsset(tech, { propertyId: propA, name: "Nope", category: "appliance" }))).toBe("FORBIDDEN");
      expect((await listAssets(manager, { service: "overdue" })).items.map((x) => x.id)).toEqual([genId]);
      expect((await listAssets(manager, { service: "ok" })).total).toBe(0);
    });
    it("hides assets outside property scope and other orgs", async () => {
      expect(await code(getAsset(scopedMgr, genId))).toBe("NOT_FOUND");
      expect((await listAssets(scopedMgr, {})).total).toBe(0);
      expect(await code(getAsset(outsider, genId))).toBe("NOT_FOUND");
      expect(await code(listAssets(scopedMgr, { propertyId: propA }))).toBe("NOT_FOUND");
    });
    it("disposing an asset deactivates its plans and freezes it", async () => {
      const pump = await createAsset(facility, { propertyId: propA, name: "Old pump", category: "water_pump", serviceIntervalDays: 30, lastServicedAt: today });
      await createPlan(facility, { assetId: pump.id, planName: "Pump check", intervalDays: 30, nextDueAt: addDays(today, 30) });
      const disposed = await updateAsset(facility, pump.id, { status: "disposed" });
      expect(disposed.status).toBe("disposed");
      expect(disposed.disposedAt).toBe(today);
      expect(await prisma.preventiveMaintenancePlan.count({ where: { assetId: pump.id, active: true } })).toBe(0);
      expect(await code(updateAsset(facility, pump.id, { name: "Revived" }))).toBe("BUSINESS_RULE");
      expect((await listAssets(facility, {})).items.some((x) => x.id === pump.id)).toBe(false); // disposed hidden by default
    });
  });

  describe("Scenario D — maintenance request to closed work order", () => {
    let reqId: string, woId: string;

    it("tenant submits from the portal for their own unit only", async () => {
      const ov = await portalMaintenance(portal);
      expect(ov.units.map((u) => u.id)).toEqual([unitA1]);
      expect(await code(portalSubmitRequest(portal, { unitId: unitB1, category: "plumbing", title: "Leak", description: "Water leaking under the sink." }))).toBe("NOT_FOUND");
      const r = await portalSubmitRequest(portal, { unitId: unitA1, category: "plumbing", title: "Kitchen sink leak", description: "Water leaking under the kitchen sink since yesterday." });
      expect(r.requestRef).toMatch(/^MR-\d{4}-\d{5}$/);
      expect(r.status).toBe("submitted");
      reqId = r.id;
      const staffView = await getRequest(manager, reqId);
      expect(staffView.source).toBe("tenant_portal");
      expect(staffView.tenant?.id).toBe(tenantId);
      expect(staffView.targetDate).toBe(addDays(today, 7)); // default for normal priority
    });

    it("portal users cannot use staff endpoints", async () => {
      expect(await code(listRequests(portal, {}))).toBe("FORBIDDEN");
      expect(await code(getRequest(portal, reqId))).toBe("FORBIDDEN");
      expect(await code(listWorkOrders(portal, {}))).toBe("FORBIDDEN");
    });

    it("manager triages and approves; work order cannot be raised before approval", async () => {
      expect(await code(createWorkOrderFromRequest(manager, reqId, {}))).toBe("BUSINESS_RULE");
      const t = await triageRequest(manager, reqId, { priority: "high", note: "Check if the trap or the supply pipe." });
      expect(t.status).toBe("triaged");
      expect(t.priority).toBe("high");
      expect(await code(triageRequest(tech, reqId, {}))).toBe("FORBIDDEN");
      expect((await approveRequest(manager, reqId, {})).status).toBe("approved");
      expect(await code(approveRequest(manager, reqId, {}))).toBe("BUSINESS_RULE"); // already approved
    });

    it("creates a work order assigned to a technician; request becomes assigned", async () => {
      expect(await code(createWorkOrderFromRequest(manager, reqId, { vendorId: inactiveVendorId }))).toBe("BUSINESS_RULE");
      expect(await code(createWorkOrderFromRequest(manager, reqId, { assignedUserId: finance.userId }))).toBe("BUSINESS_RULE"); // finance lacks work_order.update
      expect(await code(createWorkOrderFromRequest(manager, reqId, { assignedUserId: tech.userId, vendorId }))).toBe("BUSINESS_RULE"); // not both
      const r = await createWorkOrderFromRequest(manager, reqId, { assignedUserId: tech.userId, dueAt: addDays(today, 3) });
      expect(r.workOrderRef).toMatch(/^WO-\d{4}-\d{5}$/);
      expect(r.request.status).toBe("assigned");
      woId = r.workOrderId;
      const n = await prisma.notification.findFirst({ where: { userId: tech.userId, eventType: "work_order.assigned" } });
      expect(n?.channel).toBe("in_app");
    });

    it("technician sees only their own work orders", async () => {
      expect((await listWorkOrders(tech, {})).items.map((w) => w.id)).toEqual([woId]);
      expect((await listWorkOrders(tech2, {})).total).toBe(0);
      expect(await code(getWorkOrder(tech2, woId))).toBe("NOT_FOUND");
      expect(await code(progressWorkOrder(tech2, woId, { status: "in_progress" }))).toBe("NOT_FOUND");
      // technicians cannot reassign or close
      expect(await code(updateWorkOrder(tech, woId, { assignedUserId: tech2.userId }))).toBe("FORBIDDEN");
      expect(await code(updateWorkOrder(tech, woId, { priority: "low" }))).toBe("FORBIDDEN");
    });

    it("technician starts, waits for parts, records costs and completes; request follows", async () => {
      const s = await progressWorkOrder(tech, woId, { status: "in_progress", note: "On site, trap is cracked." });
      expect(s.status).toBe("in_progress");
      expect(s.startedAt).not.toBeNull();
      expect((await getRequest(manager, reqId)).status).toBe("in_progress");
      await progressWorkOrder(tech, woId, { status: "waiting_for_parts" });
      expect((await getRequest(manager, reqId)).status).toBe("waiting_for_parts");
      await progressWorkOrder(tech, woId, { status: "in_progress" });
      const u = await updateWorkOrder(tech, woId, { labourCostMinor: 15000, materialsCostMinor: 8550, purchaseReference: "Receipt 0042 Makola" });
      expect(u.totalCostMinor).toBe(23550);
      expect(await code(updateWorkOrder(tech, woId, { labourCostMinor: -1 }))).toBe("VALIDATION_ERROR");
      expect(await code(closeWorkOrder(manager, woId, {}))).toBe("BUSINESS_RULE"); // must be completed first
      expect(await code(completeWorkOrder(tech, woId, { completionNotes: "" }))).toBe("VALIDATION_ERROR");
      const c = await completeWorkOrder(tech, woId, { completionNotes: "Replaced P-trap and washer; tested, no leak.", otherCostMinor: 2000 });
      expect(c.status).toBe("completed");
      expect(c.totalCostMinor).toBe(25550);
      expect((await getRequest(manager, reqId)).status).toBe("completed");
    });

    it("technician cannot close; manager can return for rework, then sign off; request closes after review", async () => {
      expect(await code(closeWorkOrder(tech, woId, {}))).toBe("FORBIDDEN");
      expect(await code(closeRequest(manager, reqId, { resolutionNotes: "" }))).toBe("VALIDATION_ERROR");
      const ret = await returnWorkOrder(manager, woId, { reason: "Tenant reports slow drip remains." });
      expect(ret.status).toBe("in_progress");
      expect((await getRequest(manager, reqId)).status).toBe("in_progress");
      expect(await code(closeRequest(manager, reqId, { resolutionNotes: "Done" }))).toBe("BUSINESS_RULE");
      await completeWorkOrder(tech, woId, { completionNotes: "Tightened compression joint; dry after 30 minutes." });
      const closed = await closeWorkOrder(manager, woId, { signOffNotes: "Checked with tenant." });
      expect(closed.status).toBe("closed");
      expect(closed.signOffName).toBe(manager.userName);
      expect(await code(updateWorkOrder(manager, woId, { otherCostMinor: 1 }))).toBe("BUSINESS_RULE"); // closed is frozen
      const done = await closeRequest(manager, reqId, { resolutionNotes: "Leak fixed; trap replaced." });
      expect(done.status).toBe("closed");
    });

    it("tenant sees only tenant-visible updates and can rate completed work", async () => {
      await addRequestUpdate(manager, reqId, { body: "INTERNAL: tenant was difficult on the phone", visibility: "internal" });
      await addRequestUpdate(manager, reqId, { body: "Technician will call before visiting.", visibility: "tenant" });
      const ov = await portalMaintenance(portal);
      const mine = ov.requests.find((r) => r.id === reqId)!;
      expect(mine.statusLabel).toBe("Closed");
      const bodies = mine.updates.map((u) => u.body).join("\n");
      expect(bodies).toContain("Technician will call before visiting.");
      expect(bodies).not.toContain("INTERNAL");
      expect(bodies).not.toContain("Triage:");
      await portalRequestFeedback(portal, reqId, { rating: 4, comment: "Quick fix, thanks" });
      expect((await getRequest(manager, reqId)).feedbackRating).toBe(4);
    });

    it("costs show up in maintenance reporting, scoped and permissioned", async () => {
      const rep = await maintenanceReport(facility, {});
      expect(rep.totals.totalMinor).toBe(25550);
      expect(rep.byProperty[0]).toMatchObject({ id: propA, totalMinor: 25550, workOrders: 1 });
      expect(rep.byCategory[0]).toMatchObject({ id: "plumbing", labourMinor: 15000, materialsMinor: 8550, otherMinor: 2000 });
      expect(rep.snapshot.completedOnTimePct).toBe(100);
      expect(await code(maintenanceReport(tech, {}))).toBe("FORBIDDEN");
      expect(await code(maintenanceReport(finance, {}))).toBe("FORBIDDEN");
      expect((await maintenanceReport(viewer, {})).totals.totalMinor).toBe(0); // scoped to property B only
      expect(await code(maintenanceReport(facility, { from: today, to: addDays(today, -1) }))).toBe("VALIDATION_ERROR");
    });

    it("every step is audited", async () => {
      const actions = (await prisma.auditLog.findMany({ where: { OR: [{ entityId: reqId }, { entityId: woId }] }, select: { action: true } })).map((a) => a.action);
      for (const a of ["maintenance_request.created", "maintenance_request.triaged", "maintenance_request.approved", "work_order.created", "work_order.started",
        "work_order.waiting_for_parts", "work_order.resumed", "work_order.costs_updated", "work_order.completed", "work_order.returned", "work_order.closed", "maintenance_request.closed", "maintenance_request.feedback"]) {
        expect(actions).toContain(a);
      }
    });
  });

  describe("request rules", () => {
    it("rejection requires a reason and is terminal", async () => {
      const r = await createRequest(manager, { propertyId: propA, unitId: unitA1, category: "cleaning", title: "Stairwell cleaning", description: "Tenant asks for weekly cleaning." });
      expect(r.requesterName).toBe(manager.userName);
      expect(await code(rejectRequest(manager, r.id, { reason: "" }))).toBe("VALIDATION_ERROR");
      const rej = await rejectRequest(manager, r.id, { reason: "Covered by the cleaning contract already" });
      expect(rej.status).toBe("rejected");
      expect(rej.decisionReason).toContain("cleaning contract");
      expect(await code(approveRequest(manager, r.id, {}))).toBe("BUSINESS_RULE");
      expect(await code(updateRequest(manager, r.id, { title: "x" }))).toBe("BUSINESS_RULE");
    });
    it("cancelling a request with open work orders is blocked; cancelling the work order reverts the request to approved", async () => {
      const r = await createRequest(facility, { propertyId: propA, category: "electrical", title: "Corridor lights out", description: "Block A corridor lights not working." });
      await approveRequest(facility, r.id, {});
      const { workOrderId } = await createWorkOrderFromRequest(facility, r.id, { vendorId });
      expect((await getRequest(facility, r.id)).status).toBe("assigned");
      expect(await code(cancelRequest(facility, r.id, { reason: "Duplicate of another request" }))).toBe("BUSINESS_RULE");
      await cancelWorkOrder(facility, workOrderId, { reason: "Wrong vendor chosen" });
      expect((await getRequest(facility, r.id)).status).toBe("approved");
      expect((await cancelRequest(facility, r.id, { reason: "Duplicate of another request" })).status).toBe("cancelled");
    });
    it("property scope applies to requests: out-of-scope records are NOT_FOUND", async () => {
      const r = await createRequest(owner, { propertyId: propA, category: "grounds", title: "Grass cutting", description: "Front lawn overgrown." });
      expect(await code(getRequest(scopedMgr, r.id))).toBe("NOT_FOUND");
      expect((await listRequests(scopedMgr, {})).items.every((x) => x.propertyId === propB)).toBe(true);
      expect(await code(createRequest(scopedMgr, { propertyId: propA, category: "other", title: "x", description: "y" }))).toBe("NOT_FOUND");
      expect(await code(getRequest(outsider, r.id))).toBe("NOT_FOUND");
      expect(await code(createRequest(manager, { propertyId: propA, unitId: unitB1, category: "other", title: "x", description: "y" }))).toBe("BUSINESS_RULE");
    });
    it("emergencies are escalated once to responsible staff in scope (email via mock adapter)", async () => {
      const r = await portalSubmitRequest(portal, { unitId: unitA1, category: "electrical", title: "Sparks from socket", description: "Burning smell and sparks from the bedroom socket.", priority: "emergency" });
      const full = await getRequest(manager, r.id);
      expect(full.isEmergency).toBe(true);
      expect(full.escalatedAt).not.toBeNull();
      expect(full.targetDate).toBe(addDays(today, 1));
      const notified = await prisma.notification.findMany({ where: { eventType: "maintenance.emergency", channel: "in_app" }, select: { userId: true } });
      const ids = notified.map((n) => n.userId);
      expect(ids).toEqual(expect.arrayContaining([owner.userId, manager.userId, facility.userId]));
      expect(ids).not.toContain(scopedMgr.userId); // no access to property A
      expect(ids).not.toContain(tech.userId);
      expect(await prisma.notification.count({ where: { eventType: "maintenance.emergency", channel: "email", status: "simulated" } })).toBe(ids.length);
      // Re-triage as emergency does not re-send.
      await triageRequest(manager, r.id, { priority: "emergency" });
      expect(await prisma.notification.count({ where: { eventType: "maintenance.emergency", channel: "in_app" } })).toBe(ids.length);
    });
  });

  describe("standalone work orders", () => {
    it("validates links and dates; vendor-assigned work is invisible to technicians", async () => {
      expect(await code(createWorkOrder(facility, { propertyId: propA, unitId: unitB1, category: "other", scope: "x" }))).toBe("BUSINESS_RULE");
      expect(await code(createWorkOrder(facility, { propertyId: propB, assetId: genId, category: "electrical", scope: "x" }))).toBe("BUSINESS_RULE");
      expect(await code(createWorkOrder(facility, { propertyId: propA, category: "other", scope: "x", scheduledAt: today, dueAt: addDays(today, -1) }))).toBe("BUSINESS_RULE");
      expect(await code(createWorkOrder(tech, { propertyId: propA, category: "other", scope: "x" }))).toBe("FORBIDDEN");
      const w = await createWorkOrder(facility, { propertyId: propA, assetId: genId, category: "electrical", scope: "Replace generator battery", vendorId, dueAt: addDays(today, -2) });
      expect(w.status).toBe("assigned");
      expect(w.overdue).toBe(true);
      expect((await listWorkOrders(facility, { status: "overdue" })).items.map((x) => x.id)).toContain(w.id);
      expect((await listWorkOrders(tech, {})).items.some((x) => x.id === w.id)).toBe(false);
      // Unassigning returns it to open.
      expect((await updateWorkOrder(facility, w.id, { vendorId: null })).status).toBe("open");
    });
    it("work orders cannot be deleted at the database level", async () => {
      const w = await prisma.workOrder.findFirstOrThrow();
      await expect(prisma.workOrder.delete({ where: { id: w.id } })).rejects.toThrow();
    });
  });

  describe("preventive maintenance", () => {
    let planId: string;
    it("creates a plan and generates the due work order once (idempotent job)", async () => {
      expect(await code(createPlan(tech, { assetId: genId, planName: "x", intervalDays: 30, nextDueAt: today }))).toBe("FORBIDDEN");
      expect(await code(createPlan(facility, { assetId: genId, planName: "x", intervalDays: 0, nextDueAt: today }))).toBe("VALIDATION_ERROR");
      expect(await code(createPlan(facility, { assetId: genId, planName: "x", intervalDays: 30, nextDueAt: today, assignedUserId: tech.userId, assignedVendorId: vendorId }))).toBe("BUSINESS_RULE");
      const p = await createPlan(facility, { assetId: genId, planName: "Quarterly generator service", intervalDays: 90, nextDueAt: addDays(today, 5), leadDays: 7, checklist: ["Check oil level", "Replace fuel filter", "Load test 30 min"], assignedUserId: tech.userId });
      planId = p.id;
      expect(p.dueStatus).toBe("due_soon");
      const actor = { organizationId: owner.organizationId, userId: null as unknown as string, userName: "System job", requestId: "job-test", isDemoOrg: false };
      const r1 = await generatePreventiveWorkOrders(actor, today);
      expect(r1.workOrdersCreated).toBe(1);
      const r2 = await generatePreventiveWorkOrders(actor, today);
      expect(r2.workOrdersCreated).toBe(0);
      const wos = await prisma.workOrder.findMany({ where: { pmPlanId: planId } });
      expect(wos).toHaveLength(1);
      expect(wos[0]).toMatchObject({ kind: "preventive", status: "assigned", assignedUserId: tech.userId, priority: "high" });
      expect((wos[0].checklistJson as { item: string }[]).map((c) => c.item)).toEqual(["Check oil level", "Replace fuel filter", "Load test 30 min"]);
      const plan = (await listPlans(facility, {})).find((x) => x.id === planId)!;
      expect(plan.nextDueAt).toBe(addDays(today, 95));
      expect(plan.openWorkOrders).toHaveLength(1);
      expect(plan.effectiveDueAt).toBe(addDays(today, 5)); // still owed until the generated WO is done
    });
    it("concurrent generation runs do not duplicate work orders", async () => {
      const pump = await createAsset(facility, { propertyId: propA, name: "Borehole pump", category: "borehole" });
      await createPlan(facility, { assetId: pump.id, planName: "Monthly pump check", intervalDays: 30, nextDueAt: addDays(today, -65), leadDays: 0 });
      const actor = { organizationId: owner.organizationId, userId: null as unknown as string, userName: "System job", requestId: "job-race", isDemoOrg: false };
      const [a, b] = await Promise.all([generatePreventiveWorkOrders(actor, today), generatePreventiveWorkOrders(actor, today)]);
      expect(a.workOrdersCreated + b.workOrdersCreated).toBe(1);
      const wo = await prisma.workOrder.findFirstOrThrow({ where: { assetId: pump.id } });
      expect(wo.scope).toContain("2 earlier occurrence(s) were missed");
      expect(wo.status).toBe("open"); // plan had no assignee
    });
    it("technician completes the PM checklist; manager sign-off updates the asset's service dates", async () => {
      const wo = await prisma.workOrder.findFirstOrThrow({ where: { pmPlanId: planId } });
      await progressWorkOrder(tech, wo.id, { status: "in_progress" });
      await completeWorkOrder(tech, wo.id, {
        completionNotes: "Service done. Oil topped up.", labourCostMinor: 30000, materialsCostMinor: 45000,
        checklist: [{ item: "Check oil level", done: true, reading: "Low, topped up 2L" }, { item: "Replace fuel filter", done: true }, { item: "Load test 30 min", done: true, reading: "48 kW stable" }],
      });
      await closeWorkOrder(facility, wo.id, {});
      const a = await getAsset(facility, genId);
      expect(a.lastServicedAt).toBe(today);
      expect(a.nextServiceAt).toBe(addDays(today, 90));
      const hist = await getAssetServiceHistory(facility, genId);
      const pm = hist.find((h) => h.id === wo.id)!;
      expect(pm.totalCostMinor).toBe(75000);
      expect((pm.checklistJson as { reading?: string }[])[2].reading).toBe("48 kW stable");
      const techHist = await getAssetServiceHistory(tech, genId);
      expect(techHist[0].totalCostMinor).toBeUndefined(); // technicians don't see aggregated spend
    });
    it("deactivated plans are not generated; manual generation needs both asset.manage and work_order.assign", async () => {
      await updatePlan(facility, planId, { active: false, nextDueAt: today });
      const r = await generateDueNow(facility);
      expect(r.refs.every((ref) => ref.startsWith("WO-"))).toBe(true);
      expect(await prisma.workOrder.count({ where: { pmPlanId: planId } })).toBe(1);
      expect(await code(generateDueNow(tech))).toBe("FORBIDDEN");
    });
    it("vendor history reports response and spend", async () => {
      const v = await getVendor(facility, vendorId);
      expect(v.performance.workOrders).toBeGreaterThanOrEqual(1);
      expect(v.history.length).toBe(v.performance.workOrders);
    });
  });
});
