import { InvalidDeliveryAddressFactsError, InvalidDeliveryZoneFieldError } from "./errors.js";
import { Money } from "./money.js";

/**
 * A manually configured delivery coverage zone for one Branch (decision 8.1.1:
 * no geocoding or polygons in the pilot). Matching is defined purely by exact
 * postal-code and locality membership; the fee is a frozen Money value.
 */
export interface DeliveryZone {
  readonly zoneId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly feeMinor: Money;
  readonly postalCodes: ReadonlySet<string>;
  readonly localities: ReadonlySet<string>;
}

export interface CreateDeliveryZoneInput {
  readonly zoneId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly feeMinor: Money;
  readonly postalCodes: readonly string[];
  readonly localities: readonly string[];
}

/** The address facts a coverage lookup matches against; never re-geocoded. */
export interface DeliveryAddressFacts {
  readonly postalCode: string | null;
  readonly locality: string;
}

/**
 * Validates and freezes one delivery zone. Postal codes and localities are
 * de-duplicated into sets; both may be empty, but a zone with neither can
 * never match and is rejected as an invalid configuration.
 */
export function createDeliveryZone(input: CreateDeliveryZoneInput): DeliveryZone {
  assertNonEmptyText(input.zoneId, "zoneId");
  assertNonEmptyText(input.restaurantId, "restaurantId");
  assertNonEmptyText(input.branchId, "branchId");
  assertNonEmptyText(input.name, "name");
  if (!(input.feeMinor instanceof Money) || input.feeMinor.amountMinor < 0) {
    throw new InvalidDeliveryZoneFieldError("feeMinor");
  }
  const postalCodes = toNonEmptyTextSet(input.postalCodes, "postalCodes");
  const localities = toNonEmptyTextSet(input.localities, "localities");
  if (postalCodes.size === 0 && localities.size === 0) {
    throw new InvalidDeliveryZoneFieldError("postalCodes");
  }

  return Object.freeze({
    zoneId: input.zoneId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    name: input.name,
    feeMinor: input.feeMinor,
    postalCodes: Object.freeze(postalCodes),
    localities: Object.freeze(localities),
  });
}

/**
 * Finds the covering zone for one address: exact postal-code match takes
 * precedence over an exact locality match (approved decision 8.1.1). Returns
 * `undefined` when no zone in the candidate list covers the address —
 * callers project this into a `not_covered` quote.
 */
export function findDeliveryZone(
  zones: readonly DeliveryZone[],
  address: DeliveryAddressFacts,
): DeliveryZone | undefined {
  const normalized = normalizeAddressFacts(address);

  if (normalized.postalCode !== null) {
    const byPostalCode = zones.find((zone) => zone.postalCodes.has(normalized.postalCode as string));
    if (byPostalCode !== undefined) return byPostalCode;
  }

  return zones.find((zone) => zone.localities.has(normalized.locality));
}

function normalizeAddressFacts(address: DeliveryAddressFacts): DeliveryAddressFacts {
  if (address === null || typeof address !== "object") {
    throw new InvalidDeliveryAddressFactsError("address");
  }
  const postalCode = address.postalCode;
  if (postalCode !== null && (typeof postalCode !== "string" || postalCode.trim().length === 0)) {
    throw new InvalidDeliveryAddressFactsError("postalCode");
  }
  const locality = address.locality;
  if (typeof locality !== "string" || locality.trim().length === 0) {
    throw new InvalidDeliveryAddressFactsError("locality");
  }

  return Object.freeze({ postalCode, locality });
}

function toNonEmptyTextSet(values: readonly string[], field: string): Set<string> {
  if (!Array.isArray(values)) {
    throw new InvalidDeliveryZoneFieldError(field);
  }
  const set = new Set<string>();
  for (const value of values) {
    assertNonEmptyText(value, field);
    set.add(value);
  }
  return set;
}

function assertNonEmptyText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidDeliveryZoneFieldError(field);
  }
}
