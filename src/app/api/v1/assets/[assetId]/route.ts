import { authedRoute, parseBody } from "@/lib/api/handler";
import { assetUpdateSchema, getAsset, updateAsset } from "@/server/services/asset.service";

export const GET = authedRoute(async ({ ctx, params }) => getAsset(ctx, params.assetId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateAsset(ctx, params.assetId, await parseBody(req, assetUpdateSchema)));
