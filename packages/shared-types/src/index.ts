/**
 * Opaque identifiers keep restaurant and branch scopes distinct across clients
 * without defining persistence models, domain entities, or transport DTOs.
 */
declare const restaurantIdBrand: unique symbol;
declare const branchIdBrand: unique symbol;

/**
 * Runtime scope contracts are deliberately versioned independently from any
 * transport or persistence model. Increment this only for a breaking shape
 * change and provide a separate parser for the previous version when needed.
 */
export const SCOPE_SCHEMA_VERSION = 1 as const;
export const BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION = 1 as const;
export const RBAC_MATRIX_VERSION = 1 as const;
export const DINING_ZONE_SCHEMA_VERSION = 1 as const;
export const DINING_LAYOUT_SCHEMA_VERSION = 1 as const;

export const MEMBERSHIP_ROLE_CODES = Object.freeze([
  "owner",
  "admin",
  "manager",
  "supervisor",
  "cashier",
  "waiter",
  "kitchen",
  "viewer",
  "auditor",
] as const);

export type MembershipRoleCode = (typeof MEMBERSHIP_ROLE_CODES)[number];

export const RBAC_PERMISSION_CODES = Object.freeze([
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
] as const);

export type RbacPermissionCode = (typeof RBAC_PERMISSION_CODES)[number];

export function parseRbacPermissionCode(value: unknown): RbacPermissionCode | undefined {
  return typeof value === "string" && (RBAC_PERMISSION_CODES as readonly string[]).includes(value)
    ? value as RbacPermissionCode
    : undefined;
}

export type RestaurantId = string & {
  readonly [restaurantIdBrand]: "RestaurantId";
};

export type BranchId = string & {
  readonly [branchIdBrand]: "BranchId";
};

/** The minimum tenant scope required by shared clients and server contracts. */
export interface RestaurantScope {
  readonly restaurantId: RestaurantId;
}

/** A restaurant scope narrowed to one operating branch. */
export interface BranchScope extends RestaurantScope {
  readonly branchId: BranchId;
}

export interface BranchMembershipSummaryV1 {
  readonly branchName: string;
  readonly restaurantName: string;
  readonly roles: readonly MembershipRoleCode[];
  readonly scope: BranchScope;
}

export interface BranchMembershipListV1 {
  readonly memberships: readonly BranchMembershipSummaryV1[];
  readonly schemaVersion: typeof BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION;
}

export interface CreateDiningZoneCommandV1 {
  readonly deviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly name: string;
  readonly occurredAt: string;
  readonly schemaVersion: typeof DINING_ZONE_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly zoneId: string;
}

export interface DiningZoneV1 {
  readonly createdAt: string;
  readonly createdBy: string;
  readonly name: string;
  readonly replayed: boolean;
  readonly schemaVersion: typeof DINING_ZONE_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly version: number;
  readonly zoneId: string;
}

export const DINING_TABLE_SHAPES = Object.freeze(["round", "square", "rectangle"] as const);
export type DiningTableShape = (typeof DINING_TABLE_SHAPES)[number];

