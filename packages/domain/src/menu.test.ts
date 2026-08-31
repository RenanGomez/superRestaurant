import assert from "node:assert/strict";
import test from "node:test";

import {
  addOrderItem,
  calculateOrderAggregateTotals,
  calculateOrderItemTotals,
  createMenuProductPriceSnapshot,
  createOrder,
  CurrencyMismatchError,
  DomainError,
  DuplicateMenuEntityIdError,
  DuplicateMenuModifierGroupSelectionError,
  DuplicateMenuProductSkuError,
  InactiveMenuCategoryError,
  InactiveMenuProductError,
  InvalidSnapshotError,
  MenuCatalogRestaurantMismatchError,
  MenuCatalogVersionMismatchError,
  MenuModifierGroupNotAllowedError,
  MenuProductCategoryNotFoundError,
  MenuProductModifierGroupNotFoundError,
  MenuProductNotFoundError,
  ModifierGroupMinimumNotMetError,
  ModifierGroupProductMismatchError,
  Money,
  NegativeMoneyAmountError,
  validateMenuCatalog,
} from "./index.js";
import type { MenuCatalog } from "./index.js";

function menuCatalog() {
  return {
    restaurantId: "restaurant-1",
    catalogVersion: "menu-v7",
    currency: "MXN",
    categories: [
      {
        id: "archived",
        restaurantId: "restaurant-1",
        catalogVersion: "menu-v7",
        name: "Archived",
        active: false,
        displayOrder: 10,
      },
      {
        id: "food",
        restaurantId: "restaurant-1",
        catalogVersion: "menu-v7",
        name: "Food",
        active: true,
        displayOrder: 0,
      },
    ],
    products: [
      {
        id: "archived-product",
        restaurantId: "restaurant-1",
        catalogVersion: "menu-v7",
        categoryId: "archived",
        name: "Archived product",
        active: true,
        displayOrder: 10,
        stationId: "cold",
        unit: "each",
        unitPrice: new Money(5000, "MXN"),
        modifierGroupIds: [],
      },
      {
        id: "burger",
        restaurantId: "restaurant-1",
        catalogVersion: "menu-v7",
        categoryId: "food",
        name: "Burger",
        sku: "BRG-001",
        active: true,
        displayOrder: 0,
        stationId: "grill",
        unit: "each",
        unitPrice: new Money(10_000, "MXN"),
        tax: {
          taxId: "vat",
          name: "VAT",
          taxRuleVersion: "mx-v1",
          rate: { numerator: 16n, denominator: 100n },
          inclusion: "excluded",
        },
        modifierGroupIds: ["toppings"],
      },
      {
        id: "salad",
        restaurantId: "restaurant-1",
        catalogVersion: "menu-v7",
        categoryId: "food",
        name: "Salad",
        active: false,
        displayOrder: 1,
        stationId: "cold",
        unit: "each",
        unitPrice: new Money(8000, "MXN"),
        modifierGroupIds: [],
      },
    ],
    modifierGroups: [
      {
        id: "toppings",
        restaurantId: "restaurant-1",
        name: "Toppings",
        catalogVersion: "menu-v7",
        productId: "burger",
        active: true,
        minimumQuantity: 1,
        maximumQuantity: 4,
        options: [
          { id: "cheese", name: "Extra cheese", unitPrice: new Money(125, "MXN"), active: true, maximumQuantity: 2 },
          { id: "jalapeno", name: "Jalapeño", unitPrice: new Money(50, "MXN"), active: true },
        ],
      },
    ],
  } satisfies MenuCatalog;
}

const burgerContext = { restaurantId: "restaurant-1", productId: "burger", currency: "MXN" } as const;
const orderAuditContext = {
  eventId: "event-menu-order",
  idempotencyKey: "idempotency-menu-order",
  actorId: "cashier-1",
  deviceId: "terminal-1",
  occurredAt: "2026-08-29T12:00:00Z",
} as const;
const burgerSelections = [{
  groupId: "toppings",
  selections: [
    { optionId: "cheese", quantity: 1 },
    { optionId: "jalapeno", quantity: 1 },
  ],
}] as const;

test("menu validation detaches, freezes, and orders categories and products deterministically", () => {
  const input = menuCatalog();
  const validated = validateMenuCatalog(input);

  assert.deepEqual(validated.categories.map(({ id }) => id), ["food", "archived"]);
  assert.deepEqual(validated.products.map(({ id }) => id), ["burger", "salad", "archived-product"]);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.categories), true);
  assert.equal(Object.isFrozen(validated.products[0]), true);
  assert.equal(Object.isFrozen(validated.products[0]!.unitPrice), true);
  assert.equal(Object.isFrozen(validated.modifierGroups[0]!.options), true);
});

