import { authedRoute, parseBody } from "@/lib/api/handler";
import { getProperty, propertyUpdateSchema, updateProperty } from "@/server/services/property.service";

export const GET = authedRoute(async ({ ctx, params }) => getProperty(ctx, params.propertyId));
export const PATCH = authedRoute(async ({ req, ctx, params }) => updateProperty(ctx, params.propertyId, await parseBody(req, propertyUpdateSchema)));
