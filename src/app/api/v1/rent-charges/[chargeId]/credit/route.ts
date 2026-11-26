import { z } from "zod";
import { authedRoute, parseBody, ok } from "@/lib/api/handler";
import { creditCharge } from "@/server/services/payment.service";
import { minorAmount } from "@/lib/validation/common";

export const POST = authedRoute(async ({ req, ctx, params, requestId }) => {
  const b = await parseBody(req, z.object({ amountMinor: minorAmount, reason: z.string().trim().min(5).max(500) }));
  return ok(await creditCharge(ctx, { chargeId: params.chargeId, ...b }), requestId, { status: 201 });
});
