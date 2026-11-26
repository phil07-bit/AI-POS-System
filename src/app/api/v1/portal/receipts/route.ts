import { authedRoute } from "@/lib/api/handler";
import { portalReceipts } from "@/server/services/portal.service";

export const GET = authedRoute(async ({ ctx }) => portalReceipts(ctx));
