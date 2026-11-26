import { authedRoute, parseBody } from "@/lib/api/handler";
import { cancelRequest } from "@/server/services/maintenance-request.service";
import { reasonSchema } from "@/server/services/work-order.service";
export const POST = authedRoute(async ({ req, ctx, params }) => cancelRequest(ctx, params.requestId, await parseBody(req, reasonSchema)));
