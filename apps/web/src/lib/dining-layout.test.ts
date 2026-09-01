import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";
import { getDiningLayout } from "./dining-layout.js";

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
