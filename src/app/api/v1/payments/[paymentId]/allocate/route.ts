import { authedRoute, parseBody } from "@/lib/api/handler";
import { allocatePayment, allocateSchema } from "@/server/services/payment.service";

export const POST = authedRoute(async ({ req, ctx, params }) => allocatePayment(ctx, params.paymentId, await parseBody(req, allocateSchema)));
