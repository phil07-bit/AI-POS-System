import { authedRoute } from "@/lib/api/handler";
import { listTenantLeases } from "@/server/services/tenant.service";

export const GET = authedRoute(async ({ ctx, params }) => listTenantLeases(ctx, params.tenantId));
