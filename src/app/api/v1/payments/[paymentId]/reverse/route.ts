import { authedRoute, parseBody } from "@/lib/api/handler";
import { reversePayment, reverseSchema } from "@/server/services/payment.service";

export const POST = authedRoute(async ({ req, ctx, params }) => reversePayment(ctx, params.paymentId, await parseBody(req, reverseSchema)));
