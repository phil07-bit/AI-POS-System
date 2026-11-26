import { authedRoute, ok, parseBody, searchParamsObject } from "@/lib/api/handler";
import { createRequest, listRequests, requestCreateSchema } from "@/server/services/maintenance-request.service";

export const GET = authedRoute(async ({ req, ctx }) => listRequests(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createRequest(ctx, await parseBody(req, requestCreateSchema)), requestId, { status: 201 }));