export interface DiningTableGeometryV1 {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface DiningTableV1 {
  readonly capacity: number;
  readonly layout: DiningTableGeometryV1;
  readonly name: string;
  readonly replayed: boolean;
  readonly schemaVersion: typeof DINING_LAYOUT_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly shape: DiningTableShape;
  readonly tableId: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly version: number;
  readonly zoneId: string;
}

export interface DiningLayoutZoneV1 {
  readonly name: string;
  readonly tables: readonly DiningTableV1[];
  readonly version: number;
  readonly zoneId: string;
}

export interface DiningLayoutV1 {
  readonly schemaVersion: typeof DINING_LAYOUT_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly zones: readonly DiningLayoutZoneV1[];
}

interface DiningTableMutationCommandV1 {
  readonly deviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly schemaVersion: typeof DINING_LAYOUT_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly tableId: string;
}

export interface CreateDiningTableCommandV1 extends DiningTableMutationCommandV1 {
  readonly capacity: number;
  readonly layout: DiningTableGeometryV1;
  readonly name: string;
  readonly shape: DiningTableShape;
  readonly zoneId: string;
}

export interface UpdateDiningTableLayoutCommandV1 extends DiningTableMutationCommandV1 {
  readonly expectedVersion: number;
  readonly layout: DiningTableGeometryV1;
}

export function parseCreateDiningZoneCommandV1(value: unknown): CreateDiningZoneCommandV1 | undefined {
  const record = parseExactPlainRecord(value, [
    "schemaVersion",
    "scope",
    "zoneId",
    "eventId",
    "idempotencyKey",
    "deviceId",
    "occurredAt",
    "name",
  ]);
  if (record === undefined || ownValue(record, "schemaVersion") !== DINING_ZONE_SCHEMA_VERSION) return undefined;
  const scope = parseUuidBranchScope(ownValue(record, "scope"));
  const zoneId = parseUuid(ownValue(record, "zoneId"));
  const eventId = parseUuid(ownValue(record, "eventId"));
  const idempotencyKey = parseUuid(ownValue(record, "idempotencyKey"));
  const deviceId = parseUuid(ownValue(record, "deviceId"));
  const occurredAt = parseCanonicalTimestamp(ownValue(record, "occurredAt"));
  const name = parseDisplayName(ownValue(record, "name"), 80);
  if (
    scope === undefined
    || zoneId === undefined
    || eventId === undefined
    || idempotencyKey === undefined
    || deviceId === undefined
    || occurredAt === undefined
    || name === undefined
  ) return undefined;
  return Object.freeze({
    deviceId,
    eventId,
    idempotencyKey,
    name,
    occurredAt,
    schemaVersion: DINING_ZONE_SCHEMA_VERSION,
    scope,
    zoneId,
  });
}

export function parseDiningZoneV1(value: unknown): DiningZoneV1 | undefined {
  const record = parseExactPlainRecord(value, [
    "schemaVersion",
    "scope",
    "zoneId",
    "name",
    "version",
    "createdAt",
    "createdBy",
    "replayed",
  ]);
  if (record === undefined || ownValue(record, "schemaVersion") !== DINING_ZONE_SCHEMA_VERSION) return undefined;
  const scope = parseUuidBranchScope(ownValue(record, "scope"));
  const zoneId = parseUuid(ownValue(record, "zoneId"));
  const name = parseDisplayName(ownValue(record, "name"), 80);
  const version = ownValue(record, "version");
  const createdAt = parseCanonicalTimestamp(ownValue(record, "createdAt"));
  const createdBy = parseUuid(ownValue(record, "createdBy"));
  const replayed = ownValue(record, "replayed");
  if (
    scope === undefined
    || zoneId === undefined
    || name === undefined
    || typeof version !== "number"
    || !Number.isSafeInteger(version)
    || version < 1
    || createdAt === undefined
    || createdBy === undefined
    || typeof replayed !== "boolean"
  ) return undefined;
  return Object.freeze({
    createdAt,
    createdBy,
    name,
    replayed,
    schemaVersion: DINING_ZONE_SCHEMA_VERSION,
    scope,
    version,
    zoneId,
  });
}

export function parseCreateDiningTableCommandV1(value: unknown): CreateDiningTableCommandV1 | undefined {
  const record = parseExactPlainRecord(value, [
    "schemaVersion", "scope", "tableId", "zoneId", "eventId", "idempotencyKey", "deviceId",
    "occurredAt", "name", "capacity", "shape", "layout",
  ]);
  if (record === undefined || ownValue(record, "schemaVersion") !== DINING_LAYOUT_SCHEMA_VERSION) return undefined;
  const common = parseDiningTableMutation(record);
  const zoneId = parseUuid(ownValue(record, "zoneId"));
  const name = parseDisplayName(ownValue(record, "name"), 40);
  const capacity = parseBoundedInteger(ownValue(record, "capacity"), 1, 50);
  const shape = parseDiningTableShape(ownValue(record, "shape"));
  const layout = parseDiningTableGeometryV1(ownValue(record, "layout"));
  if (common === undefined || zoneId === undefined || name === undefined || capacity === undefined || shape === undefined || layout === undefined) return undefined;
  return Object.freeze({ ...common, capacity, layout, name, shape, zoneId });
}

export function parseUpdateDiningTableLayoutCommandV1(value: unknown): UpdateDiningTableLayoutCommandV1 | undefined {
  const record = parseExactPlainRecord(value, [
    "schemaVersion", "scope", "tableId", "eventId", "idempotencyKey", "deviceId", "occurredAt",
    "expectedVersion", "layout",
  ]);
  if (record === undefined || ownValue(record, "schemaVersion") !== DINING_LAYOUT_SCHEMA_VERSION) return undefined;
  const common = parseDiningTableMutation(record);
  const expectedVersion = parseBoundedInteger(ownValue(record, "expectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const layout = parseDiningTableGeometryV1(ownValue(record, "layout"));
  if (common === undefined || expectedVersion === undefined || layout === undefined) return undefined;
  return Object.freeze({ ...common, expectedVersion, layout });
}

export function parseDiningTableV1(value: unknown): DiningTableV1 | undefined {
  const record = parseExactPlainRecord(value, [
    "schemaVersion", "scope", "tableId", "zoneId", "name", "capacity", "shape", "layout",
    "version", "updatedAt", "updatedBy", "replayed",
  ]);
  if (record === undefined || ownValue(record, "schemaVersion") !== DINING_LAYOUT_SCHEMA_VERSION) return undefined;
  const scope = parseUuidBranchScope(ownValue(record, "scope"));
  const tableId = parseUuid(ownValue(record, "tableId"));
  const zoneId = parseUuid(ownValue(record, "zoneId"));
  const name = parseDisplayName(ownValue(record, "name"), 40);
  const capacity = parseBoundedInteger(ownValue(record, "capacity"), 1, 50);
  const shape = parseDiningTableShape(ownValue(record, "shape"));
  const layout = parseDiningTableGeometryV1(ownValue(record, "layout"));
  const version = parseBoundedInteger(ownValue(record, "version"), 1, Number.MAX_SAFE_INTEGER);
  const updatedAt = parseCanonicalTimestamp(ownValue(record, "updatedAt"));
  const updatedBy = parseUuid(ownValue(record, "updatedBy"));
  const replayed = ownValue(record, "replayed");
  if (scope === undefined || tableId === undefined || zoneId === undefined || name === undefined || capacity === undefined || shape === undefined || layout === undefined || version === undefined || updatedAt === undefined || updatedBy === undefined || typeof replayed !== "boolean") return undefined;
  return Object.freeze({ capacity, layout, name, replayed, schemaVersion: DINING_LAYOUT_SCHEMA_VERSION, scope, shape, tableId, updatedAt, updatedBy, version, zoneId });
}

export function parseDiningLayoutV1(value: unknown): DiningLayoutV1 | undefined {
  const record = parseExactPlainRecord(value, ["schemaVersion", "scope", "zones"]);
  if (record === undefined || ownValue(record, "schemaVersion") !== DINING_LAYOUT_SCHEMA_VERSION) return undefined;
  const scope = parseUuidBranchScope(ownValue(record, "scope"));
  const rawZones = parseExactArray(ownValue(record, "zones"), 100);
  if (scope === undefined || rawZones === undefined) return undefined;
  const zones: DiningLayoutZoneV1[] = [];
  let previousZoneId: string | undefined;
  for (const rawZone of rawZones) {
    const zoneRecord = parseExactPlainRecord(rawZone, ["zoneId", "name", "version", "tables"]);
    if (zoneRecord === undefined) return undefined;
    const zoneId = parseUuid(ownValue(zoneRecord, "zoneId"));
    const name = parseDisplayName(ownValue(zoneRecord, "name"), 80);
    const version = parseBoundedInteger(ownValue(zoneRecord, "version"), 1, Number.MAX_SAFE_INTEGER);
    const rawTables = parseExactArray(ownValue(zoneRecord, "tables"), 500);
    if (zoneId === undefined || name === undefined || version === undefined || rawTables === undefined || (previousZoneId !== undefined && compareCodeUnits(previousZoneId, zoneId) >= 0)) return undefined;
    previousZoneId = zoneId;
    const tables: DiningTableV1[] = [];
    let previousTableId: string | undefined;
    for (const rawTable of rawTables) {
      const table = parseDiningTableV1(rawTable);
      if (table === undefined || table.zoneId !== zoneId || table.scope.restaurantId !== scope.restaurantId || table.scope.branchId !== scope.branchId || (previousTableId !== undefined && compareCodeUnits(previousTableId, table.tableId) >= 0)) return undefined;
      previousTableId = table.tableId;
      tables.push(table);
    }
    zones.push(Object.freeze({ name, tables: Object.freeze(tables), version, zoneId }));
  }
  return Object.freeze({ schemaVersion: DINING_LAYOUT_SCHEMA_VERSION, scope, zones: Object.freeze(zones) });
}

/**
 * Parses the exact minimum restaurant scope shape. Invalid input is rejected
 * with `undefined`; callers must not fall back to an implicit tenant scope.
 */
export function parseRestaurantScope(value: unknown): RestaurantScope | undefined {
  const record = parseExactPlainRecord(value, ["restaurantId"]);
  if (record === undefined) return undefined;

  const restaurantId = parseNonEmptyId(record, "restaurantId");
  if (restaurantId === undefined) return undefined;

  return Object.freeze({ restaurantId: restaurantId as RestaurantId });
}

/**
 * Parses the exact minimum restaurant-and-branch scope shape. Invalid input
 * is rejected with `undefined`; callers must not widen it to a restaurant.
 */
export function parseBranchScope(value: unknown): BranchScope | undefined {
  const record = parseExactPlainRecord(value, ["restaurantId", "branchId"]);
  if (record === undefined) return undefined;

  const restaurantId = parseNonEmptyId(record, "restaurantId");
  const branchId = parseNonEmptyId(record, "branchId");
  if (restaurantId === undefined || branchId === undefined) return undefined;

  return Object.freeze({
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
  });
}

/** Parses the exact, ordered membership directory response returned by Nest. */
export function parseBranchMembershipListV1(value: unknown): BranchMembershipListV1 | undefined {
  const record = parseExactPlainRecord(value, ["schemaVersion", "memberships"]);
  if (record === undefined || ownValue(record, "schemaVersion") !== BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION) {
    return undefined;
  }

  const rawMemberships = parseExactArray(ownValue(record, "memberships"), 500);
  if (rawMemberships === undefined) return undefined;

  const memberships: BranchMembershipSummaryV1[] = [];
  let previousKey: string | undefined;
  for (const rawMembership of rawMemberships) {
    const membership = parseBranchMembershipSummary(rawMembership);
    if (membership === undefined) return undefined;
    const key = `${membership.scope.restaurantId}\u0000${membership.scope.branchId}`;
    if (previousKey !== undefined && compareCodeUnits(previousKey, key) >= 0) return undefined;
    previousKey = key;
    memberships.push(membership);
  }

  return Object.freeze({
    memberships: Object.freeze(memberships),
    schemaVersion: BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  });
}

type PlainRecord = Record<string, unknown>;

function parseExactPlainRecord(value: unknown, expectedKeys: readonly string[]): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) return undefined;

    for (const expectedKey of expectedKeys) {
      if (!ownKeys.includes(expectedKey)) return undefined;

      const descriptor = Object.getOwnPropertyDescriptor(value, expectedKey);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }

    return value as PlainRecord;
  } catch {
    // Proxy traps and hostile objects must not make scope validation permissive.
    return undefined;
  }
}

