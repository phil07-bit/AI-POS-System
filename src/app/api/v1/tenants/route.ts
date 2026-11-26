import { authedRoute, parseBody, ok, searchParamsObject } from "@/lib/api/handler";
import { createTenant, listTenants, tenantInputSchema } from "@/server/services/tenant.service";

export const GET = authedRoute(async ({ req, ctx }) => listTenants(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createTenant(ctx, await parseBody(req, tenantInputSchema)), requestId, { status: 201 }));
