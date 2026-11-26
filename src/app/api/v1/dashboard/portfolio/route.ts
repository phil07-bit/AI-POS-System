import { authedRoute, searchParamsObject } from "@/lib/api/handler";
import { portfolioOverview, collectionSummary, arrearsReport } from "@/server/services/report.service";

export const GET = authedRoute(async ({ req, ctx }) => {
  const q = searchParamsObject(req);
  const overview = await portfolioOverview(ctx, { propertyId: q.propertyId });
  const finance = ctx.permissions.has("report.financial.read")
    ? { collection: await collectionSummary(ctx, q), arrears: (await arrearsReport(ctx, { propertyId: q.propertyId })).totals }
    : null;
  return { ...overview, finance };
});
