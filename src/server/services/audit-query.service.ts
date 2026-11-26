import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { requirePermission, requireStaff } from "@/lib/auth/context";
import { isoDate, paged, paginationSchema } from "@/lib/validation/common";
import { addDays, dateOnly } from "@/lib/dates";

export const auditListSchema = paginationSchema.extend({
  action: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  actorUserId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export async function listAuditLogs(ctx: RequestContext, rawQ: z.input<typeof auditListSchema>) {
  const q = auditListSchema.parse(rawQ);
  requireStaff(ctx);
  requirePermission(ctx, "audit.read");
  const where: Prisma.AuditLogWhereInput = {
    organizationId: ctx.organizationId,
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lt: dateOnly(addDays(q.to, 1)) } : {}) } } : {}),
    ...(q.search ? { OR: [{ summary: { contains: q.search, mode: "insensitive" } }, { actorName: { contains: q.search, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  return paged(rows, total, q);
}
