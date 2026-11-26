import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requirePropertyAccess, requireStaff } from "@/lib/auth/context";
import { AppError, businessRule, notFound } from "@/lib/api/errors";
import { isoDate, requiredText } from "@/lib/validation/common";
import { propertyScopeFilter } from "@/lib/permissions";
import { dateOnly, toISODate, todayInTz } from "@/lib/dates";
import { log } from "@/lib/logging";
import { OPEN_WORK_ORDER_STATUSES, planGenerationStep, serviceStatus } from "@/server/domain/maintenance";
import { recordAudit } from "./audit";
import { loadScopedAsset } from "./asset.service";
import { assertAssignableUser } from "./maintenance-common";
import { assertAssignableVendor } from "./vendor.service";
import { createWorkOrderTx } from "./work-order.service";

export const planInputSchema = z.object({
  assetId: z.string().uuid(),
  planName: requiredText(160),
  intervalDays: z.number().int().min(1, "Interval must be at least 1 day.").max(3660),
  nextDueAt: isoDate,
  leadDays: z.number().int().min(0).max(365).default(7),
  checklist: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  assignedVendorId: z.string().uuid().optional().nullable(),
  assignedUserId: z.string().uuid().optional().nullable(),
  estimatedCostMinor: z.number().int().min(0).max(2_000_000_000).optional().nullable(),
}).strict();
export const planUpdateSchema = planInputSchema.omit({ assetId: true }).partial().extend({ active: z.boolean().optional() }).strict();
export const planListSchema = z.object({
  propertyId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  due: z.enum(["overdue", "due_soon", "ok"]).optional(),
  includeInactive: z.coerce.boolean().optional(),
});

/** Asset category → the maintenance category its preventive work orders are filed under. */
const CATEGORY_FOR_ASSET: Record<string, string> = {
  generator: "electrical", electrical: "electrical", solar: "electrical", water_pump: "plumbing", borehole: "plumbing", water_system: "plumbing",
  lift: "other", air_conditioner: "hvac", fire_equipment: "security", security_system: "security", appliance: "appliance", other: "other",
};

const include = {
  asset: { select: { id: true, assetRef: true, name: true, category: true, propertyId: true, property: { select: { id: true, name: true } } } },
  assignedVendor: { select: { id: true, businessName: true } },
  assignedUser: { select: { id: true, fullName: true } },
  workOrders: { where: { status: { in: OPEN_WORK_ORDER_STATUSES } }, select: { id: true, workOrderRef: true, status: true, dueAt: true }, orderBy: { pmDueDate: "asc" as const } },
} satisfies Prisma.PreventiveMaintenancePlanInclude;
type PlanRow = Prisma.PreventiveMaintenancePlanGetPayload<{ include: typeof include }>;

function serialize(p: PlanRow, today: string) {
  const openWos = p.workOrders.map((w) => ({ ...w, dueAt: w.dueAt ? toISODate(w.dueAt) : null }));
  // What is actually owed: the oldest open generated work order, else the plan's next occurrence.
  const effectiveDue = openWos[0]?.dueAt ?? toISODate(p.nextDueAt);
  return {
    id: p.id, planName: p.planName, asset: p.asset, intervalDays: p.intervalDays, nextDueAt: toISODate(p.nextDueAt), leadDays: p.leadDays,
    checklist: p.checklistJson as string[], assignedVendor: p.assignedVendor, assignedUser: p.assignedUser, estimatedCostMinor: p.estimatedCostMinor,
    active: p.active, lastGeneratedAt: p.lastGeneratedAt, openWorkOrders: openWos, effectiveDueAt: effectiveDue,
    dueStatus: p.active ? serviceStatus(effectiveDue, today) : "not_scheduled",
  };
}
export type PlanDTO = ReturnType<typeof serialize>;

async function validateAssignees(ctx: RequestContext, propertyId: string, input: { assignedVendorId?: string | null; assignedUserId?: string | null }) {
  if (input.assignedVendorId && input.assignedUserId) throw businessRule("Assign a plan to either a vendor or a technician, not both.");
  if (input.assignedVendorId) await assertAssignableVendor(ctx, input.assignedVendorId);
  if (input.assignedUserId) await assertAssignableUser(prisma, ctx, input.assignedUserId, propertyId);
}

