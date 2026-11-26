import { describe, expect, it } from "vitest";
import { ROLE_DEFINITIONS, roleDefinition, hasPermission, canAccessProperty, propertyScopeFilter, ALL_PERMISSION_KEYS } from "@/lib/permissions";

const subject = (roleKey: string, scope: string[] | null = null, tenantId: string | null = null) => ({
  permissions: new Set(roleDefinition(roleKey)!.permissions),
  scopeAllProperties: scope === null,
  propertyIds: new Set(scope ?? []),
  tenantId,
});

describe("permission evaluation", () => {
  it("every role references only known permission keys", () => {
    for (const r of ROLE_DEFINITIONS) for (const p of r.permissions) expect(ALL_PERMISSION_KEYS).toContain(p);
  });
  it("finance officer can record and reverse payments but cannot manage users", () => {
    const s = subject("finance_officer");
    expect(hasPermission(s, "payment.record")).toBe(true);
    expect(hasPermission(s, "payment.reverse")).toBe(true);
    expect(hasPermission(s, "user.manage")).toBe(false);
    expect(hasPermission(s, "tenant.sensitive.read")).toBe(false);
  });
  it("technician has no financial report access", () => {
    const s = subject("technician");
    expect(hasPermission(s, "report.financial.read")).toBe(false);
    expect(hasPermission(s, "rent.read")).toBe(false);
  });
  it("viewer/auditor roles are read-only", () => {
    for (const k of ["owner_viewer", "auditor"]) {
      const perms = roleDefinition(k)!.permissions;
      expect(perms.every((p) => p.endsWith(".read") || p === "audit.read")).toBe(true);
    }
  });
  it("tenant portal role has only self-service permissions", () => {
    expect(roleDefinition("tenant_portal")!.permissions.sort()).toEqual(["maintenance.request.create", "portal.self"]);
  });
  it("evaluates property scope", () => {
    const scoped = subject("property_manager", ["p1"]);
    expect(canAccessProperty(scoped, "p1")).toBe(true);
    expect(canAccessProperty(scoped, "p2")).toBe(false);
    expect(propertyScopeFilter(scoped)).toEqual({ propertyId: { in: ["p1"] } });
    expect(propertyScopeFilter(subject("org_admin"))).toEqual({});
  });
});
