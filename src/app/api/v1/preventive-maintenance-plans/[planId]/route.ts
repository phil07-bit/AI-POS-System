import { authedRoute, parseBody } from "@/lib/api/handler";
import { planUpdateSchema, updatePlan } from "@/server/services/preventive-maintenance.service";

export const PATCH = authedRoute(async ({ req, ctx, params }) => updatePlan(ctx, params.planId, await parseBody(req, planUpdateSchema)));
