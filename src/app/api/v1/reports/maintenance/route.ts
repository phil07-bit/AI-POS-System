import { authedRoute, searchParamsObject } from "@/lib/api/handler";
import { maintenanceReport } from "@/server/services/maintenance-report.service";

export const GET = authedRoute(async ({ req, ctx }) => maintenanceReport(ctx, searchParamsObject(req)));
