/**
 * Opaque identifiers keep restaurant and branch scopes distinct across clients
 * without defining persistence models, domain entities, or transport DTOs.
 */
declare const restaurantIdBrand: unique symbol;
declare const branchIdBrand: unique symbol;

/**
 * Runtime scope contracts are deliberately versioned independently from any
 * transport or persistence model. Increment this only for a breaking shape
 * change and provide a separate parser for the previous version when needed.
 */
export const SCOPE_SCHEMA_VERSION = 1 as const;

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

/**
 * Parses the exact minimum restaurant scope shape. Invalid input is rejected
 * with `undefined`; callers must not fall back to an implicit tenant scope.
 */
export function parseRestaurantScope(value: unknown): RestaurantScope | undefined {
  const record = parseExactPlainRecord(value, ["restaurantId"]);
  if (record === undefined) return undefined;

  const restaurantId = parseNonEmptyId(record, "restaurantId");
  if (restaurantId === undefined) return undefined;

  return Object.freeze({ restaurantId: restaurantId as RestaurantId });
}

/**
 * Parses the exact minimum restaurant-and-branch scope shape. Invalid input
 * is rejected with `undefined`; callers must not widen it to a restaurant.
 */
export function parseBranchScope(value: unknown): BranchScope | undefined {
  const record = parseExactPlainRecord(value, ["restaurantId", "branchId"]);
  if (record === undefined) return undefined;

  const restaurantId = parseNonEmptyId(record, "restaurantId");
  const branchId = parseNonEmptyId(record, "branchId");
  if (restaurantId === undefined || branchId === undefined) return undefined;

  return Object.freeze({
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
  });
}

type PlainRecord = Record<string, unknown>;

function parseExactPlainRecord(value: unknown, expectedKeys: readonly string[]): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) return undefined;

    for (const expectedKey of expectedKeys) {
      if (!ownKeys.includes(expectedKey)) return undefined;

      const descriptor = Object.getOwnPropertyDescriptor(value, expectedKey);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
    }

    return value as PlainRecord;
  } catch {
    // Proxy traps and hostile objects must not make scope validation permissive.
    return undefined;
  }
}

function parseNonEmptyId(record: PlainRecord, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) return undefined;

  const value = descriptor.value;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
