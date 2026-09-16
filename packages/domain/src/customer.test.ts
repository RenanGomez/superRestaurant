import assert from "node:assert/strict";
import test from "node:test";
import { CustomerScopeRejectedError, InvalidCustomerProfileError, createCustomerProfile, normalizeCustomerPhone, snapshotCustomerParty, createCustomerAddress, validateCustomerAddress, snapshotCustomerFulfillment } from "./customer.js";

const input = () => ({ customerId: "customer-a", restaurantId: "restaurant-a", displayName: "Ana",
  phones: [{ contactId: "contact-a", label: "Casa", displayValue: "+52 (642) 123-4567" }] });

const addressInput = () => ({ addressId: "address-a", customerId: "customer-a", restaurantId: "restaurant-a",
  label: "Casa", streetLine: "Calle Uno 10", unit: null, neighborhood: null, locality: "Navojoa",
  region: "Sonora", countryCode: "MX", postalCode: null, references: null, instructions: null,
  coordinates: { latitudeE6: 27_000_000, longitudeE6: -109_000_000 } });
const validationInput = () => ({ restaurantId: "restaurant-a", branchId: "branch-a", eventId: "event-a",
  actorId: "actor-a", deviceId: "device-a", validatedAt: "2026-09-16T10:00:00.000Z" });

test("coordinates do not validate an address; explicit attestation and edits preserve historical snapshot", () => {
  const source = addressInput();
  const address = createCustomerAddress(source);
  const party = snapshotCustomerParty(createCustomerProfile(input()), "restaurant-a", "contact-a");
  assert.equal(address.validation, null);
  assert.throws(() => snapshotCustomerFulfillment(address, party, "restaurant-a", "branch-a"), InvalidCustomerProfileError);
  const validated = validateCustomerAddress(address, validationInput());
  const snapshot = snapshotCustomerFulfillment(validated, party, "restaurant-a", "branch-a");
  source.coordinates.latitudeE6 = 0;
  const edited = createCustomerAddress({ ...addressInput(), streetLine: "Calle Dos 20" });
  assert.equal(edited.validation, null);
  assert.equal(snapshot.streetLine, "Calle Uno 10");
  assert.equal(snapshot.coordinates?.latitudeE6, 27_000_000);
  assert.ok(Object.isFrozen(snapshot.coordinates));
  assert.ok(Object.isFrozen(snapshot.validation));
  assert.ok(Object.isFrozen(snapshot));
});

test("address validation and fulfillment reject incomplete, foreign and malformed facts", () => {
  const address = createCustomerAddress(addressInput());
  const party = snapshotCustomerParty(createCustomerProfile(input()), "restaurant-a", "contact-a");
  const validated = validateCustomerAddress(address, validationInput());
  assert.throws(() => validateCustomerAddress(createCustomerAddress({ ...addressInput(), streetLine: null }), validationInput()), InvalidCustomerProfileError);
  assert.throws(() => validateCustomerAddress(address, { ...validationInput(), restaurantId: "other" }), CustomerScopeRejectedError);
  assert.throws(() => snapshotCustomerFulfillment(validated, party, "other", "branch-a"), CustomerScopeRejectedError);
  assert.throws(() => snapshotCustomerFulfillment(validated, party, "restaurant-a", "branch-b"), CustomerScopeRejectedError);
  assert.throws(() => snapshotCustomerFulfillment(validated, { ...party, customerId: "other" }, "restaurant-a", "branch-a"), CustomerScopeRejectedError);
  assert.throws(() => snapshotCustomerFulfillment(validated, { ...party, phoneNormalizedValue: "tampered" }, "restaurant-a", "branch-a"), InvalidCustomerProfileError);
  for (const validatedAt of ["infinity", "2026-02-30T10:00:00.000Z", "2026-09-16T10:00:00Z"]) {
    assert.throws(() => validateCustomerAddress(address, { ...validationInput(), validatedAt }), InvalidCustomerProfileError);
  }
  for (const coordinates of [{ latitudeE6: 90_000_001, longitudeE6: 0 }, { latitudeE6: 0.5, longitudeE6: 0 }, { latitudeE6: 0, longitudeE6: Infinity }]) {
    assert.throws(() => createCustomerAddress({ ...addressInput(), coordinates }), InvalidCustomerProfileError);
  }
  assert.throws(() => createCustomerAddress({ ...addressInput(), countryCode: "mx" }), InvalidCustomerProfileError);
  let invoked = false;
  const coordinates = { ...addressInput().coordinates };
  Object.defineProperty(coordinates, "latitudeE6", { enumerable: true, get: () => { invoked = true; return 0; } });
  assert.throws(() => createCustomerAddress({ ...addressInput(), coordinates }), InvalidCustomerProfileError);
  assert.equal(invoked, false);
});

