import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchScope } from "@super-restaurant/shared-types";

import { getMenuCatalog, saveMenuCatalog } from "./menu-catalog.js";

const parsedScope = parseBranchScope({
  branchId: "22222222-2222-4222-8222-222222222222",
  restaurantId: "11111111-1111-4111-8111-111111111111",
});
if (parsedScope === undefined) throw new Error("invalid test scope");
const scope = parsedScope;
const command = Object.freeze({
  catalogVersion: "33333333-3333-4333-8333-333333333333",
  categories: Object.freeze([]),
  currency: "MXN",
  deviceId: "44444444-4444-4444-8444-444444444444",
  eventId: "55555555-5555-4555-8555-555555555555",
  expectedVersion: 0,
  idempotencyKey: "66666666-6666-4666-8666-666666666666",
  modifierGroups: Object.freeze([]),
  occurredAt: "2026-09-02T12:00:00.000Z",
  products: Object.freeze([]),
  schemaVersion: 1,
  scope,
});
const state = Object.freeze({ catalog: null, schemaVersion: 1, scope });

test("menu client reads the exact scoped no-store endpoint and validates the response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), `https://api.test/api/v1/catalog/menu?branchId=${scope.branchId}&restaurantId=${scope.restaurantId}`);
    assert.deepEqual(init, {
      cache: "no-store",
      headers: { authorization: "Bearer access-token" },
      method: "GET",
    });
    return new Response(JSON.stringify(state), { status: 200 });
  };
  try {
    assert.deepEqual(await getMenuCatalog("access-token", "https://api.test", scope), state);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("menu client validates commands before PUT and fails closed on hostile responses", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    assert.equal(init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(init?.body)), command);
    return new Response(JSON.stringify({ ...state, extra: true }), { status: 200 });
  };
  try {
    assert.equal(await saveMenuCatalog("access-token", "https://api.test", { ...command, currency: "mxn" }), undefined);
    assert.equal(calls, 0);
    assert.equal(await saveMenuCatalog("access-token", "https://api.test", command), undefined);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
