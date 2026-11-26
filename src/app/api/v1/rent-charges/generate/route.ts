import { authedRoute, parseBody } from "@/lib/api/handler";
import { generateCharges, generateSchema } from "@/server/services/rent.service";

export const POST = authedRoute(async ({ req, ctx }) => generateCharges(ctx, await parseBody(req, generateSchema)));
