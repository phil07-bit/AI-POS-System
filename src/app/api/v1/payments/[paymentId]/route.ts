import { authedRoute } from "@/lib/api/handler";
import { getPayment } from "@/server/services/payment.service";

export const GET = authedRoute(async ({ ctx, params }) => getPayment(ctx, params.paymentId));
