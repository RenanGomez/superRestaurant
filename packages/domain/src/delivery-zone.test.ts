import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeliveryZone,
  findDeliveryZone,
} from "./delivery-zone.js";
import { InvalidDeliveryAddressFactsError, InvalidDeliveryZoneFieldError } from "./errors.js";
import { Money } from "./money.js";

function zone(overrides: Partial<Parameters<typeof createDeliveryZone>[0]> = {}): ReturnType<typeof createDeliveryZone> {
  return createDeliveryZone({
    zoneId: "zone-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    name: "Centro",
    feeMinor: new Money(2_500, "MXN"),
    postalCodes: ["06000"],
    localities: ["Centro Historico"],
    settlementIds: [],
    ...overrides,
  });
}

function facts(overrides: Partial<Parameters<typeof findDeliveryZone>[1]> = {}): Parameters<typeof findDeliveryZone>[1] {
  return {
    settlementId: null,
    neighborhood: null,
    postalCode: null,
    locality: null,
    ...overrides,
  };
}

test("createDeliveryZone rejects a negative fee, blank fields, and empty coverage", () => {
  assert.throws(() => zone({ feeMinor: new Money(-1, "MXN") }), InvalidDeliveryZoneFieldError);
  assert.throws(() => zone({ name: "  " }), InvalidDeliveryZoneFieldError);
  assert.throws(() => zone({ postalCodes: [], localities: [], settlementIds: [] }), InvalidDeliveryZoneFieldError);
  assert.throws(() => zone({ postalCodes: [""] }), InvalidDeliveryZoneFieldError);
  assert.throws(() => zone({ settlementIds: [""] }), InvalidDeliveryZoneFieldError);
});

test("createDeliveryZone freezes the zone and de-duplicates coverage sets", () => {
  const created = zone({
    postalCodes: ["06000", "06000"],
    settlementIds: ["settlement-1", "settlement-1"],
  });
  assert.equal(Object.isFrozen(created), true);
  assert.equal(created.postalCodes.size, 1);
  assert.equal(created.settlementIds.size, 1);
  assert.equal(Object.isFrozen(created.postalCodes), true);
  assert.equal(Object.isFrozen(created.settlementIds), true);
});

test("createDeliveryZone accepts a locality-only legacy zone but it never matches", () => {
  const legacy = zone({ postalCodes: [], localities: ["Centro Historico"], settlementIds: [] });
  assert.equal(legacy.postalCodes.size, 0);
  assert.equal(findDeliveryZone([legacy], facts({ locality: "Centro Historico" })), undefined);
});

test("findDeliveryZone prefers a settlement id and never falls back to a matching postal code", () => {
  const settlementZone = zone({ zoneId: "settlement-zone", settlementIds: ["settlement-1"], postalCodes: [] });
  const postalZone = zone({ zoneId: "postal-zone", postalCodes: ["06000"], settlementIds: [] });

  const match = findDeliveryZone([postalZone, settlementZone], facts({ settlementId: "settlement-1", postalCode: "06000" }));
  assert.equal(match?.zoneId, "settlement-zone");

  // A known settlement id with no zone is not_covered even when a legacy CP matches.
  const uncovered = findDeliveryZone([postalZone], facts({ settlementId: "settlement-2", postalCode: "06000" }));
  assert.equal(uncovered, undefined);
});

test("findDeliveryZone falls back to postal code when there is no settlement id", () => {
  const postalZone = zone({ zoneId: "postal-zone", postalCodes: ["06000"], settlementIds: [] });
  const match = findDeliveryZone([postalZone], facts({ postalCode: "06000", locality: "Otro" }));
  assert.equal(match?.zoneId, "postal-zone");
});

test("findDeliveryZone never matches by locality (name resolution happens server-side)", () => {
  const localityZone = zone({ zoneId: "locality-zone", postalCodes: ["06500"], localities: ["Roma Norte"], settlementIds: [] });
  const match = findDeliveryZone([localityZone], facts({ neighborhood: "Roma Norte", locality: "Roma Norte" }));
  assert.equal(match, undefined);
});

test("findDeliveryZone returns undefined when no zone covers the address", () => {
  const match = findDeliveryZone([zone()], facts({ postalCode: "99999", locality: "Nowhere" }));
  assert.equal(match, undefined);
});

test("findDeliveryZone returns undefined (settlement_missing) when there are no address facts", () => {
  assert.equal(findDeliveryZone([zone()], facts()), undefined);
});

test("findDeliveryZone rejects hostile or incomplete address facts", () => {
  assert.throws(() => findDeliveryZone([zone()], facts({ postalCode: "" })), InvalidDeliveryAddressFactsError);
  assert.throws(() => findDeliveryZone([zone()], facts({ settlementId: " " })), InvalidDeliveryAddressFactsError);
  assert.throws(() => findDeliveryZone([zone()], facts({ neighborhood: "" })), InvalidDeliveryAddressFactsError);
  assert.throws(
    () => findDeliveryZone([zone()], null as unknown as Parameters<typeof findDeliveryZone>[1]),
    InvalidDeliveryAddressFactsError,
  );
});
