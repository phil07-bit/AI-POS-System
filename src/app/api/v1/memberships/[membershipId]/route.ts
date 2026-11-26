import { authedRoute, parseBody } from "@/lib/api/handler";
import { membershipUpdateSchema, updateMembership } from "@/server/services/organization.service";

export const PATCH = authedRoute(async ({ req, ctx, params }) => updateMembership(ctx, params.membershipId, await parseBody(req, membershipUpdateSchema)));
