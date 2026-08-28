import assert from "node:assert/strict";
import test from "node:test";

import {
  createModifierSelectionSnapshot,
  calculateOrderItemTotals,
  CurrencyMismatchError,
  DomainError,
  DuplicateModifierOptionIdError,
  DuplicateModifierSelectionError,
  InvalidModifierGroupBoundsError,
  InvalidModifierOptionMaximumError,
  InvalidQuantityError,
  InvalidSnapshotError,
  InactiveModifierGroupError,
  InactiveModifierOptionError,
  ModifierGroupMaximumExceededError,
  ModifierGroupMinimumNotMetError,
  ModifierGroupProductMismatchError,
  ModifierGroupRestaurantMismatchError,
  ModifierOptionMaximumExceededError,
  ModifierOptionNotInGroupError,
  Money,
  MoneyOverflowError,
  NegativeMoneyAmountError,
  validateModifierGroupCatalog,
} from "./index.js";
import type { OrderItemPriceSnapshot } from "./index.js";

const toppings = {
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
} as const;

const selectionContext = { restaurantId: "restaurant-1", productId: "burger" } as const;

test("modifier selection creates deeply immutable OrderItemPriceSnapshot-compatible price facts and exact total", () => {
  const result = createModifierSelectionSnapshot(toppings, selectionContext, [
    { optionId: "cheese", quantity: 2 },
    { optionId: "jalapeno", quantity: 1 },
  ]);

  assert.deepEqual(result.modifiers, [
    { groupId: "toppings", groupName: "Toppings", groupCatalogVersion: "menu-v7", modifierId: "cheese", name: "Extra cheese", unitPrice: new Money(125, "MXN"), quantity: 2 },
    { groupId: "toppings", groupName: "Toppings", groupCatalogVersion: "menu-v7", modifierId: "jalapeno", name: "Jalapeño", unitPrice: new Money(50, "MXN"), quantity: 1 },
  ]);
  assert.deepEqual(result.total, new Money(300, "MXN"));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.modifiers), true);
  assert.equal(Object.isFrozen(result.modifiers[0]), true);
  assert.equal(Object.isFrozen(result.modifiers[0]!.unitPrice), true);

  const orderItemSnapshot: OrderItemPriceSnapshot = {
    catalogVersion: "menu-v7",
    productId: "burger",
    name: "Burger",
    stationId: "grill",
    unit: "each",
    unitPrice: new Money(10000, "MXN"),
    modifiers: result.modifiers,
  };
  assert.equal(orderItemSnapshot.modifiers, result.modifiers);
  const calculated = calculateOrderItemTotals({ orderItemId: "burger-line", snapshot: orderItemSnapshot, quantity: 1 });
  assert.equal(calculated.input.snapshot.modifiers[0]!.groupCatalogVersion, "menu-v7");
  assert.equal(result.modifiers[0]!.unitPrice.amountMinor, 125);
});

test("modifier selections enforce group minimum and maximum over total quantities", () => {
  assert.throws(() => createModifierSelectionSnapshot(toppings, selectionContext, []), ModifierGroupMinimumNotMetError);
  assert.throws(
    () => createModifierSelectionSnapshot(toppings, selectionContext, [{ optionId: "jalapeno", quantity: 5 }]),
    ModifierGroupMaximumExceededError,
  );
  assert.deepEqual(
    createModifierSelectionSnapshot(toppings, selectionContext, [{ optionId: "jalapeno", quantity: 1 }]).total,
    new Money(50, "MXN"),
  );
  assert.deepEqual(
    createModifierSelectionSnapshot(toppings, selectionContext, [{ optionId: "jalapeno", quantity: 4 }]).total,
    new Money(200, "MXN"),
  );
});

