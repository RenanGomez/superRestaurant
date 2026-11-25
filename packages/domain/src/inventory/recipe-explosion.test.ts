import assert from "node:assert/strict";
import test from "node:test";

import { InvalidQuantityError } from "../errors.js";
import {
  explodeRecipe,
  RecipeIncompatibleUnitsError,
  RecipeModifierConflictError,
  type RecipeModifierContribution,
  type RecipeVersion,
} from "./recipe-explosion.js";

function recipe(
  productId: string,
  version: number,
  lines: RecipeVersion["lines"],
): RecipeVersion {
  return { recipeId: `${productId}-v${version}`, productId, version, lines };
}

test("explodeRecipe doubles simple recipe lines for two sold units", () => {
  const result = explodeRecipe(
    { productId: "pizza", quantity: 2 },
    [recipe("pizza", 1, [{ itemId: "flour", quantity: 50, unit: "g" }])],
  );

  assert.deepEqual(result, [{ itemId: "flour", quantity: 100, unit: "g", remainder: 0 }]);
});

test("explodeRecipe scales a half pizza to half of the recipe quantity", () => {
  const result = explodeRecipe(
    { productId: "pizza", quantity: 1, fraction: { numerator: 1, denominator: 2 } },
    [recipe("pizza", 1, [{ itemId: "cheese", quantity: 200, unit: "g" }])],
  );

  assert.deepEqual(result, [{ itemId: "cheese", quantity: 100, unit: "g", remainder: 0 }]);
});

test("explodeRecipe adds selected modifier contributions per sold unit", () => {
  const modifiers: readonly RecipeModifierContribution[] = [
    { modifierId: "extra-cheese", lines: [{ itemId: "cheese", quantity: 30, unit: "g" }] },
  ];

  const result = explodeRecipe(
    { productId: "pizza", quantity: 2, modifierIds: ["extra-cheese"] },
    [recipe("pizza", 1, [{ itemId: "cheese", quantity: 200, unit: "g" }])],
    modifiers,
  );

  assert.deepEqual(result, [{ itemId: "cheese", quantity: 460, unit: "g", remainder: 0 }]);
});

test("explodeRecipe returns no consumption for a product without a recipe", () => {
  const result = explodeRecipe(
    { productId: "soda", quantity: 1 },
    [recipe("pizza", 1, [{ itemId: "flour", quantity: 50, unit: "g" }])],
  );

  assert.deepEqual(result, []);
});

test("explodeRecipe selects the highest recipe version for a product", () => {
  const result = explodeRecipe(
    { productId: "pizza", quantity: 1 },
    [
      recipe("pizza", 1, [{ itemId: "cheese", quantity: 100, unit: "g" }]),
      recipe("pizza", 3, [{ itemId: "cheese", quantity: 180, unit: "g" }]),
      recipe("pizza", 2, [{ itemId: "cheese", quantity: 150, unit: "g" }]),
    ],
  );

  assert.deepEqual(result, [{ itemId: "cheese", quantity: 180, unit: "g", remainder: 0 }]);
});

test("explodeRecipe sums the same item across recipe and modifier components", () => {
  const modifiers: readonly RecipeModifierContribution[] = [
    { modifierId: "extra-cheese", lines: [{ itemId: "cheese", quantity: 25, unit: "g" }] },
  ];

  const result = explodeRecipe(
    { productId: "pizza", quantity: 1, modifierIds: ["extra-cheese"] },
    [
      recipe("pizza", 1, [
        { itemId: "cheese", quantity: 100, unit: "g" },
        { itemId: "cheese", quantity: 20, unit: "g" },
      ]),
    ],
    modifiers,
  );

  assert.deepEqual(result, [{ itemId: "cheese", quantity: 145, unit: "g", remainder: 0 }]);
});

test("explodeRecipe keeps the rounding remainder for a fractional line", () => {
  const result = explodeRecipe(
    { productId: "pizza", quantity: 1, fraction: { numerator: 1, denominator: 2 } },
    [recipe("pizza", 1, [{ itemId: "cheese", quantity: 151, unit: "g" }])],
  );

  assert.deepEqual(result, [{ itemId: "cheese", quantity: 76, unit: "g", remainder: 1 }]);
});

test("explodeRecipe applies a repeated modifier id only once", () => {
  const modifiers: readonly RecipeModifierContribution[] = [
    { modifierId: "extra-cheese", lines: [{ itemId: "cheese", quantity: 30, unit: "g" }] },
  ];

  const result = explodeRecipe(
    { productId: "pizza", quantity: 1, modifierIds: ["extra-cheese", "extra-cheese"] },
    [recipe("pizza", 1, [{ itemId: "cheese", quantity: 100, unit: "g" }])],
    modifiers,
  );

  assert.deepEqual(result, [{ itemId: "cheese", quantity: 130, unit: "g", remainder: 0 }]);
});

test("explodeRecipe rejects repeated modifier contribution ids", () => {
  const modifiers: readonly RecipeModifierContribution[] = [
    { modifierId: "extra-cheese", lines: [{ itemId: "cheese", quantity: 30, unit: "g" }] },
    { modifierId: "extra-cheese", lines: [{ itemId: "cheese", quantity: 30, unit: "g" }] },
  ];

  assert.throws(
    () =>
      explodeRecipe(
        { productId: "pizza", quantity: 1, modifierIds: ["extra-cheese"] },
        [recipe("pizza", 1, [{ itemId: "cheese", quantity: 100, unit: "g" }])],
        modifiers,
      ),
    (error: unknown) => {
      return (
        error instanceof RecipeModifierConflictError &&
        error.code === "RECIPE_MODIFIER_CONFLICT"
      );
    },
  );
});

test("explodeRecipe rejects a fractional recipe line quantity regardless of sold quantity", () => {
  assert.throws(
    () =>
      explodeRecipe({ productId: "pizza", quantity: 2 }, [
        recipe("pizza", 1, [{ itemId: "cheese", quantity: 0.5, unit: "g" }]),
      ]),
    (error: unknown) => {
      return error instanceof InvalidQuantityError && error.code === "INVALID_QUANTITY";
    },
  );
});

test("explodeRecipe accepts an integer recipe line quantity for two sold units", () => {
  const result = explodeRecipe({ productId: "pizza", quantity: 2 }, [
    recipe("pizza", 1, [{ itemId: "cheese", quantity: 2, unit: "g" }]),
  ]);

  assert.deepEqual(result, [{ itemId: "cheese", quantity: 4, unit: "g", remainder: 0 }]);
});

test("explodeRecipe applies the fraction after accumulating repeated item lines", () => {
  const result = explodeRecipe(
    { productId: "pizza", quantity: 1, fraction: { numerator: 1, denominator: 2 } },
    [
      recipe("pizza", 1, [
        { itemId: "cheese", quantity: 1, unit: "g" },
        { itemId: "cheese", quantity: 1, unit: "g" },
      ]),
    ],
  );

  assert.deepEqual(result, [{ itemId: "cheese", quantity: 1, unit: "g", remainder: 0 }]);
});

test("explodeRecipe rejects incompatible units for the same item", () => {
  assert.throws(
    () =>
      explodeRecipe({ productId: "pizza", quantity: 1 }, [
        recipe("pizza", 1, [
          { itemId: "cheese", quantity: 100, unit: "g" },
          { itemId: "cheese", quantity: 1, unit: "piece" },
        ]),
      ]),
    (error: unknown) => {
      return (
        error instanceof RecipeIncompatibleUnitsError &&
        error.code === "RECIPE_INCOMPATIBLE_UNITS"
      );
    },
  );
});
