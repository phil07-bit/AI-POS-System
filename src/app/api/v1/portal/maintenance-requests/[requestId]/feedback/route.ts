import { authedRoute, parseBody } from "@/lib/api/handler";
import { portalFeedbackSchema, portalRequestFeedback } from "@/server/services/portal.service";

export const POST = authedRoute(async ({ req, ctx, params }) => portalRequestFeedback(ctx, params.requestId, await parseBody(req, portalFeedbackSchema)));
