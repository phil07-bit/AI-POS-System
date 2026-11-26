/**
 * Pure facilities rules (spec §4.7–4.9): request and work-order state machines, how a work order's
 * progress drives its request, derived costs, service-due status and preventive-maintenance scheduling.
 * No database access here, so every rule is unit-testable.
 */
import { addDays, diffDays, type ISODate } from "@/lib/dates";

export const MAINTENANCE_CATEGORIES = ["plumbing", "electrical", "structural", "hvac", "cleaning", "security", "pest_control", "appliance", "grounds", "other"] as const;
export const PRIORITIES = ["low", "normal", "high", "emergency"] as const;
export const REQUEST_STATUSES = ["submitted", "triaged", "approved", "assigned", "in_progress", "waiting_for_parts", "completed", "closed", "rejected", "cancelled"] as const;
export const WORK_ORDER_STATUSES = ["open", "assigned", "in_progress", "waiting_for_parts", "completed", "closed", "cancelled"] as const;
export const ASSET_CATEGORIES = ["generator", "water_pump", "borehole", "lift", "air_conditioner", "fire_equipment", "water_system", "security_system", "electrical", "solar", "appliance", "other"] as const;
export const VENDOR_STATUSES = ["active", "inactive", "suspended"] as const;

export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Default response targets in days by priority, used when a manager does not set a target date. */
export const TARGET_DAYS: Record<Priority, number> = { emergency: 1, high: 3, normal: 7, low: 14 };

export function defaultTargetDate(priority: Priority, submittedOn: ISODate): ISODate {
  return addDays(submittedOn, TARGET_DAYS[priority]);
}

// ── Request workflow ───────────────────────────────────────────────────────

/** Statuses from which a manager action is still possible. */
export const OPEN_REQUEST_STATUSES: RequestStatus[] = ["submitted", "triaged", "approved", "assigned", "in_progress", "waiting_for_parts"];
export const TERMINAL_REQUEST_STATUSES: RequestStatus[] = ["closed", "rejected", "cancelled"];

const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  submitted: ["triaged", "approved", "rejected", "cancelled"],
  triaged: ["triaged", "approved", "rejected", "cancelled"],
  approved: ["assigned", "in_progress", "waiting_for_parts", "completed", "cancelled"],
  assigned: ["approved", "assigned", "in_progress", "waiting_for_parts", "completed", "cancelled"],
  in_progress: ["approved", "assigned", "in_progress", "waiting_for_parts", "completed", "cancelled"],
  waiting_for_parts: ["approved", "assigned", "in_progress", "waiting_for_parts", "completed", "cancelled"],
  completed: ["closed", "approved", "in_progress", "assigned"], // reopen when work order goes back to rework
  closed: [],
  rejected: [],
  cancelled: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Work-order workflow ────────────────────────────────────────────────────

const WO_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  open: ["assigned", "in_progress", "cancelled"],
  assigned: ["open", "assigned", "in_progress", "cancelled"],
  in_progress: ["waiting_for_parts", "completed", "cancelled"],
  waiting_for_parts: ["in_progress", "completed", "cancelled"],
  completed: ["closed", "in_progress"], // close = manager sign-off; in_progress = returned for rework
  closed: [],
  cancelled: [],
};

export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WO_TRANSITIONS[from]?.includes(to) ?? false;
}

export const OPEN_WORK_ORDER_STATUSES: WorkOrderStatus[] = ["open", "assigned", "in_progress", "waiting_for_parts"];
export const DONE_WORK_ORDER_STATUSES: WorkOrderStatus[] = ["completed", "closed"];

/** A work order is overdue when it is still open after its due date. */
export function isWorkOrderOverdue(wo: { status: string; dueAt: ISODate | null }, today: ISODate): boolean {
  return !!wo.dueAt && (OPEN_WORK_ORDER_STATUSES as string[]).includes(wo.status) && wo.dueAt < today;
}

/**
 * Request status implied by its (non-cancelled) work orders. The least-advanced open work order wins,
 * so a request is only "completed" when every linked work order is done.
 * Returns null when the request has no work orders (it keeps its own status); when every work order
 * was cancelled the request falls back to "approved" so a new work order can be raised.
 */