function parseNonEmptyId(record: PlainRecord, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) return undefined;

  const value = descriptor.value;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseBranchMembershipSummary(value: unknown): BranchMembershipSummaryV1 | undefined {
  const record = parseExactPlainRecord(value, ["scope", "restaurantName", "branchName", "roles"]);
  if (record === undefined) return undefined;
  const scope = parseBranchScope(ownValue(record, "scope"));
  const restaurantName = parseDisplayName(ownValue(record, "restaurantName"));
  const branchName = parseDisplayName(ownValue(record, "branchName"));
  const rawRoles = parseExactArray(ownValue(record, "roles"), MEMBERSHIP_ROLE_CODES.length);
  if (
    scope === undefined
    || !uuidPattern.test(scope.restaurantId)
    || !uuidPattern.test(scope.branchId)
    || restaurantName === undefined
    || branchName === undefined
    || rawRoles === undefined
    || rawRoles.length === 0
  ) return undefined;

  const roles: MembershipRoleCode[] = [];
  let previousRole: string | undefined;
  for (const rawRole of rawRoles) {
    if (typeof rawRole !== "string" || !(MEMBERSHIP_ROLE_CODES as readonly string[]).includes(rawRole)) return undefined;
    if (previousRole !== undefined && compareCodeUnits(previousRole, rawRole) >= 0) return undefined;
    previousRole = rawRole;
    roles.push(rawRole as MembershipRoleCode);
  }

  return Object.freeze({ branchName, restaurantName, roles: Object.freeze(roles), scope });
}

