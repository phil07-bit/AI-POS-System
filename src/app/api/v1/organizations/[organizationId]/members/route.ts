import { authedRoute } from "@/lib/api/handler";
import { notFound } from "@/lib/api/errors";
import { listMembers } from "@/server/services/organization.service";

export const GET = authedRoute(async ({ ctx, params }) => {
  if (params.organizationId !== ctx.organizationId) throw notFound("Organization");
  return listMembers(ctx);
});
