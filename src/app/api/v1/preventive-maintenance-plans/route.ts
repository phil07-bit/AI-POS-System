import { authedRoute, ok, parseBody, searchParamsObject } from "@/lib/api/handler";
import { createPlan, listPlans, planInputSchema } from "@/server/services/preventive-maintenance.service";

export const GET = authedRoute(async ({ req, ctx }) => listPlans(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createPlan(ctx, await parseBody(req, planInputSchema)), requestId, { status: 201 }));
