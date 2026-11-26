import { authedRoute, ok, parseBody, searchParamsObject } from "@/lib/api/handler";
import { createVendor, listVendors, vendorInputSchema } from "@/server/services/vendor.service";

export const GET = authedRoute(async ({ req, ctx }) => listVendors(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createVendor(ctx, await parseBody(req, vendorInputSchema)), requestId, { status: 201 }));
