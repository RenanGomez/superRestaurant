import { InvalidDeliveryAddressFactsError, InvalidDeliveryZoneFieldError } from "./errors.js";
import { Money } from "./money.js";

/**
 * A manually configured delivery coverage zone for one Branch (decision 8.1.1:
 * no geocoding or polygons in the pilot, V2 adds settlement membership). A zone
 * matches by catalog settlement id first; postal codes remain as the legacy
 * fallback. `localities` is kept for compatibility but never participates in
 * matching (Z3, §8.1).
 */
export interface DeliveryZone {
  readonly zoneId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly feeMinor: Money;
  readonly postalCodes: ReadonlySet<string>;
  readonly localities: ReadonlySet<string>;
  readonly settlementIds: ReadonlySet<string>;
}

export interface CreateDeliveryZoneInput {
  readonly zoneId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly feeMinor: Money;
  readonly postalCodes: readonly string[];
  readonly localities: readonly string[];
  /** Colegios (SEPOMEX) que cubre la zona; [] en zonas heredadas sólo por CP. */
  readonly settlementIds?: readonly string[];
}

/**
 * The address facts a coverage lookup matches against; never re-geocoded.
 * Name/postal-code normalization and settlement resolution happen in the API
 * against the catalog, so the pure domain only compares ids and postal codes.
 */
export interface DeliveryAddressFacts {
  readonly settlementId: string | null;
  readonly neighborhood: string | null;
  readonly postalCode: string | null;
  readonly locality: string | null;
}

/**
 * Validates and freezes one delivery zone. Postal codes, localities and
 * settlement ids are de-duplicated into sets. A zone with none of them can
 * never match and is rejected; a localities-only zone is accepted for shape
 * compatibility with the legacy model and simply never matches.
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
  const settlementIds = toNonEmptyTextSet(input.settlementIds ?? [], "settlementIds");
  if (postalCodes.size === 0 && localities.size === 0 && settlementIds.size === 0) {
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
    settlementIds: Object.freeze(settlementIds),
  });
}

/**
 * Finds the covering zone for one address. Precedence is by identification
 * (§5): a known settlement id without a zone returns `undefined` and never
 * falls back to a legacy postal-code match; only an address without a resolved
 * settlement falls back to postal code. Locality never matches (Z3, §8.1).
 */
export function findDeliveryZone(
  zones: readonly DeliveryZone[],
  address: DeliveryAddressFacts,
): DeliveryZone | undefined {
  const normalized = normalizeAddressFacts(address);

  if (normalized.settlementId !== null) {
    return zones.find((zone) => zone.settlementIds.has(normalized.settlementId as string));
  }

  if (normalized.postalCode !== null) {
    return zones.find((zone) => zone.postalCodes.has(normalized.postalCode as string));
  }

  return undefined;
}

function normalizeAddressFacts(address: DeliveryAddressFacts): DeliveryAddressFacts {
  if (address === null || typeof address !== "object") {
    throw new InvalidDeliveryAddressFactsError("address");
  }
  const settlementId = optionalNonEmptyText(address.settlementId, "settlementId");
  const neighborhood = optionalNonEmptyText(address.neighborhood, "neighborhood");
  const postalCode = optionalNonEmptyText(address.postalCode, "postalCode");
  const locality = optionalNonEmptyText(address.locality, "locality");

  return Object.freeze({ settlementId, neighborhood, postalCode, locality });
}

function optionalNonEmptyText(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidDeliveryAddressFactsError(field);
  }
  return value;
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
