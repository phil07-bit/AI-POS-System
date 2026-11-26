import { authedRoute } from "@/lib/api/handler";
import { getReceipt } from "@/server/services/payment.service";
import { portalReceipt } from "@/server/services/portal.service";

export const GET = authedRoute(async ({ ctx, params }) => (ctx.tenantId ? portalReceipt(ctx, params.paymentId) : getReceipt(ctx, params.paymentId)));
