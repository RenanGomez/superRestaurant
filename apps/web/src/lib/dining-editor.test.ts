import assert from "node:assert/strict";
import test from "node:test";
import { mergeByVersion, validateTableDetails } from "./dining-editor.js";

test("a newer server version replaces the local table; an older render never rolls it back", () => {
  const local = { a: { tableId: "a", version: 3 }, b: { tableId: "b", version: 1 } };
  const same = mergeByVersion(local, [{ tableId: "a", version: 2 }, { tableId: "b", version: 1 }]);
  assert.equal(same, local);
  const merged = mergeByVersion(local, [{ tableId: "a", version: 2 }, { tableId: "b", version: 2 }]);
  assert.equal(merged.a?.version, 3);
  assert.equal(merged.b?.version, 2);
});

test("tables added or removed on the server show up in the merge", () => {
  const local = { a: { tableId: "a", version: 1 } };
  assert.deepEqual(Object.keys(mergeByVersion(local, [{ tableId: "a", version: 1 }, { tableId: "c", version: 1 }])).sort(), ["a", "c"]);
  assert.deepEqual(Object.keys(mergeByVersion(local, [{ tableId: "c", version: 1 }])), ["c"]);
  assert.deepEqual(Object.keys(mergeByVersion(local, [{ tableId: "c", version: 1 }], new Set(["a"]))).sort(), ["a", "c"]);
});

test("table details are checked before they are sent", () => {
  assert.deepEqual(validateTableDetails({ name: "  Mesa 7 ", capacity: "6", shape: "round" }), { ok: true, name: "Mesa 7", capacity: 6, shape: "round" });
  assert.equal(validateTableDetails({ name: "   ", capacity: "4", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "x".repeat(61), capacity: "4", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "A", capacity: "0", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "A", capacity: "51", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "A", capacity: "2.5", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "A", capacity: "4", shape: "oval" }).ok, false);
});
