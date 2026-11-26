import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api/errors";
import type { AccessSubject, PermissionKey } from "@/lib/permissions";

/**
 * Server-side request context. Built ONLY from the session + database — never from
 * client-supplied organization IDs. Every service function receives one.
 */
export interface RequestContext extends AccessSubject {
  requestId: string;
  userId: string;
  userName: string;
  userEmail: string;
  isPlatformAdmin: boolean;
  organizationId: string;
  organizationName: string;
  membershipId: string;
  roleKey: string;
  roleName: string;
  roleRank: number;
  timezone: string;
  currency: string;
  isDemoOrg: boolean;
}

/**
 * Resolve the access context for a user in an organization.
 * Checks (spec §3.2): user active → membership exists & active → organization active.
 */
export async function loadContext(userId: string, organizationId: string, requestId: string): Promise<RequestContext> {
  const membership = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: {
      user: true,
      organization: true,
      role: { include: { permissions: { include: { permission: true } } } },
      propertyScopes: true,
    },
  });
  if (!membership || membership.user.status !== "active") {
    throw new AppError("FORBIDDEN", "You are not a member of this organization.");
  }
  if (membership.status !== "active") throw new AppError("FORBIDDEN", "Your membership is suspended.");
  if (membership.organization.status !== "active") throw new AppError("FORBIDDEN", "This organization is suspended.");

  return {
    requestId,
    userId,
    userName: membership.user.fullName,
    userEmail: membership.user.email,
    isPlatformAdmin: membership.user.isPlatformAdmin,
    organizationId,
    organizationName: membership.organization.name,
    membershipId: membership.id,
    roleKey: membership.role.key,
    roleName: membership.role.name,
    roleRank: membership.role.rank,
    timezone: membership.organization.timezone,
    currency: membership.organization.defaultCurrency,
    isDemoOrg: membership.organization.isDemo,
    permissions: new Set(membership.role.permissions.map((rp) => rp.permission.key)),
    scopeAllProperties: membership.tenantId ? false : membership.scopeAllProperties,
    propertyIds: new Set(membership.propertyScopes.map((s) => s.propertyId)),
    tenantId: membership.tenantId,
  };
}

export function requirePermission(ctx: RequestContext, ...keys: PermissionKey[]) {
  for (const k of keys) {
    if (!ctx.permissions.has(k)) throw new AppError("FORBIDDEN", `Missing permission: ${k}`);
  }
}

export function requireAnyPermission(ctx: RequestContext, ...keys: PermissionKey[]) {
  if (!keys.some((k) => ctx.permissions.has(k))) throw new AppError("FORBIDDEN", `Missing permission: one of ${keys.join(", ")}`);
}

/** Staff-only guard: tenant-portal memberships may never call staff services. */
export function requireStaff(ctx: RequestContext) {
  if (ctx.tenantId) throw new AppError("FORBIDDEN", "This area is for organization staff only.");
}

export function requirePropertyAccess(ctx: RequestContext, propertyId: string) {
  if (!ctx.scopeAllProperties && !ctx.propertyIds.has(propertyId)) {
    // Same response as a missing record: do not reveal existence outside scope.
    throw new AppError("NOT_FOUND", "Record not found.");
  }
}
