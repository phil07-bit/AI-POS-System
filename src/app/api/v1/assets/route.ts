import { authedRoute, ok, parseBody, searchParamsObject } from "@/lib/api/handler";
import { assetInputSchema, createAsset, listAssets } from "@/server/services/asset.service";

export const GET = authedRoute(async ({ req, ctx }) => listAssets(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createAsset(ctx, await parseBody(req, assetInputSchema)), requestId, { status: 201 }));
