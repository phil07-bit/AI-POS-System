import type { Db } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { Prisma } from "@prisma/client";

const REDACT_KEYS = new Set([
  "passwordHash", "password", "tokenHash", "token", "identificationRefEncrypted", "identificationReference",
  "emergencyContactJson", "employmentInfo",
]);

/** Remove secrets/sensitive identifiers before anything is written to the audit trail. */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k)) out[k] = v == null ? v : "[REDACTED]";
      else if (v instanceof Prisma.Decimal) out[k] = v.toString();
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

type ActorCtx = Pick<RequestContext, "organizationId" | "userId" | "userName" | "requestId"> & { isDemoOrg?: boolean };

export async function recordAudit(db: Db, ctx: ActorCtx, input: AuditInput) {
  await db.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      actorName: ctx.userName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      beforeJson: (redact(input.before) ?? undefined) as Prisma.InputJsonValue | undefined,
      afterJson: (redact(input.after) ?? undefined) as Prisma.InputJsonValue | undefined,
      metadataJson: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      requestId: ctx.requestId,
      isDemo: ctx.isDemoOrg ?? false,
    },
  });
}
