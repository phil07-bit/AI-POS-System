import { authedRoute, parseBody } from "@/lib/api/handler";
import { getLease, leaseUpdateSchema, updateLease } from "@/server/services/lease.service";

export const GET = authedRoute(async ({ ctx, params }) => getLease(ctx, params.leaseId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateLease(ctx, params.leaseId, await parseBody(req, leaseUpdateSchema)));
