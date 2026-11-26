import { authedRoute } from "@/lib/api/handler";
import { revokeInvitation } from "@/server/services/organization.service";

export const DELETE = authedRoute(async ({ ctx, params }) => { await revokeInvitation(ctx, params.invitationId); return { revoked: true }; });
