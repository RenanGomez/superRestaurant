import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchScope } from "@super-restaurant/shared-types";
import { createCustomerProfile, createCustomerAddress, validateCustomerAddress } from "@super-restaurant/domain";
import { CustomerPersistenceCodecError, decodeCustomerProfileRecord, decodeCustomerAddressRecord,
  encodeCustomerProfileRecord, encodeCustomerAddressRecord } from "./customer-persistence-codec.js";

const id = "abcdef01-2345-4678-9abc-0123456789ab";
const other = "abcdef02-2345-4678-9abc-0123456789ab";
const scope = parseBranchScope({ restaurantId: id, branchId: id })!;
const metadata = { schemaVersion: 1 as const, version: 1, createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", deletedAt: null };
const profile = () => ({ ...metadata, profile: createCustomerProfile({ restaurantId: id, customerId: id, displayName: "Ana",
  phones: [{ contactId: id, label: "Casa", displayValue: "+52 (642) 123-4567" }] }) });
const address = () => ({ ...metadata, address: createCustomerAddress({ restaurantId: id, customerId: id, addressId: id,
  label: "Casa", streetLine: "Uno 10", unit: null, neighborhood: null, locality: "Navojoa", region: null,
  countryCode: "MX", postalCode: null, references: null, instructions: null, coordinates: { latitudeE6: 27_000_000, longitudeE6: -109_000_000 } }) });
const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("customer and address codecs round-trip immutable directory data across branches of the authorized restaurant", () => {
  const source = profile();
  assert.deepEqual(decodeCustomerProfileRecord(copy(encodeCustomerProfileRecord(source, scope)), scope), source);
  const decoded = decodeCustomerProfileRecord(copy(source), parseBranchScope({ ...scope, branchId: other })!);
  assert.ok(Object.isFrozen(decoded.profile.phones[0]));
  assert.ok(Object.isFrozen(decoded.profile.phones));
  assert.ok(Object.isFrozen(decoded));
  const storedAddress = address();
  assert.deepEqual(decodeCustomerAddressRecord(copy(encodeCustomerAddressRecord(storedAddress, scope)), scope), storedAddress);
  const validated = { ...storedAddress, address: validateCustomerAddress(storedAddress.address, {
    restaurantId: id, branchId: other, actorId: id, eventId: id, deviceId: id, validatedAt: metadata.updatedAt,
  }) };
  const restored = decodeCustomerAddressRecord(copy(validated), scope);
  assert.equal(restored.address.validation?.branchId, other);
  assert.ok(Object.isFrozen(restored.address.validation));
  assert.ok(Object.isFrozen(restored.address.coordinates));
});

test("customer codecs reject foreign scopes, corrupted derived keys and metadata without leaking payload", () => {
  const source = profile();
  assert.throws(() => decodeCustomerProfileRecord(source, parseBranchScope({ ...scope, restaurantId: other })!), CustomerPersistenceCodecError);
  assert.throws(() => decodeCustomerAddressRecord(address(), parseBranchScope({ ...scope, restaurantId: other })!), CustomerPersistenceCodecError);
  assert.throws(() => decodeCustomerProfileRecord({ ...source, profile: { ...source.profile, phones: [{ ...source.profile.phones[0]!, normalizedValue: "private" }] } }, scope), CustomerPersistenceCodecError);
  for (const version of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
    assert.throws(() => decodeCustomerProfileRecord({ ...source, version }, scope), CustomerPersistenceCodecError);
  }
  for (const change of [{ updatedAt: "2026-09-15T10:00:00.000Z" }, { deletedAt: "2026-09-17T10:00:00.000Z" },
    { createdAt: "2026-02-30T10:00:00.000Z" }, { extra: "private" }, { schemaVersion: 2 }]) {
    assert.throws(() => decodeCustomerProfileRecord({ ...source, ...change }, scope), CustomerPersistenceCodecError);
  }
  assert.doesNotThrow(() => decodeCustomerProfileRecord({ ...source, deletedAt: source.updatedAt }, scope));
  let invoked = false;
  const phone = { ...source.profile.phones[0]! };
  Object.defineProperty(phone, "displayValue", { enumerable: true, get: () => { invoked = true; return "private"; } });
  assert.throws(() => decodeCustomerProfileRecord({ ...source, profile: { ...source.profile, phones: [phone] } }, scope), CustomerPersistenceCodecError);
  assert.equal(invoked, false);
  assert.throws(() => decodeCustomerProfileRecord({ ...source, profile: new Proxy(source.profile, { ownKeys: () => { invoked = true; throw new Error("private"); } }) }, scope), error => error instanceof CustomerPersistenceCodecError && error.message === "CUSTOMER_PERSISTENCE_RECORD_REJECTED");
  assert.equal(invoked, false);
});

test("address rehydration fails closed for untrusted validation, incomplete validated data and hostile coordinates", () => {
  const source = address();
  const validation = { restaurantId: id, branchId: id, actorId: id, eventId: id, deviceId: id, validatedAt: metadata.updatedAt };
  for (const change of [{ restaurantId: other }, { validatedAt: "2026-09-17T10:00:00.000Z" }, { actorId: "bad" }, { extra: true }]) {
    assert.throws(() => decodeCustomerAddressRecord({ ...source, address: { ...source.address, validation: { ...validation, ...change } } }, scope), CustomerPersistenceCodecError);
  }
  assert.throws(() => decodeCustomerAddressRecord({ ...source, address: { ...source.address, streetLine: null, validation } }, scope), CustomerPersistenceCodecError);
  assert.throws(() => decodeCustomerAddressRecord({ ...source, address: { ...source.address, coordinates: new Proxy(source.address.coordinates!, {}) } }, scope), CustomerPersistenceCodecError);
  assert.throws(() => decodeCustomerAddressRecord({ ...source, address: { ...source.address, customerId: "bad" } }, scope), CustomerPersistenceCodecError);
});
