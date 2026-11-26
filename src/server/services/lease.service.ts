import { z } from "zod";
import { prisma, Prisma, type Tx } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { AppError, businessRule, conflict, notFound } from "@/lib/api/errors";
import { isoDate, minorAmount, optionalText, paged, paginationSchema, sortFrom } from "@/lib/validation/common";
import { addDays, addMonths, dateOnly, diffDays, toISODate, todayInTz } from "@/lib/dates";
import { propertyScopeFilter } from "@/lib/permissions";
import { findLeaseConflicts, leaseDisplayStatus, validateLeaseDates } from "@/server/domain/lease-rules";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";
import { assertUnitLeasable } from "./unit.service";
import { generateChargesForLeaseTx } from "./rent.service";

export const BILLING_FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly", "custom"] as const;
export const PARTY_ROLES = ["primary_tenant", "co_tenant", "guarantor", "occupant"] as const;

const partySchema = z.object({ tenantId: z.string().uuid(), partyRole: z.enum(PARTY_ROLES) });

const leaseBase = z.object({
  unitId: z.string().uuid(),
  parties: z.array(partySchema).min(1, "Add at least the primary tenant."),
  startDate: isoDate,
  endDate: isoDate,
  rentAmountMinor: minorAmount,
  billingFrequency: z.enum(BILLING_FREQUENCIES),
  dueDay: z.number().int().min(1).max(31).optional().nullable(),
  depositAmountMinor: z.number().int().min(0).default(0),
  depositStatus: z.enum(["not_applicable", "pending", "held", "refunded", "applied"]).default("not_applicable"),
  advanceMonths: z.number().int().min(0).max(60).optional().nullable(),
  gracePeriodDays: z.number().int().min(0).max(90).default(0),
  noticePeriodDays: z.number().int().min(0).max(365).optional().nullable(),
  renewalTerms: optionalText(2000),
  internalNotes: optionalText(4000),
  leaseRef: z.string().trim().max(30).optional().nullable(),
});

