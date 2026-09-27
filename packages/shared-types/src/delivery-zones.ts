export const DELIVERY_ZONE_SCHEMA_VERSION = 1 as const;

const MAX_ZONE_NAME_LENGTH = 80;
const MAX_POSTAL_CODE_LENGTH = 32;
const MAX_LOCALITY_LENGTH = 200;
const MAX_CODE_LIST_LENGTH = 500;
const MAX_REASON_LENGTH = 500;
const MAX_ZONE_LIST_LENGTH = 1_000;

/** A restaurant/branch-scoped identifier pair; the branch always belongs to the restaurant. */
export interface DeliveryZoneBranchScopeV1 {
  readonly restaurantId: string;
  readonly branchId: string;
}

/**
 * Listing zones can be scoped to one Branch, or to every Branch under one
 * Restaurant (manager overview); the server still revalidates membership for
 * whichever scope is requested — the client's `kind` never widens access.
 */
export interface ListDeliveryZonesRestaurantScopeV1 {
  readonly kind: "restaurant";
  readonly restaurantId: string;
}

export interface ListDeliveryZonesBranchScopeV1 {
  readonly kind: "branch";
  readonly restaurantId: string;
  readonly branchId: string;
}

export type ListDeliveryZonesScopeV1 = ListDeliveryZonesRestaurantScopeV1 | ListDeliveryZonesBranchScopeV1;

export interface ListDeliveryZonesQueryV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly scope: ListDeliveryZonesScopeV1;
}

/**
 * A manually configured delivery coverage zone for one Branch (decision
 * 8.1.1: no geocoding or polygons in the pilot). `postalCodes` and
 * `localities` are normalized, deduplicated, and strictly ordered so two
 * equivalent zones always serialize identically; at least one of the two
 * sets must be non-empty or the zone can never match an address.
 */
export interface DeliveryZoneV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly zoneId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly postalCodes: readonly string[];
  readonly localities: readonly string[];
  readonly feeMinor: number;
  readonly currency: string;
  readonly active: boolean;
  readonly version: number;
  readonly updatedAt: string;
}

export interface DeliveryZoneListV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly scope: ListDeliveryZonesScopeV1;
  readonly zones: readonly DeliveryZoneV1[];
}

/**
 * Creates a zone (`expectedVersion` 0) or updates one under optimistic
 * concurrency control (`expectedVersion` the last known version). `reason`
 * is required whenever the command deactivates a zone (`active: false`) so
 * the deactivation is audited (decision 8.1.2 pattern); it is otherwise
 * optional and carried as `null` when absent.
 */
export interface UpsertDeliveryZoneCommandV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly scope: DeliveryZoneBranchScopeV1;
  readonly zoneId: string;
  readonly expectedVersion: number;
  readonly name: string;
  readonly postalCodes: readonly string[];
  readonly localities: readonly string[];
  readonly feeMinor: number;
  readonly currency: string;
  readonly active: boolean;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason: string | null;
}

export interface UpsertDeliveryZoneResultV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly zone: DeliveryZoneV1;
  readonly replayed: boolean;
}

/**
 * Requests a delivery quote for a capture draft already held server-side;
 * it never transports a fee or zone — the server derives both from the
 * draft's address facts and the authorized zones for the Branch, then
 * returns the existing `DeliveryQuoteV1` contract (see delivery-quote.ts).
 */
export interface RequestDeliveryQuoteCommandV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly scope: DeliveryZoneBranchScopeV1;
  readonly captureDraftId: string;
  readonly scheduledFor: string | null;
}

export function parseListDeliveryZonesQueryV1(value: unknown): ListDeliveryZonesQueryV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope"]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const scope = parseListDeliveryZonesScope(own(record, "scope"));
    if (scope === undefined) return undefined;
    return Object.freeze({ schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION, scope });
  });
}