test("menu selection creates an immutable historical snapshot compatible with pricing and Order", () => {
  const snapshot = createMenuProductPriceSnapshot(menuCatalog(), burgerContext, burgerSelections);

  assert.deepEqual(snapshot, {
    catalogVersion: "menu-v7",
    productId: "burger",
    name: "Burger",
    sku: "BRG-001",
    stationId: "grill",
    unit: "each",
    unitPrice: new Money(10_000, "MXN"),
    modifiers: [
      { groupId: "toppings", groupName: "Toppings", groupCatalogVersion: "menu-v7", modifierId: "cheese", name: "Extra cheese", unitPrice: new Money(125, "MXN"), quantity: 1 },
      { groupId: "toppings", groupName: "Toppings", groupCatalogVersion: "menu-v7", modifierId: "jalapeno", name: "Jalapeño", unitPrice: new Money(50, "MXN"), quantity: 1 },
    ],
    tax: {
      taxId: "vat",
      name: "VAT",
      taxRuleVersion: "mx-v1",
      rate: { numerator: 16n, denominator: 100n },
      inclusion: "excluded",
    },
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.modifiers), true);
  assert.equal(Object.isFrozen(snapshot.tax?.rate), true);

  const calculated = calculateOrderItemTotals({ orderItemId: "line-1", snapshot, quantity: 2 });
  assert.deepEqual(calculated.unitAmount, new Money(10_175, "MXN"));
  assert.deepEqual(calculated.taxAmount, new Money(3_256, "MXN"));
  assert.deepEqual(calculated.total, new Money(23_606, "MXN"));

  const order = addOrderItem(createOrder({
    orderId: "order-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "counter",
    currency: "MXN",
    timeZone: "America/Phoenix",
  }, orderAuditContext).order, { orderItemId: "line-1", snapshot, quantity: 2 }, {
    ...orderAuditContext,
    eventId: "event-menu-line",
    idempotencyKey: "idempotency-menu-line",
  }).order;
  assert.deepEqual(calculateOrderAggregateTotals(order).total, new Money(23_606, "MXN"));
});

test("menu snapshots remain historical after the caller mutates its live catalog", () => {
  const input = menuCatalog();
  const snapshot = createMenuProductPriceSnapshot(input, burgerContext, burgerSelections);

  const liveBurger = input.products[1]! as unknown as {
    name: string;
    unitPrice: Money;
    tax: { name: string };
  };
  const liveCheese = input.modifierGroups[0]!.options[0]! as unknown as { name: string };
  liveBurger.name = "Changed burger";
  liveBurger.unitPrice = new Money(1, "MXN");
  liveBurger.tax.name = "Changed tax";
  liveCheese.name = "Changed cheese";

  assert.equal(snapshot.name, "Burger");
  assert.deepEqual(snapshot.unitPrice, new Money(10_000, "MXN"));
  assert.equal(snapshot.tax?.name, "VAT");
  assert.equal(snapshot.modifiers[0]!.name, "Extra cheese");
});

test("menu selection enforces required groups, allowlists, and one selection per group", () => {
  assert.throws(
    () => createMenuProductPriceSnapshot(menuCatalog(), burgerContext),
    ModifierGroupMinimumNotMetError,
  );
  assert.throws(
    () => createMenuProductPriceSnapshot(menuCatalog(), burgerContext, [{ groupId: "unknown", selections: [] }]),
    MenuModifierGroupNotAllowedError,
  );
  assert.throws(
    () => createMenuProductPriceSnapshot(menuCatalog(), burgerContext, [burgerSelections[0], burgerSelections[0]]),
    DuplicateMenuModifierGroupSelectionError,
  );
});

test("menu selection rejects missing or inactive products and inactive categories", () => {
  assert.throws(
    () => createMenuProductPriceSnapshot(menuCatalog(), { ...burgerContext, productId: "missing" }, []),
    MenuProductNotFoundError,
  );
  assert.throws(
    () => createMenuProductPriceSnapshot(menuCatalog(), { ...burgerContext, productId: "salad" }, []),
    InactiveMenuProductError,
  );
  assert.throws(
    () => createMenuProductPriceSnapshot(menuCatalog(), { ...burgerContext, productId: "archived-product" }, []),
    InactiveMenuCategoryError,
  );
});

test("menu catalog rejects duplicate identities, SKUs, and unresolved references", () => {
  const duplicateProduct = menuCatalog();
  duplicateProduct.products = [duplicateProduct.products[1]!, duplicateProduct.products[1]!] as never;
  assert.throws(() => validateMenuCatalog(duplicateProduct), DuplicateMenuEntityIdError);

  const duplicateSku = menuCatalog();
  duplicateSku.products = duplicateSku.products.map((product) => (
    product.id === "salad" ? { ...product, sku: "BRG-001" } : product
  )) as never;
  assert.throws(() => validateMenuCatalog(duplicateSku), DuplicateMenuProductSkuError);

  const missingCategory = menuCatalog();
  missingCategory.products = missingCategory.products.map((product) => (
    product.id === "burger" ? { ...product, categoryId: "missing" } : product
  )) as never;
  assert.throws(() => validateMenuCatalog(missingCategory), MenuProductCategoryNotFoundError);

  const missingGroup = menuCatalog();
  missingGroup.modifierGroups = [] as never;
  assert.throws(() => validateMenuCatalog(missingGroup), MenuProductModifierGroupNotFoundError);

  const duplicateGroupReference = menuCatalog();
  duplicateGroupReference.products = duplicateGroupReference.products.map((product) => (
    product.id === "burger" ? { ...product, modifierGroupIds: ["toppings", "toppings"] } : product
  )) as never;
  assert.throws(() => validateMenuCatalog(duplicateGroupReference), DuplicateMenuEntityIdError);
});

