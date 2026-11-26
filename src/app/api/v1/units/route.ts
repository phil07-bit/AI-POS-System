import { authedRoute, searchParamsObject } from "@/lib/api/handler";
import { listUnits } from "@/server/services/unit.service";

export const GET = authedRoute(async ({ req, ctx }) => listUnits(ctx, searchParamsObject(req)));
