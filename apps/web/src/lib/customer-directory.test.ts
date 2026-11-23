import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";
import {
  customerProfileMinimumPhones,
  getCustomerAutocompleteRequest,
  getCustomerDirectorySuggestions,
  getCustomerPhoneRemoval,
  insertCustomerDirectorySuggestion,
  isCurrentCustomerAutocompleteRequest,
  isCurrentCustomerSearch,
  requestCustomerDirectory,
  selectCurrentCustomerSearch,
} from "./customer-directory.js";

const scope = parseBranchScope({
  restaurantId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
});
if (scope === undefined) throw new Error("invalid fixture scope");
const customerId = "33333333-3333-4333-8333-333333333333";
const addressId = "44444444-4444-4444-8444-444444444444";
const contactId = "55555555-5555-4555-8555-555555555555";
const deviceId = "66666666-6666-4666-8666-666666666666";
const eventId = "77777777-7777-4777-8777-777777777777";
const idempotencyKey = "88888888-8888-4888-8888-888888888888";
const occurredAt = "2026-09-16T20:00:00.000Z";
const common = { schemaVersion: 1 as const, scope, customerId, expectedVersion: 0,
  deviceId, eventId, idempotencyKey, occurredAt };
const phone = { contactId, label: "Casa", displayValue: "+52 642 123 4567" };

