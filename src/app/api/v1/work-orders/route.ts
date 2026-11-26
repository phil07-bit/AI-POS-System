import { authedRoute, ok, parseBody, searchParamsObject } from "@/lib/api/handler";
import { createWorkOrder, listWorkOrders, workOrderCreateSchema } from "@/server/services/work-order.service";

export const GET = authedRoute(async ({ req, ctx }) => listWorkOrders(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createWorkOrder(ctx, await parseBody(req, workOrderCreateSchema)), requestId, { status: 201 }));