export function requestStatusFromWorkOrders(statuses: string[]): RequestStatus | null {
  if (statuses.length === 0) return null;
  const live = statuses.filter((s) => s !== "cancelled");
  if (live.length === 0) return "approved";
  const order: [WorkOrderStatus, RequestStatus][] = [
    ["open", "approved"], ["assigned", "assigned"], ["waiting_for_parts", "waiting_for_parts"], ["in_progress", "in_progress"],
  ];
  for (const [wo, req] of order) if (live.includes(wo)) return req;
  return "completed"; // all completed or closed
}

// ── Costs ─────────────────────────────────────────────────────────────────

export interface CostParts { labourCostMinor: number; materialsCostMinor: number; vendorCostMinor: number; otherCostMinor: number }

export function totalCost(c: CostParts): number {
  return c.labourCostMinor + c.materialsCostMinor + c.vendorCostMinor + c.otherCostMinor;
}

// ── Assets & preventive maintenance ───────────────────────────────────────

/** Next service date from the last service (or install date if never serviced) plus the interval. */
export function computeNextServiceDate(a: { serviceIntervalDays: number | null; lastServicedAt: ISODate | null; installedAt: ISODate | null }): ISODate | null {
  if (!a.serviceIntervalDays) return null;
  const base = a.lastServicedAt ?? a.installedAt;
  return base ? addDays(base, a.serviceIntervalDays) : null;
}

export type ServiceStatus = "overdue" | "due_soon" | "ok" | "not_scheduled";
export const DUE_SOON_DAYS = 14;

export function serviceStatus(nextDue: ISODate | null, today: ISODate, dueSoonDays = DUE_SOON_DAYS): ServiceStatus {
  if (!nextDue) return "not_scheduled";
  if (nextDue < today) return "overdue";
  if (diffDays(today, nextDue) <= dueSoonDays) return "due_soon";
  return "ok";
}

export function warrantyActive(warrantyExpiresAt: ISODate | null, today: ISODate): boolean {
  return !!warrantyExpiresAt && warrantyExpiresAt >= today;
}

/**
 * Preventive-maintenance generation step for one plan.
 * A work order is generated for the occurrence `nextDueAt` once today ≥ nextDueAt − leadDays.
 * The plan then advances by whole intervals until its next occurrence is in the future, so a
 * long-overdue plan produces ONE catch-up work order instead of a backlog of duplicates.
 * `skipped` counts the occurrences that were rolled over without their own work order.
 */
export function planGenerationStep(plan: { nextDueAt: ISODate; intervalDays: number; leadDays: number }, today: ISODate):
  { generate: false } | { generate: true; occurrence: ISODate; newNextDueAt: ISODate; skipped: number } {
  if (plan.intervalDays < 1) throw new Error("intervalDays must be ≥ 1");
  if (addDays(plan.nextDueAt, -plan.leadDays) > today) return { generate: false };
  let next = addDays(plan.nextDueAt, plan.intervalDays);
  let skipped = 0;
  while (next <= today) { next = addDays(next, plan.intervalDays); skipped++; }
  return { generate: true, occurrence: plan.nextDueAt, newNextDueAt: next, skipped };
}

// ── Repeat faults ─────────────────────────────────────────────────────────

export const REPEAT_WINDOW_DAYS = 90;
export const REPEAT_THRESHOLD = 3;

/**
 * Flag repeat repairs: ≥ threshold reactive work orders on the same target (asset, or unit when no asset)
 * and category within the window ending today. Returns one row per flagged group.
 */
export function findRepeatRepairs<T extends { id: string; assetId: string | null; unitId: string | null; propertyId: string; category: string; createdOn: ISODate }>(
  rows: T[], today: ISODate, windowDays = REPEAT_WINDOW_DAYS, threshold = REPEAT_THRESHOLD,
) {
  const from = addDays(today, -windowDays);
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (r.createdOn < from || r.createdOn > today) continue;
    const target = r.assetId ? `asset:${r.assetId}` : r.unitId ? `unit:${r.unitId}` : null;
    if (!target) continue;
    const key = `${target}|${r.category}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .filter(([, v]) => v.length >= threshold)
    .map(([key, v]) => {
      const [target, category] = key.split("|");
      const [type, id] = target.split(":");
      return { targetType: type as "asset" | "unit", targetId: id, propertyId: v[0].propertyId, category, count: v.length, workOrderIds: v.map((x) => x.id) };
    })
    .sort((a, b) => b.count - a.count);
}
