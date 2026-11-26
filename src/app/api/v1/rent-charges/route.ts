import { authedRoute, parseBody, ok, searchParamsObject } from "@/lib/api/handler";
import { createManualCharge, listCharges, manualChargeSchema } from "@/server/services/rent.service";

export const GET = authedRoute(async ({ req, ctx }) => listCharges(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createManualCharge(ctx, await parseBody(req, manualChargeSchema)), requestId, { status: 201 }));
