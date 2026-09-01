import assert from "node:assert/strict";
import test from "node:test";

import { tenancyFixtureEmail, tenancyFixtureName } from "./tenancy-fixture-markers.js";
import {
  recoverTenancyFixtures,
  type RecoveryAuthUser,
  type TenancyFixtureRecoveryAuthPort,
  type TenancyFixtureRecoveryDatabasePort,
  validateTenancyFixtureRecoverySnapshot,
} from "./tenancy-fixture-recovery.js";
import { TenancyFixtureRecoveryError } from "./tenancy-fixture-recovery-config.js";

const runId = "11111111-1111-4111-8111-111111111111";
const ids = Object.freeze({
  amber: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  cobalt: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  restaurant1: "10000000-0000-4000-8000-000000000001",
  restaurant2: "10000000-0000-4000-8000-000000000002",
  branch11: "20000000-0000-4000-8000-000000000011",
  branch12: "20000000-0000-4000-8000-000000000012",
  branch21: "20000000-0000-4000-8000-000000000021",
  branch22: "20000000-0000-4000-8000-000000000022",
});
const amberUser: RecoveryAuthUser = Object.freeze({
  email: tenancyFixtureEmail(runId, "amber"), fixtureKey: "amber", id: ids.amber,
});
const cobaltUser: RecoveryAuthUser = Object.freeze({
  email: tenancyFixtureEmail(runId, "cobalt"), fixtureKey: "cobalt", id: ids.cobalt,
});
const users: readonly [RecoveryAuthUser, RecoveryAuthUser] = Object.freeze([amberUser, cobaltUser]);

test("accepts only the complete runner graph and allowed revocation prefix", () => {
  const snapshot = completeSnapshot();
  const validated = validateTenancyFixtureRecoverySnapshot(runId, users, snapshot);
  assert.equal(validated.restaurantIds.length, 2);
  assert.equal(validated.branchIds.length, 4);
  assert.equal(validated.membershipIds.length, 4);
  assert.equal(validated.grantIds.length, 5);

  const afterWaiter = cloneSnapshot(snapshot);
  revoke(required(afterWaiter.grants[1]));
  validateTenancyFixtureRecoverySnapshot(runId, users, afterWaiter);
  const afterViewer = cloneSnapshot(afterWaiter);
  revoke(required(afterViewer.grants[2]));
  validateTenancyFixtureRecoverySnapshot(runId, users, afterViewer);
  const afterMembership = cloneSnapshot(afterViewer);
  revoke(required(afterMembership.memberships[0]));
  validateTenancyFixtureRecoverySnapshot(runId, users, afterMembership);
});

test("accepts the completed dining-zone graph and verified disable prefix for recovery", () => {
  const snapshot = completeSnapshot();
  revoke(required(snapshot.grants[1]));
  revoke(required(snapshot.grants[2]));
  revoke(required(snapshot.memberships[0]));
  disable(required(snapshot.branches[2]), ids.cobalt);
  disable(required(snapshot.restaurants[1]), ids.cobalt);
  const zoneId = "60000000-0000-4000-8000-000000000001";
  const eventId = "70000000-0000-4000-8000-000000000001";
  const idempotencyKey = "80000000-0000-4000-8000-000000000001";
  const withDining = {
    ...snapshot,
    diningZoneAudits: [{
      actorId: ids.amber,
      branchId: ids.branch11,
      eventId,
      idempotencyKey,
      name: tenancyFixtureName(runId, "dining-zone-created"),
      operation: "created",
      restaurantId: ids.restaurant1,
      zoneId,
    }],
    diningZones: [{
      branchId: ids.branch11,
      createdBy: ids.amber,
      id: zoneId,
      name: tenancyFixtureName(runId, "dining-zone-created"),
      restaurantId: ids.restaurant1,
      version: 1,
    }],
  };
  const validated = validateTenancyFixtureRecoverySnapshot(runId, users, withDining);
  assert.deepEqual(validated.diningZoneIds, [zoneId]);
  assert.deepEqual(validated.diningZoneEventIds, [eventId]);

  const contaminated = structuredClone(withDining);
  required(contaminated.diningZoneAudits[0]).name = tenancyFixtureName(runId, "dining-zone-conflict");
  assertContamination(() => validateTenancyFixtureRecoverySnapshot(runId, users, contaminated));
});

