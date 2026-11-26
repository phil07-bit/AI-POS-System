import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requireStaff } from "@/lib/auth/context";
import { businessRule, notFound } from "@/lib/api/errors";
import { addressSchema, optionalEmail, optionalPhone, optionalText, paged, paginationSchema, sortFrom } from "@/lib/validation/common";
import { decryptField, encryptField } from "@/lib/crypto";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";

export const ID_TYPES = ["ghana_card", "passport", "drivers_licence", "voter_id", "ssnit", "other"] as const;
export const PRIVACY_NOTICE_VERSION = "2026-01";

const emergencyContactSchema = z.object({
  name: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(30).default(""),
  relationship: z.string().trim().max(60).default(""),
});

export const tenantInputSchema = z.object({
  tenantType: z.enum(["individual", "organization"]),
  displayName: z.string().trim().min(2, "Enter the tenant's full name or organization name.").max(160),
  email: optionalEmail,
  phone: optionalPhone,
  alternatePhone: optionalPhone,
  address: addressSchema.optional().nullable(),
  emergencyContact: emergencyContactSchema.optional().nullable(),
  identificationType: z.enum(ID_TYPES).optional().nullable(),
  identificationReference: z.string().trim().max(40).optional().nullable(),
  employmentInfo: optionalText(500),
  status: z.enum(["prospective", "active", "former"]).default("prospective"),
  privacyNoticeAccepted: z.boolean().optional(),
});
export const tenantUpdateSchema = tenantInputSchema.partial();

export const tenantListSchema = paginationSchema.extend({
  status: z.enum(["prospective", "active", "former"]).optional(),
  includeArchived: z.coerce.boolean().optional(),
});

export const noteSchema = z.object({
  kind: z.enum(["note", "call", "visit", "email", "sms", "other"]).default("note"),
  body: z.string().trim().min(1, "Write a note.").max(4000),
});

/** Tenants visible to a property-scoped user: linked by lease to a scoped property, or created by them. */
function tenantScopeWhere(ctx: RequestContext): Prisma.TenantWhereInput {
  if (ctx.scopeAllProperties) return {};
  return { OR: [{ leaseParties: { some: { lease: { propertyId: { in: [...ctx.propertyIds] } } } } }, { createdById: ctx.userId }] };
}

type TenantRow = Prisma.TenantGetPayload<object>;

function serialize(ctx: RequestContext, t: TenantRow) {
  const sensitive = ctx.permissions.has("tenant.sensitive.read");
  return {
    id: t.id, tenantRef: t.tenantRef, tenantType: t.tenantType, displayName: t.displayName, email: t.email, phone: t.phone,
    alternatePhone: t.alternatePhone, address: t.addressJson as z.infer<typeof addressSchema> | null, status: t.status,
    privacyNoticeVersion: t.privacyNoticeVersion, privacyNoticeAcceptedAt: t.privacyNoticeAcceptedAt,
    identificationType: sensitive ? t.identificationType : undefined,
    identificationMasked: sensitive && t.identificationRefLast4 ? `•••• ${t.identificationRefLast4}` : undefined,
    emergencyContact: sensitive ? (t.emergencyContactJson as z.infer<typeof emergencyContactSchema> | null) : undefined,
    employmentInfo: sensitive ? t.employmentInfo : undefined,
    canViewSensitive: sensitive,
    archivedAt: t.archivedAt, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}
export type TenantDTO = ReturnType<typeof serialize>;

async function loadTenant(ctx: RequestContext, id: string) {
  const t = await prisma.tenant.findFirst({ where: { id, organizationId: ctx.organizationId, ...tenantScopeWhere(ctx) } });
  if (!t) throw notFound("Tenant");
  return t;
}

export async function listTenants(ctx: RequestContext, rawQ: z.input<typeof tenantListSchema>) {
  const q = tenantListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "tenant.read");
  const where: Prisma.TenantWhereInput = {
    organizationId: ctx.organizationId,
    AND: [tenantScopeWhere(ctx), q.search ? { OR: [
      { displayName: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } },
      { phone: { contains: q.search.replace(/\s/g, "") } }, { tenantRef: { contains: q.search, mode: "insensitive" } },
    ] } : {}],
    ...(q.status ? { status: q.status } : {}),
    ...(q.includeArchived ? {} : { archivedAt: null }),
  };
  const [rows, total] = await Promise.all([
    prisma.tenant.findMany({
      where, orderBy: sortFrom(q, ["displayName", "tenantRef", "createdAt", "status"], "displayName"), skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { leaseParties: { where: { lease: { status: "active" } }, select: { lease: { select: { id: true, leaseRef: true, unit: { select: { unitRef: true } }, property: { select: { name: true } } } } } } },
    }),
    prisma.tenant.count({ where }),
  ]);
  return paged(rows.map((r) => ({ ...serialize(ctx, r), activeLeases: r.leaseParties.map((lp) => lp.lease) })), total, q);
}

export async function getTenant(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "tenant.read");
  return serialize(ctx, await loadTenant(ctx, id));
}

function identityFields(input: { identificationReference?: string | null }) {
  if (input.identificationReference === undefined) return {};
  const ref = input.identificationReference?.replace(/\s/g, "") || null;
  return { identificationRefEncrypted: ref ? encryptField(ref) : null, identificationRefLast4: ref ? ref.slice(-4) : null };
}

