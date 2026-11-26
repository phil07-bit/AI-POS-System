import { authedRoute, parseBody } from "@/lib/api/handler";
import { getVendor, updateVendor, vendorUpdateSchema } from "@/server/services/vendor.service";

export const GET = authedRoute(async ({ ctx, params }) => getVendor(ctx, params.vendorId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateVendor(ctx, params.vendorId, await parseBody(req, vendorUpdateSchema)));
