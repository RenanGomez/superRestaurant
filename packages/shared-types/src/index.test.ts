import {
  BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  MEMBERSHIP_ROLE_CODES,
  parseBranchMembershipListV1,
  parseBranchScope,
  parseRestaurantScope,
  type BranchId,
  type BranchMembershipListV1,
  type BranchScope,
  type RestaurantId,
  type RestaurantScope,
} from "./index.js";

declare const restaurantId: RestaurantId;
declare const branchId: BranchId;

const restaurantScope: RestaurantScope = { restaurantId };
const branchScope: BranchScope = { restaurantId, branchId };

void restaurantScope;
void branchScope;

// @ts-expect-error Restaurant and branch identifiers must not be interchangeable.
const invalidRestaurantId: RestaurantId = branchId;
void invalidRestaurantId;

const parsedRestaurantScope: RestaurantScope | undefined = parseRestaurantScope({ restaurantId: "restaurant-1" });
const parsedBranchScope: BranchScope | undefined = parseBranchScope({ restaurantId: "restaurant-1", branchId: "branch-1" });

void parsedRestaurantScope;
void parsedBranchScope;

const parsedMemberships: BranchMembershipListV1 | undefined = parseBranchMembershipListV1({
  schemaVersion: BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  memberships: [],
});
const knownRole = MEMBERSHIP_ROLE_CODES[0];
void parsedMemberships;
void knownRole;

// @ts-expect-error Runtime parsing is required before untrusted strings become branded identifiers.
const invalidRestaurantScope: RestaurantScope = { restaurantId: "restaurant-1" };
void invalidRestaurantScope;
