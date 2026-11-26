import { z } from "zod";
import { publicRoute, parseBody } from "@/lib/api/handler";
import { resetPassword } from "@/server/services/auth.service";

export const POST = publicRoute(async ({ req }) => {
  const b = await parseBody(req, z.object({ token: z.string().min(10), password: z.string().max(200) }));
  await resetPassword(b.token, b.password);
  return { reset: true };
});