function leaseRefinement(v: Partial<z.infer<typeof leaseBase>>, ctx: z.RefinementCtx) {
  if (v.startDate && v.endDate) {
    const err = validateLeaseDates(v.startDate, v.endDate);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: err });
  }
  if (v.parties) {
    const primaries = v.parties.filter((p) => p.partyRole === "primary_tenant");
    if (primaries.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parties"], message: "Exactly one primary tenant is required." });
    const keys = v.parties.map((p) => `${p.tenantId}:${p.partyRole}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parties"], message: "Duplicate party." });
  }
}

export const leaseInputSchema = leaseBase.superRefine(leaseRefinement);
export const leaseUpdateSchema = leaseBase.partial().superRefine(leaseRefinement);

export const leaseListSchema = paginationSchema.extend({
  status: z.enum(["draft", "pending_signature", "active", "expiring", "upcoming", "expired", "terminated"]).optional(),
  propertyId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const terminateSchema = z.object({
  terminationDate: isoDate,
  reason: z.string().trim().min(3, "Give a reason.").max(500),
  settlementNotes: optionalText(2000),
});

export const renewSchema = z.object({
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  rentAmountMinor: minorAmount.optional(),
  billingFrequency: z.enum(BILLING_FREQUENCIES).optional(),
});

const include = {
  unit: { select: { id: true, unitRef: true, unitName: true, availability: true } },
  property: { select: { id: true, name: true, propertyRef: true } },
  parties: { include: { tenant: { select: { id: true, displayName: true, phone: true, email: true, tenantRef: true } } }, orderBy: { isPrimary: "desc" } },
  renewalOf: { select: { id: true, leaseRef: true } },
  renewals: { select: { id: true, leaseRef: true, status: true } },
} satisfies Prisma.LeaseInclude;
type LeaseRow = Prisma.LeaseGetPayload<{ include: typeof include }>;

async function warningDays(ctx: RequestContext) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { leaseExpiryWarningDays: true } });
  return org.leaseExpiryWarningDays;
}

function serialize(l: LeaseRow, today: string, warn: number) {
  const startDate = toISODate(l.startDate), endDate = toISODate(l.endDate);
  return {
    id: l.id, leaseRef: l.leaseRef, propertyId: l.propertyId, unitId: l.unitId, property: l.property, unit: l.unit,
    parties: l.parties.map((p) => ({ tenantId: p.tenantId, partyRole: p.partyRole, isPrimary: p.isPrimary, tenant: p.tenant })),
    primaryTenant: l.parties.find((p) => p.isPrimary)?.tenant ?? null,
    startDate, endDate, rentAmountMinor: l.rentAmountMinor, currency: l.currency, billingFrequency: l.billingFrequency,
    dueDay: l.dueDay, depositAmountMinor: l.depositAmountMinor, depositStatus: l.depositStatus, advanceMonths: l.advanceMonths,
    gracePeriodDays: l.gracePeriodDays, lateFeeEnabled: l.lateFeeEnabled, noticePeriodDays: l.noticePeriodDays, renewalTerms: l.renewalTerms,
    status: l.status, displayStatus: leaseDisplayStatus({ status: l.status, startDate, endDate }, today, warn),
    daysToExpiry: l.status === "active" ? diffDays(today, endDate) : null,
    renewalOf: l.renewalOf, renewals: l.renewals,
    activatedAt: l.activatedAt, terminatedAt: l.terminatedAt ? toISODate(l.terminatedAt) : null,
    terminationReason: l.terminationReason, settlementNotes: l.settlementNotes, internalNotes: l.internalNotes,
    createdAt: l.createdAt, updatedAt: l.updatedAt,
  };
}
export type LeaseDTO = ReturnType<typeof serialize>;

async function loadLease(ctx: RequestContext, id: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const l = await db.lease.findFirst({ where: { id, organizationId: ctx.organizationId }, include });
  if (!l) throw notFound("Lease");
  requirePropertyAccess(ctx, l.propertyId);
  return l;
}

export async function listLeases(ctx: RequestContext, rawQ: z.input<typeof leaseListSchema>) {
  const q = leaseListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "lease.read");
  const today = todayInTz(ctx.timezone);
  const todayD = dateOnly(today);
  const warn = await warningDays(ctx);
  const where: Prisma.LeaseWhereInput = {
    organizationId: ctx.organizationId,
    ...(propertyScopeFilter(ctx) as Prisma.LeaseWhereInput),
    ...(q.propertyId ? { propertyId: q.propertyId } : {}),
    ...(q.unitId ? { unitId: q.unitId } : {}),
    ...(q.tenantId ? { parties: { some: { tenantId: q.tenantId } } } : {}),
    ...(q.search ? { OR: [
      { leaseRef: { contains: q.search, mode: "insensitive" } },
      { parties: { some: { tenant: { displayName: { contains: q.search, mode: "insensitive" } } } } },
      { unit: { unitRef: { contains: q.search, mode: "insensitive" } } },
    ] } : {}),
  };
  // Translate derived statuses to date predicates so filtering & pagination happen in SQL.
  const s = q.status;
  if (s === "expiring") Object.assign(where, { status: "active", startDate: { lte: todayD }, endDate: { gte: todayD, lte: dateOnly(addDays(today, warn)) } });
  else if (s === "upcoming") Object.assign(where, { status: "active", startDate: { gt: todayD } });
  else if (s === "expired") Object.assign(where, { OR: [{ status: "expired" }, { status: "active", endDate: { lt: todayD } }] });
  else if (s === "active") Object.assign(where, { status: "active", startDate: { lte: todayD }, endDate: { gt: dateOnly(addDays(today, warn)) } });
  else if (s) Object.assign(where, { status: s });
  if (q.expiringWithinDays) Object.assign(where, { status: "active", endDate: { gte: todayD, lte: dateOnly(addDays(today, q.expiringWithinDays)) } });

  const [rows, total] = await Promise.all([
    prisma.lease.findMany({ where, include, orderBy: sortFrom(q, ["leaseRef", "startDate", "endDate", "rentAmountMinor", "createdAt"], "endDate"), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.lease.count({ where }),
  ]);
  return paged(rows.map((r) => serialize(r, today, warn)), total, q);
}

export async function getLease(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "lease.read");
  const l = await loadLease(ctx, id);
  return serialize(l, todayInTz(ctx.timezone), await warningDays(ctx));
}

async function assertParties(tx: Tx, ctx: RequestContext, parties: { tenantId: string }[]) {
  const ids = [...new Set(parties.map((p) => p.tenantId))];
  const found = await tx.tenant.findMany({ where: { id: { in: ids }, organizationId: ctx.organizationId }, select: { id: true, archivedAt: true } });
  if (found.length !== ids.length) throw new AppError("VALIDATION_ERROR", "One or more tenants were not found.", [{ path: "parties", message: "Unknown tenant." }]);
  if (found.some((t) => t.archivedAt)) throw businessRule("Archived tenants cannot be added to a lease.");
}

export async function createLease(ctx: RequestContext, rawInput: z.input<typeof leaseInputSchema>, opts: { renewalOfLeaseId?: string } = {}) {
  const input = leaseInputSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "lease.create");
  const unit = await prisma.unit.findFirst({ where: { id: input.unitId, organizationId: ctx.organizationId } });
  if (!unit) throw notFound("Unit");
  requirePropertyAccess(ctx, unit.propertyId);
  assertUnitLeasable(unit);
  const lease = await prisma.$transaction(async (tx) => {
    await assertParties(tx, ctx, input.parties);
    const ref = input.leaseRef?.toUpperCase() || (await nextRef(tx, ctx.organizationId, "LSE", { year: true, pad: 4 }));
    const l = await tx.lease.create({
      data: {
        organizationId: ctx.organizationId, leaseRef: ref, propertyId: unit.propertyId, unitId: unit.id,
        startDate: dateOnly(input.startDate), endDate: dateOnly(input.endDate), rentAmountMinor: input.rentAmountMinor,
        currency: ctx.currency, billingFrequency: input.billingFrequency, dueDay: input.dueDay ?? null,
        depositAmountMinor: input.depositAmountMinor, depositStatus: input.depositStatus, advanceMonths: input.advanceMonths ?? null,
        gracePeriodDays: input.gracePeriodDays, noticePeriodDays: input.noticePeriodDays ?? null, renewalTerms: input.renewalTerms,
        internalNotes: input.internalNotes, status: "draft", renewalOfLeaseId: opts.renewalOfLeaseId ?? null,
        createdById: ctx.userId, updatedById: ctx.userId,
        parties: { create: input.parties.map((p) => ({ organizationId: ctx.organizationId, tenantId: p.tenantId, partyRole: p.partyRole, isPrimary: p.partyRole === "primary_tenant" })) },
      },
      include,
    });
    await recordAudit(tx, ctx, { action: opts.renewalOfLeaseId ? "lease.renewal_drafted" : "lease.created", entityType: "lease", entityId: l.id, summary: `Drafted lease ${l.leaseRef} for unit ${unit.unitRef}`, after: l });
    return l;
  });
  return serialize(lease, todayInTz(ctx.timezone), await warningDays(ctx));
}

/** Only draft / pending-signature leases are editable; active terms are changed by renewal (history preserved). */
export async function updateLease(ctx: RequestContext, id: string, rawInput: z.input<typeof leaseUpdateSchema>) {
  const input = leaseUpdateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "lease.update");
  const before = await loadLease(ctx, id);
  if (!["draft", "pending_signature"].includes(before.status)) {
    throw businessRule("Only draft or pending-signature leases can be edited. Use renewal to change active terms.");
  }
  const start = input.startDate ?? toISODate(before.startDate), end = input.endDate ?? toISODate(before.endDate);
  const err = validateLeaseDates(start, end);
  if (err) throw new AppError("VALIDATION_ERROR", err, [{ path: "endDate", message: err }]);
  let unitId = before.unitId, propertyId = before.propertyId;
  if (input.unitId && input.unitId !== before.unitId) {
    const unit = await prisma.unit.findFirst({ where: { id: input.unitId, organizationId: ctx.organizationId } });
    if (!unit) throw notFound("Unit");
    requirePropertyAccess(ctx, unit.propertyId);
    assertUnitLeasable(unit);
    unitId = unit.id; propertyId = unit.propertyId;
  }
  const after = await prisma.$transaction(async (tx) => {
    const { parties, startDate, endDate, unitId: _u, leaseRef, ...rest } = input;
    if (parties) {
      await assertParties(tx, ctx, parties);
      await tx.leaseParty.deleteMany({ where: { leaseId: id } });
      await tx.leaseParty.createMany({ data: parties.map((p) => ({ organizationId: ctx.organizationId, leaseId: id, tenantId: p.tenantId, partyRole: p.partyRole, isPrimary: p.partyRole === "primary_tenant" })) });
    }
    const l = await tx.lease.update({
      where: { id },
      data: { ...rest, ...(leaseRef ? { leaseRef: leaseRef.toUpperCase() } : {}), unitId, propertyId, startDate: dateOnly(start), endDate: dateOnly(end), updatedById: ctx.userId },
      include,
    });
    await recordAudit(tx, ctx, { action: "lease.updated", entityType: "lease", entityId: id, before, after: l });
    return l;
  });
  return serialize(after, todayInTz(ctx.timezone), await warningDays(ctx));
}

export async function markPendingSignature(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "lease.update");
  const l = await loadLease(ctx, id);
  if (l.status !== "draft") throw businessRule("Only draft leases can be sent for signature.");
  await prisma.lease.update({ where: { id }, data: { status: "pending_signature", updatedById: ctx.userId } });
  await recordAudit(prisma, ctx, { action: "lease.sent_for_signature", entityType: "lease", entityId: id, summary: `Lease ${l.leaseRef} marked pending signature` });
  return getLease(ctx, id);
}

/**
 * Activate (approve) a lease. Runs in one transaction that:
 *  1. locks the unit row (SELECT … FOR UPDATE) so two concurrent activations serialize,
 *  2. re-checks overlap against other active leases (inclusive dates),
 *  3. flips status, marks tenants active, releases a "reserved" hold,
 *  4. generates the rent schedule up to the organization's horizon (idempotent).
 * A Postgres exclusion constraint (leases_active_no_overlap) backs this up at the DB level.
 */
export async function activateLease(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "lease.activate");
  const result = await prisma.$transaction(async (tx) => {
    const l = await loadLease(ctx, id, tx);
    if (!["draft", "pending_signature"].includes(l.status)) throw businessRule(`A ${l.status.replace("_", " ")} lease cannot be activated.`);
    await tx.$queryRaw`SELECT id FROM units WHERE id = ${l.unitId}::uuid FOR UPDATE`;
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: l.unitId } });
    assertUnitLeasable(unit);
    const today = todayInTz(ctx.timezone);
    if (toISODate(l.endDate) < today) throw businessRule("This lease's end date has already passed; it cannot be activated.");
    const others = await tx.lease.findMany({ where: { unitId: l.unitId, status: "active", id: { not: id } }, select: { id: true, leaseRef: true, status: true, startDate: true, endDate: true } });
    const conflicts = findLeaseConflicts(
      { id, startDate: toISODate(l.startDate), endDate: toISODate(l.endDate) },
      others.map((o) => ({ ...o, startDate: toISODate(o.startDate), endDate: toISODate(o.endDate) })),
    );
    if (conflicts.length) {
      const c = others.find((o) => o.id === conflicts[0].id)!;
      throw conflict(`Unit ${unit.unitRef} already has active lease ${c.leaseRef} from ${toISODate(c.startDate)} to ${toISODate(c.endDate)}, which overlaps these dates.`);
    }
    await tx.lease.update({ where: { id }, data: { status: "active", activatedAt: new Date(), activatedById: ctx.userId, updatedById: ctx.userId } });
    await tx.tenant.updateMany({ where: { id: { in: l.parties.filter((p) => p.partyRole !== "guarantor").map((p) => p.tenantId) }, status: "prospective" }, data: { status: "active" } });
    if (unit.availability === "reserved") await tx.unit.update({ where: { id: unit.id }, data: { availability: "available" } });
    await recordAudit(tx, ctx, { action: "lease.activated", entityType: "lease", entityId: id, summary: `Activated lease ${l.leaseRef} (unit ${unit.unitRef})`, before: { status: l.status }, after: { status: "active" } });
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const gen = await generateChargesForLeaseTx(tx, ctx, id, addDays(today, org.chargeGenerationHorizonDays));
    return gen;
  });
  return { lease: await getLease(ctx, id), chargesCreated: result.created };
}

/**
 * Terminate with an effective date, reason and settlement notes. Original terms are kept.
 * Unpaid charges for periods starting after the termination date are voided (with reason);
 * charges with payments allocated are left for finance to review.
 */
export async function terminateLease(ctx: RequestContext, id: string, rawInput: z.input<typeof terminateSchema>) {
  const input = terminateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "lease.terminate");
  const today = todayInTz(ctx.timezone);
  return prisma.$transaction(async (tx) => {
    const l = await loadLease(ctx, id, tx);
    if (l.status !== "active") throw businessRule("Only active leases can be terminated.");
    if (input.terminationDate < toISODate(l.startDate)) throw new AppError("VALIDATION_ERROR", "Termination date cannot be before the lease start.", [{ path: "terminationDate", message: "Before lease start." }]);
    if (input.terminationDate > today) throw new AppError("VALIDATION_ERROR", "Record the termination on or after its effective date.", [{ path: "terminationDate", message: "Cannot be in the future." }]);
    await tx.lease.update({
      where: { id },
      data: { status: "terminated", terminatedAt: dateOnly(input.terminationDate), terminationReason: input.reason, settlementNotes: input.settlementNotes, updatedById: ctx.userId },
    });
    const future = await tx.rentCharge.findMany({
      where: { leaseId: id, periodStart: { gt: dateOnly(input.terminationDate) }, voidedAt: null },
      include: { allocations: { where: { reversedAt: null }, select: { id: true } } },
    });
    const voidable = future.filter((c) => c.allocations.length === 0);
    if (voidable.length) {
      await tx.rentCharge.updateMany({ where: { id: { in: voidable.map((c) => c.id) } }, data: { voidedAt: new Date(), voidReason: `Lease terminated ${input.terminationDate}`, status: "void" } });
    }
    const outstanding = await tx.rentCharge.count({ where: { leaseId: id, voidedAt: null, status: { in: ["due", "partially_paid", "overdue"] } } });
    await recordAudit(tx, ctx, {
      action: "lease.terminated", entityType: "lease", entityId: id, summary: `Terminated lease ${l.leaseRef} effective ${input.terminationDate}: ${input.reason}`,
      before: { status: "active" }, after: { status: "terminated", ...input, voidedCharges: voidable.map((c) => c.chargeRef) },
    });
    return { voidedCharges: voidable.length, chargesNeedingReview: future.length - voidable.length, outstandingCharges: outstanding };
  });
}

/** Renewal creates a NEW linked draft lease; historical terms are never overwritten (spec §4.5). */
export async function renewLease(ctx: RequestContext, id: string, rawInput: z.input<typeof renewSchema>) {
  const input = renewSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "lease.create");
  const l = await loadLease(ctx, id);
  if (!["active", "expired"].includes(l.status)) throw businessRule("Only active or expired leases can be renewed.");
  if (l.renewals.some((r) => ["draft", "pending_signature", "active"].includes(r.status))) throw businessRule("A renewal for this lease already exists.");
  const oldStart = toISODate(l.startDate), oldEnd = toISODate(l.endDate);
  const termMonths = Math.max(1, Math.round(diffDays(oldStart, oldEnd) / 30.44));
  const startDate = input.startDate ?? addDays(oldEnd, 1);
  const endDate = input.endDate ?? addDays(addMonths(startDate, termMonths), -1);
  return createLease(ctx, {
    unitId: l.unitId,
    parties: l.parties.map((p) => ({ tenantId: p.tenantId, partyRole: p.partyRole as (typeof PARTY_ROLES)[number] })),
    startDate, endDate,
    rentAmountMinor: input.rentAmountMinor ?? l.rentAmountMinor,
    billingFrequency: input.billingFrequency ?? (l.billingFrequency as (typeof BILLING_FREQUENCIES)[number]),
    dueDay: l.dueDay, depositAmountMinor: l.depositAmountMinor, depositStatus: l.depositStatus as "held",
    advanceMonths: l.advanceMonths, gracePeriodDays: l.gracePeriodDays, noticePeriodDays: l.noticePeriodDays,
    renewalTerms: l.renewalTerms, internalNotes: `Renewal of ${l.leaseRef}`, leaseRef: null,
  }, { renewalOfLeaseId: l.id });
}

/** Job: mark active leases whose end date has passed as expired. Idempotent. */
export async function expireEndedLeases(organizationId: string, today: string) {
  const res = await prisma.lease.updateMany({ where: { organizationId, status: "active", endDate: { lt: dateOnly(today) } }, data: { status: "expired" } });
  return res.count;
}
