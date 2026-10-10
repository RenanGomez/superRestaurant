import assert from "node:assert/strict";
import test from "node:test";
import { applyDraftShape, draftChanges, draftFromTable, draftIsStale, mergeByVersion, validateTableDetails } from "./dining-editor.js";

test("a newer server version replaces the local table; an older render never rolls it back", () => {
  const local = { a: { tableId: "a", version: 3 }, b: { tableId: "b", version: 1 } };
  const same = mergeByVersion(local, [{ tableId: "a", version: 2 }, { tableId: "b", version: 1 }]);
  assert.equal(same, local);
  const merged = mergeByVersion(local, [{ tableId: "a", version: 2 }, { tableId: "b", version: 2 }]);
  assert.equal(merged.a?.version, 3);
  assert.equal(merged.b?.version, 2);
});

const saved = { name: "Mesa 1", capacity: 4, shape: "round", layout: { x: 2, y: 3, width: 4, height: 4 } };

test("a draft starts equal to its table and reports layout and details separately", () => {
  const draft = draftFromTable(saved);
  assert.deepEqual(draftChanges(saved, draft), { layout: false, details: false });
  assert.deepEqual(draftChanges(saved, { ...draft, x: 5 }), { layout: true, details: false });
  assert.deepEqual(draftChanges(saved, { ...draft, name: "  Mesa 1 " }), { layout: false, details: false });
  assert.deepEqual(draftChanges(saved, { ...draft, capacity: "6", shape: "square" }), { layout: false, details: true });
  assert.deepEqual(draftChanges(saved, { ...draft, height: 6, name: "Otra" }), { layout: true, details: true });
});

test("restoring the draft from the saved table discards every change", () => {
  const edited = { ...draftFromTable(saved), x: 9, name: "Cambio", capacity: "9" };
  assert.deepEqual(draftChanges(saved, edited), { layout: true, details: true });
  assert.deepEqual(draftChanges(saved, draftFromTable(saved)), { layout: false, details: false });
});

test("choosing square equalizes the sides without leaving the grid; other shapes keep the size", () => {
  const draft = { ...draftFromTable(saved), width: 6, height: 3 };
  assert.deepEqual(applyDraftShape(draft, "square"), { ...draft, shape: "square", width: 6, height: 6 });
  assert.deepEqual(applyDraftShape({ ...draft, y: 96 }, "square"), { ...draft, y: 96, shape: "square", width: 4, height: 4 });
  assert.deepEqual(applyDraftShape(draft, "rectangle"), { ...draft, shape: "rectangle" });
});

test("a draft is stale as soon as the server version differs from its base", () => {
  assert.equal(draftIsStale(3, 3), false);
  assert.equal(draftIsStale(3, 4), true);
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
  assert.equal(validateTableDetails({ name: " " + "x".repeat(40) + " ", capacity: "4", shape: "round" }).ok, true);
  assert.equal(validateTableDetails({ name: "x".repeat(41), capacity: "4", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "A", capacity: "0", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "A", capacity: "51", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "A", capacity: "2.5", shape: "round" }).ok, false);
  assert.equal(validateTableDetails({ name: "A", capacity: "4", shape: "oval" }).ok, false);
});
