import { authedRoute } from "@/lib/api/handler";
import { markPendingSignature } from "@/server/services/lease.service";

export const POST = authedRoute(async ({ ctx, params }) => markPendingSignature(ctx, params.leaseId));
