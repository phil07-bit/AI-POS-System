import { authedRoute, parseBody, ok } from "@/lib/api/handler";
import { refundCredit, refundSchema } from "@/server/services/payment.service";

export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await refundCredit(ctx, await parseBody(req, refundSchema)), requestId, { status: 201 }));
