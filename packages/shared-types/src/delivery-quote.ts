export const DELIVERY_QUOTE_SCHEMA_VERSION = 1 as const;

export const DELIVERY_QUOTE_COVERAGE_STATUSES_V1 = Object.freeze(["covered", "not_covered"] as const);
export type DeliveryQuoteCoverageStatusV1 = (typeof DELIVERY_QUOTE_COVERAGE_STATUSES_V1)[number];

const PROMISE_WINDOW_MS = 15 * 60 * 1000;
const SCHEDULE_CUTOFF_MS = 30 * 60 * 1000;
/** ASAP: la ventana prometida inicia a quotedAt + preparacion; la cotizacion vive 15 minutos desde quotedAt. */
const ASAP_PREPARATION_MS = 30 * 60 * 1000;
const ASAP_QUOTE_TTL_MS = 15 * 60 * 1000;
const SCHEDULE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The address facts a coverage lookup matches against; never re-geocoded.
 * `settlementId`/`neighborhood`/`settlementOutsideCatalog` are optional on the
 * wire so historical clients keep parsing; a missing value means `null`/false.
 */
export interface DeliveryAddressFactsV1 {
  readonly settlementId?: string | null;
  readonly neighborhood?: string | null;
  readonly postalCode: string | null;
  readonly locality?: string | null;
  readonly settlementOutsideCatalog?: boolean;
}

/**
 * Client-supplied facts only: the domain quotes coverage and the promise
 * window from these; schema-versioned independently from persistence.
 */
export interface DeliveryQuoteRequestV1 {
  readonly schemaVersion: typeof DELIVERY_QUOTE_SCHEMA_VERSION;
  readonly quoteId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly captureDraftId: string;
  readonly addressSnapshotRef: string;
  readonly address: DeliveryAddressFactsV1;
  readonly currency: string;
  readonly timeZone: string;
  readonly quotedAt: string;
  readonly scheduledFor: string | null;
  readonly version: number;
}

export type DeliveryManualFeeRoleV1 = "owner" | "admin" | "manager" | "supervisor";

/**
 * Supervisor-authorized manual fee frozen alongside a not-covered quote
 * (Z3, §6.4). `overriddenAt` is the authorization instant, never the
 * re-quote instant, so an unchanged re-quote keeps the same quoteId.
 */
export interface DeliveryQuoteManualFeeOverrideV1 {
  readonly kind: "manual_fee";
  readonly eventId: string;
  readonly actorId: string;
  readonly role: DeliveryManualFeeRoleV1;
  readonly reason: string;
  readonly feeMinor: number;
  readonly promiseStart: string;
  readonly promiseEnd: string;
  readonly overriddenAt: string;
}

/** Legacy manager override frozen in historical quotes; still readable. */
export interface DeliveryQuoteManagerOverrideV1 {
  readonly actorId: string;
  readonly role: "manager";
  readonly reason: string;
  readonly feeMinor: number;
  readonly promiseStart: string;
  readonly promiseEnd: string;
  readonly overriddenAt: string;
}

export type DeliveryQuoteOverrideV1 = DeliveryQuoteManualFeeOverrideV1 | DeliveryQuoteManagerOverrideV1;

/**
 * Authoritative projection: server-derived coverage, fee, and promise window.
 * `zoneId` and `feeMinor` reflect the as-quoted facts; `override`, when
 * present, carries the manager-authorized effective values without altering
 * the original quoted facts.
 */
export interface DeliveryQuoteV1 extends DeliveryQuoteRequestV1 {
  readonly coverageStatus: DeliveryQuoteCoverageStatusV1;
  readonly zoneId: string | null;
  readonly feeMinor: number;
  readonly promiseStart: string;
  readonly promiseEnd: string;
  readonly expiresAt: string;
  readonly override: DeliveryQuoteOverrideV1 | null;
}

export function parseDeliveryQuoteRequestV1(value: unknown): DeliveryQuoteRequestV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "quoteId", "restaurantId", "branchId", "captureDraftId", "addressSnapshotRef",
      "address", "currency", "timeZone", "quotedAt", "scheduledFor", "version",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_QUOTE_SCHEMA_VERSION) return undefined;
    const quoteId = uuid(own(record, "quoteId"));
    const restaurantId = uuid(own(record, "restaurantId"));
    const branchId = uuid(own(record, "branchId"));
    const captureDraftId = uuid(own(record, "captureDraftId"));
    const addressSnapshotRef = uuid(own(record, "addressSnapshotRef"));
    const address = parseDeliveryAddressFactsV1(own(record, "address"));
    const currency = currencyCode(own(record, "currency"));
    const timeZone = timeZoneId(own(record, "timeZone"));
    const quotedAt = timestamp(own(record, "quotedAt"));
    const rawScheduledFor = own(record, "scheduledFor");
    const scheduledFor = rawScheduledFor === null ? null : timestamp(rawScheduledFor);
    const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
    if (quoteId === undefined || restaurantId === undefined || branchId === undefined || captureDraftId === undefined
      || addressSnapshotRef === undefined || address === undefined || currency === undefined || timeZone === undefined
      || quotedAt === undefined || scheduledFor === undefined || version === undefined) return undefined;
    if (!isValidSchedule(quotedAt, scheduledFor)) return undefined;

    return Object.freeze({
      schemaVersion: DELIVERY_QUOTE_SCHEMA_VERSION,
      quoteId,
      restaurantId,
      branchId,
      captureDraftId,
      addressSnapshotRef,
      address,
      currency,
      timeZone,
      quotedAt,
      scheduledFor,
      version,
    });
  });
}

