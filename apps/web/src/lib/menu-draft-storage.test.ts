import assert from "node:assert/strict";
import test from "node:test";
import { menuDraftKey, menuDraftSnapshot, parseMenuDraft, serializeMenuDraft, staleMenuDraftKeys } from "./menu-draft-storage.js";

const parts = {
  categories: [{ active: true, categoryId: "c1", displayOrder: 1, name: "Pizzas" }],
  groups: [{ active: true, displayOrder: 1, groupId: "g1", maximumQuantity: 1, minimumQuantity: 0, name: "G", options: [], productId: "p1" }],
  products: [{ active: true, categoryId: "c1", displayOrder: 1, imagePath: null, name: "P", productId: "p1", sku: null, stationId: "general", tax: null, unit: "pieza", unitPriceMinor: 100, variants: [] }],
};

test("key is scoped by restaurant, branch and version", () => {
  assert.equal(menuDraftKey("r", "b", 4), "menu-draft:r:b:4");
});

test("a serialized draft round-trips only for the same version", () => {
  const raw = serializeMenuDraft({ ...parts, expectedVersion: 4 });
  assert.deepEqual(parseMenuDraft(raw, 4), { ...parts, expectedVersion: 4 });
  assert.equal(parseMenuDraft(raw, 5), null);
});

test("garbage and malformed drafts are ignored", () => {
  assert.equal(parseMenuDraft(null, 1), null);
  assert.equal(parseMenuDraft("{not json", 1), null);
  assert.equal(parseMenuDraft("[]", 1), null);
  assert.equal(parseMenuDraft(JSON.stringify({ categories: [{}], expectedVersion: 1, groups: [], products: [] }), 1), null);
  assert.equal(parseMenuDraft(JSON.stringify({ categories: [], expectedVersion: 1, groups: [{ groupId: "g" }], products: [] }), 1), null);
});

test("snapshot changes with any edit and ignores the version", () => {
  const same = menuDraftSnapshot({ ...parts });
  assert.equal(same, menuDraftSnapshot({ ...parts }));
  const edited = { ...parts, categories: [{ ...parts.categories[0]!, name: "Otras" }] };
  assert.notEqual(same, menuDraftSnapshot(edited));
});

test("stale keys are other versions of this branch only", () => {
  const keys = ["menu-draft:r:b:3", "menu-draft:r:b:4", "menu-draft:r:other:3", "unrelated"];
  assert.deepEqual(staleMenuDraftKeys(keys, "r", "b", 4), ["menu-draft:r:b:3"]);
});
