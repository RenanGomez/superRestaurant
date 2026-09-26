import assert from "node:assert/strict";
import test from "node:test";

import { requestCustomerOrder } from "./customer-order-history.js";

const scope = { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" };
const customerId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const orderId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const productId = "ec5e7c30-edac-4b79-bf8c-e363b041c59f";
const itemId = "60a26e69-3ea6-4ef8-8a2b-ad43ba0a0da1";
const catalogVersion = "47f7f293-b155-42b9-bdc7-f9be3846f44e";
const query = { schemaVersion: 1 as const, scope, customerId, limit: 10 };
const previewQuery = { schemaVersion: 1 as const, scope, customerId, orderId };
const preview = {
  schemaVersion: 1, scope, customerId, sourceOrderId: orderId, catalogVersion, currency: "MXN",
  readyLineCount: 1, blockedLineCount: 0, hasPriceChanges: true,
  lines: [{ sourceOrderItemId: itemId, productId, historicalName: "Taco anterior", currentName: "Taco vigente",
    quantity: 2, status: "ready", currentUnitPriceMinor: 4_500, issues: [{ code: "product_price_changed",
      severity: "warning", groupId: null, modifierId: null, historicalAmountMinor: 4_000, currentAmountMinor: 4_500 }] }],
};

test("recent orders use a no-store scoped GET and reject foreign responses", async () => {
  const previous = globalThis.fetch;
  const calls: Array<{ cache: RequestCache | undefined; method: string | undefined; url: string }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ cache: init?.cache, method: init?.method, url: String(input) });
      return new Response(JSON.stringify({ schemaVersion: 1, scope, customerId, orders: [] }), { status: 200 });
    };
    const result = await requestCustomerOrder("token", "https://api.example.com", "recentOrders", query);
    assert.equal(result.ok, true);
    assert.match(calls[0]?.url ?? "", new RegExp(`/customers/${customerId}/orders/recent\\?`));
    assert.match(calls[0]?.url ?? "", /limit=10/u);
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[0]?.cache, "no-store");
    globalThis.fetch = async () => new Response(JSON.stringify({ schemaVersion: 1,
      scope: { ...scope, branchId: customerId }, customerId, orders: [] }), { status: 200 });
    assert.deepEqual(await requestCustomerOrder("token", "https://api.example.com", "recentOrders", query),
      { error: "unavailable", ok: false });
  } finally { globalThis.fetch = previous; }
});

test("repeat preview and mutation bind route identities and validate the resulting Capture", async () => {
  const previous = globalThis.fetch;
  const command = { schemaVersion: 1 as const, scope, customerId, sourceOrderId: orderId,
    captureDraftId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", expectedVersion: 4,
    attentionLeaseId: "e2a6113b-d5cb-4e26-8f65-a0bc9065b08c",
    eventId: "0438d8ac-a86d-4f5b-8b26-1a35f9d82a39",
    idempotencyKey: "0e22dfd1-9064-4fa8-86da-8fcce41fe821",
    deviceId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4", occurredAt: "2026-09-24T12:00:00.000Z" };
  const detail = { schemaVersion: 1, scope, captureDraftId: command.captureDraftId, folio: "CAP-1",
    sourceChannel: "phone", fulfillmentChannel: "counter", status: "draft", attentionStatus: "claimed",
    ownerMembershipId: customerId, attentionLeaseId: command.attentionLeaseId,
    attentionLeaseExpiresAt: "2026-09-24T12:05:00.000Z", customerSnapshotRef: catalogVersion,
    fulfillmentSnapshotRef: null, confirmedOrderId: null, version: 5, updatedAt: "2026-09-24T12:00:01.000Z" };
  const calls: Array<{ body: string | undefined; method: string | undefined; url: string }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ body: typeof init?.body === "string" ? init.body : undefined, method: init?.method, url: String(input) });
      return String(input).endsWith("repeat")
        ? new Response(JSON.stringify({ schemaVersion: 1, capture: { schemaVersion: 1, detail, replayed: false }, preview }), { status: 200 })
        : new Response(JSON.stringify(preview), { status: 200 });
    };
    assert.equal((await requestCustomerOrder("token", "https://api.example.com", "repeatPreview", previewQuery)).ok, true);
    assert.equal((await requestCustomerOrder("token", "https://api.example.com", "repeatOrder", command)).ok, true);
    assert.match(calls[0]?.url ?? "", new RegExp(`/customers/${customerId}/orders/${orderId}/repeat-preview\\?`));
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[1]?.url, `https://api.example.com/api/v1/customers/${customerId}/orders/${orderId}/repeat`);
    assert.equal(calls[1]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "null"), command);
    assert.deepEqual(await requestCustomerOrder("token", "https://api.example.com", "repeatOrder",
      { ...command, sourceOrderId: "invalid" }), { error: "invalid", ok: false });
  } finally { globalThis.fetch = previous; }
});

test("customer order requests map bounded HTTP failures", async () => {
  const previous = globalThis.fetch;
  try {
    for (const [status, error] of [[400, "invalid"], [403, "denied"], [404, "missing"], [409, "conflict"], [500, "unavailable"]] as const) {
      globalThis.fetch = async () => new Response("{}", { status });
      assert.deepEqual(await requestCustomerOrder("token", "https://api.example.com", "repeatPreview", previewQuery),
        { error, ok: false });
    }
  } finally { globalThis.fetch = previous; }
});