export function parseDeliveryQuoteV1(value: unknown): DeliveryQuoteV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "quoteId", "restaurantId", "branchId", "captureDraftId", "addressSnapshotRef",
      "address", "currency", "timeZone", "quotedAt", "scheduledFor", "version",
      "coverageStatus", "zoneId", "feeMinor", "promiseStart", "promiseEnd", "expiresAt", "override",
    ]);
    if (record === undefined) return undefined;
    const request = parseDeliveryQuoteRequestV1({
      schemaVersion: own(record, "schemaVersion"),
      quoteId: own(record, "quoteId"),
      restaurantId: own(record, "restaurantId"),
      branchId: own(record, "branchId"),
      captureDraftId: own(record, "captureDraftId"),
      addressSnapshotRef: own(record, "addressSnapshotRef"),
      address: own(record, "address"),
      currency: own(record, "currency"),
      timeZone: own(record, "timeZone"),
      quotedAt: own(record, "quotedAt"),
      scheduledFor: own(record, "scheduledFor"),
      version: own(record, "version"),
    });
    if (request === undefined) return undefined;

    const coverageStatus = enumValue(own(record, "coverageStatus"), DELIVERY_QUOTE_COVERAGE_STATUSES_V1);
    const rawZoneId = own(record, "zoneId");
    const zoneId = rawZoneId === null ? null : uuid(rawZoneId);
    const feeMinor = money(own(record, "feeMinor"));
    const promiseStart = timestamp(own(record, "promiseStart"));
    const promiseEnd = timestamp(own(record, "promiseEnd"));
    const expiresAt = timestamp(own(record, "expiresAt"));
    const rawOverride = own(record, "override");
    const override = rawOverride === null ? null : parseOverride(rawOverride);
    if (coverageStatus === undefined || zoneId === undefined || feeMinor === undefined || promiseStart === undefined
      || promiseEnd === undefined || expiresAt === undefined || override === undefined) return undefined;

    // Coverage/fee/zone consistency (mirrors packages/domain/src/delivery-quote.ts's quoteDelivery):
    if (coverageStatus === "not_covered" && (zoneId !== null || feeMinor !== 0)) return undefined;
    if (coverageStatus === "covered" && zoneId === null) return undefined;
    // The promise window is always exactly 15 minutes, frozen from the window start (decision 8.1.3).
    if (toMillis(promiseEnd) - toMillis(promiseStart) !== PROMISE_WINDOW_MS) return undefined;
    // ASAP: the window starts at quotedAt + 30 minutes and the quote expires 15 minutes after quotedAt;
    // scheduled: the window starts at the requested schedule and the quote expires when it begins.
    const quotedAtMs = toMillis(request.quotedAt);
    if (request.scheduledFor === null) {
      const current = promiseStart === new Date(quotedAtMs + ASAP_PREPARATION_MS).toISOString()
        && expiresAt === new Date(quotedAtMs + ASAP_QUOTE_TTL_MS).toISOString();
      // Legacy ASAP quotes already frozen in orders/captures: window and expiry both at quotedAt.
      const legacy = promiseStart === request.quotedAt && expiresAt === request.quotedAt;
      if (!current && !legacy) return undefined;
    } else if (promiseStart !== request.scheduledFor || expiresAt !== request.scheduledFor) {
      return undefined;
    }

    return Object.freeze({
      ...request,
      coverageStatus,
      zoneId,
      feeMinor,
      promiseStart,
      promiseEnd,
      expiresAt,
      override,
    });
  });
}

function parseOverride(value: unknown): DeliveryQuoteOverrideV1 | undefined {
  const manual = parseManualFeeOverride(value);
  if (manual !== undefined) return manual;
  return parseManagerOverride(value);
}

