import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";
import { getDiningLayout, updateDiningTableDetails, type UpdateDiningTableDetailsCommand } from "./dining-layout.js";

const scope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");

test("dining layout client sends exact scope and rejects hostile responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input).includes(`restaurantId=${scope.restaurantId}`), true);
      assert.equal(String(input).includes(`branchId=${scope.branchId}`), true);
      assert.equal(init?.headers !== undefined && (init.headers as Record<string, string>).authorization, "Bearer token");
      return new Response(JSON.stringify({ schemaVersion: 1, scope, zones: [] }), { status: 200 });
    };
    assert.deepEqual(await getDiningLayout("token", "https://api.example.test", scope), { schemaVersion: 1, scope, zones: [] });
    globalThis.fetch = async () => new Response(JSON.stringify({ schemaVersion: 1, scope, zones: [], extra: true }), { status: 200 });
    assert.equal(await getDiningLayout("token", "https://api.example.test", scope), undefined);
  } finally { globalThis.fetch = originalFetch; }
});

const detailsCommand: UpdateDiningTableDetailsCommand = {
  schemaVersion: 1, scope, tableId: "2c4d9d50-6a49-4bd9-8f1d-2e5a2f6b7a11", expectedVersion: 1,
  eventId: "5ed22a92-a93d-4034-9661-4df2b523517b", idempotencyKey: "72371a5f-2056-448d-9ddb-14ab6664a4e8",
  deviceId: "9d8b7d3e-0b9c-4b7e-9f55-3b9d6c1a2e44", occurredAt: "2026-09-01T18:05:00.000Z", name: "Mesa 7", capacity: 6, shape: "round",
};

test("table details go to PATCH /dining/tables/details and failures keep their meaning", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let seen: { url: string; method: string | undefined; body: unknown } | undefined;
    globalThis.fetch = async (input, init) => {
      seen = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({
        schemaVersion: 1, scope, tableId: detailsCommand.tableId, zoneId: "7d0a3b1c-5f1e-4a52-8d7c-0f6f6c1b9a10", name: "Mesa 7", capacity: 6, shape: "round",
        layout: { x: 0, y: 0, width: 4, height: 4 }, version: 2, updatedAt: "2026-09-01T18:05:01.000Z", updatedBy: "8cc7eb84-af2a-4e84-95de-967c39af86ab", replayed: false,
      }), { status: 200 });
    };
    const ok = await updateDiningTableDetails("token", "https://api.example.test", detailsCommand);
    assert.equal(ok.ok, true);
    assert.equal(seen?.url, "https://api.example.test/api/v1/dining/tables/details");
    assert.equal(seen?.method, "PATCH");
    assert.deepEqual(seen?.body, detailsCommand);
    globalThis.fetch = async () => new Response("{}", { status: 409 });
    assert.deepEqual(await updateDiningTableDetails("token", "https://api.example.test", detailsCommand), { ok: false, error: "conflict" });
    globalThis.fetch = async () => new Response("{}", { status: 403 });
    assert.deepEqual(await updateDiningTableDetails("token", "https://api.example.test", detailsCommand), { ok: false, error: "denied" });
    globalThis.fetch = async () => new Response("{}", { status: 404 });
    assert.deepEqual(await updateDiningTableDetails("token", "https://api.example.test", detailsCommand), { ok: false, error: "unavailable" });
    globalThis.fetch = async () => { throw new Error("network"); };
    assert.deepEqual(await updateDiningTableDetails("token", "https://api.example.test", detailsCommand), { ok: false, error: "unavailable" });
  } finally { globalThis.fetch = originalFetch; }
});
