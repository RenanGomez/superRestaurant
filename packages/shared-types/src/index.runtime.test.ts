import {
  BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  MEMBERSHIP_ROLE_CODES,
  parseBranchMembershipListV1,
  parseBranchScope,
  parseRestaurantScope,
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
expect(Object.isFrozen(MEMBERSHIP_ROLE_CODES), "membership role codes are frozen");

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
