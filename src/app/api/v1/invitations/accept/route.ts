import { publicRoute, ok, parseBody } from "@/lib/api/handler";
import { setSessionCookie } from "@/lib/auth/cookies";
import { createSession } from "@/lib/auth/session";
import { acceptInvitation, acceptInviteSchema } from "@/server/services/organization.service";

export const POST = publicRoute(async ({ req, requestId }) => {
  const r = await acceptInvitation(await parseBody(req, acceptInviteSchema));
  const s = await createSession(r.user.id, r.organizationId, req.headers.get("user-agent"));
  return setSessionCookie(ok({ organizationId: r.organizationId }, requestId), s.token);
});
