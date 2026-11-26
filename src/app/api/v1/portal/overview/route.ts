import { authedRoute } from "@/lib/api/handler";
import { portalOverview } from "@/server/services/portal.service";

export const GET = authedRoute(async ({ ctx }) => portalOverview(ctx));
