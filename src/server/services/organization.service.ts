import { z } from "zod";
import { prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requireStaff } from "@/lib/auth/context";
import { AppError, forbidden, notFound } from "@/lib/api/errors";
import { addressSchema, optionalEmail, optionalPhone } from "@/lib/validation/common";
import { hashToken, randomToken } from "@/lib/crypto";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import { recordAudit } from "./audit";
import { sendEmail } from "@/server/integrations/email";

export const orgUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(200).optional().nullable(),
  email: optionalEmail,
  phone: optionalPhone,
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  defaultCurrency: z.string().trim().length(3).toUpperCase().optional(),
  timezone: z.string().trim().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown timezone.").optional(),
  address: addressSchema.optional(),
  paymentsRequireConfirmation: z.boolean().optional(),
  chargeGenerationHorizonDays: z.number().int().min(0).max(366).optional(),
  leaseExpiryWarningDays: z.number().int().min(7).max(365).optional(),
});

/** Organizations the current user belongs to (for the org switcher). */
export async function listMyOrganizations(userId: string) {
  const ms = await prisma.organizationMembership.findMany({
    where: { userId, status: "active", organization: { status: "active" } },
    include: { organization: { select: { id: true, name: true, slug: true, isDemo: true } }, role: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ms.map((m) => ({ ...m.organization, roleName: m.role.name, membershipId: m.id }));
}

export async function getOrganization(ctx: RequestContext, organizationId: string) {
  // The id in the URL must be the context's org; otherwise behave as not found.
  if (organizationId !== ctx.organizationId) throw notFound("Organization");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return org;
}

export async function updateOrganization(ctx: RequestContext, organizationId: string, rawInput: z.input<typeof orgUpdateSchema>) {
  const input = orgUpdateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "organization.settings.manage");
  if (organizationId !== ctx.organizationId) throw notFound("Organization");
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const { address, ...rest } = input;
  const after = await prisma.organization.update({
    where: { id: organizationId },
    data: { ...rest, ...(address ? { addressJson: address } : {}) },
  });
  await recordAudit(prisma, ctx, { action: "organization.updated", entityType: "organization", entityId: organizationId, before, after });
  return after;
}

/** Additional organization created by an existing user (they become its owner). */
export async function createOrganizationForUser(userId: string, userName: string, name: string) {
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "org_owner" } });
  const { slugify } = await import("./auth.service");
  let slug = slugify(name);
  if (await prisma.organization.findUnique({ where: { slug } })) slug = `${slug}-${randomToken(3).toLowerCase()}`;
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name, slug, addressJson: { country: "GH" } } });
    await tx.organizationMembership.create({ data: { organizationId: org.id, userId, roleId: ownerRole.id } });
    await recordAudit(tx, { organizationId: org.id, userId, userName, requestId: "org-create" }, {
      action: "organization.created", entityType: "organization", entityId: org.id, summary: `Created organization ${name}`,
    });
    return org;
  });
}

// ───────────── Members & invitations ─────────────

export async function listRoles() {
  return prisma.role.findMany({ where: { isSystem: true }, orderBy: { rank: "desc" }, select: { id: true, key: true, name: true, description: true, rank: true } });
}

export async function listMembers(ctx: RequestContext) {
  requireStaff(ctx);
  if (!ctx.permissions.has("user.manage") && !ctx.permissions.has("user.invite")) throw forbidden();
  const [members, invitations] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { organizationId: ctx.organizationId },
      include: {
        user: { select: { id: true, fullName: true, email: true, lastLoginAt: true } },
        role: { select: { key: true, name: true } },
        propertyScopes: { include: { property: { select: { id: true, name: true } } } },
        tenant: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { organizationId: ctx.organizationId, status: "pending" },
      include: { role: { select: { key: true, name: true } } }, orderBy: { createdAt: "desc" },
    }),
  ]);
  return { members, invitations: invitations.map(({ tokenHash: _t, ...i }) => i) };
}

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  roleKey: z.string(),
  scopeAllProperties: z.boolean().default(true),
  propertyIds: z.array(z.string().uuid()).default([]),
  tenantId: z.string().uuid().optional().nullable(),
});

