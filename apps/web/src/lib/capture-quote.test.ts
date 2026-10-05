import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureLineQuoteResultV1 } from "@super-restaurant/shared-types";
import { quoteLinePrice, visibleLineEstimate } from "./capture-quote.js";

const quote: CaptureLineQuoteResultV1 = {
  schemaVersion: 1,
  catalogVersion: "11111111-1111-4111-8111-111111111111",
  currency: "MXN",
  unitPriceMinor: 12001,
  lineTotalMinor: 24002,
  modifiers: [],
  geometry: "whole",
  fractionBreakdown: [],
};

test("server estimate appears only for the current selection; pending and failed reads keep the local estimate", () => {
  assert.deepEqual(visibleLineEstimate(24000, "selection-a", null), { label: "Estimado", minor: 24000 });
  assert.deepEqual(visibleLineEstimate(24000, "selection-a", { key: "selection-a", value: quote }),
    { label: "Estimado del servidor", minor: 24002 });
  assert.deepEqual(visibleLineEstimate(12000, "selection-b", { key: "selection-a", value: quote }),
    { label: "Estimado", minor: 12000 });
  assert.deepEqual(visibleLineEstimate(null, null, { key: "selection-a", value: quote }),
    { label: "Estimado", minor: null });
});

test("line quote uses the scoped read endpoint and rejects a stale catalog response", async () => {
  const request = { schemaVersion: 1, scope: { restaurantId: "22222222-2222-4222-8222-222222222222",
    branchId: "33333333-3333-4333-8333-333333333333" }, catalogVersion: quote.catalogVersion,
    productId: "44444444-4444-4444-8444-444444444444", variantId: null, modifierGroups: [], fraction: null, quantity: 2 };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.example/api/v1/captures/line-quote");
      assert.equal(options?.method, "POST");
      assert.equal((options?.headers as Record<string, string>).authorization, "Bearer token");
      assert.deepEqual(JSON.parse(String(options?.body)), request);
      return Response.json(quote);
    };
    assert.deepEqual(await quoteLinePrice("token", "https://api.example", request), { ok: true, value: quote });
    globalThis.fetch = async () => Response.json({ ...quote, catalogVersion: "55555555-5555-4555-8555-555555555555" });
    assert.deepEqual(await quoteLinePrice("token", "https://api.example", request), { ok: false, error: "unavailable" });
    globalThis.fetch = async () => new Response(null, { status: 409 });
    assert.deepEqual(await quoteLinePrice("token", "https://api.example", request), { ok: false, error: "conflict" });
  } finally { globalThis.fetch = originalFetch; }
});