export async function createTenant(ctx: RequestContext, rawInput: z.input<typeof tenantInputSchema>) {
  const input = tenantInputSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "tenant.create");
  const sensitiveAllowed = ctx.permissions.has("tenant.sensitive.read");
  const t = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        organizationId: ctx.organizationId, tenantRef: await nextRef(tx, ctx.organizationId, "TEN", { pad: 4 }),
        tenantType: input.tenantType, displayName: input.displayName, email: input.email, phone: input.phone,
        alternatePhone: input.alternatePhone, addressJson: input.address ?? undefined, status: input.status,
        ...(sensitiveAllowed ? {
          emergencyContactJson: input.emergencyContact ?? undefined, identificationType: input.identificationType ?? null,
          employmentInfo: input.employmentInfo, ...identityFields(input),
        } : {}),
        ...(input.privacyNoticeAccepted ? { privacyNoticeVersion: PRIVACY_NOTICE_VERSION, privacyNoticeAcceptedAt: new Date() } : {}),
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, { action: "tenant.created", entityType: "tenant", entityId: t.id, summary: `Created tenant ${t.displayName} (${t.tenantRef})`, after: t });
    return t;
  });
  return serialize(ctx, t);
}

export async function updateTenant(ctx: RequestContext, id: string, rawInput: z.input<typeof tenantUpdateSchema>) {
  const input = tenantUpdateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "tenant.update");
  const before = await loadTenant(ctx, id);
  if (before.archivedAt) throw businessRule("Archived tenants cannot be edited.");
  const sensitiveAllowed = ctx.permissions.has("tenant.sensitive.read");
  const { address, emergencyContact, identificationReference, privacyNoticeAccepted, identificationType, employmentInfo, ...rest } = input;
  const after = await prisma.tenant.update({
    where: { id },
    data: {
      ...rest,
      ...(address !== undefined ? { addressJson: address ?? Prisma.JsonNull } : {}),
      ...(sensitiveAllowed ? {
        ...(emergencyContact !== undefined ? { emergencyContactJson: emergencyContact ?? Prisma.JsonNull } : {}),
        ...(identificationType !== undefined ? { identificationType } : {}),
        ...(employmentInfo !== undefined ? { employmentInfo } : {}),
        ...identityFields({ identificationReference }),
      } : {}),
      ...(privacyNoticeAccepted && !before.privacyNoticeAcceptedAt ? { privacyNoticeVersion: PRIVACY_NOTICE_VERSION, privacyNoticeAcceptedAt: new Date() } : {}),
    },
  });
  await recordAudit(prisma, ctx, { action: "tenant.updated", entityType: "tenant", entityId: id, before, after });
  return serialize(ctx, after);
}

/** Reveal the full identification number — permission-gated and audit-logged (spec §10.3). */
export async function revealIdentification(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "tenant.sensitive.read");
  const t = await loadTenant(ctx, id);
  await recordAudit(prisma, ctx, { action: "tenant.identification_viewed", entityType: "tenant", entityId: id, summary: `Viewed identification for ${t.displayName}` });
  return { identificationType: t.identificationType, identificationReference: t.identificationRefEncrypted ? decryptField(t.identificationRefEncrypted) : null };
}

/** Archive keeps all financial history; it blocks only if the tenant is on an active lease. */
export async function archiveTenant(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "tenant.archive");
  const t = await loadTenant(ctx, id);
  if (t.archivedAt) throw businessRule("Tenant is already archived.");
  const active = await prisma.leaseParty.count({ where: { tenantId: id, lease: { status: { in: ["active", "pending_signature", "draft"] } } } });
  if (active) throw businessRule("This tenant is party to an active, pending or draft lease. Close the lease first.");
  const after = await prisma.tenant.update({ where: { id }, data: { archivedAt: new Date(), status: "former" } });
  await recordAudit(prisma, ctx, { action: "tenant.archived", entityType: "tenant", entityId: id, summary: `Archived tenant ${t.displayName}` });
  return serialize(ctx, after);
}

export async function listTenantNotes(ctx: RequestContext, tenantId: string) {
  requireStaff(ctx);
  requirePermission(ctx, "tenant.read");
  await loadTenant(ctx, tenantId);
  return prisma.tenantNote.findMany({ where: { tenantId, organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function addTenantNote(ctx: RequestContext, tenantId: string, rawInput: z.input<typeof noteSchema>) {
  const input = noteSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "tenant.update");
  await loadTenant(ctx, tenantId);
  const note = await prisma.tenantNote.create({ data: { organizationId: ctx.organizationId, tenantId, kind: input.kind, body: input.body, authorUserId: ctx.userId, authorName: ctx.userName } });
  await recordAudit(prisma, ctx, { action: "tenant.note_added", entityType: "tenant", entityId: tenantId, summary: `Added ${input.kind} note` });
  return note;
}

export async function listTenantLeases(ctx: RequestContext, tenantId: string) {
  requireStaff(ctx);
  requirePermission(ctx, "lease.read");
  await loadTenant(ctx, tenantId);
  const parties = await prisma.leaseParty.findMany({
    where: { tenantId, organizationId: ctx.organizationId, ...(ctx.scopeAllProperties ? {} : { lease: { propertyId: { in: [...ctx.propertyIds] } } }) },
    include: { lease: { include: { unit: { select: { unitRef: true } }, property: { select: { id: true, name: true } } } } },
    orderBy: { lease: { startDate: "desc" } },
  });
  return parties.map((p) => ({ partyRole: p.partyRole, isPrimary: p.isPrimary, lease: p.lease }));
}

export { tenantScopeWhere, loadTenant };
