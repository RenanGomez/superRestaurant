import assert from "node:assert/strict";
import test from "node:test";

import {
  createMenuProductPriceSnapshot,
  MenuModifierGroupNotAllowedError,
  MenuProductModifierGroupNotFoundError,
  ModifierGroupProductMismatchError,
  Money,
  validateMenuCatalog,
} from "./index.js";

const RESTAURANT = "restaurant-1";
const VERSION = "menu-v7";

function product(id: string, groupIds: readonly string[], displayOrder: number) {
  return {
    id,
    restaurantId: RESTAURANT,
    catalogVersion: VERSION,
    categoryId: "food",
    name: id,
    active: true,
    displayOrder,
    stationId: "grill",
    unit: "each",
    unitPrice: new Money(10_000, "MXN"),
    modifierGroupIds: [...groupIds],
  };
}

function group(productId: string | null | undefined) {
  return {
    id: "toppings",
    restaurantId: RESTAURANT,
    name: "Toppings",
    catalogVersion: VERSION,
    ...(productId === undefined ? {} : { productId }),
    active: true,
    minimumQuantity: 1,
    maximumQuantity: 4,
    options: [
      { id: "cheese", name: "Extra cheese", unitPrice: new Money(125, "MXN"), active: true, maximumQuantity: 2 },
      { id: "jalapeno", name: "Jalapeño", unitPrice: new Money(50, "MXN"), active: true },
    ],
  };
}

function catalog(options: {
  readonly productId: string | null | undefined;
  readonly burgerGroups?: readonly string[];
  readonly wrapGroups?: readonly string[];
}) {
  return {
    restaurantId: RESTAURANT,
    catalogVersion: VERSION,
    currency: "MXN",
    categories: [{
      id: "food", restaurantId: RESTAURANT, catalogVersion: VERSION, name: "Food", active: true, displayOrder: 0,
    }],
    products: [
      product("burger", options.burgerGroups ?? ["toppings"], 0),
      product("wrap", options.wrapGroups ?? ["toppings"], 1),
    ],
    modifierGroups: [group(options.productId)],
  };
}

const selections = [{ groupId: "toppings", selections: [{ optionId: "cheese", quantity: 1 }] }];

function context(productId: string) {
  return { restaurantId: RESTAURANT, productId, currency: "MXN" } as const;
}

test("a shared modifier group prices identically for every product that lists it", () => {
  const input = catalog({ productId: null });
  const validated = validateMenuCatalog(input as never);
  assert.equal(validated.modifierGroups[0]!.productId, null);
  const burger = createMenuProductPriceSnapshot(input as never, context("burger"), selections);
  const wrap = createMenuProductPriceSnapshot(input as never, context("wrap"), selections);
  assert.deepEqual(wrap.modifiers, burger.modifiers);
  assert.equal(wrap.modifiers[0]!.unitPrice.amountMinor, 125);
  assert.equal(wrap.unitPrice.amountMinor, burger.unitPrice.amountMinor);
});

test("an absent productId behaves as null and an unassigned group is valid", () => {
  const input = catalog({ productId: undefined, burgerGroups: [], wrapGroups: [] });
  assert.equal(validateMenuCatalog(input as never).modifierGroups[0]!.productId, null);
});

test("a product cannot list a modifier group that is not in the catalog", () => {
  const input = catalog({ productId: null, wrapGroups: ["toppings", "ghost"] });
  assert.throws(() => validateMenuCatalog(input as never), MenuProductModifierGroupNotFoundError);
});

test("a legacy owner still blocks sharing the group with another product", () => {
  const input = catalog({ productId: "burger" });
  assert.throws(() => validateMenuCatalog(input as never), ModifierGroupProductMismatchError);
});

test("a shared group is not selectable by a product that does not list it", () => {
  const input = catalog({ productId: null, wrapGroups: [] });
  assert.throws(
    () => createMenuProductPriceSnapshot(input as never, context("wrap"), selections),
    MenuModifierGroupNotAllowedError,
  );
});
