import { authedRoute, parseBody } from "@/lib/api/handler";
import { addRequestUpdate, updateNoteSchema } from "@/server/services/maintenance-request.service";

export const POST = authedRoute(async ({ req, ctx, params }) => addRequestUpdate(ctx, params.requestId, await parseBody(req, updateNoteSchema)));
