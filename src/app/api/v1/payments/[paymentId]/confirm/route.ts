import { authedRoute, parseBody } from "@/lib/api/handler";
import { confirmPayment, confirmSchema } from "@/server/services/payment.service";

export const POST = authedRoute(async ({ req, ctx, params }) => confirmPayment(ctx, params.paymentId, await parseBody(req, confirmSchema)));
