import "server-only";
import type { RequestContext } from "@/lib/auth/context";
import { listProperties } from "@/server/services/property.service";
import { listUnits } from "@/server/services/unit.service";
import { listAssets } from "@/server/services/asset.service";
import { listVendors } from "@/server/services/vendor.service";
import { listAssignableUsers } from "@/server/services/maintenance-common";
import { prisma } from "@/lib/db";

/** Picker options for facilities forms, already limited to the caller's org and property scope. */
export async function facilitiesOptions(ctx: RequestContext, want: { assignees?: boolean; vendors?: boolean; tenants?: boolean; managers?: boolean } = {}) {
  const has = (k: string) => ctx.permissions.has(k);
  const [props, units, assets, vendors, users, tenants, managers] = await Promise.all([
    listProperties(ctx, { pageSize: 100 }),
    listUnits(ctx, { pageSize: 100 }),
    has("asset.read") ? listAssets(ctx, { pageSize: 100, status: "active" }) : null,
    want.vendors && (has("vendor.read") || has("vendor.manage")) ? listVendors(ctx, { pageSize: 100, status: "active" }) : null,
    want.assignees && has("work_order.assign") ? listAssignableUsers(ctx) : [],
    want.tenants && has("tenant.read") ? prisma.tenant.findMany({ where: { organizationId: ctx.organizationId, archivedAt: null, status: { in: ["active", "prospective"] } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" }, take: 300 }) : [],
    want.managers ? prisma.organizationMembership.findMany({
      where: { organizationId: ctx.organizationId, status: "active", tenantId: null, role: { permissions: { some: { permission: { key: "maintenance.request.manage" } } } } },
      select: { id: true, user: { select: { fullName: true } }, role: { select: { name: true } } }, orderBy: { user: { fullName: "asc" } },
    }) : [],
  ]);
  return {
    properties: props.items.map((p) => ({ id: p.id, label: p.name })),
    units: units.items.map((u) => ({ id: u.id, label: `${u.property.name} · ${u.unitRef}`, propertyId: u.propertyId })),
    assets: (assets?.items ?? []).map((a) => ({ id: a.id, label: `${a.assetRef} ${a.name}`, propertyId: a.propertyId, unitId: a.unitId })),
    vendors: (vendors?.items ?? []).map((v) => ({ id: v.id, label: `${v.businessName}${v.serviceCategories.length ? ` (${v.serviceCategories.join(", ").replace(/_/g, " ")})` : ""}` })),
    users: users.map((u) => ({ id: u.id, label: `${u.name} · ${u.role}` })),
    tenants: tenants.map((t) => ({ id: t.id, label: t.displayName })),
    managers: managers.map((m) => ({ id: m.id, label: `${m.user.fullName} · ${m.role.name}` })),
  };
}
