import { z } from "zod";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { voidCharge } from "@/server/services/rent.service";

export const POST = authedRoute(async ({ req, ctx, params }) => voidCharge(ctx, params.chargeId, (await parseBody(req, z.object({ reason: z.string().trim().min(3).max(500) }))).reason));
