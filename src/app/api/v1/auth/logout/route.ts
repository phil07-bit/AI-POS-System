import { publicRoute, ok } from "@/lib/api/handler";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { destroySession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/constants";

export const POST = publicRoute(async ({ req, requestId }) => {
  await destroySession(req.cookies.get(SESSION_COOKIE)?.value);
  return clearSessionCookie(ok({ signedOut: true }, requestId));
});
