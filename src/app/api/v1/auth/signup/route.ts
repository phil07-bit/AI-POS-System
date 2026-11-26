import { publicRoute, ok, parseBody } from "@/lib/api/handler";
import { AppError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
import { setSessionCookie } from "@/lib/auth/cookies";
import { signup, signupSchema } from "@/server/services/auth.service";

export const POST = publicRoute(async ({ req, requestId }) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`signup:${ip}`, 5, 60 * 60_000).ok) throw new AppError("RATE_LIMITED", "Too many sign-ups from this network. Try later.");
  const body = await parseBody(req, signupSchema);
  const r = await signup(body, req.headers.get("user-agent"));
  return setSessionCookie(ok({ organizationId: r.org.id }, requestId, { status: 201 }), r.session.token);
});
