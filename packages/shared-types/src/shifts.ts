export const OPERATIONAL_SHIFT_SCHEMA_VERSION = 1 as const;

export interface OperationalShiftScopeV1 {
  readonly branchId: string;
  readonly restaurantId: string;
}

export interface OperationalShiftSummaryV1 {
  readonly name: string;
  readonly openedAt: string;
  readonly openedBy: string;
  readonly schemaVersion: typeof OPERATIONAL_SHIFT_SCHEMA_VERSION;
  readonly scope: OperationalShiftScopeV1;
  readonly shiftId: string;
  readonly status: "open";
  readonly version: number;
}

export interface OperationalShiftListV1 {
  readonly schemaVersion: typeof OPERATIONAL_SHIFT_SCHEMA_VERSION;
  readonly scope: OperationalShiftScopeV1;
  readonly shifts: readonly OperationalShiftSummaryV1[];
}

export function parseOperationalShiftListV1(value: unknown): OperationalShiftListV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "shifts"]);
  if (record === undefined || own(record, "schemaVersion") !== OPERATIONAL_SHIFT_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const rawShifts = exactArray(own(record, "shifts"), 100);
  if (scope === undefined || rawShifts === undefined) return undefined;

  const shifts: OperationalShiftSummaryV1[] = [];
  const ids = new Set<string>();
  for (const raw of rawShifts) {
    const shift = parseOperationalShiftSummaryV1(raw);
    if (shift === undefined || !sameScope(scope, shift.scope) || ids.has(shift.shiftId)) return undefined;
    ids.add(shift.shiftId);
    shifts.push(shift);
  }
  return Object.freeze({ schemaVersion: OPERATIONAL_SHIFT_SCHEMA_VERSION, scope, shifts: Object.freeze(shifts) });
}

export function parseOperationalShiftSummaryV1(value: unknown): OperationalShiftSummaryV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "shiftId", "name", "status", "openedAt", "openedBy", "version",
  ]);
  if (
    record === undefined
    || own(record, "schemaVersion") !== OPERATIONAL_SHIFT_SCHEMA_VERSION
    || own(record, "status") !== "open"
  ) return undefined;
  const scope = parseScope(own(record, "scope"));
  const shiftId = uuid(own(record, "shiftId"));
  const name = displayName(own(record, "name"));
  const openedAt = timestamp(own(record, "openedAt"));
  const openedBy = uuid(own(record, "openedBy"));
  const version = positiveInteger(own(record, "version"));
  return scope === undefined || shiftId === undefined || name === undefined || openedAt === undefined
    || openedBy === undefined || version === undefined
    ? undefined
    : Object.freeze({
      name, openedAt, openedBy, schemaVersion: OPERATIONAL_SHIFT_SCHEMA_VERSION,
      scope, shiftId, status: "open", version,
    });
}

function parseScope(value: unknown): OperationalShiftScopeV1 | undefined {
  const record = exactRecord(value, ["branchId", "restaurantId"]);
  if (record === undefined) return undefined;
  const branchId = uuid(own(record, "branchId"));
  const restaurantId = uuid(own(record, "restaurantId"));
  return branchId === undefined || restaurantId === undefined
    ? undefined
    : Object.freeze({ branchId, restaurantId });
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function exactArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
  }
  return value;
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function displayName(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= 80 && value.trim() === value
    ? value
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_PATTERN.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? undefined : value;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function sameScope(left: OperationalShiftScopeV1, right: OperationalShiftScopeV1): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
