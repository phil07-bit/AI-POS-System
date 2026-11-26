import { authedRoute, parseBody } from "@/lib/api/handler";
import { closeRequest, closeRequestSchema } from "@/server/services/maintenance-request.service";

export const POST = authedRoute(async ({ req, ctx, params }) => closeRequest(ctx, params.requestId, await parseBody(req, closeRequestSchema)));
