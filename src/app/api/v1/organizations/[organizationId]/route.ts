import { authedRoute, parseBody } from "@/lib/api/handler";
import { getOrganization, orgUpdateSchema, updateOrganization } from "@/server/services/organization.service";

export const GET = authedRoute(async ({ ctx, params }) => getOrganization(ctx, params.organizationId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateOrganization(ctx, params.organizationId, await parseBody(req, orgUpdateSchema)));
