import { z } from "zod";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { changePassword } from "@/server/services/auth.service";

export const POST = authedRoute(async ({ req, ctx }) => {
  const b = await parseBody(req, z.object({ currentPassword: z.string(), newPassword: z.string().max(200) }));
  await changePassword(ctx.userId, b.currentPassword, b.newPassword);
  return { changed: true };
});
