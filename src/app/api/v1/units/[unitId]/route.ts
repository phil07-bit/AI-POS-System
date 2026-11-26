import { authedRoute, parseBody } from "@/lib/api/handler";
import { getUnit, unitUpdateSchema, updateUnit } from "@/server/services/unit.service";

export const GET = authedRoute(async ({ ctx, params }) => getUnit(ctx, params.unitId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateUnit(ctx, params.unitId, await parseBody(req, unitUpdateSchema)));
