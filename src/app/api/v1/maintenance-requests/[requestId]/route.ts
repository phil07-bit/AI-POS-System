import { authedRoute, parseBody } from "@/lib/api/handler";
import { getRequest, requestUpdateSchema, updateRequest } from "@/server/services/maintenance-request.service";

export const GET = authedRoute(async ({ ctx, params }) => getRequest(ctx, params.requestId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateRequest(ctx, params.requestId, await parseBody(req, requestUpdateSchema)));
