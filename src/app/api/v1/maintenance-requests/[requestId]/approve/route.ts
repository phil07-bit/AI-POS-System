import { authedRoute, parseBody } from "@/lib/api/handler";
import { approveRequest, approveSchema } from "@/server/services/maintenance-request.service";

export const POST = authedRoute(async ({ req, ctx, params }) => approveRequest(ctx, params.requestId, await parseBody(req, approveSchema)));
