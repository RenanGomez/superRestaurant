import {
  MEMBERSHIP_ROLE_CODES,
  parseRbacPermissionCode,
  RBAC_MATRIX_VERSION,
  type MembershipRoleCode,
  type RbacPermissionCode,
} from "@super-restaurant/shared-types";

const allPermissions = Object.freeze([
  "branch.select",
  "branch.settings.manage",
  "memberships.manage",
  "catalog.read",
  "catalog.manage",
  "tables.read",
  "tables.manage",
  "orders.read",
  "orders.create",
  "orders.update",
  "orders.cancel.pending",
  "orders.cancel.sent",
  "kds.read",
  "kds.transition",
  "payments.collect",
  "refunds.create",
  "cash-register.manage",
  "reports.read",
] satisfies readonly RbacPermissionCode[]);

const managerPermissions = without(allPermissions, "memberships.manage");
const supervisorPermissions = permissions(
  "branch.select",
  "catalog.read",
  "tables.read",
  "orders.read",
  "orders.create",
  "orders.update",
  "orders.cancel.pending",
  "orders.cancel.sent",
  "kds.read",
  "kds.transition",
  "payments.collect",
  "refunds.create",
  "cash-register.manage",
  "reports.read",
);

export const RBAC_ROLE_PERMISSIONS_V1 = Object.freeze({
  owner: allPermissions,
  admin: allPermissions,
  manager: managerPermissions,
  supervisor: supervisorPermissions,
  cashier: permissions(
    "branch.select",
    "catalog.read",
    "tables.read",
    "orders.read",
    "orders.create",
    "orders.update",
    "orders.cancel.pending",
    "payments.collect",
    "cash-register.manage",
  ),
  waiter: permissions(
    "branch.select",
    "catalog.read",
    "tables.read",
    "orders.read",
    "orders.create",
    "orders.update",
    "orders.cancel.pending",
    "kds.read",
  ),
  kitchen: permissions("branch.select", "orders.read", "kds.read", "kds.transition"),
  viewer: permissions("branch.select", "catalog.read", "tables.read", "orders.read", "kds.read", "reports.read"),
  auditor: permissions("branch.select", "catalog.read", "tables.read", "orders.read", "kds.read", "reports.read"),
} satisfies Readonly<Record<MembershipRoleCode, readonly RbacPermissionCode[]>>);

export const rbacMatrixVersion = RBAC_MATRIX_VERSION;

export function rolesGrantPermission(roles: unknown, permission: unknown): boolean {
  const parsedPermission = parseRbacPermissionCode(permission);
  const parsedRoles = parseRoles(roles);
  if (parsedPermission === undefined || parsedRoles === undefined) return false;
  return parsedRoles.some((role) => RBAC_ROLE_PERMISSIONS_V1[role].includes(parsedPermission));
}

function permissions(...values: readonly RbacPermissionCode[]): readonly RbacPermissionCode[] {
  return Object.freeze([...values]);
}

function without(
  values: readonly RbacPermissionCode[],
  omitted: RbacPermissionCode,
): readonly RbacPermissionCode[] {
  return Object.freeze(values.filter((value) => value !== omitted));
}

function parseRoles(value: unknown): readonly MembershipRoleCode[] | undefined {
  try {
    if (!Array.isArray(value) || value.length === 0 || value.length > MEMBERSHIP_ROLE_CODES.length) return undefined;
    const parsed: MembershipRoleCode[] = [];
    for (const role of value as readonly unknown[]) {
      if (
        typeof role !== "string"
        || !(MEMBERSHIP_ROLE_CODES as readonly string[]).includes(role)
        || parsed.includes(role as MembershipRoleCode)
      ) return undefined;
      parsed.push(role as MembershipRoleCode);
    }
    return Object.freeze(parsed);
  } catch {
    return undefined;
  }
}
