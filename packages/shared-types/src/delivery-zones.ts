import { parseDeliveryAddressFactsV1, type DeliveryAddressFactsV1 } from "./delivery-quote.js";

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
  /** Colonias (SEPOMEX) cubiertas; vacío en zonas heredadas sólo por CP. */
  readonly settlementIds: readonly string[];
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
  /** Nuevo; los clientes viejos lo omiten y el API lo normaliza a []. */
  readonly settlementIds: readonly string[];
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

/**
 * Read-only coverage check for one address and Branch. It carries no draft,
 * quote id, override or schedule: the server answers zone, fee and the ASAP
 * promise from the server clock and persists nothing. The binding quote is
 * still `RequestDeliveryQuoteCommandV1` over the draft at confirmation.
 */
export interface DeliveryZoneMatchRequestV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly address: DeliveryAddressFactsV1;
}

export const DELIVERY_MATCH_REASON_CODES_V1 = Object.freeze([
  "settlement_missing",
  "settlement_unknown",
  "settlement_ambiguous",
  "settlement_not_in_zone",
  "settlement_outside_catalog",
  "legacy_postal_code_match",
] as const);
export type DeliveryMatchReasonCodeV1 = (typeof DELIVERY_MATCH_REASON_CODES_V1)[number];

/** Server-composed reason; the UI shows `message` verbatim (never concatenated). */
export interface DeliveryMatchReasonV1 {
  readonly code: DeliveryMatchReasonCodeV1;
  readonly message: string;
}

export type DeliveryMatchMethodV1 = "settlement" | "neighborhood" | "postal_code";

export interface DeliveryMatchedSettlementV1 {
  readonly settlementId: string;
  readonly name: string;
  readonly postalCode: string;
}

/**
 * `covered` carries zone and fee; `not_covered` carries `zoneId`/`zoneName`
 * null and `feeMinor` 0. `reason` explains a not-covered (or legacy CP) result
 * and is null when the address was covered by an exact settlement match.
 */
export interface DeliveryZoneMatchResultV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly coverageStatus: "covered" | "not_covered";
  readonly zoneId: string | null;
  readonly zoneName: string | null;
  readonly feeMinor: number;
  readonly currency: string;
  readonly promiseMinutes: number;
  readonly promiseStart: string;
  readonly promiseEnd: string;
  readonly evaluatedAt: string;
  readonly reason: DeliveryMatchReasonV1 | null;
  readonly matchedBy: DeliveryMatchMethodV1 | null;
  readonly settlement: DeliveryMatchedSettlementV1 | null;
}

export function parseDeliveryZoneMatchRequestV1(value: unknown): DeliveryZoneMatchRequestV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "restaurantId", "branchId", "address"]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const restaurantId = uuid(own(record, "restaurantId"));
    const branchId = uuid(own(record, "branchId"));
    const address = parseMatchAddress(own(record, "address"));
    if (restaurantId === undefined || branchId === undefined || address === undefined) return undefined;
    return Object.freeze({ schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION, restaurantId, branchId, address });
  });
}

