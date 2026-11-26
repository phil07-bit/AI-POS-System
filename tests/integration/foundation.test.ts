import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, makeOrg, makeMember, address, ctxFor } from "./helpers";
import { login, signup } from "@/server/services/auth.service";
import { acceptInvitation, inviteMember, updateMembership } from "@/server/services/organization.service";
import { createProperty, getProperty, listProperties, updateProperty } from "@/server/services/property.service";
import { loadContext } from "@/lib/auth/context";
import { AppError } from "@/lib/api/errors";

const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof AppError ? e.code : "ERROR"; } };

describe("phase 1 — auth, organizations, RBAC, isolation", () => {
  beforeAll(resetDb);

  it("signup creates user + org + owner membership and allows login", async () => {
    const r = await signup({ fullName: "Ama Mensah", email: "ama@example.test", password: "Accra2026pass", organizationName: "Mensah Estates" });
    expect(r.org.slug).toBe("mensah-estates");
    const ctx = await loadContext(r.user.id, r.org.id, "t");
    expect(ctx.roleKey).toBe("org_owner");
    expect(ctx.permissions.has("payment.reverse")).toBe(true);
    const l = await login({ email: "AMA@example.test".toLowerCase(), password: "Accra2026pass" });
    expect(l.hasMembership).toBe(true);
    await expect(login({ email: "ama@example.test", password: "wrong" })).rejects.toThrow(/Incorrect/);
    await expect(signup({ fullName: "Weak Pass", email: "weak@example.test", password: "short", organizationName: "Org" })).rejects.toThrow(/at least 10/);
  });

  it("Organization A cannot read or update Organization B records (Scenario F)", async () => {
    const a = await makeOrg("Org A"); const b = await makeOrg("Org B");
    const adminA = await makeMember(a.id, "org_admin");
    const adminB = await makeMember(b.id, "org_admin");
    const propB = await createProperty(adminB, { name: "B Towers", propertyType: "residential", address, status: "active" });
    expect(await code(getProperty(adminA, propB.id))).toBe("NOT_FOUND");
    expect(await code(updateProperty(adminA, propB.id, { name: "hacked" }))).toBe("NOT_FOUND");
    const listA = await listProperties(adminA, { page: 1, pageSize: 50, sortOrder: "asc" });
    expect(listA.items.find((p) => p.id === propB.id)).toBeUndefined();
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propB.id } })).name).toBe("B Towers");
    // A user with no membership in B cannot even build a context for it.
    await expect(loadContext(adminA.userId, b.id, "t")).rejects.toThrow(/not a member/);
  });

  it("enforces property-level scope", async () => {
    const org = await makeOrg("Scoped Org");
    const admin = await makeMember(org.id, "org_admin");
    const p1 = await createProperty(admin, { name: "Osu Flats", propertyType: "residential", address, status: "active" });
    const p2 = await createProperty(admin, { name: "Tema Shops", propertyType: "commercial", address, status: "active" });
    const pm = await makeMember(org.id, "property_manager", { propertyIds: [p1.id] });
    expect((await getProperty(pm, p1.id)).name).toBe("Osu Flats");
    expect(await code(getProperty(pm, p2.id))).toBe("NOT_FOUND");
    const list = await listProperties(pm, { page: 1, pageSize: 50, sortOrder: "asc" });
    expect(list.items.map((p) => p.id)).toEqual([p1.id]);
  });

  it("hides restricted acquisition cost from roles without property.financials.read", async () => {
    const org = await makeOrg("Fin Org");
    const owner = await makeMember(org.id, "org_owner");
    const p = await createProperty(owner, { name: "Airport Residences", propertyType: "residential", address, status: "active", acquisitionCostMinor: 500_000_000 });
    expect(p.acquisitionCostMinor).toBe(500_000_000);
    const pm = await makeMember(org.id, "property_manager");
    expect((await getProperty(pm, p.id)).acquisitionCostMinor).toBeUndefined();
  });

  it("role permissions are enforced server-side", async () => {
    const org = await makeOrg("Role Org");
    const fin = await makeMember(org.id, "finance_officer");
    const tech = await makeMember(org.id, "technician");
    const viewer = await makeMember(org.id, "owner_viewer");
    expect(await code(createProperty(fin, { name: "Nope", propertyType: "residential", address, status: "active" }))).toBe("FORBIDDEN");
    expect(await code(inviteMember(fin, { email: "x@example.test", roleKey: "technician", scopeAllProperties: true, propertyIds: [] }))).toBe("FORBIDDEN");
    expect(await code(createProperty(tech, { name: "Nope", propertyType: "residential", address, status: "active" }))).toBe("FORBIDDEN");
    expect(await code(createProperty(viewer, { name: "Nope", propertyType: "residential", address, status: "active" }))).toBe("FORBIDDEN");
  });

  it("invitation flow: admin invites, invitee accepts with assigned role; escalation blocked; audit logged", async () => {
    const org = await makeOrg("Invite Org");
    const admin = await makeMember(org.id, "org_admin");
    expect(await code(inviteMember(admin, { email: "boss@example.test", roleKey: "org_owner", scopeAllProperties: true, propertyIds: [] }))).toBe("FORBIDDEN");
    const r = await inviteMember(admin, { email: "kofi@example.test", roleKey: "finance_officer", scopeAllProperties: true, propertyIds: [] });
    const token = r.devAcceptUrl!.split("/invite/")[1];
    const acc = await acceptInvitation({ token, fullName: "Kofi Boateng", password: "Kumasi2026pass" });
    const ctx = await ctxFor(acc.user.id, org.id);
    expect(ctx.roleKey).toBe("finance_officer");
    await expect(acceptInvitation({ token, fullName: "Kofi", password: "Kumasi2026pass" })).rejects.toThrow(/invalid or has expired/);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: org.id }, select: { action: true } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["membership.invited", "membership.joined"]));
    const sent = await prisma.notification.findFirst({ where: { recipient: "kofi@example.test" } });
    expect(sent?.status).toBe("simulated");
  });

  it("suspending a membership blocks access; last owner protected", async () => {
    const org = await makeOrg("Suspend Org");
    const owner = await makeMember(org.id, "org_owner");
    const fin = await makeMember(org.id, "finance_officer");
    await updateMembership(owner, fin.membershipId, { status: "suspended" });
    await expect(ctxFor(fin.userId, org.id)).rejects.toThrow(/suspended/);
    expect(await code(updateMembership(owner, owner.membershipId, { status: "suspended" }))).toBe("BUSINESS_RULE");
    const logs = await prisma.auditLog.count({ where: { organizationId: org.id, action: "membership.suspended" } });
    expect(logs).toBe(1);
  });

  it("audit log is append-only at the database level", async () => {
    const log = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/append-only/);
  });
});