export function parseDeliveryZoneV1(value: unknown): DeliveryZoneV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "zoneId", "restaurantId", "branchId", "name", "postalCodes", "localities",
      "feeMinor", "currency", "active", "version", "updatedAt",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const zoneId = uuid(own(record, "zoneId"));
    const restaurantId = uuid(own(record, "restaurantId"));
    const branchId = uuid(own(record, "branchId"));
    const name = boundedText(own(record, "name"), 1, MAX_ZONE_NAME_LENGTH);
    const postalCodes = parseOrderedTextArray(own(record, "postalCodes"), MAX_POSTAL_CODE_LENGTH);
    const localities = parseOrderedTextArray(own(record, "localities"), MAX_LOCALITY_LENGTH);
    const feeMinor = money(own(record, "feeMinor"));
    const currency = currencyCode(own(record, "currency"));
    const active = own(record, "active");
    const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
    const updatedAt = timestamp(own(record, "updatedAt"));
    if (
      zoneId === undefined || restaurantId === undefined || branchId === undefined || name === undefined
      || postalCodes === undefined || localities === undefined || feeMinor === undefined || currency === undefined
      || typeof active !== "boolean" || version === undefined || updatedAt === undefined
    ) return undefined;
    if (postalCodes.length === 0 && localities.length === 0) return undefined;

    return Object.freeze({
      schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION,
      zoneId,
      restaurantId,
      branchId,
      name,
      postalCodes,
      localities,
      feeMinor,
      currency,
      active,
      version,
      updatedAt,
    });
  });
}

export function parseDeliveryZoneListV1(value: unknown): DeliveryZoneListV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "zones"]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const scope = parseListDeliveryZonesScope(own(record, "scope"));
    const rawZones = parseExactArray(own(record, "zones"), MAX_ZONE_LIST_LENGTH);
    if (scope === undefined || rawZones === undefined) return undefined;

    const zones: DeliveryZoneV1[] = [];
    let previousZoneId: string | undefined;
    for (const rawZone of rawZones) {
      const zone = parseDeliveryZoneV1(rawZone);
      if (zone === undefined) return undefined;
      if (zone.restaurantId !== scope.restaurantId) return undefined;
      if (scope.kind === "branch" && zone.branchId !== scope.branchId) return undefined;
      if (previousZoneId !== undefined && compareCodeUnits(previousZoneId, zone.zoneId) >= 0) return undefined;
      previousZoneId = zone.zoneId;
      zones.push(zone);
    }

    return Object.freeze({ schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION, scope, zones: Object.freeze(zones) });
  });
}

export function parseUpsertDeliveryZoneCommandV1(value: unknown): UpsertDeliveryZoneCommandV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "scope", "zoneId", "expectedVersion", "name", "postalCodes", "localities",
      "feeMinor", "currency", "active", "eventId", "idempotencyKey", "deviceId", "occurredAt", "reason",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const scope = parseBranchScope(own(record, "scope"));
    const zoneId = uuid(own(record, "zoneId"));
    const expectedVersion = integer(own(record, "expectedVersion"), 0, Number.MAX_SAFE_INTEGER);
    const name = boundedText(own(record, "name"), 1, MAX_ZONE_NAME_LENGTH);
    const postalCodes = parseOrderedTextArray(own(record, "postalCodes"), MAX_POSTAL_CODE_LENGTH);
    const localities = parseOrderedTextArray(own(record, "localities"), MAX_LOCALITY_LENGTH);
    const feeMinor = money(own(record, "feeMinor"));
    const currency = currencyCode(own(record, "currency"));
    const active = own(record, "active");
    const eventId = uuid(own(record, "eventId"));
    const idempotencyKey = uuid(own(record, "idempotencyKey"));
    const deviceId = uuid(own(record, "deviceId"));
    const occurredAt = timestamp(own(record, "occurredAt"));
    const rawReason = own(record, "reason");
    const reason = rawReason === null ? null : boundedText(rawReason, 1, MAX_REASON_LENGTH);
    if (
      scope === undefined || zoneId === undefined || expectedVersion === undefined || name === undefined
      || postalCodes === undefined || localities === undefined || feeMinor === undefined || currency === undefined
      || typeof active !== "boolean" || eventId === undefined || idempotencyKey === undefined
      || deviceId === undefined || occurredAt === undefined || reason === undefined
    ) return undefined;
    if (postalCodes.length === 0 && localities.length === 0) return undefined;
    // A deactivation must always carry an audited reason (decision 8.1.2 pattern).
    if (!active && reason === null) return undefined;

    return Object.freeze({
      schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION,
      scope,
      zoneId,
      expectedVersion,
      name,
      postalCodes,
      localities,
      feeMinor,
      currency,
      active,
      eventId,
      idempotencyKey,
      deviceId,
      occurredAt,
      reason,
    });
  });
}

