/**
 * Opaque identifiers keep restaurant and branch scopes distinct across clients
 * without defining persistence models, domain entities, or transport DTOs.
 */
declare const restaurantIdBrand: unique symbol;
declare const branchIdBrand: unique symbol;

export type RestaurantId = string & {
  readonly [restaurantIdBrand]: "RestaurantId";
};

export type BranchId = string & {
  readonly [branchIdBrand]: "BranchId";
};

/** The minimum tenant scope required by shared clients and server contracts. */
export interface RestaurantScope {
  readonly restaurantId: RestaurantId;
}

/** A restaurant scope narrowed to one operating branch. */
export interface BranchScope extends RestaurantScope {
  readonly branchId: BranchId;
}
