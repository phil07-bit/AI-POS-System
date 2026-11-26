import { authedRoute, searchParamsObject } from "@/lib/api/handler";
import { requirePermission, requireStaff } from "@/lib/auth/context";
import { listAssignableUsers } from "@/server/services/maintenance-common";

/** Staff who can be assigned work orders (optionally limited to those with access to a property). */
export const GET = authedRoute(async ({ req, ctx }) => {
  requireStaff(ctx);
  requirePermission(ctx, "work_order.assign");
  const { propertyId } = searchParamsObject(req);
  return listAssignableUsers(ctx, propertyId);
});