export function parseDeliveryZoneMatchResultV1(value: unknown): DeliveryZoneMatchResultV1 | undefined {
  return safely(() => {
    const extended = exactRecord(value, [
      "schemaVersion", "coverageStatus", "zoneId", "zoneName", "feeMinor", "currency",
      "promiseMinutes", "promiseStart", "promiseEnd", "evaluatedAt", "reason", "matchedBy", "settlement",
    ]);
    const legacy = extended === undefined ? exactRecord(value, [
      "schemaVersion", "coverageStatus", "zoneId", "zoneName", "feeMinor", "currency",
      "promiseMinutes", "promiseStart", "promiseEnd", "evaluatedAt",
    ]) : undefined;
    const record = extended ?? legacy;
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const coverageStatus = own(record, "coverageStatus");
    const rawZoneId = own(record, "zoneId");
    const rawZoneName = own(record, "zoneName");
    const feeMinor = money(own(record, "feeMinor"));
    const currency = currencyCode(own(record, "currency"));
    const promiseMinutes = integer(own(record, "promiseMinutes"), 1, 1_440);
    const promiseStart = timestamp(own(record, "promiseStart"));
    const promiseEnd = timestamp(own(record, "promiseEnd"));
    const evaluatedAt = timestamp(own(record, "evaluatedAt"));
    if (
      (coverageStatus !== "covered" && coverageStatus !== "not_covered")
      || feeMinor === undefined || currency === undefined || promiseMinutes === undefined
      || promiseStart === undefined || promiseEnd === undefined || evaluatedAt === undefined
    ) return undefined;
    let zoneId: string | null;
    let zoneName: string | null;
    if (coverageStatus === "covered") {
      const coveredId = uuid(rawZoneId);
      const coveredName = boundedText(rawZoneName, 1, MAX_ZONE_NAME_LENGTH);
      if (coveredId === undefined || coveredName === undefined) return undefined;
      zoneId = coveredId;
      zoneName = coveredName;
    } else {
      if (rawZoneId !== null || rawZoneName !== null || feeMinor !== 0) return undefined;
      zoneId = null;
      zoneName = null;
    }
    if (new Date(promiseEnd).getTime() - new Date(promiseStart).getTime() !== promiseMinutes * 60_000) return undefined;
    if (new Date(promiseStart).getTime() < new Date(evaluatedAt).getTime()) return undefined;

    let reason: DeliveryMatchReasonV1 | null | undefined = null;
    let matchedBy: DeliveryMatchMethodV1 | null | undefined = null;
    let settlement: DeliveryMatchedSettlementV1 | null | undefined = null;
    if (extended !== undefined) {
      const rawReason = own(extended, "reason");
      const rawMatchedBy = own(extended, "matchedBy");
      const rawSettlement = own(extended, "settlement");
      reason = rawReason === null ? null : parseMatchReason(rawReason);
      matchedBy = rawMatchedBy === null ? null : matchMethod(rawMatchedBy);
      settlement = rawSettlement === null ? null : parseMatchedSettlement(rawSettlement);
      if (reason === undefined || matchedBy === undefined || settlement === undefined) return undefined;
      if (coverageStatus === "covered" && matchedBy === null) return undefined;
      if (coverageStatus === "not_covered" && (reason === null || matchedBy !== null || settlement !== null)) {
        return undefined;
      }
    }
    if (reason === undefined || matchedBy === undefined || settlement === undefined) return undefined;

    return Object.freeze({
      schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION,
      coverageStatus,
      zoneId,
      zoneName,
      feeMinor,
      currency,
      promiseMinutes,
      promiseStart,
      promiseEnd,
      evaluatedAt,
      reason,
      matchedBy,
      settlement,
    });
  });
}

function parseMatchReason(value: unknown): DeliveryMatchReasonV1 | undefined {
  const record = exactRecord(value, ["code", "message"]);
  if (record === undefined) return undefined;
  const code = own(record, "code");
  if (typeof code !== "string" || !(DELIVERY_MATCH_REASON_CODES_V1 as readonly string[]).includes(code)) return undefined;
  const message = boundedText(own(record, "message"), 1, 400);
  if (message === undefined) return undefined;
  return Object.freeze({ code: code as DeliveryMatchReasonCodeV1, message });
}

function matchMethod(value: unknown): DeliveryMatchMethodV1 | undefined {
  return value === "settlement" || value === "neighborhood" || value === "postal_code" ? value : undefined;
}

function parseMatchedSettlement(value: unknown): DeliveryMatchedSettlementV1 | undefined {
  const record = exactRecord(value, ["settlementId", "name", "postalCode"]);
  if (record === undefined) return undefined;
  const settlementId = uuid(own(record, "settlementId"));
  const name = boundedText(own(record, "name"), 1, MAX_LOCALITY_LENGTH);
  const postalCode = boundedText(own(record, "postalCode"), 1, MAX_POSTAL_CODE_LENGTH);
  if (settlementId === undefined || name === undefined || postalCode === undefined) return undefined;
  return Object.freeze({ settlementId, name, postalCode });
}

