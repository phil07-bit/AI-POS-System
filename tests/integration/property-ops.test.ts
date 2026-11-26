import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, makeOrg, makeMember, address } from "./helpers";
import { createProperty, archiveProperty, getProperty } from "@/server/services/property.service";
import { createUnit, getUnit, archiveUnit, listUnits } from "@/server/services/unit.service";
import { createTenant, getTenant, revealIdentification, archiveTenant } from "@/server/services/tenant.service";
import { activateLease, createLease, renewLease, terminateLease, updateLease, getLease } from "@/server/services/lease.service";
import { generateCharges } from "@/server/services/rent.service";
import { addDays, addMonths, todayInTz } from "@/lib/dates";
import { AppError } from "@/lib/api/errors";
import type { RequestContext } from "@/lib/auth/context";

const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof AppError ? e.code : "ERROR"; } };
const today = todayInTz();

describe("phase 2 — properties, units, tenants, leases (Scenario A)", () => {
  let admin: RequestContext, manager: RequestContext, finance: RequestContext;
  let propertyId: string, unitId: string, tenantId: string;

  beforeAll(async () => {
    await resetDb();
    const org = await makeOrg("Caxaze Test");
    admin = await makeMember(org.id, "org_admin");
    manager = await makeMember(org.id, "property_manager");
    finance = await makeMember(org.id, "finance_officer");
  });

  it("admin creates a property and a unit; unit is vacant", async () => {
    const p = await createProperty(admin, { name: "Cantonments Court", propertyType: "residential", address, status: "active" });
    expect(p.propertyRef).toMatch(/^PRP-\d{4}$/);
    propertyId = p.id;
    const u = await createUnit(admin, propertyId, { unitRef: "a1", unitType: "apartment", areaUnit: "sqm", furnishingStatus: "furnished", rentFrequency: "monthly", availability: "available", bedrooms: 2, askingRentMinor: 450000 });
    expect(u.unitRef).toBe("A1");
    expect(u.occupancyStatus).toBe("vacant");
    unitId = u.id;
    expect(await code(createUnit(admin, propertyId, { unitRef: "A1", unitType: "apartment", areaUnit: "sqm", furnishingStatus: "furnished", rentFrequency: "monthly", availability: "available" }))).not.toBe("OK");
  });

  it("manager creates a tenant; ID number is encrypted, masked and access-controlled", async () => {
    const t = await createTenant(manager, {
      tenantType: "individual", displayName: "Yaw Asante", phone: "024 123 4567", email: "yaw@example.test", status: "prospective",
      identificationType: "ghana_card", identificationReference: "GHA-123456789-0", privacyNoticeAccepted: true,
    });
    expect(t.phone).toBe("+233241234567");
    expect(t.identificationMasked).toBe("•••• 89-0");
    tenantId = t.id;
    const raw = await prisma.tenant.findUniqueOrThrow({ where: { id: t.id } });
    expect(raw.identificationRefEncrypted).not.toContain("123456789");
    expect((await revealIdentification(manager, t.id)).identificationReference).toBe("GHA-123456789-0");
    const asFinance = await getTenant(finance, t.id);
    expect(asFinance.identificationMasked).toBeUndefined();
    expect(asFinance.emergencyContact).toBeUndefined();
    expect(await code(revealIdentification(finance, t.id))).toBe("FORBIDDEN");
    expect(await prisma.auditLog.count({ where: { action: "tenant.identification_viewed" } })).toBe(1);
  });

  it("manager creates and activates a lease; unit shows occupied; rent schedule generated without duplicates", async () => {
    const start = addMonths(today, -2);
    const end = addDays(addMonths(start, 12), -1);
    const l = await createLease(manager, { unitId, parties: [{ tenantId, partyRole: "primary_tenant" }], startDate: start, endDate: end, rentAmountMinor: 450000, billingFrequency: "monthly", depositAmountMinor: 900000, depositStatus: "held", gracePeriodDays: 5, dueDay: null });
    expect(l.status).toBe("draft");
    expect((await getUnit(manager, unitId)).occupancyStatus).toBe("vacant");
    const r = await activateLease(manager, l.id);
    expect(r.lease.status).toBe("active");
    expect(r.chargesCreated).toBeGreaterThanOrEqual(3); // 2 past months + current (+ next within horizon)
    expect((await getUnit(manager, unitId)).occupancyStatus).toBe("occupied");
    expect((await getTenant(manager, tenantId)).status).toBe("active");
    const prop = await getProperty(manager, propertyId);
    expect(prop.occupancy.occupiedUnits).toBe(1);
    expect(prop.occupancy.occupancyRate).toBe(100);
    // Re-running generation is idempotent.
    const count = await prisma.rentCharge.count({ where: { leaseId: l.id } });
    const again = await generateCharges(finance, { leaseId: l.id });
    expect(again.created).toBe(0);
    expect(await prisma.rentCharge.count({ where: { leaseId: l.id } })).toBe(count);
  });

  it("blocks overlapping active leases on the same unit (service + DB constraint)", async () => {
    const t2 = await createTenant(manager, { tenantType: "individual", displayName: "Efua Owusu", status: "prospective" });
    const l2 = await createLease(manager, { unitId, parties: [{ tenantId: t2.id, partyRole: "primary_tenant" }], startDate: today, endDate: addMonths(today, 6), rentAmountMinor: 400000, billingFrequency: "monthly", depositAmountMinor: 0, depositStatus: "not_applicable", gracePeriodDays: 0 });
    expect(await code(activateLease(manager, l2.id))).toBe("CONFLICT");
    // Concurrent activation race: both drafts on a fresh unit, only one wins.
    const u2 = await createUnit(admin, propertyId, { unitRef: "B2", unitType: "studio", areaUnit: "sqm", furnishingStatus: "unfurnished", rentFrequency: "monthly", availability: "available" });
    const mk = (tid: string) => createLease(manager, { unitId: u2.id, parties: [{ tenantId: tid, partyRole: "primary_tenant" }], startDate: today, endDate: addMonths(today, 12), rentAmountMinor: 300000, billingFrequency: "monthly", depositAmountMinor: 0, depositStatus: "not_applicable", gracePeriodDays: 0 });
    const [x, y] = [await mk(tenantId), await mk(t2.id)];
    const results = await Promise.allSettled([activateLease(manager, x.id), activateLease(manager, y.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // DB exclusion constraint as last line of defence.
    await expect(prisma.lease.updateMany({ where: { unitId: u2.id, status: "draft" }, data: { status: "active" } })).rejects.toThrow();
  });

  it("rejects invalid dates and edits to active leases", async () => {
    const t3 = await createTenant(manager, { tenantType: "organization", displayName: "Kente Traders Ltd", status: "prospective" });
    await expect(createLease(manager, { unitId, parties: [{ tenantId: t3.id, partyRole: "primary_tenant" }], startDate: "2027-05-01", endDate: "2027-01-01", rentAmountMinor: 1000, billingFrequency: "monthly", depositAmountMinor: 0, depositStatus: "not_applicable", gracePeriodDays: 0 })).rejects.toThrow();
    const active = await prisma.lease.findFirstOrThrow({ where: { unitId, status: "active" } });
    expect(await code(updateLease(manager, active.id, { rentAmountMinor: 1 }))).toBe("BUSINESS_RULE");
  });

  it("renewal creates a new linked lease and never overwrites history", async () => {
    const active = await prisma.lease.findFirstOrThrow({ where: { unitId, status: "active" } });
    const renewal = await renewLease(manager, active.id, { rentAmountMinor: 500000 });
    expect(renewal.renewalOf?.id).toBe(active.id);
    expect(renewal.status).toBe("draft");
    expect(renewal.startDate).toBe(addDays(active.endDate.toISOString().slice(0, 10), 1));
    expect((await getLease(manager, active.id)).rentAmountMinor).toBe(450000);
    expect(await code(renewLease(manager, active.id, {}))).toBe("BUSINESS_RULE");
  });

  it("archive rules: unit with active lease, property with active leases, tenant on lease", async () => {
    expect(await code(archiveUnit(admin, unitId))).toBe("BUSINESS_RULE");
    expect(await code(archiveProperty(admin, propertyId))).toBe("BUSINESS_RULE");
    expect(await code(archiveTenant(manager, tenantId))).toBe("BUSINESS_RULE");
  });

  it("terminate records date/reason, voids unpaid future charges and frees the unit", async () => {
    const active = await prisma.lease.findFirstOrThrow({ where: { unitId, status: "active" } });
    expect(await code(terminateLease(finance, active.id, { terminationDate: today, reason: "Relocating" }))).toBe("FORBIDDEN");
    await generateCharges(finance, { leaseId: active.id, upTo: addMonths(today, 3) });
    const r = await terminateLease(manager, active.id, { terminationDate: today, reason: "Tenant relocating to Kumasi", settlementNotes: "Deposit to be reconciled" });
    expect(r.voidedCharges).toBeGreaterThan(0);
    const l = await getLease(manager, active.id);
    expect(l.status).toBe("terminated");
    expect(l.terminationReason).toMatch(/Kumasi/);
    expect((await getUnit(manager, unitId)).occupancyStatus).toBe("vacant");
    const units = await listUnits(manager, { page: 1, pageSize: 20, sortOrder: "asc", occupancy: "vacant", propertyId });
    expect(units.items.map((u) => u.id)).toContain(unitId);
  });
});
