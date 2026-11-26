import { authedRoute, parseBody } from "@/lib/api/handler";
import { getWorkOrder, updateWorkOrder, workOrderUpdateSchema } from "@/server/services/work-order.service";

export const GET = authedRoute(async ({ ctx, params }) => getWorkOrder(ctx, params.workOrderId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateWorkOrder(ctx, params.workOrderId, await parseBody(req, workOrderUpdateSchema)));
