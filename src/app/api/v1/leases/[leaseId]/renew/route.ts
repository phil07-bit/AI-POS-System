import { authedRoute, parseBody, ok } from "@/lib/api/handler";
import { renewLease, renewSchema } from "@/server/services/lease.service";

export const POST = authedRoute(async ({ req, ctx, params, requestId }) => ok(await renewLease(ctx, params.leaseId, await parseBody(req, renewSchema)), requestId, { status: 201 }));
