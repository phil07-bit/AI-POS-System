import { authedRoute, parseBody } from "@/lib/api/handler";
import { triageRequest, triageSchema } from "@/server/services/maintenance-request.service";

export const POST = authedRoute(async ({ req, ctx, params }) => triageRequest(ctx, params.requestId, await parseBody(req, triageSchema)));
