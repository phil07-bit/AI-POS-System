import { authedRoute, parseBody, ok, searchParamsObject } from "@/lib/api/handler";
import { createLease, leaseInputSchema, listLeases } from "@/server/services/lease.service";

export const GET = authedRoute(async ({ req, ctx }) => listLeases(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createLease(ctx, await parseBody(req, leaseInputSchema)), requestId, { status: 201 }));
