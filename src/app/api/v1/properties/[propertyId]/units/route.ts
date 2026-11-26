import { authedRoute, parseBody, ok, searchParamsObject } from "@/lib/api/handler";
import { createUnit, listUnits, unitInputSchema } from "@/server/services/unit.service";

export const GET = authedRoute(async ({ req, ctx, params }) => listUnits(ctx, { ...searchParamsObject(req), propertyId: params.propertyId }));
export const POST = authedRoute(async ({ req, ctx, params, requestId }) => ok(await createUnit(ctx, params.propertyId, await parseBody(req, unitInputSchema)), requestId, { status: 201 }));
