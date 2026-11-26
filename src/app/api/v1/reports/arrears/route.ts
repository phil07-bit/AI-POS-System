import { authedRoute, searchParamsObject } from "@/lib/api/handler";
import { arrearsReport } from "@/server/services/report.service";

export const GET = authedRoute(async ({ req, ctx }) => arrearsReport(ctx, searchParamsObject(req)));
