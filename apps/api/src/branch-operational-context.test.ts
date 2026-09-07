import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";

import {
  BranchOperationalContextUnavailableError,
  PostgresBranchOperationalContext,
} from "./branch-operational-context.js";

const actorId = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const scope = parseBranchScope({ restaurantId, branchId });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");

const context = Object.freeze({
  roles: Object.freeze(["manager", "waiter"]),
  schemaVersion: 1,
  scope,
  timeZone: "America/Hermosillo",
});

test("reads the authoritative context for the verified actor and exact scope", async () => {
  const calls: { parameters: readonly unknown[]; sql: string }[] = [];
  const adapter = new PostgresBranchOperationalContext({
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      return { rows: [{ result: context }] };
    },
  });

  assert.deepEqual(await adapter.select(actorId, scope), context);
  assert.deepEqual(calls[0]?.parameters, [actorId, restaurantId, branchId]);
  assert.match(calls[0]?.sql ?? "", /app_private\.read_branch_operational_context/u);
  assert.equal((calls[0]?.sql ?? "").includes(actorId), false);
});

test("fails closed for forbidden, malformed and cross-scope responses", async () => {
  const forbidden = new PostgresBranchOperationalContext({ query: async () => ({ rows: [{ result: null }] }) });
  assert.equal(await forbidden.select(actorId, scope), "forbidden");

  const invalidRows: readonly (readonly unknown[])[] = [
    [],
    [{ result: context }, { result: context }],
    [{ wrong: context }],
    [{ result: { ...context, timeZone: "Not/A_Zone" } }],
    [{ result: { ...context, scope: { ...scope, branchId: "b98b5914-002d-42a0-a26b-2a0f954ddf1e" } } }],
    [{ result: { ...context, extra: true } }],
    [Object.create({ result: context })],
  ];
  for (const rows of invalidRows) {
    const adapter = new PostgresBranchOperationalContext({ query: async () => ({ rows }) });
    await assert.rejects(adapter.select(actorId, scope), BranchOperationalContextUnavailableError);
  }
});

test("rejects invalid identifiers before reaching PostgreSQL casts", async () => {
  let calls = 0;
  const adapter = new PostgresBranchOperationalContext({ query: async () => { calls += 1; return { rows: [] }; } });
  const invalidScope = parseBranchScope({ restaurantId: "restaurant", branchId: "branch" });
  if (invalidScope === undefined) throw new Error("OPAQUE_SCOPE_REJECTED");
  assert.equal(await adapter.select(actorId, invalidScope), "forbidden");
  assert.equal(await adapter.select("actor", scope), "forbidden");
  assert.equal(calls, 0);
});