test("modifier selection rejects unknown, duplicated, invalid, and option-capped quantities", () => {
  assert.throws(
    () => createModifierSelectionSnapshot(toppings, selectionContext, [{ optionId: "unknown", quantity: 1 }]),
    ModifierOptionNotInGroupError,
  );
  assert.throws(
    () => createModifierSelectionSnapshot(toppings, selectionContext, [
      { optionId: "jalapeno", quantity: 1 },
      { optionId: "jalapeno", quantity: 1 },
    ]),
    DuplicateModifierSelectionError,
  );
  assert.throws(
    () => createModifierSelectionSnapshot(toppings, selectionContext, [{ optionId: "jalapeno", quantity: 0 }]),
    InvalidQuantityError,
  );
  assert.throws(
    () => createModifierSelectionSnapshot(toppings, selectionContext, [{ optionId: "cheese", quantity: 3 }]),
    ModifierOptionMaximumExceededError,
  );
});

test("modifier selection rejects product mismatches and inactive catalog entries", () => {
  assert.throws(
    () => createModifierSelectionSnapshot(toppings, { ...selectionContext, productId: "salad" }, [{ optionId: "jalapeno", quantity: 1 }]),
    ModifierGroupProductMismatchError,
  );
  assert.throws(
    () => createModifierSelectionSnapshot({ ...toppings, active: false }, selectionContext, [{ optionId: "jalapeno", quantity: 1 }]),
    InactiveModifierGroupError,
  );
  assert.throws(
    () => createModifierSelectionSnapshot({
      ...toppings,
      options: [{ ...toppings.options[0], active: false }, toppings.options[1]],
    }, selectionContext, [{ optionId: "cheese", quantity: 1 }]),
    InactiveModifierOptionError,
  );
});

test("zero-minimum groups accept no selection and output order is canonical", () => {
  const optional = { ...toppings, minimumQuantity: 0 };
  assert.deepEqual(createModifierSelectionSnapshot(optional, selectionContext, []).modifiers, []);
  const forward = createModifierSelectionSnapshot(toppings, selectionContext, [
    { optionId: "cheese", quantity: 1 },
    { optionId: "jalapeno", quantity: 1 },
  ]);
  const reversed = createModifierSelectionSnapshot(toppings, selectionContext, [
    { optionId: "jalapeno", quantity: 1 },
    { optionId: "cheese", quantity: 1 },
  ]);
  assert.deepEqual(forward, reversed);
});

test("modifier snapshots detach caller-owned values and surface exact-money overflow", () => {
  const mutable = {
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
  };
  const snapshot = createModifierSelectionSnapshot(mutable, selectionContext, [{ optionId: "jalapeno", quantity: 1 }]);
  mutable.options[1]!.name = "Changed catalog option";
  assert.equal(snapshot.modifiers[0]!.name, "Jalapeño");

  assert.throws(
    () => createModifierSelectionSnapshot({
      ...toppings,
      maximumQuantity: 2,
      options: [{ id: "overflow", name: "Overflow", unitPrice: new Money(Number.MAX_SAFE_INTEGER, "MXN"), active: true }],
    }, selectionContext, [{ optionId: "overflow", quantity: 2 }]),
    MoneyOverflowError,
  );
});

test("modifier catalog validates bounds, option identity, caps, currency, and non-negative prices", () => {
  assert.throws(
    () => validateModifierGroupCatalog({ ...toppings, minimumQuantity: 3, maximumQuantity: 2 }),
    InvalidModifierGroupBoundsError,
  );
  assert.throws(
    () => validateModifierGroupCatalog({ ...toppings, options: [toppings.options[0], toppings.options[0]] }),
    DuplicateModifierOptionIdError,
  );
  assert.throws(
    () => validateModifierGroupCatalog({ ...toppings, options: [{ ...toppings.options[0], maximumQuantity: 0 }] }),
    InvalidModifierOptionMaximumError,
  );
  assert.throws(
    () => validateModifierGroupCatalog({
      ...toppings,
      options: [toppings.options[0], { ...toppings.options[1], unitPrice: new Money(50, "USD") }],
    }),
    CurrencyMismatchError,
  );
  assert.throws(
    () => validateModifierGroupCatalog({
      ...toppings,
      options: [{ ...toppings.options[0], unitPrice: new Money(-1, "MXN") }],
    }),
    NegativeMoneyAmountError,
  );
});