test("customer server client keeps PII in a POST body and validates exact search scope", async () => {
  const original = globalThis.fetch;
  let observed: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observed = { input: String(input), ...(init === undefined ? {} : { init }) };
    return new Response(JSON.stringify({ schemaVersion: 1, scope, candidates: [{ customerId,
      displayName: "Ana", phones: [phone], addresses: [], version: 1, updatedAt: occurredAt }], nextCursor: null }),
    { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const query = { schemaVersion: 1 as const, scope, mode: "phone" as const, query: "+52 642 123 4567", limit: 20, cursor: null };
    const result = await requestCustomerDirectory("private-token", "http://127.0.0.1:3000", "search", query);
    assert.equal(result.ok, true);
    assert.equal(observed?.input, "http://127.0.0.1:3000/api/v1/customers/search");
    assert.equal(observed?.init?.method, "POST");
    assert.equal(observed?.init?.cache, "no-store");
    assert.equal(new URL(observed?.input ?? "http://invalid").search, "");
    assert.deepEqual(JSON.parse(String(observed?.init?.body)), query);
    assert.equal(new Headers(observed?.init?.headers).get("authorization"), "Bearer private-token");
  } finally { globalThis.fetch = original; }
});

test("customer server client rejects invalid input before fetch and maps HTTP failures", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response("{}", { status: 409 }); }) as typeof fetch;
  try {
    assert.deepEqual(await requestCustomerDirectory("token", "http://127.0.0.1:3000", "search", {}), { ok: false, error: "invalid" });
    assert.equal(calls, 0);
    const command = { ...common, displayName: "Ana", phones: [phone] };
    assert.deepEqual(await requestCustomerDirectory("token", "http://127.0.0.1:3000", "profile", command), { ok: false, error: "conflict" });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("customer server client rejects hostile identity, version and validation branch responses", async () => {
  const original = globalThis.fetch;
  const command = { ...common, expectedVersion: 1, addressId };
  const address = { label: "Casa", streetLine: "Uno 10", unit: null, neighborhood: null, locality: "Navojoa",
    region: null, countryCode: "MX", postalCode: null, references: null, instructions: null, coordinates: null };
  const record = { schemaVersion: 1, restaurantId: scope.restaurantId, customerId, addressId, address, version: 2,
    validation: { branchId: scope.branchId, actorId: customerId, deviceId, eventId, validatedAt: occurredAt },
    createdAt: occurredAt, updatedAt: occurredAt, deletedAt: null };
  const responses = [
    { schemaVersion: 1, record: { ...record, customerId: contactId }, replayed: false },
    { schemaVersion: 1, record: { ...record, version: 3 }, replayed: false },
    { schemaVersion: 1, record: { ...record, validation: { ...record.validation, branchId: customerId } }, replayed: false },
    { schemaVersion: 1, record, replayed: false },
  ];
  globalThis.fetch = (async () => new Response(JSON.stringify(responses.shift()), { status: 200 })) as typeof fetch;
  try {
    for (let index = 0; index < 3; index += 1) {
      assert.deepEqual(await requestCustomerDirectory("token", "http://127.0.0.1:3000", "validate", command), { ok: false, error: "unavailable" });
    }
    const accepted = await requestCustomerDirectory("token", "http://127.0.0.1:3000", "validate", command);
    assert.equal(accepted.ok, true);
  } finally { globalThis.fetch = original; }
});

test("autocomplete derives bounded name and address terms only from the authorized result", () => {
  const result = {
    schemaVersion: 1 as const,
    scope,
    candidates: [{
      customerId,
      displayName: "Ana María Morena",
      phones: [phone],
      addresses: [{
        addressId,
        label: "Casa",
        streetLine: "Acacia Morena 84",
        neighborhood: "Las Fuentes",
        locality: "Navojoa",
        version: 2,
        validatedForRequestedBranch: true,
      }],
      version: 3,
      updatedAt: occurredAt,
    }],
    nextCursor: null,
  };

  assert.deepEqual(getCustomerDirectorySuggestions(result, "name", "ma"), [
    { id: "name-0-maria", customerId, value: "María", context: "Ana María Morena" },
  ]);
  assert.deepEqual(getCustomerDirectorySuggestions(result, "address", "Morena 8"), [
    { id: "address-0-84", customerId, value: "84", context: "Ana María Morena" },
  ]);
  assert.deepEqual(getCustomerDirectorySuggestions(result, "address", "Fuentes A"), [
    { id: "address-0-acacia", customerId, value: "Acacia", context: "Ana María Morena" },
  ]);
  assert.equal(getCustomerDirectorySuggestions(result, "address", "A", 20).length <= 10, true);
  assert.deepEqual(getCustomerDirectorySuggestions(undefined, "name", "Ana"), []);
});

test("autocomplete requires four phone digits and accepting replaces only the active term", () => {
  const result = {
    schemaVersion: 1 as const,
    scope,
    candidates: [{ customerId, displayName: "Ana", phones: [phone], addresses: [], version: 1, updatedAt: occurredAt }],
    nextCursor: null,
  };
  assert.deepEqual(getCustomerDirectorySuggestions(result, "phone", "456"), []);
  assert.deepEqual(getCustomerDirectorySuggestions(result, "phone", "4567"), [
    { id: "phone-0-526421234567", customerId, value: "+52 642 123 4567", context: "Ana" },
  ]);
  const otherCustomerId = "abcdef02-2345-4678-9abc-0123456789ab";
  assert.deepEqual(getCustomerDirectorySuggestions({ ...result, candidates: [
    ...result.candidates, { ...result.candidates[0]!, customerId: otherCustomerId, displayName: "Luis" },
  ] }, "phone", "4567").map(suggestion => suggestion.customerId), [customerId, otherCustomerId]);
  assert.equal(insertCustomerDirectorySuggestion("Morena Ac", "Acacia", "address"), "Morena Acacia ");
  assert.equal(insertCustomerDirectorySuggestion("Morena ", "84", "address"), "Morena 84 ");
  assert.equal(insertCustomerDirectorySuggestion("4567", "+52 642 123 4567", "phone"), "+52 642 123 4567 ");
});

test("automatic autocomplete search waits for a useful authorized prefix", () => {
  assert.equal(getCustomerAutocompleteRequest("phone", "123"), undefined);
  assert.deepEqual(getCustomerAutocompleteRequest("phone", " 642 1 "), { mode: "phone", query: "642 1" });
  assert.equal(getCustomerAutocompleteRequest("name", "a"), undefined);
  assert.deepEqual(getCustomerAutocompleteRequest("name", "aca"), { mode: "name", query: "aca" });
  assert.equal(getCustomerAutocompleteRequest("address", "8"), undefined);
  assert.deepEqual(getCustomerAutocompleteRequest("address", "Morena 8"), { mode: "address", query: "Morena 8" });
  assert.equal(getCustomerAutocompleteRequest("name", "a".repeat(121)), undefined);
});

test("automatic autocomplete discards responses for a stale mode or query", () => {
  const request = getCustomerAutocompleteRequest("address", "aca");
  assert.notEqual(request, undefined);
  if (request === undefined) return;
  assert.equal(isCurrentCustomerAutocompleteRequest(request, "address", " aca "), true);
  assert.equal(isCurrentCustomerAutocompleteRequest(request, "address", "acac"), false);
  assert.equal(isCurrentCustomerAutocompleteRequest(request, "name", "aca"), false);
});

test("a submitted search only shows results for the query that produced them", () => {
  const value = { schemaVersion: 1 as const, scope, candidates: [], nextCursor: null };
  const snapshot = { mode: "phone" as const, query: "6622751352", value };
  assert.equal(selectCurrentCustomerSearch(snapshot, "phone", "6622751352"), value);
  assert.equal(selectCurrentCustomerSearch(snapshot, "phone", " 6622751352 "), value);
  assert.equal(selectCurrentCustomerSearch(snapshot, "phone", "6622900"), undefined);
  assert.equal(selectCurrentCustomerSearch(snapshot, "name", "6622751352"), undefined);
  assert.equal(selectCurrentCustomerSearch(undefined, "phone", "6622751352"), undefined);
});

test("a late response for an outdated submitted query is discarded", () => {
  const late = { mode: "phone" as const, query: "6622751352" };
  assert.equal(isCurrentCustomerSearch(late, "phone", "6622900"), false);
  assert.equal(isCurrentCustomerSearch(late, "phone", "6622751352"), true);
  assert.equal(isCurrentCustomerSearch(late, "name", "6622751352"), false);
  assert.equal(isCurrentCustomerSearch(undefined, "phone", "6622751352"), false);
});

const secondaryContactId = "99999999-9999-4999-8999-999999999999";
const secondaryPhone = { contactId: secondaryContactId, label: "Trabajo", displayValue: "+52 642 987 6543" };

test("removing a phone saves the rest of the edited profile with it", () => {
  const editedSecondary = { ...secondaryPhone, displayValue: "+52 642 000 1111" };
  const plan = getCustomerPhoneRemoval({ phones: [phone, editedSecondary], contactId,
    displayName: "Ana Editada", savedDisplayName: "Ana", savedPhones: [phone] });
  assert.equal(plan.blocked, false);
  assert.deepEqual(plan.phones, [editedSecondary]);
  assert.equal(plan.alsoSavesOtherChanges, true);
});

test("removing an unchanged phone does not warn about other profile edits", () => {
  const plan = getCustomerPhoneRemoval({ phones: [phone, secondaryPhone], contactId,
    displayName: "Ana", savedDisplayName: "Ana", savedPhones: [phone, secondaryPhone] });
  assert.deepEqual(plan.phones, [secondaryPhone]);
  assert.equal(plan.alsoSavesOtherChanges, false);
});

test("the last phone can be removed because the profile contract allows an empty list", () => {
  assert.equal(customerProfileMinimumPhones, 0);
  const plan = getCustomerPhoneRemoval({ phones: [phone], contactId,
    displayName: "Ana", savedDisplayName: "Ana", savedPhones: [phone] });
  assert.equal(plan.blocked, false);
  assert.deepEqual(plan.phones, []);
});

test("removing a primary phone targets only that contact and rejects a missing phone", () => {
  const renamedPrimary = { ...phone, label: "Principal" };
  const plan = getCustomerPhoneRemoval({ phones: [renamedPrimary, secondaryPhone], contactId,
    displayName: "Ana", savedDisplayName: "Ana", savedPhones: [phone, secondaryPhone] });
  assert.deepEqual(plan.phones, [secondaryPhone]);
  assert.equal(plan.alsoSavesOtherChanges, false);

  const missing = getCustomerPhoneRemoval({ phones: [secondaryPhone], contactId,
    displayName: "Ana", savedDisplayName: "Ana", savedPhones: [phone, secondaryPhone] });
  assert.equal(missing.blocked, true);
  assert.equal(missing.reason, "Ese teléfono ya no está en la ficha.");
  assert.deepEqual(missing.phones, [secondaryPhone]);
});
