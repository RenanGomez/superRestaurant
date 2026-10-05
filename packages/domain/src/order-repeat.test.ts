import assert from "node:assert/strict";
import test from "node:test";

import {
  CurrencyMismatchError,
  Money,
  RepeatOrderScopeMismatchError,
  addOrderItem,
  buildRepeatOrderPlan,
  createMenuProductPriceSnapshot,
  createOrder,
} from "./index.js";
import type { MenuCatalog, Order } from "./index.js";

const audit = {
  eventId: "event-order-repeat",
  idempotencyKey: "idempotency-order-repeat",
  actorId: "cashier-1",
  deviceId: "terminal-1",
  occurredAt: "2026-09-23T12:00:00Z",
} as const;

function catalog(options: {
  readonly restaurantId?: string;
  readonly currency?: string;
  readonly productActive?: boolean;
  readonly productPriceMinor?: number;
  readonly cheeseActive?: boolean;
  readonly cheesePriceMinor?: number;
  readonly removeBurger?: boolean;
  readonly removeCheese?: boolean;
  readonly requireSauce?: boolean;
  readonly version?: string;
} = {}): MenuCatalog {
  const restaurantId = options.restaurantId ?? "restaurant-1";
  const currency = options.currency ?? "MXN";
  const version = options.version ?? "menu-v1";
  const groups = options.removeBurger ? [] : [
    {
      id: "toppings",
      restaurantId,
      name: "Toppings",
      catalogVersion: version,
      productId: "burger",
      active: true,
      minimumQuantity: 1,
      maximumQuantity: 3,
      options: [
        ...(options.removeCheese ? [] : [{
          id: "cheese",
          name: "Cheese",
          unitPrice: new Money(options.cheesePriceMinor ?? 100, currency),
          active: options.cheeseActive ?? true,
          maximumQuantity: 2,
        }]),
        { id: "jalapeno", name: "Jalapeño", unitPrice: new Money(50, currency), active: true },
      ],
    },
    ...(options.requireSauce ? [{
      id: "sauce",
      restaurantId,
      name: "Sauce",
      catalogVersion: version,
      productId: "burger",
      active: true,
      minimumQuantity: 1,
      maximumQuantity: 1,
      options: [{ id: "red", name: "Red", unitPrice: new Money(0, currency), active: true }],
    }] : []),
  ];
  return {
    restaurantId,
    catalogVersion: version,
    currency,
    categories: [{
      id: "food",
      restaurantId,
      catalogVersion: version,
      name: "Food",
      active: true,
      displayOrder: 0,
    }],
    products: options.removeBurger ? [] : [{
      id: "burger",
      restaurantId,
      catalogVersion: version,
      categoryId: "food",
      name: "Burger",
      active: options.productActive ?? true,
      displayOrder: 0,
      stationId: "grill",
      unit: "each",
      unitPrice: new Money(options.productPriceMinor ?? 10_000, currency),
      modifierGroupIds: options.requireSauce ? ["toppings", "sauce"] : ["toppings"],
    }],
    modifierGroups: groups,
  };
}

function historicalOrder(): Order {
  const historicalCatalog = catalog();
  const snapshot = createMenuProductPriceSnapshot(historicalCatalog, {
    restaurantId: "restaurant-1",
    productId: "burger",
    currency: "MXN",
  }, [{ groupId: "toppings", selections: [{ optionId: "cheese", quantity: 1 }] }]);
  const order = createOrder({
    orderId: "order-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "counter",
    currency: "MXN",
    timeZone: "America/Hermosillo",
  }, audit).order;
  return addOrderItem(order, { orderItemId: "line-1", snapshot, quantity: 2 }, {
    ...audit,
    eventId: "event-order-repeat-line",
    idempotencyKey: "idempotency-order-repeat-line",
  }).order;
}

test("repeat plan rebuilds a ready line exclusively from the current catalog", () => {
  const plan = buildRepeatOrderPlan(historicalOrder(), catalog());

  assert.equal(plan.readyLineCount, 1);
  assert.equal(plan.blockedLineCount, 0);
  assert.equal(plan.hasPriceChanges, false);
  assert.deepEqual(plan.lines[0]?.selection, {
    productId: "burger",
    variantId: null,
    modifierGroups: [{ groupId: "toppings", selections: [{ optionId: "cheese", quantity: 1 }] }],
  });
  assert.deepEqual(plan.lines[0]?.issues, []);
  assert.equal(plan.lines[0]?.currentSnapshot?.catalogVersion, "menu-v1");
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.lines), true);
  assert.equal(Object.isFrozen(plan.lines[0]?.selection?.modifierGroups), true);
});

test("repeat plan keeps a line ready but exposes product and modifier price changes", () => {
  const plan = buildRepeatOrderPlan(historicalOrder(), catalog({
    version: "menu-v2",
    productPriceMinor: 11_000,
    cheesePriceMinor: 175,
  }));

  assert.equal(plan.lines[0]?.status, "ready");
  assert.equal(plan.hasPriceChanges, true);
  assert.deepEqual(plan.lines[0]?.issues, [
    {
      code: "product_price_changed",
      severity: "warning",
      historicalAmountMinor: 10_000,
      currentAmountMinor: 11_000,
    },
    {
      code: "modifier_price_changed",
      severity: "warning",
      groupId: "toppings",
      modifierId: "cheese",
      historicalAmountMinor: 100,
      currentAmountMinor: 175,
    },
  ]);
  assert.equal(plan.lines[0]?.currentSnapshot?.unitPrice.amountMinor, 11_000);
});

