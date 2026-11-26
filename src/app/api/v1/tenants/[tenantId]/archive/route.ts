import { authedRoute } from "@/lib/api/handler";
import { archiveTenant } from "@/server/services/tenant.service";

export const POST = authedRoute(async ({ ctx, params }) => archiveTenant(ctx, params.tenantId));
