import { authedRoute } from "@/lib/api/handler";
import { activateLease } from "@/server/services/lease.service";

export const POST = authedRoute(async ({ ctx, params }) => activateLease(ctx, params.leaseId));
