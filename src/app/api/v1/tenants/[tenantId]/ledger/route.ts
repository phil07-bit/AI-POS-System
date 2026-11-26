import { authedRoute } from "@/lib/api/handler";
import { getTenantLedger } from "@/server/services/ledger.service";

export const GET = authedRoute(async ({ ctx, params }) => getTenantLedger(ctx, params.tenantId));