function parseMatchAddress(value: unknown): DeliveryAddressFactsV1 | undefined {
  return parseDeliveryAddressFactsV1(value);
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
    const withSettlements = exactRecord(value, [
      "schemaVersion", "zoneId", "restaurantId", "branchId", "name", "postalCodes", "localities", "settlementIds",
      "feeMinor", "currency", "active", "version", "updatedAt",
    ]);
    const legacy = withSettlements === undefined ? exactRecord(value, [
      "schemaVersion", "zoneId", "restaurantId", "branchId", "name", "postalCodes", "localities",
      "feeMinor", "currency", "active", "version", "updatedAt",
    ]) : undefined;
    const record = withSettlements ?? legacy;
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const zoneId = uuid(own(record, "zoneId"));
    const restaurantId = uuid(own(record, "restaurantId"));
    const branchId = uuid(own(record, "branchId"));
    const name = boundedText(own(record, "name"), 1, MAX_ZONE_NAME_LENGTH);
    const postalCodes = parseOrderedTextArray(own(record, "postalCodes"), MAX_POSTAL_CODE_LENGTH);
    const localities = parseOrderedTextArray(own(record, "localities"), MAX_LOCALITY_LENGTH);
    const settlementIds = withSettlements === undefined
      ? Object.freeze([] as string[])
      : parseOrderedUuidArray(own(record, "settlementIds"));
    const feeMinor = money(own(record, "feeMinor"));
    const currency = currencyCode(own(record, "currency"));
    const active = own(record, "active");
    const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
    const updatedAt = timestamp(own(record, "updatedAt"));
    if (
      zoneId === undefined || restaurantId === undefined || branchId === undefined || name === undefined
      || postalCodes === undefined || localities === undefined || settlementIds === undefined
      || feeMinor === undefined || currency === undefined
      || typeof active !== "boolean" || version === undefined || updatedAt === undefined
    ) return undefined;
    if (postalCodes.length === 0 && localities.length === 0 && settlementIds.length === 0) return undefined;

    return Object.freeze({
      schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION,
      zoneId,
      restaurantId,
      branchId,
      name,
      postalCodes,
      localities,
      settlementIds,
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
    const withSettlements = exactRecord(value, [
      "schemaVersion", "scope", "zoneId", "expectedVersion", "name", "postalCodes", "localities", "settlementIds",
      "feeMinor", "currency", "active", "eventId", "idempotencyKey", "deviceId", "occurredAt", "reason",
    ]);
    const legacy = withSettlements === undefined ? exactRecord(value, [
      "schemaVersion", "scope", "zoneId", "expectedVersion", "name", "postalCodes", "localities",
      "feeMinor", "currency", "active", "eventId", "idempotencyKey", "deviceId", "occurredAt", "reason",
    ]) : undefined;
    const record = withSettlements ?? legacy;
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const scope = parseBranchScope(own(record, "scope"));
    const zoneId = uuid(own(record, "zoneId"));
    const expectedVersion = integer(own(record, "expectedVersion"), 0, Number.MAX_SAFE_INTEGER);
    const name = boundedText(own(record, "name"), 1, MAX_ZONE_NAME_LENGTH);
    const postalCodes = parseOrderedTextArray(own(record, "postalCodes"), MAX_POSTAL_CODE_LENGTH);
    const localities = parseOrderedTextArray(own(record, "localities"), MAX_LOCALITY_LENGTH);
    const settlementIds = withSettlements === undefined
      ? Object.freeze([] as string[])
      : parseOrderedUuidArray(own(record, "settlementIds"));
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
      || postalCodes === undefined || localities === undefined || settlementIds === undefined
      || feeMinor === undefined || currency === undefined
      || typeof active !== "boolean" || eventId === undefined || idempotencyKey === undefined
      || deviceId === undefined || occurredAt === undefined || reason === undefined
    ) return undefined;
    // At least one settlement or legacy postal code; localities alone are inert (§6.5).
    if (settlementIds.length === 0 && postalCodes.length === 0) return undefined;
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
      settlementIds,
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

// --- Settlement search (autocomplete) ---------------------------------------

export const SETTLEMENT_SEARCH_DEFAULT_LIMIT = 20;
export const SETTLEMENT_SEARCH_MAX_LIMIT = 50;

export interface SettlementSearchRequestV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly scope: DeliveryZoneBranchScopeV1;
  /** Prefijo de colonia; exactamente uno de query/postalCode. */
  readonly query: string | null;
  readonly postalCode: string | null;
  readonly limit: number;
}

export interface SettlementSearchBranchV1 {
  readonly name: string;
  readonly locality: string;
  readonly region: string;
  readonly countryCode: string;
}

export interface SettlementSummaryV1 {
  readonly settlementId: string;
  readonly name: string;
  readonly postalCode: string;
  readonly settlementType: string;
  readonly municipality: string;
  readonly state: string;
  readonly countryCode: string;
}

export interface SettlementSearchResultV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly scope: DeliveryZoneBranchScopeV1;
  readonly branch: SettlementSearchBranchV1;
  readonly settlements: readonly SettlementSummaryV1[];
}

export function parseSettlementSearchRequestV1(value: unknown): SettlementSearchRequestV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "query", "postalCode", "limit"]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const scope = parseBranchScope(own(record, "scope"));
    const limit = integer(own(record, "limit"), 1, SETTLEMENT_SEARCH_MAX_LIMIT);
    const rawQuery = own(record, "query");
    const rawPostalCode = own(record, "postalCode");
    if (scope === undefined || limit === undefined || (rawQuery === null) === (rawPostalCode === null)) return undefined;
    let query: string | null = null;
    let postalCode: string | null = null;
    if (rawQuery !== null) {
      const parsedQuery = boundedText(rawQuery, 2, 40);
      if (parsedQuery === undefined) return undefined;
      query = parsedQuery;
    } else {
      if (typeof rawPostalCode !== "string" || !/^[0-9]{5}$/u.test(rawPostalCode)) return undefined;
      postalCode = rawPostalCode;
    }
    return Object.freeze({ schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION, scope, query, postalCode, limit });
  });
}

