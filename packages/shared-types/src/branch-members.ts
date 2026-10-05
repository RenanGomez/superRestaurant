import { MEMBERSHIP_ROLE_CODES, type BranchScope, type MembershipRoleCode } from "./index.js";

export const BRANCH_MEMBERS_SCHEMA_VERSION = 1 as const;
const MAX_BRANCH_MEMBERS = 500;

/**
 * Lists the active members of one Branch, optionally narrowed to some roles (for example the couriers
 * to assign a delivery to, or the waiters to assign to a table). `roles: null` means every role.
 */
export interface BranchMembersRequestV1 {
  readonly roles: readonly MembershipRoleCode[] | null;
  readonly schemaVersion: typeof BRANCH_MEMBERS_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

/**
 * `displayName` comes from the identity provider profile (`full_name` or `name`) when it carries one;
 * the product has no own user profile table yet, so it is `null` otherwise. Email is never returned.
 */
export interface BranchMemberV1 {
  readonly displayName: string | null;
  readonly roles: readonly MembershipRoleCode[];
  readonly userId: string;
}

export interface BranchMembersV1 {
  readonly members: readonly BranchMemberV1[];
  readonly schemaVersion: typeof BRANCH_MEMBERS_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export function parseBranchMembersRequestV1(value: unknown): BranchMembersRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "roles"]);
  if (record === undefined || own(record, "schemaVersion") !== BRANCH_MEMBERS_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const rawRoles = own(record, "roles");
  const roles = rawRoles === null ? null : parseRoles(rawRoles);
  return scope === undefined || roles === undefined
    ? undefined
    : Object.freeze({ roles, schemaVersion: BRANCH_MEMBERS_SCHEMA_VERSION, scope });
}

export function parseBranchMembersV1(value: unknown): BranchMembersV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "members"]);
  if (record === undefined || own(record, "schemaVersion") !== BRANCH_MEMBERS_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const rawMembers = denseArray(own(record, "members"), MAX_BRANCH_MEMBERS);
  if (scope === undefined || rawMembers === undefined) return undefined;
  const members: BranchMemberV1[] = [];
  const seen = new Set<string>();
  for (const raw of rawMembers) {
    const entry = exactRecord(raw, ["userId", "displayName", "roles"]);
    if (entry === undefined) return undefined;
    const userId = uuid(own(entry, "userId"));
    const rawName = own(entry, "displayName");
    const displayName = rawName === null ? null : boundedText(rawName, 1, 120);
    const roles = parseRoles(own(entry, "roles"));
    if (userId === undefined || displayName === undefined || roles === undefined || seen.has(userId)) return undefined;
    seen.add(userId);
    members.push(Object.freeze({ displayName, roles, userId }));
  }
  return Object.freeze({ members: Object.freeze(members), schemaVersion: BRANCH_MEMBERS_SCHEMA_VERSION, scope });
}

function parseRoles(value: unknown): readonly MembershipRoleCode[] | undefined {
  const raw = denseArray(value, MEMBERSHIP_ROLE_CODES.length);
  if (raw === undefined || raw.length === 0) return undefined;
  const roles: MembershipRoleCode[] = [];
  for (const role of raw) {
    if (typeof role !== "string" || !(MEMBERSHIP_ROLE_CODES as readonly string[]).includes(role)
      || roles.includes(role as MembershipRoleCode)) return undefined;
    roles.push(role as MembershipRoleCode);
  }
  return Object.freeze(roles);
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined
    : Object.freeze({ restaurantId, branchId }) as BranchScope;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function denseArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || value.length > maximum) return undefined;
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result.push(descriptor.value);
    }
    return result;
  } catch { return undefined; }
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function boundedText(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
