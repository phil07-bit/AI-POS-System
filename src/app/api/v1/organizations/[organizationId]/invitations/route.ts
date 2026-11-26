import { authedRoute, parseBody, ok } from "@/lib/api/handler";
import { AppError, notFound } from "@/lib/api/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
import { inviteMember, inviteSchema } from "@/server/services/organization.service";

export const POST = authedRoute(async ({ req, ctx, params, requestId }) => {
  if (params.organizationId !== ctx.organizationId) throw notFound("Organization");
  if (!rateLimit(`invite:${ctx.userId}`, 30, 60 * 60_000).ok) throw new AppError("RATE_LIMITED", "Invitation limit reached. Try again later.");
  return ok(await inviteMember(ctx, await parseBody(req, inviteSchema)), requestId, { status: 201 });
});
