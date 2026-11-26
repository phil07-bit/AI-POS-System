import { authedRoute, parseBody } from "@/lib/api/handler";
import { completeWorkOrder, workOrderCompleteSchema } from "@/server/services/work-order.service";

export const POST = authedRoute(async ({ req, ctx, params }) => completeWorkOrder(ctx, params.workOrderId, await parseBody(req, workOrderCompleteSchema)));
