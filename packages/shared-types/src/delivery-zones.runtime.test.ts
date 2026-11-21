import {
  parseDeliveryZoneListV1,
  parseDeliveryZoneMatchRequestV1,
  parseDeliveryZoneMatchResultV1,
  parseDeliveryZoneV1,
  parseListDeliveryZonesQueryV1,
  parseRequestDeliveryQuoteCommandV1,
  parseSetCaptureDeliveryManualFeeCommandV1,
  parseSetCaptureDeliveryManualFeeResultV1,
  parseSettlementSearchRequestV1,
  parseSettlementSearchResultV1,
  parseUpsertDeliveryZoneCommandV1,
  parseUpsertDeliveryZoneResultV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const restaurantId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const zoneId = "33333333-3333-4333-8333-333333333333";

const baseZone = {
  schemaVersion: 1,
  zoneId,
  restaurantId,
  branchId,
  name: "Centro",
  postalCodes: ["06000", "06010"],
  localities: ["Centro Historico"],
  settlementIds: [] as readonly string[],
  feeMinor: 2_500,
  currency: "MXN",
  active: true,
  version: 1,
  updatedAt: "2026-09-26T18:00:00.000Z",
} as const;

// --- DeliveryZoneV1: acceptance/rejection matrix ---

const parsedZone = parseDeliveryZoneV1(baseZone);
expect(parsedZone !== undefined && Object.isFrozen(parsedZone), "valid zone parses frozen");
expect(parsedZone !== undefined && Object.isFrozen(parsedZone.postalCodes), "postalCodes array is frozen");
expect(parsedZone !== undefined && Object.isFrozen(parsedZone.settlementIds), "settlementIds array is frozen");

const settlementZone = { ...baseZone, postalCodes: [], localities: [], settlementIds: ["33333333-3333-4333-8333-333333333334"] } as const;
expect(parseDeliveryZoneV1(settlementZone) !== undefined, "zone with only settlement ids parses");
// Historical rows/events without settlementIds still parse with [].
const { settlementIds: _omittedSettlements, ...legacyZone } = baseZone;
void _omittedSettlements;
const parsedLegacyZone = parseDeliveryZoneV1(legacyZone);
expect(parsedLegacyZone !== undefined && parsedLegacyZone.settlementIds.length === 0, "legacy zone without settlementIds parses as []");

const postalOnlyZone = { ...baseZone, localities: [] } as const;
expect(parseDeliveryZoneV1(postalOnlyZone) !== undefined, "zone with only postal codes parses");
const localityOnlyZone = { ...baseZone, postalCodes: [] } as const;
expect(parseDeliveryZoneV1(localityOnlyZone) !== undefined, "zone with only localities parses");

for (const invalid of [
  { ...baseZone, extra: true },
  { ...baseZone, schemaVersion: 2 },
  { ...baseZone, zoneId: "not-a-uuid" },
  { ...baseZone, restaurantId: "not-a-uuid" },
  { ...baseZone, branchId: "not-a-uuid" },
  { ...baseZone, name: "" },
  { ...baseZone, name: "  Centro" },
  { ...baseZone, name: "x".repeat(81) },
  // Neither settlements, postal codes nor localities: can never match.
  { ...baseZone, postalCodes: [], localities: [], settlementIds: [] },
  // Duplicate or unsorted entries are not canonical.
  { ...baseZone, postalCodes: ["06010", "06000"] },
  { ...baseZone, postalCodes: ["06000", "06000"] },
  { ...baseZone, postalCodes: ["", "06010"] },
  { ...baseZone, postalCodes: ["  06000", "06010"] },
  { ...baseZone, settlementIds: ["not-a-uuid"] },
  { ...baseZone, settlementIds: ["44444444-4444-4444-8444-444444444444", "33333333-3333-4333-8333-333333333333"] },
  { ...baseZone, feeMinor: -1 },
  { ...baseZone, feeMinor: 1.5 },
  { ...baseZone, currency: "mxn" },
  { ...baseZone, currency: "MX" },
  { ...baseZone, active: "true" },
  { ...baseZone, version: 0 },
  { ...baseZone, version: 1.5 },
  { ...baseZone, updatedAt: "2026-09-26" },
]) expect(parseDeliveryZoneV1(invalid) === undefined, `zone rejects invalid facts: ${JSON.stringify(invalid)}`);

// Hostile inputs fail closed without invoking accessors.
const zoneAccessor = Object.defineProperty({ ...baseZone }, "feeMinor", { get: () => 2_500, enumerable: true });
expect(parseDeliveryZoneV1(zoneAccessor) === undefined, "zone accessor is not invoked");
expect(parseDeliveryZoneV1(Object.assign(Object.create({}), baseZone)) === undefined, "zone prototype rejected");
expect(
  parseDeliveryZoneV1(new Proxy(baseZone, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "zone hostile proxy fails closed",
);
const postalCodeAccessor = Object.defineProperty([...baseZone.postalCodes] as string[], "0", {
  get: () => "06000",
  enumerable: true,
});
expect(
  parseDeliveryZoneV1({ ...baseZone, postalCodes: postalCodeAccessor }) === undefined,
  "postalCodes accessor entry is not invoked",
);
expect(
  parseDeliveryZoneV1({
    ...baseZone,
    postalCodes: new Proxy([...baseZone.postalCodes], { ownKeys: () => { throw new Error("hostile"); } }),
  }) === undefined,
  "postalCodes hostile proxy fails closed",
);

// --- Idempotency: parsing the same valid input twice yields bit-exact frozen output ---
const firstZoneParse = parseDeliveryZoneV1(baseZone);
const secondZoneParse = parseDeliveryZoneV1(baseZone);
expect(
  firstZoneParse !== undefined && secondZoneParse !== undefined && JSON.stringify(firstZoneParse) === JSON.stringify(secondZoneParse),
  "repeated zone parsing is idempotent",
);

// --- ListDeliveryZonesQueryV1 ---

const restaurantQuery = { schemaVersion: 1, scope: { kind: "restaurant", restaurantId } } as const;
expect(parseListDeliveryZonesQueryV1(restaurantQuery) !== undefined, "restaurant-scoped query parses");
const branchQuery = { schemaVersion: 1, scope: { kind: "branch", restaurantId, branchId } } as const;
expect(parseListDeliveryZonesQueryV1(branchQuery) !== undefined, "branch-scoped query parses");

for (const invalid of [
  { ...restaurantQuery, extra: true },
  { schemaVersion: 1, scope: { kind: "restaurant", restaurantId, branchId } },
  { schemaVersion: 1, scope: { kind: "branch", restaurantId } },
  { schemaVersion: 1, scope: { kind: "other", restaurantId } },
  { schemaVersion: 1, scope: { restaurantId } },
]) expect(parseListDeliveryZonesQueryV1(invalid) === undefined, `query rejects invalid scope: ${JSON.stringify(invalid)}`);

// --- DeliveryZoneListV1 ---

const restaurantList = {
  schemaVersion: 1,
  scope: restaurantQuery.scope,
  zones: [baseZone, { ...baseZone, zoneId: "44444444-4444-4444-8444-444444444444" }],
} as const;
expect(parseDeliveryZoneListV1(restaurantList) !== undefined, "restaurant-scoped list of ordered zones parses");

const branchList = { schemaVersion: 1, scope: branchQuery.scope, zones: [baseZone] } as const;
expect(parseDeliveryZoneListV1(branchList) !== undefined, "branch-scoped list parses");

for (const invalid of [
  { ...branchList, extra: true },
  // Zones out of ascending zoneId order.
  { schemaVersion: 1, scope: restaurantQuery.scope, zones: [restaurantList.zones[1], restaurantList.zones[0]] },
  // Duplicate zoneId.
  { schemaVersion: 1, scope: restaurantQuery.scope, zones: [baseZone, baseZone] },
  // A branch-scoped list carrying a zone from a different branch.
  { schemaVersion: 1, scope: branchQuery.scope, zones: [{ ...baseZone, branchId: "55555555-5555-4555-8555-555555555555" }] },
  // A zone from a different restaurant altogether.
  { schemaVersion: 1, scope: restaurantQuery.scope, zones: [{ ...baseZone, restaurantId: "66666666-6666-4666-8666-666666666666" }] },
]) expect(parseDeliveryZoneListV1(invalid) === undefined, `list rejects invalid facts: ${JSON.stringify(invalid)}`);

// --- UpsertDeliveryZoneCommandV1 ---

const baseUpsert = {
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  zoneId,
  expectedVersion: 0,
  name: "Centro",
  postalCodes: ["06000"],
  localities: [] as readonly string[],
  settlementIds: [] as readonly string[],
  feeMinor: 2_500,
  currency: "MXN",
  active: true,
  eventId: "77777777-7777-4777-8777-777777777777",
  idempotencyKey: "88888888-8888-4888-8888-888888888888",
  deviceId: "99999999-9999-4999-8999-999999999999",
  occurredAt: "2026-09-26T18:00:00.000Z",
  reason: null,
} as const;

const parsedCreate = parseUpsertDeliveryZoneCommandV1(baseUpsert);
expect(parsedCreate !== undefined && Object.isFrozen(parsedCreate), "create command (expectedVersion 0) parses frozen");

const { settlementIds: _omittedUpsertSettlements, ...legacyUpsert } = baseUpsert;
void _omittedUpsertSettlements;
const parsedLegacyUpsert = parseUpsertDeliveryZoneCommandV1(legacyUpsert);
expect(parsedLegacyUpsert !== undefined && parsedLegacyUpsert.settlementIds.length === 0,
  "legacy command without settlementIds parses as []");

const settlementCommand = { ...baseUpsert, postalCodes: [], settlementIds: ["33333333-3333-4333-8333-333333333334"] } as const;
expect(parseUpsertDeliveryZoneCommandV1(settlementCommand) !== undefined, "settlement-only command parses");

const updateCommand = { ...baseUpsert, expectedVersion: 3 } as const;
expect(parseUpsertDeliveryZoneCommandV1(updateCommand) !== undefined, "update command with a positive expectedVersion parses");

const deactivateCommand = { ...baseUpsert, active: false, reason: "Cobertura suspendida por lluvia" } as const;
expect(parseUpsertDeliveryZoneCommandV1(deactivateCommand) !== undefined, "deactivation with an audited reason parses");

for (const invalid of [
  { ...baseUpsert, extra: true },
  { ...baseUpsert, expectedVersion: -1 },
  { ...baseUpsert, expectedVersion: 1.5 },
  { ...baseUpsert, postalCodes: [], localities: [] },
  { ...baseUpsert, settlementIds: ["not-a-uuid"] },
  { ...baseUpsert, settlementIds: ["44444444-4444-4444-8444-444444444444", "33333333-3333-4333-8333-333333333333"] },
  { ...baseUpsert, eventId: "not-a-uuid" },
  { ...baseUpsert, idempotencyKey: "not-a-uuid" },
  { ...baseUpsert, deviceId: "not-a-uuid" },
  { ...baseUpsert, occurredAt: "2026-09-26" },
  { ...baseUpsert, reason: "" },
  { ...baseUpsert, reason: "   " },
  // Deactivation without an audited reason must be rejected.
  { ...baseUpsert, active: false, reason: null },
  { ...baseUpsert, scope: { restaurantId } },
  { ...baseUpsert, scope: { restaurantId, branchId, extra: true } },
]) expect(parseUpsertDeliveryZoneCommandV1(invalid) === undefined, `upsert command rejects invalid facts: ${JSON.stringify(invalid)}`);

const upsertAccessor = Object.defineProperty({ ...baseUpsert }, "expectedVersion", { get: () => 0, enumerable: true });
expect(parseUpsertDeliveryZoneCommandV1(upsertAccessor) === undefined, "upsert accessor is not invoked");
expect(parseUpsertDeliveryZoneCommandV1(Object.assign(Object.create({}), baseUpsert)) === undefined, "upsert prototype rejected");
expect(
  parseUpsertDeliveryZoneCommandV1(new Proxy(baseUpsert, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "upsert hostile proxy fails closed",
);

// --- Idempotency: identical command parses to bit-exact frozen output ---
const firstUpsertParse = parseUpsertDeliveryZoneCommandV1(baseUpsert);
const secondUpsertParse = parseUpsertDeliveryZoneCommandV1(baseUpsert);
expect(
  firstUpsertParse !== undefined && secondUpsertParse !== undefined
  && JSON.stringify(firstUpsertParse) === JSON.stringify(secondUpsertParse),
  "repeated upsert-command parsing is idempotent",
);

// --- UpsertDeliveryZoneResultV1 ---

const upsertResult = { schemaVersion: 1, zone: baseZone, replayed: false } as const;
expect(parseUpsertDeliveryZoneResultV1(upsertResult) !== undefined, "upsert result parses");
const replayedResult = { ...upsertResult, replayed: true } as const;
expect(parseUpsertDeliveryZoneResultV1(replayedResult) !== undefined, "replayed upsert result parses");

for (const invalid of [
  { ...upsertResult, extra: true },
  { ...upsertResult, replayed: "false" },
  { ...upsertResult, zone: { ...baseZone, feeMinor: -1 } },
]) expect(parseUpsertDeliveryZoneResultV1(invalid) === undefined, `upsert result rejects invalid facts: ${JSON.stringify(invalid)}`);

// --- RequestDeliveryQuoteCommandV1 ---

const baseQuoteCommand = {
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  captureDraftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  scheduledFor: null,
} as const;
expect(parseRequestDeliveryQuoteCommandV1(baseQuoteCommand) !== undefined, "ASAP quote request parses");

const scheduledQuoteCommand = { ...baseQuoteCommand, scheduledFor: "2026-09-27T12:00:00.000Z" } as const;
expect(parseRequestDeliveryQuoteCommandV1(scheduledQuoteCommand) !== undefined, "scheduled quote request parses");

for (const invalid of [
  { ...baseQuoteCommand, extra: true },
  // Never transports a fee or a zone.
  { ...baseQuoteCommand, feeMinor: 0 },
  { ...baseQuoteCommand, zoneId },
  { ...baseQuoteCommand, captureDraftId: "not-a-uuid" },
  { ...baseQuoteCommand, scheduledFor: "2026-09-27" },
  { ...baseQuoteCommand, scope: { restaurantId } },
]) expect(parseRequestDeliveryQuoteCommandV1(invalid) === undefined, `quote request rejects invalid facts: ${JSON.stringify(invalid)}`);

const quoteAccessor = Object.defineProperty({ ...baseQuoteCommand }, "captureDraftId", {
  get: () => baseQuoteCommand.captureDraftId,
  enumerable: true,
});
expect(parseRequestDeliveryQuoteCommandV1(quoteAccessor) === undefined, "quote request accessor is not invoked");
expect(
  parseRequestDeliveryQuoteCommandV1(new Proxy(baseQuoteCommand, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "quote request hostile proxy fails closed",
);

// --- DeliveryZoneMatchRequestV1 / DeliveryZoneMatchResultV1 ---

const matchRequest = { schemaVersion: 1, restaurantId, branchId, address: { postalCode: "06000", locality: "Centro Historico" } };
expect(parseDeliveryZoneMatchRequestV1(matchRequest) !== undefined, "match request parses");
expect(
  parseDeliveryZoneMatchRequestV1({ ...matchRequest, address: { postalCode: null, locality: "Centro" } }) !== undefined,
  "match request accepts a null postal code",
);
expect(
  parseDeliveryZoneMatchRequestV1({ ...matchRequest, address: { postalCode: "06000" } }) !== undefined,
  "legacy match request without locality parses",
);
const settlementMatchRequest = {
  ...matchRequest,
  address: { settlementId: "33333333-3333-4333-8333-333333333333", neighborhood: "Benito Juárez", postalCode: null, locality: null },
};
expect(parseDeliveryZoneMatchRequestV1(settlementMatchRequest) !== undefined, "match request accepts settlement facts");
expect(parseDeliveryZoneMatchRequestV1({ ...matchRequest, extra: 1 }) === undefined, "match request rejects extra keys");
expect(parseDeliveryZoneMatchRequestV1({ ...matchRequest, schemaVersion: 2 }) === undefined, "match request rejects version 2");
expect(parseDeliveryZoneMatchRequestV1({ ...matchRequest, branchId: "nope" }) === undefined, "match request rejects bad branch id");
expect(
  parseDeliveryZoneMatchRequestV1({ ...matchRequest, address: { postalCode: "06000", locality: " " } }) === undefined,
  "match request rejects blank locality",
);
expect(
  parseDeliveryZoneMatchRequestV1({ ...settlementMatchRequest, address: { ...settlementMatchRequest.address, settlementId: "nope" } }) === undefined,
  "match request rejects a malformed settlement id",
);
expect(
  parseDeliveryZoneMatchRequestV1(new Proxy(matchRequest, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "match request hostile proxy fails closed",
);

const coveredMatch = {
  schemaVersion: 1, coverageStatus: "covered", zoneId, zoneName: "Centro", feeMinor: 3_500, currency: "MXN",
  promiseMinutes: 15, promiseStart: "2026-10-05T18:00:00.000Z", promiseEnd: "2026-10-05T18:15:00.000Z",
  evaluatedAt: "2026-10-05T18:00:00.000Z",
};
const notCoveredMatch = { ...coveredMatch, coverageStatus: "not_covered", zoneId: null, zoneName: null, feeMinor: 0 };
expect(parseDeliveryZoneMatchResultV1(coveredMatch) !== undefined, "covered match result parses");
expect(parseDeliveryZoneMatchResultV1(notCoveredMatch) !== undefined, "not_covered match result parses");
expect(parseDeliveryZoneMatchResultV1({ ...notCoveredMatch, feeMinor: 100 }) === undefined, "not_covered with a fee is rejected");
expect(parseDeliveryZoneMatchResultV1({ ...notCoveredMatch, zoneId }) === undefined, "not_covered with a zone is rejected");
expect(parseDeliveryZoneMatchResultV1({ ...coveredMatch, zoneId: null }) === undefined, "covered without a zone is rejected");
expect(parseDeliveryZoneMatchResultV1({ ...coveredMatch, feeMinor: 35.5 }) === undefined, "fractional fee is rejected");
expect(parseDeliveryZoneMatchResultV1({ ...coveredMatch, feeMinor: -1 }) === undefined, "negative fee is rejected");
expect(parseDeliveryZoneMatchResultV1({ ...coveredMatch, promiseMinutes: 30 }) === undefined, "window must match promiseMinutes");
expect(
  parseDeliveryZoneMatchResultV1({ ...coveredMatch, evaluatedAt: "2026-10-05T18:00:01.000Z" }) === undefined,
  "promise cannot start before evaluation",
);
expect(parseDeliveryZoneMatchResultV1({ ...coveredMatch, coverageStatus: "maybe" }) === undefined, "unknown coverage status is rejected");
expect(parseDeliveryZoneMatchResultV1({ ...coveredMatch, quoteId: zoneId }) === undefined, "match result rejects extra keys");

const settlementId = "33333333-3333-4333-8333-333333333334";
const extendedCoveredMatch = {
  ...coveredMatch,
  reason: null,
  matchedBy: "settlement",
  settlement: { settlementId, name: "Benito Juárez", postalCode: "06000" },
};
expect(parseDeliveryZoneMatchResultV1(extendedCoveredMatch) !== undefined, "extended covered match result parses");
const extendedNotCoveredMatch = {
  ...notCoveredMatch,
  reason: { code: "settlement_not_in_zone", message: "La colonia Benito Juárez no está en ninguna zona de la sucursal Centro." },
  matchedBy: null,
  settlement: null,
};
expect(parseDeliveryZoneMatchResultV1(extendedNotCoveredMatch) !== undefined, "extended not_covered match result parses");
expect(
  parseDeliveryZoneMatchResultV1({ ...extendedCoveredMatch, matchedBy: null }) === undefined,
  "covered result requires matchedBy",
);
expect(
  parseDeliveryZoneMatchResultV1({ ...extendedNotCoveredMatch, reason: null }) === undefined,
  "not_covered result requires a reason",
);
expect(
  parseDeliveryZoneMatchResultV1({ ...extendedNotCoveredMatch, reason: { code: "invented", message: "x" } }) === undefined,
  "not_covered result rejects unknown reason codes",
);
expect(
  parseDeliveryZoneMatchResultV1({ ...extendedNotCoveredMatch, reason: { code: "settlement_unknown", message: "x".repeat(401) } }) === undefined,
  "reason messages are bounded",
);

// --- Settlement search ---

const settlementIdForSearch = "33333333-3333-4333-8333-333333333334";
const searchRequest = {
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  query: "benito",
  postalCode: null,
  limit: 20,
} as const;
expect(parseSettlementSearchRequestV1(searchRequest) !== undefined, "prefix search request parses");
expect(parseSettlementSearchRequestV1({ ...searchRequest, query: null, postalCode: "06000" }) !== undefined,
  "postal-code search request parses");

for (const invalid of [
  { ...searchRequest, extra: true },
  { ...searchRequest, query: null, postalCode: null },
  { ...searchRequest, query: "benito", postalCode: "06000" },
  { ...searchRequest, query: "b" },
  { ...searchRequest, postalCode: "0600" },
  { ...searchRequest, limit: 0 },
  { ...searchRequest, limit: 51 },
  { ...searchRequest, scope: { restaurantId } },
]) expect(parseSettlementSearchRequestV1(invalid) === undefined, `search request rejects invalid facts: ${JSON.stringify(invalid)}`);

const settlementSummary = {
  settlementId: settlementIdForSearch,
  name: "Benito Juárez",
  postalCode: "06000",
  settlementType: "Colonia",
  municipality: "Navojoa",
  state: "Sonora",
  countryCode: "MX",
} as const;
const searchResult = {
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  branch: { name: "Centro", locality: "Navojoa", region: "Sonora", countryCode: "MX" },
  settlements: [settlementSummary],
} as const;
expect(parseSettlementSearchResultV1(searchResult) !== undefined, "search result parses");
expect(parseSettlementSearchResultV1({ ...searchResult, settlements: [] }) !== undefined, "empty search result is valid");
for (const invalid of [
  { ...searchResult, extra: true },
  { ...searchResult, settlements: [{ ...settlementSummary, settlementId: "nope" }] },
  { ...searchResult, settlements: [{ ...settlementSummary, postalCode: "0600" }] },
  { ...searchResult, settlements: [{ ...settlementSummary, countryCode: "mex" }] },
  { ...searchResult, branch: { ...searchResult.branch, countryCode: "MEX" } },
]) expect(parseSettlementSearchResultV1(invalid) === undefined, `search result rejects invalid facts: ${JSON.stringify(invalid)}`);

// --- Manual delivery fee ---

const manualFeeCommand = {
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  captureDraftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  addressSnapshotRef: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  expectedVersion: 0,
  feeMinor: 3_000,
  currency: "MXN",
  reason: "Colonia fuera de zona autorizada",
  eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  deviceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  occurredAt: "2026-11-21T18:00:00.000Z",
} as const;
expect(parseSetCaptureDeliveryManualFeeCommandV1(manualFeeCommand) !== undefined, "manual fee command parses");
for (const invalid of [
  { ...manualFeeCommand, extra: true },
  { ...manualFeeCommand, expectedVersion: -1 },
  { ...manualFeeCommand, feeMinor: -1 },
  { ...manualFeeCommand, feeMinor: 1.5 },
  { ...manualFeeCommand, currency: "mxn" },
  { ...manualFeeCommand, reason: "" },
  { ...manualFeeCommand, reason: "   " },
  { ...manualFeeCommand, addressSnapshotRef: "nope" },
  { ...manualFeeCommand, idempotencyKey: "nope" },
  { ...manualFeeCommand, occurredAt: "2026-11-21" },
]) expect(parseSetCaptureDeliveryManualFeeCommandV1(invalid) === undefined,
  `manual fee command rejects invalid facts: ${JSON.stringify(invalid)}`);

const manualFeeResult = {
  schemaVersion: 1,
  manualFee: {
    eventId: manualFeeCommand.eventId,
    captureDraftId: manualFeeCommand.captureDraftId,
    addressSnapshotRef: manualFeeCommand.addressSnapshotRef,
    feeMinor: 3_000,
    currency: "MXN",
    reason: manualFeeCommand.reason,
    role: "supervisor",
    actorId: "77777777-7777-4777-8777-777777777777",
    authorizedAt: "2026-11-21T18:00:00.000Z",
    version: 1,
  },
  replayed: false,
} as const;
expect(parseSetCaptureDeliveryManualFeeResultV1(manualFeeResult) !== undefined, "manual fee result parses");
expect(parseSetCaptureDeliveryManualFeeResultV1({ ...manualFeeResult, replayed: true }) !== undefined,
  "replayed manual fee result parses");
for (const invalid of [
  { ...manualFeeResult, extra: true },
  { ...manualFeeResult, replayed: "false" },
  { ...manualFeeResult, manualFee: { ...manualFeeResult.manualFee, role: "cashier" } },
  { ...manualFeeResult, manualFee: { ...manualFeeResult.manualFee, version: 0 } },
  { ...manualFeeResult, manualFee: { ...manualFeeResult.manualFee, extra: true } },
]) expect(parseSetCaptureDeliveryManualFeeResultV1(invalid) === undefined,
  `manual fee result rejects invalid facts: ${JSON.stringify(invalid)}`);
