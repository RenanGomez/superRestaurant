import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";

import type { DatabaseClientPort } from "../database.js";
import { PostgresMembershipLookup } from "./postgres-membership-lookup.js";

const actorId = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const scope = parseBranchScope({ restaurantId, branchId });
if (scope === undefined) throw new Error("test scope must be valid");

test("looks up the verified actor and exact UUID scope through the private function", async () => {
  const calls: { parameters: readonly unknown[]; sql: string }[] = [];
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      return { rows: [{ branch_id: branchId, restaurant_id: restaurantId, roles: ["manager", "waiter"] }] };
    },
  };
  const lookup = new PostgresMembershipLookup(database);

  const membership = await lookup.findActiveMembership({ actorId }, scope);
  assert.deepEqual(membership, { roles: ["manager", "waiter"], scope });
  assert.ok(Object.isFrozen(membership));
  assert.ok(Object.isFrozen(membership?.roles));
  assert.deepEqual(calls[0]?.parameters, [actorId, restaurantId, branchId]);
  assert.match(calls[0]?.sql ?? "", /app_private\.find_active_branch_membership\(\$1::uuid, \$2::uuid, \$3::uuid\)/u);
  assert.equal((calls[0]?.sql ?? "").includes(actorId), false);
});

test("rejects invalid UUIDs before PostgreSQL casts are reached", async () => {
  let calls = 0;
  const lookup = new PostgresMembershipLookup({ query: async () => { calls += 1; return { rows: [] }; } });
  const invalidScope = parseBranchScope({ restaurantId: "restaurant-a", branchId: "branch-a" });
  if (invalidScope === undefined) throw new Error("shared scope parser should accept opaque ids");

  assert.equal(await lookup.findActiveMembership({ actorId }, invalidScope), undefined);
  assert.equal(await lookup.findActiveMembership({ actorId: "caller-controlled" }, scope), undefined);
  assert.equal(calls, 0);
});

test("fails closed for missing, ambiguous, cross-scope or malformed rows", async () => {
  const invalidRows: readonly (readonly unknown[])[] = [
    [],
    [
      { branch_id: branchId, restaurant_id: restaurantId, roles: ["manager"] },
      { branch_id: branchId, restaurant_id: restaurantId, roles: ["waiter"] },
    ],
    [{ branch_id: "b98b5914-002d-42a0-a26b-2a0f954ddf1e", restaurant_id: restaurantId, roles: ["manager"] }],
    [{ branch_id: branchId, restaurant_id: "159fc6e9-c272-4362-bdd9-84f0455a65fe", roles: ["manager"] }],
    [{ branch_id: branchId, restaurant_id: restaurantId, roles: [] }],
    [{ branch_id: branchId, restaurant_id: restaurantId, roles: ["manager", "manager"] }],
    [{ branch_id: branchId, restaurant_id: restaurantId, roles: ["invented"] }],
    [{ branch_id: branchId, extra: true, restaurant_id: restaurantId, roles: ["manager"] }],
    [Object.create({ branch_id: branchId, restaurant_id: restaurantId, roles: ["manager"] })],
  ];

  for (const rows of invalidRows) {
    const lookup = new PostgresMembershipLookup({ query: async () => ({ rows }) });
    assert.equal(await lookup.findActiveMembership({ actorId }, scope), undefined);
  }
});

test("does not convert database failures into an apparent membership", async () => {
  const lookup = new PostgresMembershipLookup({ query: async () => { throw new Error("database unavailable"); } });
  await assert.rejects(lookup.findActiveMembership({ actorId }, scope), /database unavailable/u);
});