function parseManualFeeOverride(value: unknown): DeliveryQuoteManualFeeOverrideV1 | undefined {
  const record = exactRecord(value, [
    "kind", "eventId", "actorId", "role", "reason", "feeMinor", "promiseStart", "promiseEnd", "overriddenAt",
  ]);
  if (record === undefined || own(record, "kind") !== "manual_fee") return undefined;
  const eventId = uuid(own(record, "eventId"));
  const actorId = uuid(own(record, "actorId"));
  const role = manualFeeRole(own(record, "role"));
  const reason = boundedText(own(record, "reason"), 1, 500);
  const feeMinor = money(own(record, "feeMinor"));
  const promiseStart = timestamp(own(record, "promiseStart"));
  const promiseEnd = timestamp(own(record, "promiseEnd"));
  const overriddenAt = timestamp(own(record, "overriddenAt"));
  if (eventId === undefined || actorId === undefined || role === undefined || reason === undefined
    || feeMinor === undefined || promiseStart === undefined || promiseEnd === undefined || overriddenAt === undefined
    || toMillis(promiseStart) >= toMillis(promiseEnd)) {
    return undefined;
  }
  return Object.freeze({
    kind: "manual_fee" as const,
    eventId,
    actorId,
    role,
    reason,
    feeMinor,
    promiseStart,
    promiseEnd,
    overriddenAt,
  });
}

function parseManagerOverride(value: unknown): DeliveryQuoteManagerOverrideV1 | undefined {
  const record = exactRecord(value, ["actorId", "role", "reason", "feeMinor", "promiseStart", "promiseEnd", "overriddenAt"]);
  if (record === undefined || own(record, "role") !== "manager") return undefined;
  const actorId = uuid(own(record, "actorId"));
  const reason = boundedText(own(record, "reason"), 1, 500);
  const feeMinor = money(own(record, "feeMinor"));
  const promiseStart = timestamp(own(record, "promiseStart"));
  const promiseEnd = timestamp(own(record, "promiseEnd"));
  const overriddenAt = timestamp(own(record, "overriddenAt"));
  if (actorId === undefined || reason === undefined || feeMinor === undefined || promiseStart === undefined
    || promiseEnd === undefined || overriddenAt === undefined || toMillis(promiseStart) >= toMillis(promiseEnd)) {
    return undefined;
  }
  return Object.freeze({
    actorId,
    role: "manager" as const,
    reason,
    feeMinor,
    promiseStart,
    promiseEnd,
    overriddenAt,
  });
}

/**
 * Parses the address facts of a quote. The Z2 persisted shape carries
 * `settlementId`/`neighborhood`/`postalCode`; historical quotes and clients
 * carry only `postalCode`/`locality`. Both parse, defaulting the rest to null.
 */
export function parseDeliveryAddressFactsV1(value: unknown): DeliveryAddressFactsV1 | undefined {
  const keys = ["settlementId", "neighborhood", "postalCode", "locality", "settlementOutsideCatalog"] as const;
  const record = exactRecordWithKnownKeys(value, keys);
  if (record === undefined) return undefined;
  const settlementId = nullableUuid(own(record, "settlementId"));
  const neighborhood = nullableBoundedText(own(record, "neighborhood"), 1, 200);
  const postalCode = nullableBoundedText(own(record, "postalCode"), 1, 32);
  const locality = nullableBoundedText(own(record, "locality"), 1, 200);
  const rawOutsideCatalog = own(record, "settlementOutsideCatalog");
  const settlementOutsideCatalog = rawOutsideCatalog === undefined || rawOutsideCatalog === null
    ? false
    : typeof rawOutsideCatalog === "boolean" ? rawOutsideCatalog : undefined;
  if (settlementId === undefined || neighborhood === undefined || postalCode === undefined || locality === undefined
    || settlementOutsideCatalog === undefined) return undefined;
  return Object.freeze({ settlementId, neighborhood, postalCode, locality, settlementOutsideCatalog });
}

function isValidSchedule(quotedAt: string, scheduledFor: string | null): boolean {
  if (scheduledFor === null) return true;
  const quotedAtMs = toMillis(quotedAt);
  const scheduledMs = toMillis(scheduledFor);
  const deltaMs = scheduledMs - quotedAtMs;
  return deltaMs >= SCHEDULE_CUTOFF_MS && deltaMs <= SCHEDULE_HORIZON_MS;
}

function toMillis(value: string): number {
  return new Date(value).getTime();
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

/**
 * Like `exactRecord`, but tolerates a subset of the allowed keys (historical
 * shapes). Extra keys are rejected and accessors are never invoked.
 */
function exactRecordWithKnownKeys(value: unknown, allowed: readonly string[]): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length === 0 || !ownKeys.every((key) => typeof key === "string" && allowed.includes(key))) {
    return undefined;
  }
  const detached: PlainRecord = {};
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    detached[key] = descriptor.value;
  }
  return detached;
}

function nullableBoundedText(value: unknown, minimum: number, maximum: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  return boundedText(value, minimum, maximum);
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return uuid(value);
}

function manualFeeRole(value: unknown): DeliveryManualFeeRoleV1 | undefined {
  return value === "owner" || value === "admin" || value === "manager" || value === "supervisor" ? value : undefined;
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

function timeZoneId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 100 || value !== value.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return undefined;
  }
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try {
    return new Date(value).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function safely<T>(operation: () => T | undefined): T | undefined {
  try { return operation(); } catch { return undefined; }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