export async function listPlans(ctx: RequestContext, rawQ: z.input<typeof planListSchema>) {
  const q = planListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "asset.read");
  if (q.propertyId) requirePropertyAccess(ctx, q.propertyId);
  const today = todayInTz(ctx.timezone);
  const rows = await prisma.preventiveMaintenancePlan.findMany({
    where: {
      organizationId: ctx.organizationId, ...(q.includeInactive ? {} : { active: true }), ...(q.assetId ? { assetId: q.assetId } : {}),
      asset: { ...(propertyScopeFilter(ctx) as Prisma.AssetWhereInput), ...(q.propertyId ? { propertyId: q.propertyId } : {}) },
    },
    include, orderBy: { nextDueAt: "asc" },
  });
  const items = rows.map((r) => serialize(r, today)).sort((a, b) => a.effectiveDueAt.localeCompare(b.effectiveDueAt));
  return q.due ? items.filter((p) => p.dueStatus === q.due) : items;
}

export async function createPlan(ctx: RequestContext, raw: z.input<typeof planInputSchema>) {
  const input = planInputSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "asset.manage");
  const asset = await loadScopedAsset(ctx, input.assetId);
  if (asset.status !== "active") throw businessRule(`Asset ${asset.assetRef} is ${asset.status}; plans can only be created for active assets.`);
  await validateAssignees(ctx, asset.propertyId, input);
  const { checklist, nextDueAt, ...rest } = input;
  const p = await prisma.$transaction(async (tx) => {
    const p = await tx.preventiveMaintenancePlan.create({
      data: { ...rest, organizationId: ctx.organizationId, nextDueAt: dateOnly(nextDueAt), checklistJson: checklist, createdById: ctx.userId },
      include,
    });
    // Keep the asset's interval in line with its plan when the asset has none.
    if (!asset.serviceIntervalDays) await tx.asset.update({ where: { id: asset.id }, data: { serviceIntervalDays: input.intervalDays } });
    await recordAudit(tx, ctx, { action: "pm_plan.created", entityType: "pm_plan", entityId: p.id, summary: `Plan "${p.planName}" every ${p.intervalDays} days for ${asset.assetRef}`, after: p });
    return p;
  });
  return serialize(p, todayInTz(ctx.timezone));
}

export async function updatePlan(ctx: RequestContext, id: string, raw: z.input<typeof planUpdateSchema>) {
  const input = planUpdateSchema.parse(raw);
  requireStaff(ctx);
  requirePermission(ctx, "asset.manage");
  const before = await prisma.preventiveMaintenancePlan.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { asset: true } });
  if (!before) throw notFound("Plan");
  requirePropertyAccess(ctx, before.asset.propertyId);
  if (input.active && before.asset.status !== "active") throw businessRule("Cannot reactivate a plan on an asset that is not active.");
  const merged = {
    assignedVendorId: input.assignedVendorId !== undefined ? input.assignedVendorId : before.assignedVendorId,
    assignedUserId: input.assignedUserId !== undefined ? input.assignedUserId : before.assignedUserId,
  };
  await validateAssignees(ctx, before.asset.propertyId, {
    assignedVendorId: input.assignedVendorId !== undefined ? input.assignedVendorId : null,
    assignedUserId: input.assignedUserId !== undefined ? input.assignedUserId : null,
  });
  if (merged.assignedVendorId && merged.assignedUserId) throw businessRule("Assign a plan to either a vendor or a technician, not both.");
  const { checklist, nextDueAt, ...rest } = input;
  const after = await prisma.preventiveMaintenancePlan.update({
    where: { id },
    data: { ...rest, ...(checklist ? { checklistJson: checklist } : {}), ...(nextDueAt ? { nextDueAt: dateOnly(nextDueAt) } : {}) },
    include,
  });
  await recordAudit(prisma, ctx, { action: input.active === false ? "pm_plan.deactivated" : "pm_plan.updated", entityType: "pm_plan", entityId: id, summary: `Updated plan "${after.planName}"`, before, after });
  return serialize(after, todayInTz(ctx.timezone));
}

type JobActor = { organizationId: string; userId: string; userName: string; requestId: string; isDemoOrg: boolean };

