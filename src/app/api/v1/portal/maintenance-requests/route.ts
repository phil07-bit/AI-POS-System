import { authedRoute, ok, parseBody } from "@/lib/api/handler";
import { portalMaintenance, portalRequestSchema, portalSubmitRequest } from "@/server/services/portal.service";

export const GET = authedRoute(async ({ ctx }) => portalMaintenance(ctx));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await portalSubmitRequest(ctx, await parseBody(req, portalRequestSchema)), requestId, { status: 201 }));
