import { z } from "zod";
import { prisma, Prisma, type Tx } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { AppError, businessRule, conflict, notFound } from "@/lib/api/errors";
import { isoDate, minorAmount, optionalText, paged, paginationSchema } from "@/lib/validation/common";
import { dateOnly, toISODate, todayInTz } from "@/lib/dates";
import { allocateOldestFirst, validateManualAllocation } from "@/server/domain/ledger";
import { recordAudit } from "./audit";
import { nextRef } from "./sequences";
import { leaseCreditPositions, queryChargeBalances, refreshChargeStatuses } from "./ledger-queries";

export const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "cheque", "card", "other"] as const;

const manualAlloc = z.array(z.object({ chargeId: z.string().uuid(), amountMinor: minorAmount })).max(200);

export const recordPaymentSchema = z.object({
  leaseId: z.string().uuid(),
  amountMinor: minorAmount,
  paymentMethod: z.enum(PAYMENT_METHODS),
  receivedAt: isoDate,
  externalReference: z.string().trim().max(80).optional().nullable()
    // Defence: never accept anything resembling a full card number (PAN) in the reference field.
    .refine((v) => !v || !/\b\d{13,19}\b/.test(v.replace(/[\s-]/g, "")), "Do not enter card numbers. Use the last 4 digits or the processor's transaction ID."),
  payerName: z.string().trim().max(160).optional().nullable(),
  notes: optionalText(1000),
  idempotencyKey: z.string().trim().min(8).max(100),
  allocation: z.union([z.literal("auto"), z.literal("none"), manualAlloc]).default("auto"),
});

export const allocateSchema = z.object({ mode: z.literal("auto") }).or(z.object({ allocations: manualAlloc.min(1) }));
export const reverseSchema = z.object({ reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500) });
export const confirmSchema = z.object({ allocation: z.enum(["auto", "none"]).default("auto") });
export const creditSchema = z.object({ chargeId: z.string().uuid(), amountMinor: minorAmount, reason: z.string().trim().min(5).max(500) });
export const refundSchema = z.object({ leaseId: z.string().uuid(), amountMinor: minorAmount, reason: z.string().trim().min(5).max(500), reference: z.string().trim().max(80).optional().nullable() });

