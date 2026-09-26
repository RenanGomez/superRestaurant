import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveModifierConstraints,
  validateModifierConstraintCatalog,
  type ModifierConstraintCatalog,
  type ModifierConstraintOptionReference,
} from "./modifier-constraints.js";

const reference = (groupId: string, optionId: string): ModifierConstraintOptionReference => ({ groupId, optionId });

const catalog = (): ModifierConstraintCatalog => ({
  catalogVersion: "catalog-v2",
  constraints: [
    { id: "01-requires", kind: "requires", source: reference("edge", "stuffed"), target: reference("size", "large") },
    { id: "02-excludes", kind: "excludes", source: reference("dough", "thin"), target: reference("edge", "stuffed") },
    { id: "03-enables", kind: "enables", source: reference("size", "large"), target: reference("edge", "family") },
    { id: "04-group", kind: "requires_group", source: reference("combo", "meal"), targetGroupId: "drink" },
  ],
  groups: [
    { groupId: "size", optionIds: ["large"] },
    { groupId: "dough", optionIds: ["thin"] },
    { groupId: "edge", optionIds: ["stuffed", "family"] },
    { groupId: "combo", optionIds: ["meal"] },
    { groupId: "drink", optionIds: ["cola"] },
  ],
  restaurantId: "restaurant-1",
});

test("resolves every structural rule into stable issues without deleting the draft", () => {
  const selectedOptions = [
    reference("dough", "thin"),
    reference("edge", "stuffed"),
    reference("edge", "family"),
    reference("combo", "meal"),
  ];
  const result = resolveModifierConstraints(catalog(), { completedGroupIds: ["edge"], selectedOptions });

  assert.equal(result.valid, false);
  assert.deepEqual(result.selectedOptions, [
    reference("combo", "meal"),
    reference("dough", "thin"),
    reference("edge", "family"),
    reference("edge", "stuffed"),
  ]);
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    "required_option_missing",
    "excluded_option_selected",
    "option_not_enabled",
    "required_group_incomplete",
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.issues), true);
});

test("allows the same template option id in different groups without ambiguous dependencies", () => {
  const scoped: ModifierConstraintCatalog = {
    catalogVersion: "catalog-v2",
    constraints: [{
      id: "whole-needs-large",
      kind: "requires",
      source: reference("whole-toppings", "cheese"),
      target: reference("size", "large"),
    }],
    groups: [
      { groupId: "whole-toppings", optionIds: ["cheese"] },
      { groupId: "left-toppings", optionIds: ["cheese"] },
      { groupId: "size", optionIds: ["large"] },
    ],
    restaurantId: "restaurant-1",
  };
  assert.equal(resolveModifierConstraints(scoped, {
    completedGroupIds: ["left-toppings"],
    selectedOptions: [reference("left-toppings", "cheese")],
  }).valid, true);
  assert.equal(resolveModifierConstraints(scoped, {
    completedGroupIds: ["whole-toppings"],
    selectedOptions: [reference("whole-toppings", "cheese")],
  }).issues[0]?.code, "required_option_missing");
});

test("accepts a complete compatible configuration", () => {
  const result = resolveModifierConstraints(catalog(), {
    completedGroupIds: ["drink", "edge", "size"],
    selectedOptions: [
      reference("size", "large"),
      reference("edge", "stuffed"),
      reference("edge", "family"),
      reference("combo", "meal"),
      reference("drink", "cola"),
    ],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("publication rejects missing references, self references, duplicates and contradictions", () => {
  assert.throws(() => validateModifierConstraintCatalog({
    ...catalog(),
    constraints: [{ id: "bad", kind: "requires", source: reference("size", "large"), target: reference("size", "missing") }],
  }));
  assert.throws(() => validateModifierConstraintCatalog({
    ...catalog(),
    constraints: [{ id: "bad", kind: "requires", source: reference("size", "large"), target: reference("size", "large") }],
  }));
  assert.throws(() => validateModifierConstraintCatalog({
    ...catalog(),
    groups: [{ groupId: "size", optionIds: ["large", "large"] }],
  }));
  assert.throws(() => validateModifierConstraintCatalog({
    ...catalog(),
    constraints: [
      { id: "required", kind: "requires", source: reference("size", "large"), target: reference("dough", "thin") },
      { id: "excluded", kind: "excludes", source: reference("dough", "thin"), target: reference("size", "large") },
    ],
  }));
});

test("publication rejects direct and longer requires cycles", () => {
  for (let length = 2; length <= 6; length += 1) {
    const optionIds = Array.from({ length }, (_, index) => `option-${index}`);
    assert.throws(() => validateModifierConstraintCatalog({
      catalogVersion: "catalog-v2",
      constraints: optionIds.map((optionId, index) => ({
        id: `rule-${index}`,
        kind: "requires" as const,
        source: reference("group", optionId),
        target: reference("group", optionIds[(index + 1) % length]!),
      })),
      groups: [{ groupId: "group", optionIds }],
      restaurantId: "restaurant-1",
    }));
  }
});

test("boundaries reject unknown selections, accessors and hostile proxies", () => {
  assert.throws(() => resolveModifierConstraints(catalog(), {
    completedGroupIds: [],
    selectedOptions: [reference("size", "missing")],
  }));
  const accessor = { ...catalog() } as Record<string, unknown>;
  Object.defineProperty(accessor, "constraints", { enumerable: true, get: () => [] });
  assert.throws(() => validateModifierConstraintCatalog(accessor as unknown as ModifierConstraintCatalog));
  assert.throws(() => validateModifierConstraintCatalog(new Proxy(catalog(), {
    getPrototypeOf() { throw new Error("hostile"); },
  })));
});