test("phone search normalization preserves explicit country prefix and leading zeros without verification", () => {
  assert.equal(normalizeCustomerPhone("+52 (642) 123-4567"), "+526421234567");
  assert.equal(normalizeCustomerPhone("0642.123.4567"), "06421234567");
  assert.notEqual(normalizeCustomerPhone("6421234567"), normalizeCustomerPhone("+526421234567"));
  for (const invalid of ["", " 6421234567", "6421234567\n", "642\u200b1234567", "642 ext 1", "52+642", "++52642", "-", "1".repeat(21)]) {
    assert.throws(() => normalizeCustomerPhone(invalid), InvalidCustomerProfileError);
  }
});
test("profiles are detached and frozen, shared phone never merges distinct customers", () => {
  const source = input();
  const first = createCustomerProfile(source);
  const second = createCustomerProfile({ ...input(), customerId: "customer-b", displayName: "Luis" });
  assert.equal(first.phones[0]!.normalizedValue, second.phones[0]!.normalizedValue);
  assert.notEqual(first.customerId, second.customerId);
  source.phones[0]!.displayValue = "5550000000";
  source.displayName = "Changed";
  assert.equal(first.displayName, "Ana");
  assert.ok(Object.isFrozen(first.phones[0]));
  assert.ok(Object.isFrozen(first.phones));
  assert.equal(createCustomerProfile({ ...input(), phones: [] }).phones.length, 0);
});
test("party snapshot requires explicit contact in authorized restaurant and keeps immutable historical facts", () => {
  const original = createCustomerProfile(input());
  const snapshot = snapshotCustomerParty(original, "restaurant-a", "contact-a");
  const updated = createCustomerProfile({ ...input(), displayName: "Ana edited" });
  assert.equal(updated.displayName, "Ana edited");
  assert.equal(snapshot.displayName, "Ana");
  assert.ok(Object.isFrozen(snapshot));
  assert.throws(() => snapshotCustomerParty(original, "restaurant-b", "contact-a"), CustomerScopeRejectedError);
  assert.throws(() => snapshotCustomerParty(original, "restaurant-a", "missing"), InvalidCustomerProfileError);
  assert.throws(() => snapshotCustomerParty({ ...original, phones: [{ ...original.phones[0]!, normalizedValue: "tampered" }] }, "restaurant-a", "contact-a"), InvalidCustomerProfileError);
});
test("profile inputs reject duplicate IDs, hidden data, accessors and hostile records without exposing PII", () => {
  const base = input();
  assert.throws(() => createCustomerProfile({ ...base, phones: [base.phones[0]!, base.phones[0]!] }), InvalidCustomerProfileError);
  assert.throws(() => createCustomerProfile({ ...base, extra: "private" } as never), InvalidCustomerProfileError);
  let invoked = false;
  const hostile = { ...base };
  Object.defineProperty(hostile, "displayName", { enumerable: true, get: () => { invoked = true; return "private"; } });
  assert.throws(() => createCustomerProfile(hostile), InvalidCustomerProfileError);
  assert.equal(invoked, false);
  assert.throws(() => createCustomerProfile(new Proxy(base, { ownKeys: () => { throw new Error("private"); } })), InvalidCustomerProfileError);
  assert.throws(() => createCustomerProfile({ ...base, phones: new Proxy(base.phones, {
    getOwnPropertyDescriptor: () => { throw new Error("private phone"); },
  }) }), InvalidCustomerProfileError);
  const sparse = new Array(1) as typeof base.phones;
  assert.throws(() => createCustomerProfile({ ...base, phones: sparse }), InvalidCustomerProfileError);
});
