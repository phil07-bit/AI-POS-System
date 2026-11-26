import { z } from "zod";
import { publicRoute, parseBody } from "@/lib/api/handler";
import { AppError } from "@/lib/api/errors";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { findSession, setActiveOrganization } from "@/lib/auth/session";
import { loadContext } from "@/lib/auth/context";

export const POST = publicRoute(async ({ req, requestId }) => {
  const { organizationId } = await parseBody(req, z.object({ organizationId: z.string().uuid() }));
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await findSession(token);
  if (!session || !token) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  await loadContext(session.userId, organizationId, requestId); // verifies active membership
  await setActiveOrganization(token, organizationId);
  return { organizationId };
});