test("modifier boundaries reject non-string identity fields with domain errors", () => {
  assert.throws(
    () => validateModifierGroupCatalog({ ...toppings, id: undefined as never }),
    InvalidSnapshotError,
  );
  assert.throws(
    () => createModifierSelectionSnapshot(toppings, { ...selectionContext, productId: undefined as never }, []),
    InvalidSnapshotError,
  );
  assert.throws(
    () => createModifierSelectionSnapshot(toppings, { ...selectionContext, restaurantId: undefined as never }, []),
    InvalidSnapshotError,
  );
});

test("modifier selection rejects a same-product catalog from another restaurant", () => {
  assert.throws(
    () => createModifierSelectionSnapshot(
      { ...toppings, restaurantId: "restaurant-2" },
      selectionContext,
      [{ optionId: "jalapeno", quantity: 1 }],
    ),
    ModifierGroupRestaurantMismatchError,
  );
});

test("modifier public boundaries reject malformed records, arrays, and hostile prototypes as domain failures", () => {
  const hostileGroup = { ...toppings, options: [...toppings.options] };
  Object.setPrototypeOf(hostileGroup, { id: "inherited-group" });
  const hostileOption = { ...toppings, options: [{ ...toppings.options[0]! }] };
  Object.setPrototypeOf(hostileOption.options[0]!, { id: "inherited-option" });
  const hostileContext = { ...selectionContext };
  Object.setPrototypeOf(hostileContext, { restaurantId: "inherited-context" });
  const hostileSelection = { optionId: "jalapeno", quantity: 1 };
  Object.setPrototypeOf(hostileSelection, { optionId: "inherited-selection" });

  for (const operation of [
    () => validateModifierGroupCatalog(null as never),
    () => validateModifierGroupCatalog([] as never),
    () => validateModifierGroupCatalog({ id: "incomplete" } as never),
    () => validateModifierGroupCatalog({ ...toppings, options: {} as never }),
    () => validateModifierGroupCatalog(hostileGroup),
    () => validateModifierGroupCatalog(hostileOption),
    () => createModifierSelectionSnapshot(toppings, null as never, []),
    () => createModifierSelectionSnapshot(toppings, hostileContext, []),
    () => createModifierSelectionSnapshot(toppings, selectionContext, {} as never),
    () => createModifierSelectionSnapshot(toppings, selectionContext, [hostileSelection]),
  ]) {
    assertDomainFailure(operation);
  }
});

test("modifier public boundaries reject accessors without invoking them and detach proxy reads", () => {
  let accessorReads = 0;
  const accessorOptions = { ...toppings };
  Object.defineProperty(accessorOptions, "options", {
    get(): never {
      accessorReads += 1;
      throw new TypeError("hostile options getter must not run");
    },
  });
  const accessorOption = { ...toppings, options: [{ ...toppings.options[0] }] };
  Object.defineProperty(accessorOption.options[0]!, "unitPrice", {
    get(): never {
      accessorReads += 1;
      throw new TypeError("hostile option getter must not run");
    },
  });
  const accessorContext = { ...selectionContext };
  Object.defineProperty(accessorContext, "restaurantId", {
    get(): never {
      accessorReads += 1;
      throw new TypeError("hostile context getter must not run");
    },
  });
  const accessorSelection = { optionId: "jalapeno", quantity: 1 };
  Object.defineProperty(accessorSelection, "optionId", {
    get(): never {
      accessorReads += 1;
      throw new TypeError("hostile selection getter must not run");
    },
  });

  assertDomainFailure(() => validateModifierGroupCatalog(accessorOptions));
  assertDomainFailure(() => validateModifierGroupCatalog(accessorOption));
  assertDomainFailure(() => createModifierSelectionSnapshot(toppings, accessorContext, []));
  assertDomainFailure(() => createModifierSelectionSnapshot(toppings, selectionContext, [accessorSelection]));
  assert.equal(accessorReads, 0);

  const proxy = new Proxy({ ...toppings, options: [...toppings.options] }, {
    get(): never {
      throw new TypeError("catalog reads must use descriptors");
    },
  });
  const catalog = validateModifierGroupCatalog(proxy);
  assert.equal(catalog.id, "toppings");
});

function assertDomainFailure(operation: () => unknown): void {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof DomainError, "expected a DomainError instead of an untyped runtime failure");
  assert.equal(error instanceof TypeError, false);
}
