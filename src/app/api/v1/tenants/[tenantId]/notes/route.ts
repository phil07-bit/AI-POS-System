import { authedRoute, parseBody, ok } from "@/lib/api/handler";
import { addTenantNote, listTenantNotes, noteSchema } from "@/server/services/tenant.service";

export const GET = authedRoute(async ({ ctx, params }) => listTenantNotes(ctx, params.tenantId));
export const POST = authedRoute(async ({ req, ctx, params, requestId }) => ok(await addTenantNote(ctx, params.tenantId, await parseBody(req, noteSchema)), requestId, { status: 201 }));