test("accepts only the marked dining-table create and update prefix", () => {
  const snapshot = completeSnapshot();
  const zoneId = "60000000-0000-4000-8000-000000000001";
  const tableId = "61000000-0000-4000-8000-000000000001";
  const zoneName = tenancyFixtureName(runId, "dining-zone-created");
  const tableName = tenancyFixtureName(runId, "dining-table-created");
  const withTables = {
    ...snapshot,
    diningZones: [{ branchId: ids.branch11, createdBy: ids.amber, id: zoneId, name: zoneName, restaurantId: ids.restaurant1, version: 1 }],
    diningZoneAudits: [{ actorId: ids.amber, branchId: ids.branch11, eventId: "70000000-0000-4000-8000-000000000001", idempotencyKey: "80000000-0000-4000-8000-000000000001", name: zoneName, operation: "created", restaurantId: ids.restaurant1, zoneId }],
    diningTables: [{ actorId: ids.amber, branchId: ids.branch11, id: tableId, name: tableName, restaurantId: ids.restaurant1, zoneId }],
    diningTableAudits: [
      { actorId: ids.amber, branchId: ids.branch11, eventId: "71000000-0000-4000-8000-000000000001", name: tableName, operation: "created", restaurantId: ids.restaurant1, tableId, zoneId },
      { actorId: ids.amber, branchId: ids.branch11, eventId: "71000000-0000-4000-8000-000000000002", name: tableName, operation: "layout_updated", restaurantId: ids.restaurant1, tableId, zoneId },
    ],
  };
  const validated = validateTenancyFixtureRecoverySnapshot(runId, users, withTables);
  assert.deepEqual(validated.diningTableIds, [tableId]);
  assert.deepEqual(validated.diningTableEventIds, ["71000000-0000-4000-8000-000000000001", "71000000-0000-4000-8000-000000000002"]);
  const contaminated = structuredClone(withTables);
  required(contaminated.diningTableAudits[1]).operation = "created";
  assertContamination(() => validateTenancyFixtureRecoverySnapshot(runId, users, contaminated));
});

test("accepts empty database with zero, one or two exact Auth fixtures", () => {
  const empty = emptySnapshot();
  for (const authUsers of [[], [amberUser], users]) {
    const validated = validateTenancyFixtureRecoverySnapshot(runId, authUsers, empty);
    assert.deepEqual(validated.restaurantIds, []);
  }
});

test("rejects partial, canary-only and contaminated fixture state", () => {
  const partial = cloneSnapshot(completeSnapshot());
  partial.branches.pop();
  assertContamination(() => validateTenancyFixtureRecoverySnapshot(runId, users, partial));

  const canaryOnly = emptySnapshot();
  canaryOnly.restaurants.push(restaurant("30000000-0000-4000-8000-000000000001", "canary-anon"));
  assertContamination(() => validateTenancyFixtureRecoverySnapshot(runId, [], canaryOnly));

  const wrongGrant = cloneSnapshot(completeSnapshot());
  required(wrongGrant.grants[0]).roleCode = "owner";
  assertContamination(() => validateTenancyFixtureRecoverySnapshot(runId, users, wrongGrant));

  const illegalOrder = cloneSnapshot(completeSnapshot());
  revoke(required(illegalOrder.grants[2]));
  assertContamination(() => validateTenancyFixtureRecoverySnapshot(runId, users, illegalOrder));

  const thirdUser = {
    email: "tenancy-third@example.invalid",
    fixtureKey: "third",
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  };
  assertContamination(() => validateTenancyFixtureRecoverySnapshot(runId, [...users, thirdUser], completeSnapshot()));
});

test("orchestrates idempotent cleanup and postcheck", async () => {
  let discovered: readonly RecoveryAuthUser[] = [amberUser];
  const deleted: string[] = [];
  let asserted = false;
  const auth: TenancyFixtureRecoveryAuthPort = {
    deleteUser: async (userId) => {
      deleted.push(userId);
      discovered = [];
      return true;
    },
    discoverUsers: async () => discovered,
    readUser: async (_requestedRunId, userId) => discovered.find((user) => user.id === userId),
  };
  const database: TenancyFixtureRecoveryDatabasePort = {
    assertZero: async (_requestedRunId, userIds) => {
      assert.deepEqual(userIds, [ids.amber]);
      asserted = true;
    },
    close: async () => undefined,
    deleteVerified: async (_requestedRunId, discoveredUsers) => {
      assert.deepEqual(discoveredUsers, [amberUser]);
      return 0;
    },
  };

  const result = await recoverTenancyFixtures(runId, { auth, database });
  assert.deepEqual(deleted, [ids.amber]);
  assert.equal(asserted, true);
  assert.deepEqual(result, { fixtureRowsRemoved: 0, fixtureUsersRemoved: 1, runId, status: "ok" });
});

test("aborts before Auth deletion if the marker changes after database cleanup", async () => {
  let reads = 0;
  let deleteCalled = false;
  const auth: TenancyFixtureRecoveryAuthPort = {
    deleteUser: async () => {
      deleteCalled = true;
      return true;
    },
    discoverUsers: async () => [amberUser],
    readUser: async () => {
      reads += 1;
      return reads === 1 ? amberUser : undefined;
    },
  };
  const database: TenancyFixtureRecoveryDatabasePort = {
    assertZero: async () => undefined,
    close: async () => undefined,
    deleteVerified: async () => 0,
  };

  await assert.rejects(() => recoverTenancyFixtures(runId, { auth, database }), (error: unknown) => {
    assert.ok(error instanceof TenancyFixtureRecoveryError);
    assert.equal(error.code, "TENANCY_FIXTURE_RECOVERY_CONTAMINATION_DETECTED");
    return true;
  });
  assert.equal(deleteCalled, false);
});

