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
  parseRbacPermissionCode,
  parseBranchMembershipListV1,
  parseBranchScope,
  parseRestaurantScope,
  RBAC_MATRIX_VERSION,
  RBAC_PERMISSION_CODES,
  type BranchId,
  type BranchMembershipListV1,
  type BranchScope,
  type CreateDiningZoneCommandV1,
  type DiningZoneV1,
  type CreateDiningTableCommandV1,
  type DiningLayoutV1,
  type DiningTableV1,
  type UpdateDiningTableLayoutCommandV1,
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
const knownPermission = RBAC_PERMISSION_CODES[0];
const parsedPermission = parseRbacPermissionCode(knownPermission);
void parsedMemberships;
void knownRole;
void parsedPermission;
void RBAC_MATRIX_VERSION;

const parsedZoneCommand: CreateDiningZoneCommandV1 | undefined = parseCreateDiningZoneCommandV1({
  schemaVersion: DINING_ZONE_SCHEMA_VERSION,
  scope: { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" },
  zoneId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
  eventId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
  idempotencyKey: "c483b6e7-e102-4cc5-a887-d30712c85e52",
  deviceId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  occurredAt: "2026-08-31T17:00:00.000Z",
  name: "Terraza",
});
const parsedZone: DiningZoneV1 | undefined = parseDiningZoneV1({
  schemaVersion: DINING_ZONE_SCHEMA_VERSION,
  scope: { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" },
  zoneId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
  name: "Terraza",
  version: 1,
  createdAt: "2026-08-31T17:00:01.000Z",
  createdBy: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  replayed: false,
});
void parsedZoneCommand;
void parsedZone;

const parsedTableCommand: CreateDiningTableCommandV1 | undefined = parseCreateDiningTableCommandV1({ schemaVersion: DINING_LAYOUT_SCHEMA_VERSION });
const parsedTable: DiningTableV1 | undefined = parseDiningTableV1({ schemaVersion: DINING_LAYOUT_SCHEMA_VERSION });
const parsedLayout: DiningLayoutV1 | undefined = parseDiningLayoutV1({ schemaVersion: DINING_LAYOUT_SCHEMA_VERSION });
const parsedLayoutUpdate: UpdateDiningTableLayoutCommandV1 | undefined = parseUpdateDiningTableLayoutCommandV1({ schemaVersion: DINING_LAYOUT_SCHEMA_VERSION });
void parsedTableCommand;
void parsedTable;
void parsedLayout;
void parsedLayoutUpdate;

// @ts-expect-error Runtime parsing is required before untrusted strings become branded identifiers.
const invalidRestaurantScope: RestaurantScope = { restaurantId: "restaurant-1" };
void invalidRestaurantScope;
