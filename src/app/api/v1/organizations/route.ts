import { z } from "zod";
import { authedRoute, parseBody, ok } from "@/lib/api/handler";
import { createOrganizationForUser, listMyOrganizations } from "@/server/services/organization.service";

export const GET = authedRoute(async ({ ctx }) => listMyOrganizations(ctx.userId));
export const POST = authedRoute(async ({ req, ctx, requestId }) => {
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(2).max(120) }));
  return ok(await createOrganizationForUser(ctx.userId, ctx.userName, name), requestId, { status: 201 });
});
