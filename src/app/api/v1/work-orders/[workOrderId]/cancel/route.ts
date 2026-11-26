import { authedRoute, parseBody } from "@/lib/api/handler";
import { cancelWorkOrder, reasonSchema } from "@/server/services/work-order.service";

export const POST = authedRoute(async ({ req, ctx, params }) => cancelWorkOrder(ctx, params.workOrderId, await parseBody(req, reasonSchema)));
