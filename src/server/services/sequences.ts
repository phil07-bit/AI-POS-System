import type { Db } from "@/lib/db";

/**
 * Atomically allocate the next number in a per-organization sequence.
 * Uses INSERT … ON CONFLICT … RETURNING so concurrent transactions serialize on the row lock.
 */
export async function nextSequence(db: Db, organizationId: string, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO org_sequences (organization_id, key, value) VALUES (${organizationId}::uuid, ${key}, 1)
    ON CONFLICT (organization_id, key) DO UPDATE SET value = org_sequences.value + 1
    RETURNING value`;
  return rows[0].value;
}

export async function nextRef(db: Db, organizationId: string, prefix: string, opts: { year?: boolean; pad?: number } = {}): Promise<string> {
  const year = opts.year ? new Date().getUTCFullYear() : null;
  const key = year ? `${prefix}-${year}` : prefix;
  const n = await nextSequence(db, organizationId, key);
  const num = String(n).padStart(opts.pad ?? 5, "0");
  return year ? `${prefix}-${year}-${num}` : `${prefix}-${num}`;
}
