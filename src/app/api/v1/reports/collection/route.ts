import { authedRoute, searchParamsObject } from "@/lib/api/handler";
import { collectionSummary } from "@/server/services/report.service";

export const GET = authedRoute(async ({ req, ctx }) => collectionSummary(ctx, searchParamsObject(req)));