export const paymentListSchema = paginationSchema.extend({
  status: z.enum(["pending", "confirmed", "reversed", "refunded"]).optional(),
  tenantId: z.string().uuid().optional(),
  leaseId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const include = {
  tenant: { select: { id: true, displayName: true, tenantRef: true, phone: true } },
  lease: { select: { id: true, leaseRef: true, propertyId: true, unit: { select: { unitRef: true } }, property: { select: { name: true } } } },
  allocations: { include: { rentCharge: { select: { id: true, chargeRef: true, periodStart: true, periodEnd: true, dueDate: true, amountMinor: true, chargeType: true } } }, orderBy: { createdAt: "asc" } },
  receipt: true,
} satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof include }>;

function serialize(p: PaymentRow) {
  const activeAllocated = p.allocations.filter((a) => !a.reversedAt).reduce((s, a) => s + a.allocatedAmountMinor, 0);
  return {
    id: p.id, paymentRef: p.paymentRef, tenant: p.tenant, lease: p.lease, payerName: p.payerName, amountMinor: p.amountMinor, currency: p.currency,
    paymentMethod: p.paymentMethod, receivedAt: toISODate(p.receivedAt), externalReference: p.externalReference, status: p.status,
    recordedById: p.recordedById, confirmedById: p.confirmedById, confirmedAt: p.confirmedAt,
    reversedById: p.reversedById, reversedAt: p.reversedAt, reversalReason: p.reversalReason, notes: p.notes,
    allocatedMinor: activeAllocated, unallocatedMinor: p.status === "confirmed" ? p.amountMinor - activeAllocated : 0,
    allocations: p.allocations.map((a) => ({
      id: a.id, amountMinor: a.allocatedAmountMinor, method: a.method, reversedAt: a.reversedAt, createdAt: a.createdAt,
      charge: { ...a.rentCharge, periodStart: toISODate(a.rentCharge.periodStart), periodEnd: toISODate(a.rentCharge.periodEnd), dueDate: toISODate(a.rentCharge.dueDate) },
    })),
    receipt: p.receipt ? { receiptNumber: p.receipt.receiptNumber, issuedAt: p.receipt.issuedAt } : null,
    createdAt: p.createdAt,
  };
}
export type PaymentDTO = ReturnType<typeof serialize>;

async function lockPayment(tx: Tx, ctx: RequestContext, id: string) {
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid FOR UPDATE`;
  const p = await tx.payment.findFirst({ where: { id, organizationId: ctx.organizationId }, include });
  if (!p) throw notFound("Payment");
  if (p.lease) requirePropertyAccess(ctx, p.lease.propertyId);
  return p;
}

/** Allocate inside an existing transaction. Locks the lease's charges to prevent concurrent over-allocation. */
async function allocateTx(tx: Tx, ctx: RequestContext, payment: PaymentRow, request: "auto" | { chargeId: string; amountMinor: number }[]) {
  if (payment.status !== "confirmed") throw businessRule("Only confirmed payments can be allocated.");
  if (!payment.leaseId) throw businessRule("Payment is not linked to a lease.");
  await tx.$queryRaw`SELECT id FROM rent_charges WHERE lease_id = ${payment.leaseId}::uuid FOR UPDATE`;
  const today = todayInTz(ctx.timezone);
  const open = await queryChargeBalances(tx, { organizationId: ctx.organizationId, leaseId: payment.leaseId, openOnly: true }, today);
  const allocated = payment.allocations.filter((a) => !a.reversedAt).reduce((s, a) => s + a.allocatedAmountMinor, 0);
  const unallocated = payment.amountMinor - allocated;
  let plan: { chargeId: string; amountMinor: number }[];
  if (request === "auto") {
    plan = allocateOldestFirst(unallocated, open.map((c) => ({ id: c.id, dueDate: c.dueDate, periodStart: c.periodStart, balance: c.balanceMinor }))).allocations;
  } else {
    const err = validateManualAllocation(unallocated, request, new Map(open.map((c) => [c.id, c.balanceMinor])));
    if (err) throw businessRule(err);
    plan = request;
  }
  if (!plan.length) return [];
  await tx.paymentAllocation.createMany({
    data: plan.map((a) => ({ organizationId: ctx.organizationId, paymentId: payment.id, rentChargeId: a.chargeId, allocatedAmountMinor: a.amountMinor, method: request === "auto" ? "auto" : "manual", createdById: ctx.userId })),
  });
  await refreshChargeStatuses(tx, ctx.organizationId, plan.map((a) => a.chargeId), today);
  await recordAudit(tx, ctx, {
    action: "payment.allocated", entityType: "payment", entityId: payment.id,
    summary: `Allocated ${plan.reduce((s, a) => s + a.amountMinor, 0)} minor units of ${payment.paymentRef} to ${plan.length} charge(s)`,
    after: { allocations: plan, method: request === "auto" ? "auto (oldest due first)" : "manual" },
  });
  return plan;
}

async function issueReceiptTx(tx: Tx, ctx: RequestContext, paymentId: string) {
  const existing = await tx.receipt.findUnique({ where: { paymentId } });
  if (existing) return existing;
  const receiptNumber = await nextRef(tx, ctx.organizationId, "RCT", { year: true, pad: 6 });
  const r = await tx.receipt.create({ data: { organizationId: ctx.organizationId, paymentId, receiptNumber, issuedById: ctx.userId } });
  await recordAudit(tx, ctx, { action: "receipt.issued", entityType: "receipt", entityId: r.id, summary: `Issued receipt ${receiptNumber}` });
  return r;
}

/**
 * Record a payment (spec §4.6 workflow). Idempotent on (organization, idempotencyKey):
 * a retried submission returns the original payment instead of creating a duplicate.
 * If organization policy requires confirmation, the payment stays PENDING (not counted as collected).
 */
export async function recordPayment(ctx: RequestContext, rawInput: z.input<typeof recordPaymentSchema>) {
  const input = recordPaymentSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "payment.record");
  const prior = await prisma.payment.findUnique({ where: { organizationId_idempotencyKey: { organizationId: ctx.organizationId, idempotencyKey: input.idempotencyKey } }, include });
  if (prior) {
    if (prior.amountMinor !== input.amountMinor || prior.leaseId !== input.leaseId) throw conflict("This idempotency key was already used for a different payment.");
    return { payment: serialize(prior), replayed: true };
  }
  const lease = await prisma.lease.findFirst({ where: { id: input.leaseId, organizationId: ctx.organizationId }, include: { parties: { where: { isPrimary: true } } } });
  if (!lease) throw notFound("Lease");
  requirePropertyAccess(ctx, lease.propertyId);
  if (lease.status === "draft" || lease.status === "pending_signature") throw businessRule("Payments can only be recorded against an active or closed lease.");
  if (input.receivedAt > todayInTz(ctx.timezone)) throw new AppError("VALIDATION_ERROR", "Date received cannot be in the future.", [{ path: "receivedAt", message: "Future date." }]);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const autoConfirm = !org.paymentsRequireConfirmation;
  if (autoConfirm && input.allocation !== "none") requirePermission(ctx, "payment.allocate");

  try {
    const id = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          organizationId: ctx.organizationId, paymentRef: await nextRef(tx, ctx.organizationId, "PAY", { year: true, pad: 6 }),
          tenantId: lease.parties[0].tenantId, leaseId: lease.id, payerName: input.payerName, amountMinor: input.amountMinor, currency: lease.currency,
          paymentMethod: input.paymentMethod, receivedAt: dateOnly(input.receivedAt), externalReference: input.externalReference,
          status: autoConfirm ? "confirmed" : "pending", recordedById: ctx.userId,
          confirmedById: autoConfirm ? ctx.userId : null, confirmedAt: autoConfirm ? new Date() : null,
          idempotencyKey: input.idempotencyKey, notes: input.notes,
        },
        include,
      });
      await recordAudit(tx, ctx, { action: "payment.recorded", entityType: "payment", entityId: p.id, summary: `Recorded ${p.paymentRef} (${input.paymentMethod}) for ${lease.leaseRef} — ${p.status}`, after: p });
      if (autoConfirm) {
        await issueReceiptTx(tx, ctx, p.id);
        if (input.allocation !== "none") await allocateTx(tx, ctx, p, input.allocation);
      }
      return p.id;
    });
    return { payment: await getPayment(ctx, id), replayed: false };
  } catch (e) {
    // Lost a race with an identical concurrent submission → return the winner.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.payment.findUnique({ where: { organizationId_idempotencyKey: { organizationId: ctx.organizationId, idempotencyKey: input.idempotencyKey } }, include });
      if (winner) return { payment: serialize(winner), replayed: true };
    }
    throw e;
  }
}

export async function confirmPayment(ctx: RequestContext, id: string, rawInput: z.input<typeof confirmSchema>) {
  const input = confirmSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "payment.confirm");
  if (input.allocation === "auto") requirePermission(ctx, "payment.allocate");
  await prisma.$transaction(async (tx) => {
    const p = await lockPayment(tx, ctx, id);
    if (p.status !== "pending") throw businessRule(`Payment is already ${p.status}.`);
    const confirmed = await tx.payment.update({ where: { id }, data: { status: "confirmed", confirmedById: ctx.userId, confirmedAt: new Date() }, include });
    await recordAudit(tx, ctx, { action: "payment.confirmed", entityType: "payment", entityId: id, summary: `Confirmed ${p.paymentRef}`, before: { status: "pending" }, after: { status: "confirmed" } });
    await issueReceiptTx(tx, ctx, id);
    if (input.allocation === "auto") await allocateTx(tx, ctx, confirmed, "auto");
  });
  return getPayment(ctx, id);
}

export async function allocatePayment(ctx: RequestContext, id: string, rawInput: z.input<typeof allocateSchema>) {
  const input = allocateSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "payment.allocate");
  await prisma.$transaction(async (tx) => {
    const p = await lockPayment(tx, ctx, id);
    const plan = await allocateTx(tx, ctx, p, "mode" in input ? "auto" : input.allocations);
    if (!plan.length) throw businessRule("Nothing to allocate: the payment is fully allocated or there are no open charges on this lease.");
  });
  return getPayment(ctx, id);
}

/**
 * Reverse a payment. Nothing is deleted: the payment row is kept with status "reversed",
 * its allocations are marked reversed, and a compensating "reversal" ledger adjustment is written.
 * Charge balances therefore re-open automatically.
 */
export async function reversePayment(ctx: RequestContext, id: string, rawInput: z.input<typeof reverseSchema>) {
  const input = reverseSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "payment.reverse");
  await prisma.$transaction(async (tx) => {
    const p = await lockPayment(tx, ctx, id);
    if (p.status !== "confirmed" && p.status !== "pending") throw businessRule(`A ${p.status} payment cannot be reversed.`);
    // Refunds paid out of this lease's credit must not exceed what remains after reversal.
    if (p.status === "confirmed" && p.leaseId) {
      const pos = (await leaseCreditPositions(tx, ctx.organizationId, [p.leaseId])).get(p.leaseId);
      const activeAlloc = p.allocations.filter((a) => !a.reversedAt).reduce((s, a) => s + a.allocatedAmountMinor, 0);
      const unappliedOnThis = p.amountMinor - activeAlloc;
      if (pos && pos.unappliedMinor < unappliedOnThis) throw businessRule("Part of this payment's credit has already been refunded. Reverse the refund first.");
    }
    const chargeIds = p.allocations.filter((a) => !a.reversedAt).map((a) => a.rentChargeId);
    await tx.paymentAllocation.updateMany({ where: { paymentId: id, reversedAt: null }, data: { reversedAt: new Date(), reversedById: ctx.userId } });
    await tx.payment.update({ where: { id }, data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.userId, reversalReason: input.reason } });
    const adj = await tx.ledgerAdjustment.create({
      data: {
        organizationId: ctx.organizationId, adjustmentRef: await nextRef(tx, ctx.organizationId, "ADJ", { year: true, pad: 5 }),
        tenantId: p.tenantId, leaseId: p.leaseId, adjustmentType: "reversal", amountMinor: p.amountMinor, currency: p.currency,
        reason: input.reason, reference: p.paymentRef, reversesTransactionId: p.id, approvedById: ctx.userId, createdById: ctx.userId,
      },
    });
    await refreshChargeStatuses(tx, ctx.organizationId, chargeIds, todayInTz(ctx.timezone));
    await recordAudit(tx, ctx, {
      action: "payment.reversed", entityType: "payment", entityId: id, summary: `Reversed ${p.paymentRef}: ${input.reason}`,
      before: { status: p.status, allocations: p.allocations.filter((a) => !a.reversedAt).map((a) => ({ chargeId: a.rentChargeId, amountMinor: a.allocatedAmountMinor })) },
      after: { status: "reversed", adjustmentRef: adj.adjustmentRef, reason: input.reason },
    });
  });
  return getPayment(ctx, id);
}

/** Credit (e.g. approved waiver) against a specific charge; cannot exceed its balance. */
export async function creditCharge(ctx: RequestContext, rawInput: z.input<typeof creditSchema>) {
  const input = creditSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "rent.adjust");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM rent_charges WHERE id = ${input.chargeId}::uuid FOR UPDATE`;
    const c = await tx.rentCharge.findFirst({ where: { id: input.chargeId, organizationId: ctx.organizationId } });
    if (!c) throw notFound("Charge");
    requirePropertyAccess(ctx, c.propertyId);
    const [bal] = await queryChargeBalances(tx, { organizationId: ctx.organizationId, chargeIds: [c.id] }, todayInTz(ctx.timezone));
    if (!bal || input.amountMinor > bal.balanceMinor) throw businessRule("Credit cannot exceed the charge's outstanding balance.");
    const adj = await tx.ledgerAdjustment.create({
      data: {
        organizationId: ctx.organizationId, adjustmentRef: await nextRef(tx, ctx.organizationId, "ADJ", { year: true, pad: 5 }),
        tenantId: c.tenantId, leaseId: c.leaseId, rentChargeId: c.id, adjustmentType: "credit", amountMinor: input.amountMinor,
        currency: c.currency, reason: input.reason, reference: c.chargeRef, approvedById: ctx.userId, createdById: ctx.userId,
      },
    });
    await refreshChargeStatuses(tx, ctx.organizationId, [c.id], todayInTz(ctx.timezone));
    await recordAudit(tx, ctx, { action: "ledger.credit", entityType: "rent_charge", entityId: c.id, summary: `Credit ${adj.adjustmentRef} on ${c.chargeRef}: ${input.reason}`, after: adj });
    return adj;
  });
}

