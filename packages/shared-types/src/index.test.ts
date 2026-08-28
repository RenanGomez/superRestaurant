import type { BranchId, BranchScope, RestaurantId, RestaurantScope } from "./index.js";

declare const restaurantId: RestaurantId;
declare const branchId: BranchId;

const restaurantScope: RestaurantScope = { restaurantId };
const branchScope: BranchScope = { restaurantId, branchId };

void restaurantScope;
void branchScope;

// @ts-expect-error Restaurant and branch identifiers must not be interchangeable.
const invalidRestaurantId: RestaurantId = branchId;
void invalidRestaurantId;
