import { rolesGrantPermission } from "@super-restaurant/shared-types";

/**
 * Purchasing UI access helpers backed by the single RBAC matrix in
 * `@super-restaurant/shared-types` so the web never duplicates role lists.
 */
export function canReadPurchases(roles: unknown): boolean {
  return rolesGrantPermission(roles, "catalog.read");
}

export function canManagePurchases(roles: unknown): boolean {
  return rolesGrantPermission(roles, "catalog.manage");
}