export function parseSettlementSearchResultV1(value: unknown): SettlementSearchResultV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "branch", "settlements"]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const scope = parseBranchScope(own(record, "scope"));
    const branch = parseSettlementSearchBranch(own(record, "branch"));
    const rawSettlements = parseExactArray(own(record, "settlements"), SETTLEMENT_SEARCH_MAX_LIMIT);
    if (scope === undefined || branch === undefined || rawSettlements === undefined) return undefined;
    const settlements: SettlementSummaryV1[] = [];
    for (const raw of rawSettlements) {
      const settlement = parseSettlementSummary(raw);
      if (settlement === undefined) return undefined;
      settlements.push(settlement);
    }
    return Object.freeze({ schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION, scope, branch, settlements: Object.freeze(settlements) });
  });
}

function parseSettlementSearchBranch(value: unknown): SettlementSearchBranchV1 | undefined {
  const record = exactRecord(value, ["name", "locality", "region", "countryCode"]);
  if (record === undefined) return undefined;
  const name = boundedText(own(record, "name"), 1, MAX_LOCALITY_LENGTH);
  const locality = boundedText(own(record, "locality"), 1, MAX_LOCALITY_LENGTH);
  const region = boundedText(own(record, "region"), 1, MAX_LOCALITY_LENGTH);
  const countryCode = typeof own(record, "countryCode") === "string" && /^[A-Z]{2}$/u.test(own(record, "countryCode") as string)
    ? own(record, "countryCode") as string : undefined;
  if (name === undefined || locality === undefined || region === undefined || countryCode === undefined) return undefined;
  return Object.freeze({ name, locality, region, countryCode });
}

function parseSettlementSummary(value: unknown): SettlementSummaryV1 | undefined {
  const record = exactRecord(value, [
    "settlementId", "name", "postalCode", "settlementType", "municipality", "state", "countryCode",
  ]);
  if (record === undefined) return undefined;
  const settlementId = uuid(own(record, "settlementId"));
  const name = boundedText(own(record, "name"), 1, MAX_LOCALITY_LENGTH);
  const postalCode = typeof own(record, "postalCode") === "string" && /^[0-9]{5}$/u.test(own(record, "postalCode") as string)
    ? own(record, "postalCode") as string : undefined;
  const settlementType = boundedText(own(record, "settlementType"), 1, MAX_LOCALITY_LENGTH);
  const municipality = boundedText(own(record, "municipality"), 1, MAX_LOCALITY_LENGTH);
  const state = boundedText(own(record, "state"), 1, MAX_LOCALITY_LENGTH);
  const countryCode = typeof own(record, "countryCode") === "string" && /^[A-Z]{2}$/u.test(own(record, "countryCode") as string)
    ? own(record, "countryCode") as string : undefined;
  if (settlementId === undefined || name === undefined || postalCode === undefined || settlementType === undefined
    || municipality === undefined || state === undefined || countryCode === undefined) return undefined;
  return Object.freeze({ settlementId, name, postalCode, settlementType, municipality, state, countryCode });
}

// --- Manual delivery fee (supervisor authorization) -------------------------

export const DELIVERY_MANUAL_FEE_ROLES_V1 = Object.freeze(["owner", "admin", "manager", "supervisor"] as const);
export type DeliveryManualFeeRoleCodeV1 = (typeof DELIVERY_MANUAL_FEE_ROLES_V1)[number];

export interface SetCaptureDeliveryManualFeeCommandV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly scope: DeliveryZoneBranchScopeV1;
  readonly captureDraftId: string;
  readonly addressSnapshotRef: string;
  readonly expectedVersion: number;
  readonly feeMinor: number;
  readonly currency: string;
  readonly reason: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly occurredAt: string;
}

export interface CaptureDeliveryManualFeeV1 {
  readonly eventId: string;
  readonly captureDraftId: string;
  readonly addressSnapshotRef: string;
  readonly feeMinor: number;
  readonly currency: string;
  readonly reason: string;
  readonly role: DeliveryManualFeeRoleCodeV1;
  readonly actorId: string;
  readonly authorizedAt: string;
  readonly version: number;
}

export interface SetCaptureDeliveryManualFeeResultV1 {
  readonly schemaVersion: typeof DELIVERY_ZONE_SCHEMA_VERSION;
  readonly manualFee: CaptureDeliveryManualFeeV1;
  readonly replayed: boolean;
}

