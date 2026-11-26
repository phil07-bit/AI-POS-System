import { authedRoute, parseBody } from "@/lib/api/handler";
import { progressWorkOrder, workOrderTransitionSchema } from "@/server/services/work-order.service";

export const POST = authedRoute(async ({ req, ctx, params }) => progressWorkOrder(ctx, params.workOrderId, await parseBody(req, workOrderTransitionSchema)));
