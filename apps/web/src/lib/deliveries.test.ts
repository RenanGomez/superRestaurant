import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchScope } from "@super-restaurant/shared-types";
import { readDeliveryOrderDetail } from "./deliveries.js";

const scope = parseBranchScope({
  restaurantId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
});
if (scope === undefined) throw new Error("invalid scope");
const orderId = "33333333-3333-4333-8333-333333333333";
const detail = {
  schemaVersion: 1, scope, orderId, status: "open", channel: "delivery", tableId: null,
  currency: "MXN", timeZone: "America/Mexico_City", createdAt: null, updatedAt: null, version: 1,
  items: [{ orderItemId: "44444444-4444-4444-8444-444444444444", status: "ready", name: "Pizza",
    quantity: 1, unitPriceMinor: 10000, lineTotalMinor: 10000, note: "Sin cebolla", modifiers: [], availableActions: [] }],
  totals: { currency: "MXN", itemsTotalMinor: 10000, deliveryChargeMinor: 0, tipMinor: 0, totalMinor: 10000 },
  fulfillment: { channel: "delivery", tableId: null, customerLabel: "Ana", addressLabel: "Calle 1",
    deliveryInstructions: "Portón azul", paymentIntent: { method: "cash", tenderedAmountMinor: 20000, tipMinor: 0 } },
  availableActions: [],
};

test("courier detail uses the ownership-gated route and validates order and branch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.test/api/v1/deliveries/order-detail");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
    assert.deepEqual(JSON.parse(String(init?.body)), { schemaVersion: 1, scope, orderId });
    return new Response(JSON.stringify(detail));
  };
  try {
    const result = await readDeliveryOrderDetail("token", "https://api.test", scope, orderId);
    assert.equal(result.status, "ok");
    if (result.status === "ok") assert.equal(result.value.items[0]?.note, "Sin cebolla");
  } finally { globalThis.fetch = originalFetch; }
});

test("courier detail fails closed on forbidden and mismatched responses", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 403 }); };
  try {
    assert.equal((await readDeliveryOrderDetail("token", "https://api.test", scope, "bad")).status, "invalid");
    assert.equal(calls, 0);
    assert.equal((await readDeliveryOrderDetail("token", "https://api.test", scope, orderId)).status, "unauthorized");
    globalThis.fetch = async () => new Response(JSON.stringify({ ...detail, orderId: "55555555-5555-4555-8555-555555555555" }));
    assert.equal((await readDeliveryOrderDetail("token", "https://api.test", scope, orderId)).status, "unavailable");
  } finally { globalThis.fetch = originalFetch; }
});
