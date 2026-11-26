import { authedRoute, searchParamsObject } from "@/lib/api/handler";
import { rentRoll } from "@/server/services/report.service";

export const GET = authedRoute(async ({ req, ctx }) => rentRoll(ctx, searchParamsObject(req)));
