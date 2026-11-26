import type { PermissionKey } from "./keys";

/** Minimal shape needed to evaluate access; produced by the auth context loader. */
export interface AccessSubject {
  permissions: ReadonlySet<string>;
  scopeAllProperties: boolean;
  propertyIds: ReadonlySet<string>;
  tenantId: string | null; // set for tenant-portal users
}

export function hasPermission(subject: AccessSubject, key: PermissionKey): boolean {
  return subject.permissions.has(key);
}

export function hasAnyPermission(subject: AccessSubject, keys: PermissionKey[]): boolean {
  return keys.some((k) => subject.permissions.has(k));
}

export function canAccessProperty(subject: AccessSubject, propertyId: string): boolean {
  return subject.scopeAllProperties || subject.propertyIds.has(propertyId);
}

/**
 * Prisma `where` fragment restricting a property-linked model to the subject's scope.
 * Returns {} when the subject has organization-wide scope.
 */
export function propertyScopeFilter(subject: AccessSubject, field = "propertyId"): Record<string, unknown> {
  if (subject.scopeAllProperties) return {};
  return { [field]: { in: [...subject.propertyIds] } };
}
