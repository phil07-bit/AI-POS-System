import { authedRoute, parseBody } from "@/lib/api/handler";
import { getTenant, tenantUpdateSchema, updateTenant } from "@/server/services/tenant.service";

export const GET = authedRoute(async ({ ctx, params }) => getTenant(ctx, params.tenantId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateTenant(ctx, params.tenantId, await parseBody(req, tenantUpdateSchema)));
