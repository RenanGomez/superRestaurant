import assert from "node:assert/strict";
import test from "node:test";
import { menuDraftKey, menuDraftSnapshot, parseMenuDraft, serializeMenuDraft, staleMenuDraftKeys } from "./menu-draft-storage.js";
import { withDerivedAssignments } from "./menu-groups.js";

const parts = {
  categories: [{ active: true, categoryId: "c1", color: null, displayOrder: 1, imagePath: null, name: "Pizzas" }],
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

test("an old draft without modifierGroupIds is recovered through its legacy owners", () => {
  const parsed = parseMenuDraft(serializeMenuDraft({ ...parts, expectedVersion: 4 }), 4);
  assert.ok(parsed !== null);
  assert.deepEqual(withDerivedAssignments(parsed.products, parsed.groups)[0]?.modifierGroupIds, ["g1"]);
});

test("a new draft preserves canonical modifierGroupIds", () => {
  const modern = { ...parts, products: [{ ...parts.products[0]!, modifierGroupIds: ["g1"] }] };
  const parsed = parseMenuDraft(serializeMenuDraft({ ...modern, expectedVersion: 4 }), 4);
  assert.deepEqual(parsed?.products[0]?.modifierGroupIds, ["g1"]);
});

test("garbage and malformed drafts are ignored", () => {
  assert.equal(parseMenuDraft(null, 1), null);
  assert.equal(parseMenuDraft("{not json", 1), null);
  assert.equal(parseMenuDraft("[]", 1), null);
  assert.equal(parseMenuDraft(JSON.stringify({ categories: [{}], expectedVersion: 1, groups: [], products: [] }), 1), null);
  assert.equal(parseMenuDraft(JSON.stringify({ categories: [], expectedVersion: 1, groups: [{ groupId: "g" }], products: [] }), 1), null);
  assert.equal(parseMenuDraft(JSON.stringify({ ...parts, expectedVersion: 1, products: [{ ...parts.products[0], modifierGroupIds: ["missing"] }] }), 1), null);
  assert.equal(parseMenuDraft(JSON.stringify({ ...parts, expectedVersion: 1, products: [{ ...parts.products[0], modifierGroupIds: ["g1", "g1"] }] }), 1), null);
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

test("a draft saved before category colours existed reads back with null colour and image", () => {
  const legacy = JSON.stringify({
    categories: [{ active: true, categoryId: "c1", displayOrder: 1, name: "Pizzas" }],
    expectedVersion: 2, groups: parts.groups, products: parts.products,
  });
  assert.deepEqual(parseMenuDraft(legacy, 2)?.categories, [{ active: true, categoryId: "c1", color: null, displayOrder: 1, imagePath: null, name: "Pizzas" }]);
  const styled = JSON.stringify({
    categories: [{ active: true, categoryId: "c1", color: "sky", displayOrder: 1, imagePath: "11111111-1111-4111-8111-111111111111/categories/c1/0123456789abcdef0123456789abcdef.png", name: "Pizzas" }],
    expectedVersion: 2, groups: parts.groups, products: parts.products,
  });
  assert.equal(parseMenuDraft(styled, 2)?.categories[0]?.color, "sky");
});

test("a draft with an invalid or foreign category image or colour is rejected", () => {
  const draft = (category: Record<string, unknown>): string => JSON.stringify({
    categories: [{ active: true, categoryId: "c1", displayOrder: 1, name: "Pizzas", ...category }],
    expectedVersion: 2, groups: parts.groups, products: parts.products,
  });
  assert.equal(parseMenuDraft(draft({ imagePath: "x/categories/y/z.png" }), 2), null);
  assert.equal(parseMenuDraft(draft({ imagePath: "11111111-1111-4111-8111-111111111111/categories/c2/0123456789abcdef0123456789abcdef.png" }), 2), null);
  assert.equal(parseMenuDraft(draft({ color: "#fff" }), 2), null);
});