/**
 * Generate preventive work orders that have entered their lead window (spec §9.5 "creating preventive
 * maintenance tasks"). Idempotent: each plan row is locked, and the (plan, occurrence) pair is unique,
 * so concurrent or repeated runs create each occurrence once. A plan whose assignee is no longer valid
 * still gets its work order, unassigned, so a coordinator can pick it up.
 */
export async function generatePreventiveWorkOrders(actor: JobActor, today: string, opts: { propertyIds?: string[] } = {}) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { defaultCurrency: true } });
  const plans = await prisma.preventiveMaintenancePlan.findMany({
    where: { organizationId: actor.organizationId, active: true, asset: { status: "active", ...(opts.propertyIds ? { propertyId: { in: opts.propertyIds } } : {}) } },
    select: { id: true },
  });
  let created = 0, skippedOccurrences = 0, failed = 0;
  const refs: string[] = [];
  for (const { id } of plans) {
    try {
      const r = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM preventive_maintenance_plans WHERE id = ${id}::uuid FOR UPDATE`;
        const plan = await tx.preventiveMaintenancePlan.findUniqueOrThrow({ where: { id }, include: { asset: true } });
        if (!plan.active) return null;
        const step = planGenerationStep({ nextDueAt: toISODate(plan.nextDueAt), intervalDays: plan.intervalDays, leadDays: plan.leadDays }, today);
        if (!step.generate) return null;
        const exists = await tx.workOrder.findUnique({ where: { pmPlanId_pmDueDate: { pmPlanId: id, pmDueDate: dateOnly(step.occurrence) } } });
        let wo = exists;
        if (!exists) {
          let assignedUserId = plan.assignedUserId, vendorId = plan.assignedVendorId;
          try {
            if (assignedUserId) await assertAssignableUser(tx, actor, assignedUserId, plan.asset.propertyId);
            if (vendorId) await assertAssignableVendor(actor, vendorId, tx);
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            assignedUserId = null; vendorId = null;
          }
          const items = (plan.checklistJson as string[]).map((item) => ({ item, done: false }));
          wo = await createWorkOrderTx(tx, actor, {
            kind: "preventive", pmPlanId: id, pmDueDate: step.occurrence, dueAt: step.occurrence,
            propertyId: plan.asset.propertyId, unitId: plan.asset.unitId, assetId: plan.assetId,
            category: CATEGORY_FOR_ASSET[plan.asset.category] ?? "other", priority: plan.asset.criticality === "critical" ? "high" : "normal",
            scope: `Preventive maintenance: ${plan.planName} on ${plan.asset.assetRef} ${plan.asset.name}.${step.skipped ? ` Note: ${step.skipped} earlier occurrence(s) were missed and rolled into this visit.` : ""}`,
            assignedUserId, vendorId, checklist: items, currency: org.defaultCurrency,
          });
        }
        await tx.preventiveMaintenancePlan.update({ where: { id }, data: { nextDueAt: dateOnly(step.newNextDueAt), lastGeneratedAt: new Date() } });
        return { created: !exists, ref: wo!.workOrderRef, skipped: step.skipped };
      });
      if (r?.created) { created++; refs.push(r.ref); skippedOccurrences += r.skipped; }
    } catch (e) {
      failed++;
      log("error", "job.generate_pm.plan_failed", { planId: id, error: String(e) });
    }
  }
  return { plansScanned: plans.length, workOrdersCreated: created, occurrencesRolledOver: skippedOccurrences, plansFailed: failed, refs };
}

/** Manual "generate due work now" from the PM screen, limited to the caller's property scope. */
export async function generateDueNow(ctx: RequestContext) {
  requireStaff(ctx);
  requirePermission(ctx, "asset.manage");
  requirePermission(ctx, "work_order.assign");
  const r = await generatePreventiveWorkOrders(ctx, todayInTz(ctx.timezone), ctx.scopeAllProperties ? {} : { propertyIds: [...ctx.propertyIds] });
  await recordAudit(prisma, ctx, { action: "pm_plan.generated", entityType: "pm_plan", summary: `Generated ${r.workOrdersCreated} preventive work order(s)`, metadata: r });
  return r;
}
