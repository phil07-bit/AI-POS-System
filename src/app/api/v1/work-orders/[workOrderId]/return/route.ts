import { authedRoute, parseBody } from "@/lib/api/handler";
import { returnWorkOrder, reasonSchema } from "@/server/services/work-order.service";

export const POST = authedRoute(async ({ req, ctx, params }) => returnWorkOrder(ctx, params.workOrderId, await parseBody(req, reasonSchema)));
