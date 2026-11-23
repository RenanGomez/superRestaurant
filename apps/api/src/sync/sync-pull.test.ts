import assert from "node:assert/strict";
import test from "node:test";
import { SyncCursor } from "./sync-cursor.js";

const scope = { actorId: "actor", restaurantId: "restaurant", branchId: "branch" };
test("cursor binds actor and scope and expires", () => {
  let now = 0;
  const cursor = new SyncCursor("a".repeat(32), () => now);
  const value = cursor.encode(scope, "42");
  assert.equal(cursor.decode(value, scope), "42");
  assert.throws(() => cursor.decode(value, { ...scope, actorId: "other" }), /CURSOR_SCOPE_MISMATCH/u);
  assert.throws(() => cursor.decode(value, { ...scope, branchId: "other" }), /CURSOR_SCOPE_MISMATCH/u);
  assert.throws(() => cursor.decode(value, { ...scope, restaurantId: "other" }), /CURSOR_SCOPE_MISMATCH/u);
  assert.throws(() => cursor.decode(`${value}x`, scope), /CURSOR_SCOPE_MISMATCH/u);
  now = 30 * 86400_000;
  assert.throws(() => cursor.decode(value, scope), /CURSOR_EXPIRED/u);
});
import { SyncPullService } from "./sync-pull.service.js";
import type { TransactionalDatabaseClientPort } from "../database.js";

const ids = { restaurantId: "44444444-4444-4444-8444-444444444444", branchId: "55555555-5555-4555-8555-555555555555" };
const actor = "33333333-3333-4333-8333-333333333333";
const rows = [1, 2].map((sequence) => ({ canonical_sequence: String(sequence), canonical_version: String(sequence), entity_type: "MenuCatalog", entity_id: "66666666-6666-4666-8666-666666666666", restaurant_id: ids.restaurantId, branch_id: ids.branchId, tombstone: sequence === 2, snapshot: sequence === 2 ? null : { name: "menu" } }));
test("pull paginates canonical changes and tombstones without leaking scopes", async () => {
  const db: TransactionalDatabaseClientPort = { query: async () => { throw Error("unexpected"); }, transaction: async (f) => f({ query: async (_sql, args) => ({ rows: rows.filter((row) => Number(row.canonical_sequence) > Number(args[3])) }) }) };
  const service = new SyncPullService(db, new SyncCursor("a".repeat(32)));
  const first = await service.pull(actor, { protocolVersion: 1, scope: ids, cursor: null, limit: 1 });
  assert.equal(first.hasMore, true); assert.equal(first.changes[0]?.tombstone, false); assert.ok(first.nextCursor);
  const next = await service.pull(actor, { protocolVersion: 1, scope: ids, cursor: first.nextCursor, limit: 1 });
  assert.equal(next.changes[0]?.tombstone, true); assert.equal(next.hasMore, false);
  await assert.rejects(service.pull("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { protocolVersion: 1, scope: ids, cursor: first.nextCursor, limit: 1 }));
  await assert.rejects(service.pull(actor, { protocolVersion: 1, scope: { ...ids, branchId: "77777777-7777-4777-8777-777777777777" }, cursor: first.nextCursor, limit: 1 }));
});
