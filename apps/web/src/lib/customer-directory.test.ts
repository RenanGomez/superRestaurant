import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";
import { requestCustomerDirectory } from "./customer-directory.js";

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
