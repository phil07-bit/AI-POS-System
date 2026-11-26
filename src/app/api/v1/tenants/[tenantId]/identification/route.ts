import { authedRoute } from "@/lib/api/handler";
import { revealIdentification } from "@/server/services/tenant.service";

// POST (not GET) so the reveal is a deliberate, CSRF-protected, audited action.
export const POST = authedRoute(async ({ ctx, params }) => revealIdentification(ctx, params.tenantId));