export function parseUpsertDeliveryZoneResultV1(value: unknown): UpsertDeliveryZoneResultV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "zone", "replayed"]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const zone = parseDeliveryZoneV1(own(record, "zone"));
    const replayed = own(record, "replayed");
    if (zone === undefined || typeof replayed !== "boolean") return undefined;
    return Object.freeze({ schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION, zone, replayed });
  });
}

export function parseRequestDeliveryQuoteCommandV1(value: unknown): RequestDeliveryQuoteCommandV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "captureDraftId", "scheduledFor"]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const scope = parseBranchScope(own(record, "scope"));
    const captureDraftId = uuid(own(record, "captureDraftId"));
    const rawScheduledFor = own(record, "scheduledFor");
    const scheduledFor = rawScheduledFor === null ? null : timestamp(rawScheduledFor);
    if (scope === undefined || captureDraftId === undefined || scheduledFor === undefined) return undefined;

    return Object.freeze({
      schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION,
      scope,
      captureDraftId,
      scheduledFor,
    });
  });
}

function parseListDeliveryZonesScope(value: unknown): ListDeliveryZonesScopeV1 | undefined {
  const restaurantRecord = exactRecord(value, ["kind", "restaurantId"]);
  if (restaurantRecord !== undefined && own(restaurantRecord, "kind") === "restaurant") {
    const restaurantId = uuid(own(restaurantRecord, "restaurantId"));
    return restaurantId === undefined ? undefined : Object.freeze({ kind: "restaurant" as const, restaurantId });
  }
  const branchRecord = exactRecord(value, ["kind", "restaurantId", "branchId"]);
  if (branchRecord !== undefined && own(branchRecord, "kind") === "branch") {
    const restaurantId = uuid(own(branchRecord, "restaurantId"));
    const branchId = uuid(own(branchRecord, "branchId"));
    if (restaurantId === undefined || branchId === undefined) return undefined;
    return Object.freeze({ kind: "branch" as const, restaurantId, branchId });
  }
  return undefined;
}

function parseBranchScope(value: unknown): DeliveryZoneBranchScopeV1 | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  if (record === undefined) return undefined;
  const restaurantId = uuid(own(record, "restaurantId"));
  const branchId = uuid(own(record, "branchId"));
  if (restaurantId === undefined || branchId === undefined) return undefined;
  return Object.freeze({ restaurantId, branchId });
}

/**
 * Parses a hostile-safe array of bounded, trimmed strings that must already
 * be deduplicated and in strictly ascending code-unit order — the canonical
 * form every valid `DeliveryZoneV1`/command payload is expected to carry, so
 * two equivalent zones always serialize identically.
 */
function parseOrderedTextArray(value: unknown, maxLength: number): readonly string[] | undefined {
  const raw = parseExactArray(value, MAX_CODE_LIST_LENGTH);
  if (raw === undefined) return undefined;
  const values: string[] = [];
  let previous: string | undefined;
  for (const entry of raw) {
    const text = boundedText(entry, 1, maxLength);
    if (text === undefined) return undefined;
    if (previous !== undefined && compareCodeUnits(previous, text) >= 0) return undefined;
    previous = text;
    values.push(text);
  }
  return Object.freeze(values);
}

type PlainRecord = Record<string, unknown>;

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key))
    ? value as PlainRecord : undefined;
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

function own(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function money(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function boundedText(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value)
    ? value
    : undefined;
}

function currencyCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try {
    return new Date(value).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safely<T>(operation: () => T | undefined): T | undefined {
  try { return operation(); } catch { return undefined; }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
