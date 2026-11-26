import type { Db } from "@/lib/db";
import { PERMISSIONS, ROLE_DEFINITIONS } from "@/lib/permissions";

/** Idempotently upsert system permissions, roles and role→permission links. */
export async function syncSystemRoles(db: Db) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const perms = await db.permission.findMany();
  const byKey = new Map(perms.map((p) => [p.key, p.id]));
  for (const def of ROLE_DEFINITIONS) {
    const role = await db.role.upsert({
      where: { key: def.key },
      update: { name: def.name, description: def.description, rank: def.rank },
      create: { key: def.key, name: def.name, description: def.description, rank: def.rank, isSystem: true },
    });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: def.permissions.map((k) => ({ roleId: role.id, permissionId: byKey.get(k)! })),
    });
  }
}
