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
    ...overrides,
  });
}

test("createDeliveryZone rejects a negative fee, blank fields, and empty coverage", () => {
  assert.throws(() => zone({ feeMinor: new Money(-1, "MXN") }), InvalidDeliveryZoneFieldError);
  assert.throws(() => zone({ name: "  " }), InvalidDeliveryZoneFieldError);
  assert.throws(() => zone({ postalCodes: [], localities: [] }), InvalidDeliveryZoneFieldError);
  assert.throws(() => zone({ postalCodes: [""] }), InvalidDeliveryZoneFieldError);
});

test("createDeliveryZone freezes the zone and de-duplicates coverage sets", () => {
  const created = zone({ postalCodes: ["06000", "06000"] });
  assert.equal(Object.isFrozen(created), true);
  assert.equal(created.postalCodes.size, 1);
  assert.equal(Object.isFrozen(created.postalCodes), true);
});

test("findDeliveryZone prefers an exact postal-code match over locality", () => {
  const postalZone = zone({ zoneId: "postal-zone", postalCodes: ["06000"], localities: [] });
  const localityZone = zone({ zoneId: "locality-zone", postalCodes: [], localities: ["Centro Historico"] });

  const match = findDeliveryZone([localityZone, postalZone], { postalCode: "06000", locality: "Centro Historico" });
  assert.equal(match?.zoneId, "postal-zone");
});

test("findDeliveryZone falls back to locality when the postal code has no match", () => {
  const localityZone = zone({ zoneId: "locality-zone", postalCodes: ["06500"], localities: ["Roma Norte"] });
  const match = findDeliveryZone([localityZone], { postalCode: "06000", locality: "Roma Norte" });
  assert.equal(match?.zoneId, "locality-zone");
});

test("findDeliveryZone returns undefined when no zone covers the address", () => {
  const match = findDeliveryZone([zone()], { postalCode: "99999", locality: "Nowhere" });
  assert.equal(match, undefined);
});

test("findDeliveryZone rejects hostile or incomplete address facts", () => {
  assert.throws(() => findDeliveryZone([zone()], { postalCode: "", locality: "Centro" }), InvalidDeliveryAddressFactsError);
  assert.throws(() => findDeliveryZone([zone()], { postalCode: null, locality: "" }), InvalidDeliveryAddressFactsError);
});
