import { z } from "zod";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { archiveProperty } from "@/server/services/property.service";

export const POST = authedRoute(async ({ req, ctx, params }) => {
  const b = await parseBody(req, z.object({ reason: z.string().trim().max(500).optional() }));
  return archiveProperty(ctx, params.propertyId, b.reason);
});
