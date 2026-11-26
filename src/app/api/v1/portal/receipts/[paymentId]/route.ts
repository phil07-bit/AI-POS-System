import { authedRoute } from "@/lib/api/handler";
import { portalReceipt } from "@/server/services/portal.service";

export const GET = authedRoute(async ({ ctx, params }) => portalReceipt(ctx, params.paymentId));
