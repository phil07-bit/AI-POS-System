import { prisma } from "@/lib/db";
import { loadContext, type RequestContext } from "@/lib/auth/context";
import { syncSystemRoles } from "@/server/services/rbac-seed";
import { hashPassword } from "@/lib/auth/password";
import { randomUUID } from "node:crypto";

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE bypasses the append-only DELETE triggers (test-only).
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await syncSystemRoles(prisma);
}

let n = 0;
export async function makeOrg(name: string, opts: { paymentsRequireConfirmation?: boolean } = {}) {
  n++;
  return prisma.organization.create({ data: { name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${n}-${randomUUID().slice(0, 6)}`, addressJson: { country: "GH" }, paymentsRequireConfirmation: opts.paymentsRequireConfirmation ?? true } });
}

export async function makeMember(orgId: string, roleKey: string, opts: { propertyIds?: string[]; tenantId?: string; email?: string } = {}) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await prisma.user.create({ data: { fullName: `${roleKey} user`, email: opts.email ?? `${roleKey}-${randomUUID().slice(0, 8)}@example.test`, passwordHash: await hashPassword("Password123!") } });
  await prisma.organizationMembership.create({
    data: {
      organizationId: orgId, userId: user.id, roleId: role.id, tenantId: opts.tenantId ?? null,
      scopeAllProperties: !opts.propertyIds && !opts.tenantId,
      propertyScopes: opts.propertyIds ? { create: opts.propertyIds.map((propertyId) => ({ propertyId })) } : undefined,
    },
  });
  return ctxFor(user.id, orgId);
}

export function ctxFor(userId: string, orgId: string): Promise<RequestContext> {
  return loadContext(userId, orgId, `test-${randomUUID().slice(0, 8)}`);
}

export const address = { country: "GH", region: "Greater Accra", district: "La-Nkwantanang-Madina", community: "East Legon", landmark: "Near A&C Mall", digitalAddress: "GA-123-4567", notes: "" };
