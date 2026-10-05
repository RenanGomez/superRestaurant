import {
  parseDeliveryZoneListV1,
  parseDeliveryZoneMatchRequestV1,
  parseDeliveryZoneMatchResultV1,
  parseDeliveryZoneV1,
  parseListDeliveryZonesQueryV1,
  parseRequestDeliveryQuoteCommandV1,
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
  // Neither postal codes nor localities: can never match.
  { ...baseZone, postalCodes: [], localities: [] },
  // Duplicate or unsorted entries are not canonical.
  { ...baseZone, postalCodes: ["06010", "06000"] },
  { ...baseZone, postalCodes: ["06000", "06000"] },
  { ...baseZone, postalCodes: ["", "06010"] },
  { ...baseZone, postalCodes: ["  06000", "06010"] },
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

const updateCommand = { ...baseUpsert, expectedVersion: 3 } as const;
expect(parseUpsertDeliveryZoneCommandV1(updateCommand) !== undefined, "update command with a positive expectedVersion parses");

const deactivateCommand = { ...baseUpsert, active: false, reason: "Cobertura suspendida por lluvia" } as const;
expect(parseUpsertDeliveryZoneCommandV1(deactivateCommand) !== undefined, "deactivation with an audited reason parses");

for (const invalid of [
  { ...baseUpsert, extra: true },
  { ...baseUpsert, expectedVersion: -1 },
  { ...baseUpsert, expectedVersion: 1.5 },
  { ...baseUpsert, postalCodes: [], localities: [] },
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
expect(parseDeliveryZoneMatchRequestV1({ ...matchRequest, extra: 1 }) === undefined, "match request rejects extra keys");
expect(parseDeliveryZoneMatchRequestV1({ ...matchRequest, schemaVersion: 2 }) === undefined, "match request rejects version 2");
expect(parseDeliveryZoneMatchRequestV1({ ...matchRequest, branchId: "nope" }) === undefined, "match request rejects bad branch id");
expect(
  parseDeliveryZoneMatchRequestV1({ ...matchRequest, address: { postalCode: "06000", locality: " " } }) === undefined,
  "match request rejects blank locality",
);
expect(
  parseDeliveryZoneMatchRequestV1({ ...matchRequest, address: { postalCode: "06000" } }) === undefined,
  "match request rejects a missing locality",
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
