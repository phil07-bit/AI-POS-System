import { authedRoute } from "@/lib/api/handler";
import { getAssetServiceHistory } from "@/server/services/asset.service";

export const GET = authedRoute(async ({ ctx, params }) => getAssetServiceHistory(ctx, params.assetId));