function parseExactArray(value: unknown, maximumLength: number): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > maximumLength) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return undefined;
  }
}

function ownValue(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function parseDisplayName(value: unknown, maximumLength = 120): string | undefined {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

function parseUuidBranchScope(value: unknown): BranchScope | undefined {
  const scope = parseBranchScope(value);
  return scope !== undefined && uuidPattern.test(scope.restaurantId) && uuidPattern.test(scope.branchId)
    ? scope
    : undefined;
}

function parseUuid(value: unknown): string | undefined {
  return typeof value === "string" && uuidPattern.test(value) ? value.toLowerCase() : undefined;
}

function parseCanonicalTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length !== 24) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : undefined;
}

function parseDiningTableMutation(record: PlainRecord): DiningTableMutationCommandV1 | undefined {
  const scope = parseUuidBranchScope(ownValue(record, "scope"));
  const tableId = parseUuid(ownValue(record, "tableId"));
  const eventId = parseUuid(ownValue(record, "eventId"));
  const idempotencyKey = parseUuid(ownValue(record, "idempotencyKey"));
  const deviceId = parseUuid(ownValue(record, "deviceId"));
  const occurredAt = parseCanonicalTimestamp(ownValue(record, "occurredAt"));
  if (scope === undefined || tableId === undefined || eventId === undefined || idempotencyKey === undefined || deviceId === undefined || occurredAt === undefined) return undefined;
  return Object.freeze({ deviceId, eventId, idempotencyKey, occurredAt, schemaVersion: DINING_LAYOUT_SCHEMA_VERSION, scope, tableId });
}

function parseDiningTableShape(value: unknown): DiningTableShape | undefined {
  return typeof value === "string" && (DINING_TABLE_SHAPES as readonly string[]).includes(value)
    ? value as DiningTableShape
    : undefined;
}

function parseDiningTableGeometryV1(value: unknown): DiningTableGeometryV1 | undefined {
  const record = parseExactPlainRecord(value, ["x", "y", "width", "height"]);
  if (record === undefined) return undefined;
  const x = parseBoundedInteger(ownValue(record, "x"), 0, 23);
  const y = parseBoundedInteger(ownValue(record, "y"), 0, 99);
  const width = parseBoundedInteger(ownValue(record, "width"), 2, 8);
  const height = parseBoundedInteger(ownValue(record, "height"), 2, 8);
  if (x === undefined || y === undefined || width === undefined || height === undefined || x + width > 24 || y + height > 100) return undefined;
  return Object.freeze({ height, width, x, y });
}

function parseBoundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