async function assertGrantableRole(ctx: RequestContext, roleKey: string) {
  const role = await prisma.role.findUnique({ where: { key: roleKey } });
  if (!role) throw new AppError("VALIDATION_ERROR", "Unknown role.", [{ path: "roleKey", message: "Unknown role." }]);
  if (role.rank > ctx.roleRank) throw forbidden("You cannot grant a role more privileged than your own.");
  if (role.key === "org_owner" && ctx.roleKey !== "org_owner") throw forbidden("Only an owner can grant the owner role.");
  return role;
}

async function assertPropertiesInOrg(ctx: RequestContext, propertyIds: string[]) {
  if (!propertyIds.length) return;
  const count = await prisma.property.count({ where: { id: { in: propertyIds }, organizationId: ctx.organizationId } });
  if (count !== new Set(propertyIds).size) throw new AppError("VALIDATION_ERROR", "One or more properties are invalid.", [{ path: "propertyIds", message: "Invalid property." }]);
}

export async function inviteMember(ctx: RequestContext, rawInput: z.input<typeof inviteSchema>) {
  const input = inviteSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "user.invite");
  const role = await assertGrantableRole(ctx, input.roleKey);
  await assertPropertiesInOrg(ctx, input.propertyIds);
  if (role.key === "tenant_portal") {
    if (!input.tenantId) throw new AppError("VALIDATION_ERROR", "Select the tenant this portal login belongs to.", [{ path: "tenantId", message: "Required for tenant portal users." }]);
    const t = await prisma.tenant.findFirst({ where: { id: input.tenantId, organizationId: ctx.organizationId } });
    if (!t) throw notFound("Tenant");
  }
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const m = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: existingUser.id } } });
    if (m) throw new AppError("CONFLICT", "This person is already a member of the organization.");
  }
  const token = randomToken();
  const inv = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({ where: { organizationId: ctx.organizationId, email: input.email, status: "pending" }, data: { status: "revoked" } });
    const inv = await tx.invitation.create({
      data: {
        organizationId: ctx.organizationId, email: input.email, roleId: role.id,
        scopeAllProperties: role.key === "tenant_portal" ? false : input.scopeAllProperties,
        propertyIds: input.scopeAllProperties ? [] : input.propertyIds,
        tenantId: role.key === "tenant_portal" ? input.tenantId : null,
        tokenHash: hashToken(token), invitedById: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    await recordAudit(tx, ctx, {
      action: "membership.invited", entityType: "invitation", entityId: inv.id,
      summary: `Invited ${input.email} as ${role.name}`,
      after: { email: input.email, role: role.key, scopeAllProperties: inv.scopeAllProperties, propertyIds: inv.propertyIds },
    });
    return inv;
  });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/invite/${token}`;
  await sendEmail({
    to: input.email, organizationId: ctx.organizationId, eventType: "invitation.sent",
    subject: `You've been invited to ${ctx.organizationName} on AI-POS`,
    body: `${ctx.userName} invited you to join ${ctx.organizationName} as ${role.name}. Accept within 7 days: ${url}`,
    idempotencyKey: `invite:${inv.id}`,
  });
  const { tokenHash: _t, ...safe } = inv;
  // The raw link is returned only in demo/mock mode so the flow can be exercised without a mail server.
  return { invitation: safe, devAcceptUrl: process.env.EMAIL_PROVIDER === "mock" || !process.env.EMAIL_PROVIDER ? url : undefined };
}

export async function revokeInvitation(ctx: RequestContext, invitationId: string) {
  requirePermission(ctx, "user.invite");
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, organizationId: ctx.organizationId, status: "pending" } });
  if (!inv) throw notFound("Invitation");
  await prisma.invitation.update({ where: { id: inv.id }, data: { status: "revoked" } });
  await recordAudit(prisma, ctx, { action: "membership.invitation_revoked", entityType: "invitation", entityId: inv.id, summary: `Revoked invitation for ${inv.email}` });
}

export async function getInvitationByToken(token: string) {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } }, role: { select: { name: true } } },
  });
  if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) return null;
  const userExists = !!(await prisma.user.findUnique({ where: { email: inv.email } }));
  return { email: inv.email, organizationName: inv.organization.name, roleName: inv.role.name, userExists };
}

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  fullName: z.string().trim().max(120).optional(),
  password: z.string().max(200),
});

