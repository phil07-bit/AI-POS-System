import { authedRoute } from "@/lib/api/handler";
import { getCharge } from "@/server/services/rent.service";

export const GET = authedRoute(async ({ ctx, params }) => getCharge(ctx, params.chargeId));
