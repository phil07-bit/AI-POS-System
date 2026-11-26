import { authedRoute, parseBody } from "@/lib/api/handler";
import { closeWorkOrder, workOrderCloseSchema } from "@/server/services/work-order.service";

export const POST = authedRoute(async ({ req, ctx, params }) => closeWorkOrder(ctx, params.workOrderId, await parseBody(req, workOrderCloseSchema)));