test("menu catalog enforces restaurant, version, product ownership, and display order", () => {
  const crossRestaurant = menuCatalog();
  crossRestaurant.categories = crossRestaurant.categories.map((category) => (
    category.id === "food" ? { ...category, restaurantId: "restaurant-2" } : category
  )) as never;
  assert.throws(() => validateMenuCatalog(crossRestaurant), MenuCatalogRestaurantMismatchError);

  const wrongVersion = menuCatalog();
  wrongVersion.modifierGroups = [{ ...wrongVersion.modifierGroups[0]!, catalogVersion: "menu-v6" }] as never;
  assert.throws(() => validateMenuCatalog(wrongVersion), MenuCatalogVersionMismatchError);

  const wrongProduct = menuCatalog();
  wrongProduct.modifierGroups = [{ ...wrongProduct.modifierGroups[0]!, productId: "salad" }] as never;
  assert.throws(() => validateMenuCatalog(wrongProduct), MenuModifierGroupNotAllowedError);

  const invalidOrder = menuCatalog();
  invalidOrder.categories = invalidOrder.categories.map((category) => (
    category.id === "food" ? { ...category, displayOrder: -1 } : category
  )) as never;
  assert.throws(() => validateMenuCatalog(invalidOrder), InvalidSnapshotError);

  assert.throws(
    () => createMenuProductPriceSnapshot(menuCatalog(), { ...burgerContext, restaurantId: "restaurant-2" }, burgerSelections),
    MenuCatalogRestaurantMismatchError,
  );
});

test("menu catalog enforces exact non-negative money in one currency", () => {
  const negative = menuCatalog();
  negative.products = negative.products.map((product) => (
    product.id === "burger" ? { ...product, unitPrice: new Money(-1, "MXN") } : product
  )) as never;
  assert.throws(() => validateMenuCatalog(negative), NegativeMoneyAmountError);

  const wrongProductCurrency = menuCatalog();
  wrongProductCurrency.products = wrongProductCurrency.products.map((product) => (
    product.id === "burger" ? { ...product, unitPrice: new Money(10_000, "USD") } : product
  )) as never;
  assert.throws(() => validateMenuCatalog(wrongProductCurrency), CurrencyMismatchError);

  const wrongModifierCurrency = menuCatalog();
  wrongModifierCurrency.modifierGroups = [{
    ...wrongModifierCurrency.modifierGroups[0]!,
    options: wrongModifierCurrency.modifierGroups[0]!.options.map((option) => ({
      ...option,
      unitPrice: new Money(option.unitPrice.amountMinor, "USD"),
    })),
  }] as never;
  assert.throws(() => validateMenuCatalog(wrongModifierCurrency), CurrencyMismatchError);

  assert.throws(
    () => createMenuProductPriceSnapshot(menuCatalog(), { ...burgerContext, currency: "USD" }, burgerSelections),
    CurrencyMismatchError,
  );
});

test("menu public boundaries fail closed for malformed, accessor, prototype, and proxy inputs", () => {
  let accessorReads = 0;
  const accessorCategory = { ...menuCatalog().categories[0] };
  Object.defineProperty(accessorCategory, "name", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "Hostile";
    },
  });
  const accessorCatalog = { ...menuCatalog(), categories: [accessorCategory] };

  const hostileProduct = { ...menuCatalog().products[0] };
  Object.setPrototypeOf(hostileProduct, { productId: "inherited" });
  const hostileCatalog = { ...menuCatalog(), products: [hostileProduct] };
  const hostileContext = new Proxy({ ...burgerContext }, {
    getOwnPropertyDescriptor() {
      throw new TypeError("hostile descriptor trap");
    },
  });

  for (const operation of [
    () => validateMenuCatalog(null as never),
    () => validateMenuCatalog([] as never),
    () => validateMenuCatalog({ restaurantId: "restaurant-1" } as never),
    () => validateMenuCatalog(accessorCatalog as never),
    () => validateMenuCatalog(hostileCatalog as never),
    () => createMenuProductPriceSnapshot(menuCatalog(), hostileContext, burgerSelections),
    () => createMenuProductPriceSnapshot(menuCatalog(), burgerContext, {} as never),
  ]) {
    assert.throws(operation, DomainError);
  }
  assert.equal(accessorReads, 0);
});

test("menu group ownership mismatch remains a domain error", () => {
  const input = menuCatalog();
  input.modifierGroups = [{ ...input.modifierGroups[0]!, productId: "archived-product" }] as never;
  input.products = input.products.map((product) => (
    product.id === "archived-product" ? { ...product, modifierGroupIds: ["toppings"] } : product
  )) as never;
  assert.throws(() => validateMenuCatalog(input), ModifierGroupProductMismatchError);
});
