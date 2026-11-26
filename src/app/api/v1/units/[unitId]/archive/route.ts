import { authedRoute } from "@/lib/api/handler";
import { archiveUnit } from "@/server/services/unit.service";

export const POST = authedRoute(async ({ ctx, params }) => archiveUnit(ctx, params.unitId));
