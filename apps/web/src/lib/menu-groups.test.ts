import assert from "node:assert/strict";
import test from "node:test";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { duplicateGroup, groupAssignmentCount, groupsForProduct, toggleGroupAssignment, withDerivedAssignments, withLegacyOwners } from "./menu-groups.js";

const product = (productId: string, modifierGroupIds?: readonly string[]): MenuProductV1 => ({
  active: true, categoryId: "c", displayOrder: 1, imagePath: null, name: productId, productId, sku: null, stationId: "s",
  tax: null, unit: "u", unitPriceMinor: 1, ...(modifierGroupIds === undefined ? {} : { modifierGroupIds }),
});
const group = (groupId: string, productId: string | null = null): MenuModifierGroupV1 => ({
  active: true, displayOrder: 1, groupId, maximumQuantity: 1, minimumQuantity: 0, name: groupId, options: [], productId,
});

test("groupsForProduct uses the canonical ids in catalog order", () => {
  const groups = [group("g1"), group("g2"), group("g3")];
  assert.deepEqual(groupsForProduct(product("p1", ["g3", "g1"]), groups).map((entry) => entry.groupId), ["g1", "g3"]);
  assert.equal(groupAssignmentCount([product("p1", ["g1"]), product("p2", ["g1"])], groups[0]!), 2);
  assert.equal(groupAssignmentCount([product("p1", ["g1"])], groups[1]!), 0);
});

test("groupsForProduct falls back to the legacy owner when canonical ids are absent", () => {
  assert.deepEqual(groupsForProduct(product("p1"), [group("g1", "p1"), group("g2", "p2")]).map((entry) => entry.groupId), ["g1"]);
});

test("groupsForProduct lets canonical ids win when both relationships exist", () => {
  assert.deepEqual(groupsForProduct(product("p1", ["g2"]), [group("g1", "p1"), group("g2", null)]).map((entry) => entry.groupId), ["g2"]);
});

test("groupsForProduct treats a canonical empty list as no assignments", () => {
  assert.deepEqual(groupsForProduct(product("p1", []), [group("g1", "p1")]), []);
});

test("duplicating a group gives fresh ids, no owner, no photos and a name that fits", () => {
  let n = 0;
  const source: MenuModifierGroupV1 = {
    ...group("g1", "p1"), name: "x".repeat(80),
    options: [{ active: true, imagePath: "a/options/b/c.png", maximumQuantity: 2, name: "Queso", optionId: "o1", unitPriceMinor: 10 }],
  };
  const copy = duplicateGroup(source, () => `new-${++n}`, 9);
  assert.equal(copy.groupId, "new-1");
  assert.equal(copy.options[0]?.optionId, "new-2");
  assert.equal(copy.options[0]?.imagePath, null);
  assert.equal(copy.options[0]?.maximumQuantity, 2);
  assert.equal(copy.productId, null);
  assert.equal(copy.displayOrder, 9);
  assert.equal(copy.name.length, 80);
  assert.ok(copy.name.endsWith(" (copia)"));
  assert.equal(source.productId, "p1");
});

test("old drafts without lists get them derived from the legacy owner", () => {
  const products = withDerivedAssignments([product("p1"), product("p2", ["gx"])], [group("g1", "p1"), group("g2", "p1"), group("gx", "p2")]);
  assert.deepEqual(products.map((entry) => entry.modifierGroupIds), [["g1", "g2"], ["gx"]]);
});

test("the legacy owner is kept only while exactly one product offers the group", () => {
  const products = [product("p1", ["g1", "g2"]), product("p2", ["g2"])];
  const groups = withLegacyOwners(products, [group("g1", "zzz"), group("g2", "p1"), group("g3", "p2")]);
  assert.deepEqual(groups.map((entry) => entry.productId), ["p1", null, null]);
});

test("toggling an assignment never duplicates an id and never mutates the product", () => {
  const original = product("p1", ["g1"]);
  const added = toggleGroupAssignment(original, "g2", true);
  assert.deepEqual(added.modifierGroupIds, ["g1", "g2"]);
  assert.deepEqual(toggleGroupAssignment(added, "g2", true).modifierGroupIds, ["g1", "g2"]);
  assert.deepEqual(toggleGroupAssignment(added, "g1", false).modifierGroupIds, ["g2"]);
  assert.deepEqual(original.modifierGroupIds, ["g1"]);
  assert.deepEqual(toggleGroupAssignment(product("p9"), "g1", true).modifierGroupIds, ["g1"]);
});
