import type { PermissionKey } from "@/lib/permissions";

export interface NavItem { href: string; label: string; anyOf: PermissionKey[]; phase?: number }

/**
 * Permission-aware navigation (spec §5.1). Items whose module is not yet built are listed
 * with their phase so the shell shows the full product map; they are rendered disabled.
 * The backend remains the authority — hiding a link is a convenience, not a control.
 */
export const NAV: NavItem[] = [
  { href: "/app", label: "Overview", anyOf: ["property.read"] },
  { href: "/app/properties", label: "Properties", anyOf: ["property.read"] },
  { href: "/app/units", label: "Units", anyOf: ["unit.read"] },
  { href: "/app/tenants", label: "Tenants", anyOf: ["tenant.read"] },
  { href: "/app/leases", label: "Leases", anyOf: ["lease.read"] },
  { href: "/app/rent", label: "Rent & Charges", anyOf: ["rent.read"] },
  { href: "/app/payments", label: "Payments", anyOf: ["rent.read"] },
  { href: "/app/arrears", label: "Arrears", anyOf: ["report.financial.read"] },
  { href: "/app/maintenance", label: "Maintenance", anyOf: ["maintenance.request.read"] },
  { href: "/app/work-orders", label: "Work Orders", anyOf: ["work_order.read"] },
  { href: "/app/assets", label: "Assets", anyOf: ["asset.read"] },
  { href: "/app/preventive-maintenance", label: "Preventive Maint.", anyOf: ["asset.read"] },
  { href: "/app/vendors", label: "Vendors", anyOf: ["vendor.read", "vendor.manage"] },
  { href: "/app/maintenance-costs", label: "Maintenance Costs", anyOf: ["maintenance.report.read"] },
  { href: "/app/reports", label: "Reports & Analytics", anyOf: ["report.financial.read"], phase: 5 },
  { href: "/app/ai", label: "AI Insights", anyOf: ["ai.insight.read"], phase: 6 },
  { href: "/app/documents", label: "Documents", anyOf: ["document.read"], phase: 5 },
  { href: "/app/team", label: "Team & Roles", anyOf: ["user.invite", "user.manage"] },
  { href: "/app/audit", label: "Audit Log", anyOf: ["audit.read"] },
  { href: "/app/settings", label: "Settings", anyOf: ["organization.settings.manage"] },
];
