import { authedRoute, parseBody, ok, searchParamsObject } from "@/lib/api/handler";
import { createProperty, listProperties, propertyInputSchema } from "@/server/services/property.service";

export const GET = authedRoute(async ({ req, ctx }) => listProperties(ctx, searchParamsObject(req)));
export const POST = authedRoute(async ({ req, ctx, requestId }) => ok(await createProperty(ctx, await parseBody(req, propertyInputSchema)), requestId, { status: 201 }));
