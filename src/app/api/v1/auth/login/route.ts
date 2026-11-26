import { publicRoute, ok, parseBody } from "@/lib/api/handler";
import { AppError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
import { setSessionCookie } from "@/lib/auth/cookies";
import { login, loginSchema } from "@/server/services/auth.service";

export const POST = publicRoute(async ({ req, requestId }) => {
  const body = await parseBody(req, loginSchema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  for (const k of [`login:ip:${ip}`, `login:email:${body.email}`]) {
    const r = rateLimit(k, 10, 15 * 60_000);
    if (!r.ok) throw new AppError("RATE_LIMITED", `Too many sign-in attempts. Try again in ${Math.ceil(r.retryAfterSec / 60)} minutes.`);
  }
  const result = await login(body, req.headers.get("user-agent"));
  const res = ok({ user: { id: result.user.id, fullName: result.user.fullName, email: result.user.email }, hasMembership: result.hasMembership, isTenant: result.isTenant, mustChangePassword: result.user.mustChangePassword }, requestId);
  return setSessionCookie(res, result.session.token);
});