function completeSnapshot(): MutableSnapshot {
  const membershipIds = [
    "40000000-0000-4000-8000-000000000011",
    "40000000-0000-4000-8000-000000000012",
    "40000000-0000-4000-8000-000000000021",
    "40000000-0000-4000-8000-000000000022",
  ] as const;
  return {
    branches: [
      branch(ids.branch11, ids.restaurant1, "branch-11"),
      branch(ids.branch12, ids.restaurant1, "branch-12"),
      branch(ids.branch21, ids.restaurant2, "branch-21"),
      branch(ids.branch22, ids.restaurant2, "branch-22"),
    ],
    grants: [
      grant("50000000-0000-4000-8000-000000000001", membershipIds[0], "manager"),
      grant("50000000-0000-4000-8000-000000000002", membershipIds[0], "waiter"),
      grant("50000000-0000-4000-8000-000000000003", membershipIds[1], "viewer"),
      grant("50000000-0000-4000-8000-000000000004", membershipIds[2], "cashier"),
      grant("50000000-0000-4000-8000-000000000005", membershipIds[3], "kitchen"),
    ],
    memberships: [
      membership(membershipIds[0], ids.amber, ids.restaurant1, ids.branch11),
      membership(membershipIds[1], ids.amber, ids.restaurant1, ids.branch12),
      membership(membershipIds[2], ids.cobalt, ids.restaurant2, ids.branch21),
      membership(membershipIds[3], ids.cobalt, ids.restaurant2, ids.branch22),
    ],
    restaurants: [restaurant(ids.restaurant1, "restaurant-1"), restaurant(ids.restaurant2, "restaurant-2")],
  };
}

type MutableSnapshot = {
  branches: Array<{ disabledAt: string | null; disabledBy: string | null; disabledReason: string | null; id: string; name: string; restaurantId: string; version: number }>;
  grants: Array<{ grantedBy: string; id: string; membershipId: string; revocationReason: string | null; revokedAt: string | null; revokedBy: string | null; roleCode: string }>;
  memberships: Array<{ branchId: string; grantedBy: string; id: string; restaurantId: string; revocationReason: string | null; revokedAt: string | null; revokedBy: string | null; userId: string }>;
  restaurants: Array<{ disabledAt: string | null; disabledBy: string | null; disabledReason: string | null; id: string; name: string; version: number }>;
};

function emptySnapshot(): MutableSnapshot {
  return { branches: [], grants: [], memberships: [], restaurants: [] };
}

function cloneSnapshot(snapshot: MutableSnapshot): MutableSnapshot {
  return {
    branches: snapshot.branches.map((row) => ({ ...row })),
    grants: snapshot.grants.map((row) => ({ ...row })),
    memberships: snapshot.memberships.map((row) => ({ ...row })),
    restaurants: snapshot.restaurants.map((row) => ({ ...row })),
  };
}

function restaurant(id: string, suffix: Parameters<typeof tenancyFixtureName>[1]) {
  return { disabledAt: null, disabledBy: null, disabledReason: null, id, name: tenancyFixtureName(runId, suffix), version: 1 };
}

function branch(id: string, restaurantId: string, suffix: Parameters<typeof tenancyFixtureName>[1]) {
  return { disabledAt: null, disabledBy: null, disabledReason: null, id, name: tenancyFixtureName(runId, suffix), restaurantId, version: 1 };
}

function membership(id: string, userId: string, restaurantId: string, branchId: string) {
  return { branchId, grantedBy: ids.amber, id, restaurantId, revocationReason: null, revokedAt: null, revokedBy: null, userId };
}

function grant(id: string, membershipId: string, roleCode: string) {
  return { grantedBy: ids.amber, id, membershipId, revocationReason: null, revokedAt: null, revokedBy: null, roleCode };
}

function revoke(row: { revocationReason: string | null; revokedAt: string | null; revokedBy: string | null }): void {
  row.revokedAt = "2026-08-30T00:00:00.000Z";
  row.revokedBy = ids.amber;
  row.revocationReason = "tenancy verification";
}

function disable(
  row: { disabledAt: string | null; disabledBy: string | null; disabledReason: string | null },
  actorId: string,
): void {
  row.disabledAt = "2026-08-31T00:00:00.000Z";
  row.disabledBy = actorId;
  row.disabledReason = "tenancy verification";
}

function assertContamination(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof TenancyFixtureRecoveryError);
    assert.equal(error.code, "TENANCY_FIXTURE_RECOVERY_CONTAMINATION_DETECTED");
    return true;
  });
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("TEST_FIXTURE_MISSING");
  return value;
}
