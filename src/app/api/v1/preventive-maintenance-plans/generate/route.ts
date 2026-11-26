import { authedRoute } from "@/lib/api/handler";
import { generateDueNow } from "@/server/services/preventive-maintenance.service";

export const POST = authedRoute(async ({ ctx }) => generateDueNow(ctx));
