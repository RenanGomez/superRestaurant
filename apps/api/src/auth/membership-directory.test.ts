import assert from "node:assert/strict";
import test from "node:test";

import type { DatabaseClientPort } from "../database.js";
import {
  MembershipDirectoryUnavailableError,
  PostgresMembershipDirectory,
} from "./membership-directory.js";

const actorId = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";

const validRow = Object.freeze({
  branch_id: branchId,
  branch_name: "Sucursal Norte",
  restaurant_id: restaurantId,
  restaurant_name: "Restaurante Centro",
  roles: ["manager", "waiter"],
});

test("lists the verified actor's memberships through the exact private capability", async () => {
  const calls: { parameters: readonly unknown[]; sql: string }[] = [];
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      return { rows: [validRow] };
    },
  };

  const result = await new PostgresMembershipDirectory(database).listActiveMemberships({ actorId });

  assert.deepEqual(result, {
    memberships: [{
      branchName: "Sucursal Norte",
      restaurantName: "Restaurante Centro",
      roles: ["manager", "waiter"],
      scope: { branchId, restaurantId },
    }],
    schemaVersion: 1,
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.memberships));
  assert.ok(Object.isFrozen(result.memberships[0]));
  assert.ok(Object.isFrozen(result.memberships[0]?.roles));
  assert.deepEqual(calls[0]?.parameters, [actorId]);
  assert.match(calls[0]?.sql ?? "", /app_private\.list_active_branch_memberships\(\$1::uuid\)/u);
  assert.equal((calls[0]?.sql ?? "").includes(actorId), false);
});

test("returns an explicit empty versioned directory when no active memberships exist", async () => {
  const directory = new PostgresMembershipDirectory({ query: async () => ({ rows: [] }) });
  assert.deepEqual(await directory.listActiveMemberships({ actorId }), { memberships: [], schemaVersion: 1 });
});

test("rejects an invalid principal before PostgreSQL casts are reached", async () => {
  let calls = 0;
  const directory = new PostgresMembershipDirectory({
    query: async () => {
      calls += 1;
      return { rows: [] };
    },
  });

  await assert.rejects(
    directory.listActiveMemberships({ actorId: "caller-controlled" }),
    MembershipDirectoryUnavailableError,
  );
  assert.equal(calls, 0);
});

test("fails the entire directory for malformed, ambiguous or hostile rows", async () => {
  const secondBranchId = "b98b5914-002d-42a0-a26b-2a0f954ddf1e";
  const accessorRow = { ...validRow };
  Object.defineProperty(accessorRow, "roles", { enumerable: true, get: () => ["manager"] });
  const malformedRows: readonly (readonly unknown[])[] = [
    [{ ...validRow, extra: true }],
    [{ ...validRow, roles: ["waiter", "manager"] }],
    [{ ...validRow, roles: ["manager", "manager"] }],
    [{ ...validRow, roles: ["invented"] }],
    [{ ...validRow, branch_name: "  Norte" }],
    [validRow, validRow],
    [{ ...validRow, branch_id: secondBranchId }, validRow],
    [Object.create(validRow)],
    [accessorRow],
    [new Proxy(validRow, { ownKeys: () => { throw new Error("hostile"); } })],
  ];

  for (const rows of malformedRows) {
    const directory = new PostgresMembershipDirectory({ query: async () => ({ rows }) });
    await assert.rejects(directory.listActiveMemberships({ actorId }), MembershipDirectoryUnavailableError);
  }
});

test("rejects oversized results and database failures with one stable error", async () => {
  const oversized = Array.from({ length: 501 }, () => validRow);
  const oversizedDirectory = new PostgresMembershipDirectory({ query: async () => ({ rows: oversized }) });
  await assert.rejects(
    oversizedDirectory.listActiveMemberships({ actorId }),
    MembershipDirectoryUnavailableError,
  );

  const failedDirectory = new PostgresMembershipDirectory({
    query: async () => { throw new Error("database unavailable with sensitive context"); },
  });
  await assert.rejects(
    failedDirectory.listActiveMemberships({ actorId }),
    (error: unknown) => error instanceof MembershipDirectoryUnavailableError
      && error.message === "MEMBERSHIP_DIRECTORY_UNAVAILABLE",
  );
});
