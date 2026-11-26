import { ALL_PERMISSION_KEYS, type PermissionKey } from "./keys";

export type RoleKey =
  | "org_owner" | "org_admin" | "property_manager" | "finance_officer" | "facility_manager"
  | "technician" | "owner_viewer" | "tenant_portal" | "auditor";

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  rank: number; // higher = more privileged; an inviter can only grant roles with rank <= their own
  permissions: PermissionKey[];
}

const readOnlyOps: PermissionKey[] = [
  "property.read", "unit.read", "lease.read", "rent.read", "report.financial.read",
  "maintenance.request.read", "work_order.read", "asset.read",
];

const ownerPerms = ALL_PERMISSION_KEYS.filter((k) => k !== "portal.self");

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  { key: "org_owner", name: "Organization Owner", rank: 100,
    description: "Full organization administration and data access.", permissions: ownerPerms },
  { key: "org_admin", name: "Organization Admin", rank: 90,
    description: "Broad access; ownership transfer and billing are excluded.", permissions: ownerPerms },
  { key: "property_manager", name: "Portfolio/Property Manager", rank: 60,
    description: "Property, unit, tenant, lease, rent and maintenance operations within assigned scope.",
    permissions: [
      "property.read", "property.create", "property.update", "unit.read", "unit.manage",
      "tenant.read", "tenant.create", "tenant.update", "tenant.archive", "tenant.sensitive.read",
      "lease.read", "lease.create", "lease.update", "lease.activate", "lease.terminate",
      "rent.read", "rent.charge.create", "payment.record", "report.financial.read",
      "maintenance.request.read", "maintenance.request.create", "maintenance.request.manage",
      "work_order.read", "work_order.assign", "work_order.update", "work_order.close",
      "vendor.manage", "asset.read", "asset.manage", "document.read", "document.manage",
      "ai.insight.read", "ai.insight.generate",
    ] },
  { key: "finance_officer", name: "Finance Officer", rank: 50,
    description: "Invoices, payments, receipts, arrears and financial reports. No access to tenant ID documents.",
    permissions: [
      "property.read", "property.financials.read", "unit.read", "tenant.read", "lease.read",
      "rent.read", "rent.charge.create", "rent.charge.void", "rent.adjust",
      "payment.record", "payment.confirm", "payment.allocate", "payment.reverse",
      "report.financial.read", "report.export", "ai.insight.read",
    ] },
  { key: "facility_manager", name: "Facility/Maintenance Manager", rank: 50,
    description: "Assets, requests, work orders, vendors and maintenance reporting.",
    permissions: [
      "property.read", "unit.read", "maintenance.request.read", "maintenance.request.create",
      "maintenance.request.manage", "work_order.read", "work_order.assign", "work_order.update",
      "work_order.close", "vendor.manage", "asset.read", "asset.manage", "document.read", "ai.insight.read",
    ] },
  { key: "technician", name: "Maintenance Technician", rank: 20,
    description: "Assigned work orders and limited property/asset information.",
    permissions: ["property.read", "unit.read", "work_order.read", "work_order.update", "asset.read"] },
  { key: "owner_viewer", name: "Landlord/Owner Viewer", rank: 30,
    description: "Read-only access to assigned properties and reports.",
    permissions: [...readOnlyOps, "tenant.read"] },
  { key: "auditor", name: "Auditor/Read-only", rank: 30,
    description: "Read-only access to explicitly assigned scope, including the audit log.",
    permissions: [...readOnlyOps, "tenant.read", "audit.read"] },
  { key: "tenant_portal", name: "Tenant Portal User", rank: 10,
    description: "Own lease summary, ledger, receipts and maintenance requests only.",
    permissions: ["portal.self", "maintenance.request.create"] },
];

export function roleDefinition(key: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((r) => r.key === key);
}