/** Refund unapplied credit (prepayment) on a lease. Records the refund; does not move money. */
export async function refundCredit(ctx: RequestContext, rawInput: z.input<typeof refundSchema>) {
  const input = refundSchema.parse(rawInput);
  requireStaff(ctx);
  requirePermission(ctx, "rent.adjust");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leases WHERE id = ${input.leaseId}::uuid FOR UPDATE`;
    const lease = await tx.lease.findFirst({ where: { id: input.leaseId, organizationId: ctx.organizationId }, include: { parties: { where: { isPrimary: true } } } });
    if (!lease) throw notFound("Lease");
    requirePropertyAccess(ctx, lease.propertyId);
    const pos = (await leaseCreditPositions(tx, ctx.organizationId, [lease.id])).get(lease.id);
    if (!pos || input.amountMinor > pos.unappliedMinor) throw businessRule("Refund cannot exceed the lease's unapplied credit.");
    const adj = await tx.ledgerAdjustment.create({
      data: {
        organizationId: ctx.organizationId, adjustmentRef: await nextRef(tx, ctx.organizationId, "ADJ", { year: true, pad: 5 }),
        tenantId: lease.parties[0].tenantId, leaseId: lease.id, adjustmentType: "refund", amountMinor: input.amountMinor, currency: lease.currency,
        reason: input.reason, reference: input.reference ?? null, approvedById: ctx.userId, createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, { action: "ledger.refund", entityType: "lease", entityId: lease.id, summary: `Refund ${adj.adjustmentRef} on ${lease.leaseRef}: ${input.reason}`, after: adj });
    return adj;
  });
}

export async function listPayments(ctx: RequestContext, rawQ: z.input<typeof paymentListSchema>) {
  const q = paymentListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "rent.read");
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const where: Prisma.PaymentWhereInput = {
    organizationId: ctx.organizationId,
    ...(ctx.scopeAllProperties ? {} : { lease: { propertyId: { in: [...ctx.propertyIds] } } }),
    ...(q.propertyId ? { lease: { propertyId: q.propertyId } } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.tenantId ? { tenantId: q.tenantId } : {}),
    ...(q.leaseId ? { leaseId: q.leaseId } : {}),
    ...(q.method ? { paymentMethod: q.method } : {}),
    ...(q.from || q.to ? { receivedAt: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}),
    ...(q.search ? { OR: [
      { paymentRef: { contains: q.search, mode: "insensitive" } }, { externalReference: { contains: q.search, mode: "insensitive" } },
      { tenant: { displayName: { contains: q.search, mode: "insensitive" } } }, { receipt: { receiptNumber: { contains: q.search, mode: "insensitive" } } },
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({ where, include, orderBy: [{ receivedAt: q.sortOrder === "asc" ? "asc" : "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.payment.count({ where }),
  ]);
  return paged(rows.map(serialize), total, q);
}

export async function getPayment(ctx: RequestContext, id: string) {
  requireStaff(ctx);
  requirePermission(ctx, "rent.read");
  const p = await prisma.payment.findFirst({ where: { id, organizationId: ctx.organizationId }, include });
  if (!p) throw notFound("Payment");
  if (p.lease) requirePropertyAccess(ctx, p.lease.propertyId);
  const users = await prisma.user.findMany({ where: { id: { in: [p.recordedById, p.confirmedById, p.reversedById].filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
  const name = (uid: string | null) => users.find((u) => u.id === uid)?.fullName ?? null;
  const reversal = await prisma.ledgerAdjustment.findFirst({ where: { reversesTransactionId: id, adjustmentType: "reversal" } });
  return { ...serialize(p), recordedByName: name(p.recordedById), confirmedByName: name(p.confirmedById), reversedByName: name(p.reversedById), reversalAdjustment: reversal };
}

/** Receipt data (immutable evidence). Tenant-portal access is handled in portal.service. */
export async function buildReceipt(organizationId: string, paymentId: string) {
  const p = await prisma.payment.findFirst({ where: { id: paymentId, organizationId }, include: { ...include, organization: true } });
  if (!p || !p.receipt) return null;
  const users = await prisma.user.findMany({ where: { id: { in: [p.recordedById, p.confirmedById].filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
  return {
    receiptNumber: p.receipt.receiptNumber, issuedAt: p.receipt.issuedAt,
    organization: { name: p.organization.name, legalName: p.organization.legalName, phone: p.organization.phone, email: p.organization.email, address: p.organization.addressJson, isDemo: p.organization.isDemo, timezone: p.organization.timezone },
    payment: serialize(p),
    receivedByName: users.find((u) => u.id === p.recordedById)?.fullName ?? null,
    confirmedByName: users.find((u) => u.id === p.confirmedById)?.fullName ?? null,
  };
}

export async function getReceipt(ctx: RequestContext, paymentId: string) {
  requireStaff(ctx);
  requirePermission(ctx, "rent.read");
  await getPayment(ctx, paymentId); // scope check
  const r = await buildReceipt(ctx.organizationId, paymentId);
  if (!r) throw businessRule("No receipt: the payment has not been confirmed.");
  return r;
}
