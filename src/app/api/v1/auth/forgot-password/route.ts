import { z } from "zod";
import { publicRoute, parseBody } from "@/lib/api/handler";
import { AppError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requestPasswordReset } from "@/server/services/auth.service";

export const POST = publicRoute(async ({ req }) => {
  const { email } = await parseBody(req, z.object({ email: z.string().email() }));
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`reset:${ip}`, 5, 15 * 60_000).ok || !rateLimit(`reset:${email}`, 3, 15 * 60_000).ok) throw new AppError("RATE_LIMITED", "Too many reset requests. Try again later.");
  await requestPasswordReset(email);
  return { message: "If an account exists for that email, a reset link has been sent." };
});
