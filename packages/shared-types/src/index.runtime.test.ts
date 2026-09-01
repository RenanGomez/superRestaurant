import {
  BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  DINING_ZONE_SCHEMA_VERSION,
  DINING_LAYOUT_SCHEMA_VERSION,
  MEMBERSHIP_ROLE_CODES,
  parseCreateDiningZoneCommandV1,
  parseDiningZoneV1,
  parseCreateDiningTableCommandV1,
  parseDiningLayoutV1,
  parseDiningTableV1,
  parseUpdateDiningTableLayoutCommandV1,
  parseBranchMembershipListV1,
  parseBranchScope,
  parseRbacPermissionCode,
  parseRestaurantScope,
  RBAC_MATRIX_VERSION,
  RBAC_PERMISSION_CODES,
  SCOPE_SCHEMA_VERSION,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectDefined<T>(value: T | undefined, message: string): asserts value is T {
  if (value === undefined) throw new Error(message);
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  expect(Object.is(actual, expected), `${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function expectUndefined(actual: unknown, message: string): void {
  expectEqual(actual, undefined, message);
}

function expectRestaurantScope(input: unknown, message: string): void {
  const parsed = parseRestaurantScope(input);
  expect(parsed !== undefined, message);
  expect(Object.isFrozen(parsed), `${message}: parser output must be frozen`);
}

function expectBranchScope(input: unknown, message: string): void {
  const parsed = parseBranchScope(input);
  expect(parsed !== undefined, message);
  expect(Object.isFrozen(parsed), `${message}: parser output must be frozen`);
}

expectEqual(SCOPE_SCHEMA_VERSION, 1, "scope schema version is explicit");
expectEqual(RBAC_MATRIX_VERSION, 1, "RBAC matrix version is explicit");
expectEqual(DINING_ZONE_SCHEMA_VERSION, 1, "dining-zone schema version is explicit");
expectEqual(DINING_LAYOUT_SCHEMA_VERSION, 1, "dining-layout schema version is explicit");
expect(Object.isFrozen(MEMBERSHIP_ROLE_CODES), "membership role codes are frozen");
expect(Object.isFrozen(RBAC_PERMISSION_CODES), "RBAC permission codes are frozen");
expectEqual(parseRbacPermissionCode("orders.create"), "orders.create", "known RBAC permission parses");
for (const invalidPermission of [undefined, null, 1, "", "orders.delete", new String("orders.create")]) {
  expectUndefined(parseRbacPermissionCode(invalidPermission), "unknown or non-primitive RBAC permission is rejected");
}

const restaurantInput = { restaurantId: "restaurant-1" };
const restaurantScope = parseRestaurantScope(restaurantInput);
expectDefined(restaurantScope, "restaurant scope parses");
expect(restaurantScope !== restaurantInput, "restaurant scope is a new value");
expect(Object.isFrozen(restaurantScope), "restaurant scope is frozen");
expectEqual(restaurantScope.restaurantId, "restaurant-1" as typeof restaurantScope.restaurantId, "restaurant id is preserved");

const branchInput = { restaurantId: "restaurant-1", branchId: "branch-1" };
const branchScope = parseBranchScope(branchInput);
expectDefined(branchScope, "branch scope parses");
expect(branchScope !== branchInput, "branch scope is a new value");
expect(Object.isFrozen(branchScope), "branch scope is frozen");
expectEqual(branchScope.restaurantId, "restaurant-1" as typeof branchScope.restaurantId, "branch restaurant id is preserved");
expectEqual(branchScope.branchId, "branch-1" as typeof branchScope.branchId, "branch id is preserved");

expectRestaurantScope(Object.assign(Object.create(null), { restaurantId: "restaurant-null-prototype" }), "null-prototype plain object parses");
expectBranchScope({ restaurantId: "restaurant-1", branchId: "branch-1" }, "branch scope parses exact fields");

for (const invalid of [undefined, null, [], "scope", 1, { restaurantId: "" }, { restaurantId: "  " }]) {
  expectUndefined(parseRestaurantScope(invalid), "restaurant parser rejects invalid scalar, empty, or array input");
}

for (const invalid of [undefined, null, [], "scope", 1, { restaurantId: "restaurant-1" }, { restaurantId: "restaurant-1", branchId: "" }]) {
  expectUndefined(parseBranchScope(invalid), "branch parser rejects invalid scalar, missing, or empty input");
}

expectUndefined(parseRestaurantScope({ restaurantId: "restaurant-1", branchId: "branch-1" }), "restaurant parser rejects extra fields");
expectUndefined(parseBranchScope({ restaurantId: "restaurant-1", branchId: "branch-1", extra: true }), "branch parser rejects extra fields");
expectUndefined(parseRestaurantScope({ restaurantId: "restaurant-1", [Symbol("extra")]: true }), "parser rejects symbol extra fields");

const inheritedRestaurant = Object.create({ restaurantId: "restaurant-1" }) as object;
expectUndefined(parseRestaurantScope(inheritedRestaurant), "parser rejects inherited required fields");
expectUndefined(parseRestaurantScope(Object.create({})), "parser rejects hostile prototypes");

const accessorRestaurant = {};
Object.defineProperty(accessorRestaurant, "restaurantId", { get: () => "restaurant-1", enumerable: true });
expectUndefined(parseRestaurantScope(accessorRestaurant), "parser rejects accessors without invoking them");

const accessorBranch = { restaurantId: "restaurant-1" };
Object.defineProperty(accessorBranch, "branchId", { get: () => "branch-1", enumerable: true });
expectUndefined(parseBranchScope(accessorBranch), "branch parser rejects accessors without invoking them");

const hostileProxy = new Proxy({ restaurantId: "restaurant-1" }, {
  getPrototypeOf: () => {
    throw new Error("hostile prototype trap");
  },
});
expectUndefined(parseRestaurantScope(hostileProxy), "parser fails closed for hostile proxy traps");

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const membershipList = parseBranchMembershipListV1({
  schemaVersion: BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  memberships: [{
    scope: { restaurantId, branchId },
    restaurantName: "Restaurante Centro",
    branchName: "Sucursal Norte",
    roles: ["manager", "waiter"],
  }],
});
expectDefined(membershipList, "membership list parses");
expect(Object.isFrozen(membershipList), "membership list is frozen");
expect(Object.isFrozen(membershipList.memberships), "membership array is frozen");
expect(Object.isFrozen(membershipList.memberships[0]?.roles), "membership roles are frozen");

for (const invalid of [
  { schemaVersion: 2, memberships: [] },
  { schemaVersion: 1, memberships: [], extra: true },
  { schemaVersion: 1, memberships: [{ scope: { restaurantId, branchId }, restaurantName: "", branchName: "Norte", roles: ["manager"] }] },
  { schemaVersion: 1, memberships: [{ scope: { restaurantId, branchId }, restaurantName: "Centro", branchName: "Norte", roles: ["waiter", "manager"] }] },
  { schemaVersion: 1, memberships: [{ scope: { restaurantId, branchId }, restaurantName: "Centro", branchName: "Norte", roles: ["manager", "manager"] }] },
  { schemaVersion: 1, memberships: [{ scope: { restaurantId, branchId: "not-a-uuid" }, restaurantName: "Centro", branchName: "Norte", roles: ["manager"] }] },
]) {
  expectUndefined(parseBranchMembershipListV1(invalid), "membership parser rejects malformed contracts");
}

const membershipAccessor = { schemaVersion: 1 };
Object.defineProperty(membershipAccessor, "memberships", { enumerable: true, get: () => [] });
expectUndefined(parseBranchMembershipListV1(membershipAccessor), "membership parser rejects accessors");
const hiddenMemberships = { schemaVersion: 1 };
Object.defineProperty(hiddenMemberships, "memberships", { enumerable: false, value: [] });
expectUndefined(parseBranchMembershipListV1(hiddenMemberships), "membership parser rejects hidden required fields");
expectUndefined(
  parseBranchMembershipListV1(new Proxy({ schemaVersion: 1, memberships: [] }, { ownKeys: () => { throw new Error("hostile"); } })),
  "membership parser rejects hostile proxies",
);

const zoneCommand = parseCreateDiningZoneCommandV1({
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  zoneId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
  eventId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
  idempotencyKey: "c483b6e7-e102-4cc5-a887-d30712c85e52",
  deviceId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  occurredAt: "2026-08-31T17:00:00.000Z",
  name: "Terraza",
});
expectDefined(zoneCommand, "dining-zone command parses");
expect(Object.isFrozen(zoneCommand), "dining-zone command is frozen");
expect(Object.isFrozen(zoneCommand.scope), "dining-zone command scope is frozen");

const zoneResponse = parseDiningZoneV1({
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  zoneId: zoneCommand.zoneId,
  name: zoneCommand.name,
  version: 1,
  createdAt: "2026-08-31T17:00:01.000Z",
  createdBy: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  replayed: false,
});
expectDefined(zoneResponse, "dining-zone response parses");
expect(Object.isFrozen(zoneResponse), "dining-zone response is frozen");

for (const invalid of [
  { ...zoneCommand, schemaVersion: 2 },
  { ...zoneCommand, name: " Terraza" },
  { ...zoneCommand, name: "x".repeat(81) },
  { ...zoneCommand, occurredAt: "2026-08-31T17:00:00Z" },
  { ...zoneCommand, zoneId: "not-a-uuid" },
  { ...zoneCommand, extra: true },
]) expectUndefined(parseCreateDiningZoneCommandV1(invalid), "dining-zone command rejects malformed input");

for (const invalid of [
  { ...zoneResponse, version: 0 },
  { ...zoneResponse, replayed: "false" },
  { ...zoneResponse, createdAt: "invalid" },
  { ...zoneResponse, createdBy: "not-a-uuid" },
  { ...zoneResponse, extra: true },
]) expectUndefined(parseDiningZoneV1(invalid), "dining-zone response rejects malformed input");

const tableCommand = parseCreateDiningTableCommandV1({
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  tableId: "9544c299-d25b-44ce-98ed-d30116610887",
  zoneId: zoneCommand.zoneId,
  eventId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
  idempotencyKey: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  deviceId: "88d34b74-6afe-4a3c-acb9-9fc8ed902c91",
  occurredAt: "2026-09-01T18:00:00.000Z",
  name: "Mesa 1",
  capacity: 4,
  shape: "round",
  layout: { x: 2, y: 3, width: 4, height: 4 },
});
expectDefined(tableCommand, "dining-table command parses");
expect(Object.isFrozen(tableCommand.layout), "dining-table geometry is frozen");

const tableResponse = parseDiningTableV1({
  ...tableCommand,
  version: 1,
  updatedAt: "2026-09-01T18:00:01.000Z",
  updatedBy: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  replayed: false,
  eventId: undefined,
  idempotencyKey: undefined,
  deviceId: undefined,
  occurredAt: undefined,
});
expectUndefined(tableResponse, "dining-table response rejects extra command fields");
const exactTableResponse = {
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  tableId: tableCommand.tableId,
  zoneId: tableCommand.zoneId,
  name: tableCommand.name,
  capacity: tableCommand.capacity,
  shape: tableCommand.shape,
  layout: tableCommand.layout,
  version: 1,
  updatedAt: "2026-09-01T18:00:01.000Z",
  updatedBy: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  replayed: false,
};
expectDefined(parseDiningTableV1(exactTableResponse), "dining-table response parses");
expectDefined(parseUpdateDiningTableLayoutCommandV1({
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  tableId: tableCommand.tableId,
  eventId: "5ed22a92-a93d-4034-9661-4df2b523517b",
  idempotencyKey: "72371a5f-2056-448d-9ddb-14ab6664a4e8",
  deviceId: tableCommand.deviceId,
  occurredAt: "2026-09-01T18:05:00.000Z",
  expectedVersion: 1,
  layout: { x: 4, y: 5, width: 4, height: 4 },
}), "layout update command parses");
expectDefined(parseDiningLayoutV1({
  schemaVersion: 1,
  scope: { restaurantId, branchId },
  zones: [{ zoneId: zoneCommand.zoneId, name: zoneCommand.name, version: 1, tables: [exactTableResponse] }],
}), "dining layout parses");

for (const invalid of [
  { ...tableCommand, capacity: 0 },
  { ...tableCommand, shape: "oval" },
  { ...tableCommand, layout: { x: 23, y: 0, width: 2, height: 2 } },
  { ...tableCommand, layout: { x: 0.5, y: 0, width: 2, height: 2 } },
]) expectUndefined(parseCreateDiningTableCommandV1(invalid), "dining-table command rejects invalid geometry or properties");
