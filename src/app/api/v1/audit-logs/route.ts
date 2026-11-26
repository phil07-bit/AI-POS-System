import { authedRoute, searchParamsObject } from "@/lib/api/handler";
import { listAuditLogs } from "@/server/services/audit-query.service";

export const GET = authedRoute(async ({ req, ctx }) => listAuditLogs(ctx, searchParamsObject(req)));
