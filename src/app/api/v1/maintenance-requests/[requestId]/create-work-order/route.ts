import { authedRoute, parseBody } from "@/lib/api/handler";
import { createWorkOrderFromRequest, createWorkOrderFromRequestSchema } from "@/server/services/maintenance-request.service";

export const POST = authedRoute(async ({ req, ctx, params }) => createWorkOrderFromRequest(ctx, params.requestId, await parseBody(req, createWorkOrderFromRequestSchema)));
