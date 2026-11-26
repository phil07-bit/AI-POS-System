import { authedRoute } from "@/lib/api/handler";
import { listMyOrganizations } from "@/server/services/organization.service";

export const GET = authedRoute(async ({ ctx }) => ({
  user: { id: ctx.userId, fullName: ctx.userName, email: ctx.userEmail },
  activeOrganization: { id: ctx.organizationId, name: ctx.organizationName, timezone: ctx.timezone, currency: ctx.currency, isDemo: ctx.isDemoOrg },
  membership: { id: ctx.membershipId, role: ctx.roleKey, roleName: ctx.roleName, scopeAllProperties: ctx.scopeAllProperties, propertyIds: [...ctx.propertyIds], tenantId: ctx.tenantId },
  permissions: [...ctx.permissions].sort(),
  organizations: await listMyOrganizations(ctx.userId),
}));
