import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api/errors";
import { SESSION_COOKIE } from "./constants";
import { findSession } from "./session";
import { loadContext, type RequestContext } from "./context";

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function getCurrentSession() {
  return findSession(await getSessionToken());
}

export async function getRequestId(): Promise<string> {
  return (await headers()).get("x-request-id") ?? randomUUID();
}

/**
 * Resolve the context for the active organization from the session cookie.
 * Falls back to the user's first active membership if the session has none.
 */
export async function resolveContextFromSession(requestId: string): Promise<RequestContext | null> {
  const session = await getCurrentSession();
  if (!session || session.user.status !== "active") return null;
  let orgId = session.activeOrganizationId;
  if (!orgId) {
    const first = await prisma.organizationMembership.findFirst({
      where: { userId: session.userId, status: "active" }, orderBy: { createdAt: "asc" },
    });
    if (!first) return null;
    orgId = first.organizationId;
    await prisma.session.update({ where: { id: session.id }, data: { activeOrganizationId: orgId } });
  }
  try {
    return await loadContext(session.userId, orgId, requestId);
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
}

/** For server components/pages: redirect to sign-in when unauthenticated. */
export async function getPageContext(): Promise<RequestContext> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const ctx = await resolveContextFromSession(await getRequestId());
  if (!ctx) redirect("/onboarding");
  return ctx;
}

/** Staff page guard; tenant-portal users are sent to the portal. */
export async function getStaffPageContext(): Promise<RequestContext> {
  const ctx = await getPageContext();
  if (ctx.tenantId) redirect("/portal");
  return ctx;
}
