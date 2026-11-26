import { prisma } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import { SESSION_TTL_MS } from "./constants";

export async function createSession(userId: string, activeOrganizationId: string | null, userAgent?: string | null) {
  const token = randomToken();
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token), userId, activeOrganizationId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS), userAgent: userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
}

export async function findSession(token: string | undefined | null) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  // Sliding expiry, written at most every 5 minutes.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return session;
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function setActiveOrganization(token: string, organizationId: string) {
  await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { activeOrganizationId: organizationId } });
}