export async function acceptInvitation(rawInput: z.input<typeof acceptInviteSchema>) {
  const input = acceptInviteSchema.parse(rawInput);
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(input.token) }, include: { role: true } });
  if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) throw new AppError("BUSINESS_RULE", "This invitation is invalid or has expired.");
  let user = await prisma.user.findUnique({ where: { email: inv.email } });
  if (user) {
    if (!(await verifyPassword(input.password, user.passwordHash))) throw new AppError("UNAUTHENTICATED", "Incorrect password for this account.");
  } else {
    const pwErr = passwordPolicyError(input.password);
    if (pwErr) throw new AppError("VALIDATION_ERROR", pwErr, [{ path: "password", message: pwErr }]);
    if (!input.fullName || input.fullName.length < 2) throw new AppError("VALIDATION_ERROR", "Enter your full name.", [{ path: "fullName", message: "Required." }]);
    user = await prisma.user.create({ data: { email: inv.email, fullName: input.fullName, passwordHash: await hashPassword(input.password) } });
  }
  const u = user;
  await prisma.$transaction(async (tx) => {
    const m = await tx.organizationMembership.create({
      data: {
        organizationId: inv.organizationId, userId: u.id, roleId: inv.roleId, invitedById: inv.invitedById,
        scopeAllProperties: inv.scopeAllProperties, tenantId: inv.tenantId,
        propertyScopes: { create: inv.propertyIds.map((propertyId) => ({ propertyId })) },
      },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { status: "accepted", acceptedAt: new Date() } });
    await recordAudit(tx, { organizationId: inv.organizationId, userId: u.id, userName: u.fullName, requestId: "invite-accept" }, {
      action: "membership.joined", entityType: "membership", entityId: m.id, summary: `${u.fullName} joined as ${inv.role.name}`,
    });
  });
  return { user: u, organizationId: inv.organizationId };
}

export const membershipUpdateSchema = z.object({
  roleKey: z.string().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  scopeAllProperties: z.boolean().optional(),
  propertyIds: z.array(z.string().uuid()).optional(),
});

export async function updateMembership(ctx: RequestContext, membershipId: string, rawInput: z.input<typeof membershipUpdateSchema>) {
  const input = membershipUpdateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "user.manage");
  const m = await prisma.organizationMembership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId }, include: { role: true, propertyScopes: true },
  });
  if (!m) throw notFound("Member");
  if (m.userId === ctx.userId) throw new AppError("BUSINESS_RULE", "You cannot change your own role, scope or status.");
  if (m.role.rank > ctx.roleRank) throw forbidden("You cannot modify a member more privileged than yourself.");
  const data: Record<string, unknown> = {};
  if (input.roleKey && input.roleKey !== m.role.key) {
    const role = await assertGrantableRole(ctx, input.roleKey);
    if (m.role.key === "org_owner") {
      const owners = await prisma.organizationMembership.count({ where: { organizationId: ctx.organizationId, status: "active", role: { key: "org_owner" } } });
      if (owners <= 1) throw new AppError("BUSINESS_RULE", "An organization must keep at least one active owner.");
    }
    data.roleId = role.id;
  }
  if (input.status) {
    if (input.status === "suspended" && m.role.key === "org_owner") {
      const owners = await prisma.organizationMembership.count({ where: { organizationId: ctx.organizationId, status: "active", role: { key: "org_owner" } } });
      if (owners <= 1) throw new AppError("BUSINESS_RULE", "You cannot suspend the last active owner.");
    }
    data.status = input.status;
  }
  if (input.scopeAllProperties !== undefined) data.scopeAllProperties = input.scopeAllProperties;
  if (input.propertyIds) await assertPropertiesInOrg(ctx, input.propertyIds);

  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.organizationMembership.update({ where: { id: m.id }, data });
    if (input.propertyIds) {
      await tx.membershipPropertyScope.deleteMany({ where: { membershipId: m.id } });
      await tx.membershipPropertyScope.createMany({ data: input.propertyIds.map((propertyId) => ({ membershipId: m.id, propertyId })) });
    }
    if (input.status === "suspended") await tx.session.updateMany({ where: { userId: m.userId, activeOrganizationId: ctx.organizationId }, data: { activeOrganizationId: null } });
    await recordAudit(tx, ctx, {
      action: input.status === "suspended" ? "membership.suspended" : input.status === "active" && m.status !== "active" ? "membership.reactivated" : "membership.updated",
      entityType: "membership", entityId: m.id,
      before: { role: m.role.key, status: m.status, scopeAllProperties: m.scopeAllProperties, propertyIds: m.propertyScopes.map((s) => s.propertyId) },
      after: { ...input },
    });
    return updated;
  });
  return after;
}
