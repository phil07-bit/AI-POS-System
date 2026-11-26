import { authedRoute, parseBody } from "@/lib/api/handler";
import { terminateLease, terminateSchema } from "@/server/services/lease.service";

export const POST = authedRoute(async ({ req, ctx, params }) => terminateLease(ctx, params.leaseId, await parseBody(req, terminateSchema)));