export function parseSetCaptureDeliveryManualFeeCommandV1(
  value: unknown,
): SetCaptureDeliveryManualFeeCommandV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "scope", "captureDraftId", "addressSnapshotRef", "expectedVersion", "feeMinor",
      "currency", "reason", "eventId", "idempotencyKey", "deviceId", "occurredAt",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const scope = parseBranchScope(own(record, "scope"));
    const captureDraftId = uuid(own(record, "captureDraftId"));
    const addressSnapshotRef = uuid(own(record, "addressSnapshotRef"));
    const expectedVersion = integer(own(record, "expectedVersion"), 0, Number.MAX_SAFE_INTEGER);
    const feeMinor = money(own(record, "feeMinor"));
    const currency = currencyCode(own(record, "currency"));
    const reason = boundedText(own(record, "reason"), 1, MAX_REASON_LENGTH);
    const eventId = uuid(own(record, "eventId"));
    const idempotencyKey = uuid(own(record, "idempotencyKey"));
    const deviceId = uuid(own(record, "deviceId"));
    const occurredAt = timestamp(own(record, "occurredAt"));
    if (scope === undefined || captureDraftId === undefined || addressSnapshotRef === undefined
      || expectedVersion === undefined || feeMinor === undefined || currency === undefined || reason === undefined
      || eventId === undefined || idempotencyKey === undefined || deviceId === undefined || occurredAt === undefined) {
      return undefined;
    }
    return Object.freeze({
      schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION,
      scope,
      captureDraftId,
      addressSnapshotRef,
      expectedVersion,
      feeMinor,
      currency,
      reason,
      eventId,
      idempotencyKey,
      deviceId,
      occurredAt,
    });
  });
}

export function parseSetCaptureDeliveryManualFeeResultV1(
  value: unknown,
): SetCaptureDeliveryManualFeeResultV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "manualFee", "replayed"]);
    if (record === undefined || own(record, "schemaVersion") !== DELIVERY_ZONE_SCHEMA_VERSION) return undefined;
    const manualFee = parseCaptureDeliveryManualFee(own(record, "manualFee"));
    const replayed = own(record, "replayed");
    if (manualFee === undefined || typeof replayed !== "boolean") return undefined;
    return Object.freeze({ schemaVersion: DELIVERY_ZONE_SCHEMA_VERSION, manualFee, replayed });
  });
}

function parseCaptureDeliveryManualFee(value: unknown): CaptureDeliveryManualFeeV1 | undefined {
  const record = exactRecord(value, [
    "eventId", "captureDraftId", "addressSnapshotRef", "feeMinor", "currency", "reason",
    "role", "actorId", "authorizedAt", "version",
  ]);
  if (record === undefined) return undefined;
  const eventId = uuid(own(record, "eventId"));
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const addressSnapshotRef = uuid(own(record, "addressSnapshotRef"));
  const feeMinor = money(own(record, "feeMinor"));
  const currency = currencyCode(own(record, "currency"));
  const reason = boundedText(own(record, "reason"), 1, MAX_REASON_LENGTH);
  const role = manualFeeRole(own(record, "role"));
  const actorId = uuid(own(record, "actorId"));
  const authorizedAt = timestamp(own(record, "authorizedAt"));
  const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
  if (eventId === undefined || captureDraftId === undefined || addressSnapshotRef === undefined
    || feeMinor === undefined || currency === undefined || reason === undefined || role === undefined
    || actorId === undefined || authorizedAt === undefined || version === undefined) return undefined;
  return Object.freeze({
    eventId, captureDraftId, addressSnapshotRef, feeMinor, currency, reason, role, actorId, authorizedAt, version,
  });
}

function manualFeeRole(value: unknown): DeliveryManualFeeRoleCodeV1 | undefined {
  return typeof value === "string" && (DELIVERY_MANUAL_FEE_ROLES_V1 as readonly string[]).includes(value)
    ? value as DeliveryManualFeeRoleCodeV1 : undefined;
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

/** Same canonical ordering rule as text arrays, restricted to UUIDs. */
function parseOrderedUuidArray(value: unknown): readonly string[] | undefined {
  const raw = parseExactArray(value, MAX_CODE_LIST_LENGTH);
  if (raw === undefined) return undefined;
  const values: string[] = [];
  let previous: string | undefined;
  for (const entry of raw) {
    const id = uuid(entry);
    if (id === undefined) return undefined;
    if (previous !== undefined && compareCodeUnits(previous, id) >= 0) return undefined;
    previous = id;
    values.push(id);
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
