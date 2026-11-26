import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api/errors";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { hashToken, randomToken } from "@/lib/crypto";
import { recordAudit } from "./audit";
import { sendEmail } from "@/server/integrations/email";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required.").max(200),
});

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().max(200),
  organizationName: z.string().trim().min(2, "Enter your organization name.").max(120),
});

// A real hash of a random value, used to equalize timing when the email doesn't exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

export async function login(rawInput: z.input<typeof loginSchema>, userAgent?: string | null) {
  const input = loginSchema.parse(rawInput);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const valid = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid || user.status !== "active") {
    throw new AppError("UNAUTHENTICATED", "Incorrect email or password.");
  }
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, status: "active", organization: { status: "active" } }, orderBy: { createdAt: "asc" },
  });
  const session = await createSession(user.id, membership?.organizationId ?? null, userAgent);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  if (membership) {
    await recordAudit(prisma, { organizationId: membership.organizationId, userId: user.id, userName: user.fullName, requestId: "login" }, {
      action: "auth.login", entityType: "user", entityId: user.id, summary: "Signed in",
    });
  }
  return { session, user, hasMembership: !!membership, isTenant: !!membership?.tenantId };
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 48) || "org";
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.organization.findUnique({ where: { slug } }))) return slug;
  }
  return `${base}-${randomToken(4).toLowerCase()}`;
}

/** Self-service onboarding: creates the user, the organization and an owner membership atomically. */
export async function signup(rawInput: z.input<typeof signupSchema>, userAgent?: string | null) {
  const input = signupSchema.parse(rawInput);
  const pwErr = passwordPolicyError(input.password);
  if (pwErr) throw new AppError("VALIDATION_ERROR", pwErr, [{ path: "password", message: pwErr }]);
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw new AppError("CONFLICT", "An account with this email already exists. Sign in instead.", [{ path: "email", message: "Already registered." }]);
  }
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "org_owner" } });
  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(input.organizationName);
  const { user, org } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { fullName: input.fullName, email: input.email, passwordHash } });
    const org = await tx.organization.create({
      data: { name: input.organizationName, slug, email: input.email, addressJson: { country: "GH" } },
    });
    const m = await tx.organizationMembership.create({ data: { organizationId: org.id, userId: user.id, roleId: ownerRole.id } });
    await recordAudit(tx, { organizationId: org.id, userId: user.id, userName: user.fullName, requestId: "signup" }, {
      action: "organization.created", entityType: "organization", entityId: org.id, summary: `Created organization ${org.name}`,
      after: { name: org.name, slug: org.slug, membershipId: m.id, role: "org_owner" },
    });
    return { user, org };
  });
  const session = await createSession(user.id, org.id, userAgent);
  return { session, user, org };
}

export async function requestPasswordReset(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Always succeed outwardly to avoid account enumeration.
  if (!user || user.status !== "active") return;
  const token = randomToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60_000) },
  });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  await sendEmail({
    to: user.email, userId: user.id, eventType: "auth.password_reset", subject: "Reset your AI-POS password",
    body: `Use this link within 60 minutes to reset your password: ${url}`,
    idempotencyKey: `pwreset:${hashToken(token)}`,
  });
}

export async function resetPassword(token: string, newPassword: string) {
  const pwErr = passwordPolicyError(newPassword);
  if (pwErr) throw new AppError("VALIDATION_ERROR", pwErr, [{ path: "password", message: pwErr }]);
  const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new AppError("BUSINESS_RULE", "This reset link is invalid or has expired.");
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: rec.userId }, data: { passwordHash, mustChangePassword: false } }),
    prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: rec.userId } }), // revoke all sessions
  ]);
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw new AppError("VALIDATION_ERROR", "Current password is incorrect.", [{ path: "currentPassword", message: "Incorrect password." }]);
  }
  const pwErr = passwordPolicyError(next);
  if (pwErr) throw new AppError("VALIDATION_ERROR", pwErr, [{ path: "newPassword", message: pwErr }]);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
}
