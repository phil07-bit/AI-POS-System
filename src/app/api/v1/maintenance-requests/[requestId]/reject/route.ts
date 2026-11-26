import { authedRoute, parseBody } from "@/lib/api/handler";
import { rejectRequest } from "@/server/services/maintenance-request.service";
import { reasonSchema } from "@/server/services/work-order.service";
export const POST = authedRoute(async ({ req, ctx, params }) => rejectRequest(ctx, params.requestId, await parseBody(req, reasonSchema)));