test("repeat plan blocks a removed product instead of dropping the historical line", () => {
  const plan = buildRepeatOrderPlan(historicalOrder(), catalog({ removeBurger: true, version: "menu-v2" }));

  assert.equal(plan.readyLineCount, 0);
  assert.equal(plan.blockedLineCount, 1);
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0]?.status, "blocked");
  assert.equal(plan.lines[0]?.selection, null);
  assert.equal(plan.lines[0]?.currentSnapshot, null);
  assert.deepEqual(plan.lines[0]?.issues, [{ code: "product_removed", severity: "blocking" }]);
});

test("repeat plan blocks removed or inactive historical modifier options without substituting them", () => {
  const removed = buildRepeatOrderPlan(historicalOrder(), catalog({ removeCheese: true, version: "menu-v2" }));
  const inactive = buildRepeatOrderPlan(historicalOrder(), catalog({ cheeseActive: false, version: "menu-v2" }));

  assert.deepEqual(removed.lines[0]?.issues, [
    { code: "modifier_option_removed", severity: "blocking", groupId: "toppings", modifierId: "cheese" },
  ]);
  assert.deepEqual(inactive.lines[0]?.issues, [
    { code: "modifier_option_inactive", severity: "blocking", groupId: "toppings", modifierId: "cheese" },
  ]);
  assert.equal(removed.lines[0]?.selection, null);
  assert.equal(inactive.lines[0]?.selection, null);
});

test("repeat plan blocks a line when the current catalog adds an unmet required group", () => {
  const plan = buildRepeatOrderPlan(historicalOrder(), catalog({ requireSauce: true, version: "menu-v2" }));

  assert.equal(plan.lines[0]?.status, "blocked");
  assert.deepEqual(plan.lines[0]?.issues, [
    { code: "modifier_group_requirements_changed", severity: "blocking", groupId: "sauce" },
  ]);
});

test("repeat plan rejects cross-restaurant and cross-currency reconstruction", () => {
  assert.throws(
    () => buildRepeatOrderPlan(historicalOrder(), catalog({ restaurantId: "restaurant-2" })),
    RepeatOrderScopeMismatchError,
  );
  assert.throws(
    () => buildRepeatOrderPlan(historicalOrder(), catalog({ currency: "USD" })),
    CurrencyMismatchError,
  );
});

function sizedCatalog(options: { readonly smallActive?: boolean; readonly removeSmall?: boolean; readonly smallPriceMinor?: number } = {}): MenuCatalog {
  const base = catalog();
  return {
    ...base,
    products: base.products.map((product) => ({
      ...product,
      variants: [
        ...(options.removeSmall ? [] : [{
          id: "small", name: "Chica", active: options.smallActive ?? true, displayOrder: 0,
          unitPrice: new Money(options.smallPriceMinor ?? 12_000, "MXN"),
        }]),
        { id: "large", name: "Grande", active: true, displayOrder: 1, unitPrice: new Money(20_000, "MXN") },
      ],
    })),
  };
}

function historicalSizedOrder(lines: readonly (string | null)[]): Order {
  let order = createOrder({
    orderId: "order-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "counter",
    currency: "MXN",
    timeZone: "America/Hermosillo",
  }, audit).order;
  lines.forEach((variantId, index) => {
    const source = variantId === null ? catalog() : sizedCatalog();
    const snapshot = createMenuProductPriceSnapshot(source, {
      restaurantId: "restaurant-1", productId: "burger", currency: "MXN", variantId,
    }, [{ groupId: "toppings", selections: [{ optionId: "cheese", quantity: 1 }] }]);
    order = addOrderItem(order, { orderItemId: `line-${index + 1}`, snapshot, quantity: 1 }, {
      ...audit, eventId: `event-sized-${index}`, idempotencyKey: `idempotency-sized-${index}`,
    }).order;
  });
  return order;
}

test("repeat plan reuses the historical size while it is still active and re-prices it from the catalog", () => {
  const plan = buildRepeatOrderPlan(historicalSizedOrder(["small"]), sizedCatalog({ smallPriceMinor: 13_000 }));
  const line = plan.lines[0];
  assert.equal(line?.status, "ready");
  assert.equal(line?.blockedReason, null);
  assert.equal(line?.selection?.variantId, "small");
  assert.equal(line?.currentSnapshot?.unitPrice.amountMinor, 13_000);
  assert.equal(line?.currentSnapshot?.variantName, "Chica");
  assert.deepEqual(line?.issues.map(({ code }) => code), ["product_price_changed"]);
});

test("repeat plan blocks only the line that cannot supply a size the product now requires", () => {
  const plan = buildRepeatOrderPlan(historicalSizedOrder(["small", null]), sizedCatalog());
  assert.equal(plan.readyLineCount, 1);
  assert.equal(plan.blockedLineCount, 1);
  assert.equal(plan.lines[0]?.status, "ready");
  const blocked = plan.lines[1];
  assert.equal(blocked?.status, "blocked");
  assert.equal(blocked?.blockedReason, "variant_required");
  assert.equal(blocked?.selection, null);
  assert.deepEqual(blocked?.issues.map(({ code, severity }) => [code, severity]), [["variant_required", "blocking"]]);
});

test("repeat plan blocks a line whose historical size is now inactive or removed, and keeps plain products ready", () => {
  for (const options of [{ smallActive: false }, { removeSmall: true }]) {
    const plan = buildRepeatOrderPlan(historicalSizedOrder(["small"]), sizedCatalog(options));
    assert.equal(plan.lines[0]?.status, "blocked");
    assert.equal(plan.lines[0]?.blockedReason, "variant_required");
  }
  const plain = buildRepeatOrderPlan(historicalSizedOrder([null]), catalog());
  assert.equal(plain.lines[0]?.status, "ready");
  assert.equal(plain.lines[0]?.selection?.variantId, null);
});
