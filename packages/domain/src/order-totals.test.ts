import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateOrderItemTotals,
  calculateOrderTotals,
  CurrencyMismatchError,
  DiscountExceedsAmountError,
  DuplicateOrderItemIdError,
  InvalidQuantityError,
  InvalidOrderDiscountAllocationStrategyError,
  InvalidSnapshotError,
  InvalidTaxRateError,
  InvalidTimeZoneError,
  Money,
  NegativeMoneyAmountError,
  ORDER_DISCOUNT_ALLOCATION_STRATEGY,
  type ModifierPriceSnapshot,
  type OrderDiscountSnapshot,
  type OrderItemPricingInput,
  type OrderPricingInput,
} from "./index.js";

const mxn = (amountMinor: number): Money => new Money(amountMinor, "MXN");
const ORDER_TOTALS_PROPERTY_SEED = 0x0d3e5eed;

function line(
  orderItemId: string,
  overrides: Partial<OrderItemPricingInput> = {},
): OrderItemPricingInput {
  return {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "menu-v7",
      productId: `product-${orderItemId}`,
      name: "Taco",
      sku: "TACO-01",
      stationId: "kitchen",
      unit: "each",
      unitPrice: mxn(100),
      modifiers: [],
    },
    ...overrides,
  };
}

function order(overrides: Partial<OrderPricingInput> = {}): OrderPricingInput {
  return { currency: "MXN", timeZone: "America/Mexico_City", lines: [line("line-a")], ...overrides };
}

function orderDiscount(amountMinor: number): OrderDiscountSnapshot {
  return {
    discountId: "whole-order",
    discountRuleVersion: "test-v1",
    amount: mxn(amountMinor),
    allocationStrategy: ORDER_DISCOUNT_ALLOCATION_STRATEGY,
  };
}

test("line totals use frozen price and modifier snapshots, quantity, and explicit line discounts", () => {
  const input = line("line-a", {
    quantity: 2,
    lineDiscount: { discountId: "happy-hour", discountRuleVersion: "test-v1", amount: mxn(35) },
    snapshot: {
      catalogVersion: "menu-v7",
      productId: "taco",
      name: "Taco",
      stationId: "kitchen",
      unit: "each",
      unitPrice: mxn(100),
      modifiers: [{ modifierId: "extra-cheese", name: "Extra cheese", unitPrice: mxn(20), quantity: 2 }],
    },
  });

  const result = calculateOrderItemTotals(input);

  assert.equal(result.unitAmount.amountMinor, 140);
  assert.equal(result.grossBeforeLineDiscount.amountMinor, 280);
  assert.equal(result.lineDiscount.amountMinor, 35);
  assert.equal(result.subtotalBeforeTax.amountMinor, 245);
  assert.equal(result.taxAmount.amountMinor, 0);
  assert.equal(result.total.amountMinor, 245);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.snapshot), false);
  assert.equal(Object.isFrozen(input.snapshot.modifiers), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.input.snapshot), true);
  assert.throws(() => (result.input.snapshot.modifiers as ModifierPriceSnapshot[]).push({} as ModifierPriceSnapshot), TypeError);
});

test("calculations clone caller inputs and preserve complete immutable historical facts", () => {
  const input = line("history", {
    quantity: 2,
    snapshot: {
      catalogVersion: "menu-v7",
      productId: "taco",
      name: "Taco",
      stationId: "grill",
      unit: "plate",
      unitPrice: mxn(100),
      modifiers: [{ modifierId: "cheese", name: "Cheese", unitPrice: mxn(15), quantity: 1 }],
      tax: {
        taxId: "vat",
        name: "VAT",
        taxRuleVersion: "mx-vat-2026-01",
        rate: { numerator: 4n, denominator: 25n },
        inclusion: "excluded",
      },
    },
  });

  const result = calculateOrderItemTotals(input);
  (input as { quantity: number }).quantity = 99;
  (input.snapshot as { name: string }).name = "Changed catalog";
  (input.snapshot.modifiers as ModifierPriceSnapshot[]).push({
    modifierId: "salsa", name: "Salsa", unitPrice: mxn(20), quantity: 1,
  });

  assert.equal(result.input.quantity, 2);
  assert.equal(result.input.snapshot.name, "Taco");
  assert.equal(result.input.snapshot.stationId, "grill");
  assert.equal(result.input.snapshot.unit, "plate");
  assert.equal(result.input.snapshot.tax?.taxRuleVersion, "mx-vat-2026-01");
  assert.equal(result.input.snapshot.modifiers.length, 1);
  assert.equal(Object.isFrozen(result.input.snapshot.tax), true);
  assert.equal(Object.isFrozen(result.input.snapshot.tax?.rate), true);
});

test("taxes are calculated per line with exact ratios and Money half-away-from-zero ties", () => {
  const exclusive = calculateOrderItemTotals(line("exclusive", {
    snapshot: {
      catalogVersion: "v1",
      productId: "p1",
      name: "Five",
      stationId: "kitchen",
      unit: "each",
      unitPrice: mxn(5),
      modifiers: [],
      tax: { taxId: "tax", name: "half", taxRuleVersion: "test-v1", rate: { numerator: 1n, denominator: 2n }, inclusion: "excluded" },
    },
  }));
  const included = calculateOrderItemTotals(line("included", {
    snapshot: {
      catalogVersion: "v1",
      productId: "p2",
      name: "Six",
      stationId: "kitchen",
      unit: "each",
      unitPrice: mxn(6),
      modifiers: [],
      tax: { taxId: "tax", name: "half", taxRuleVersion: "test-v1", rate: { numerator: 1n, denominator: 2n }, inclusion: "included" },
    },
  }));

  assert.equal(exclusive.taxableAmount.amountMinor, 5);
  assert.equal(exclusive.taxAmount.amountMinor, 3);
  assert.equal(exclusive.total.amountMinor, 8);
  assert.equal(included.taxAmount.amountMinor, 2);
  assert.equal(included.taxableAmount.amountMinor, 4);
  assert.equal(included.total.amountMinor, 6);
});

test("order totals apply tax before order discount, allocate exact minor units deterministically, then add tip", () => {
  const result = calculateOrderTotals(order({
    lines: [
      line("line-b", {
        snapshot: {
          catalogVersion: "v1", productId: "b", name: "B", stationId: "kitchen", unit: "each", unitPrice: mxn(100), modifiers: [],
          tax: { taxId: "vat", name: "VAT", taxRuleVersion: "test-v1", rate: { numerator: 1n, denominator: 10n }, inclusion: "excluded" },
        },
      }),
      line("line-a", { snapshot: { catalogVersion: "v1", productId: "a", name: "A", stationId: "kitchen", unit: "each", unitPrice: mxn(100), modifiers: [] } }),
      line("line-c", { snapshot: { catalogVersion: "v1", productId: "c", name: "C", stationId: "kitchen", unit: "each", unitPrice: mxn(100), modifiers: [] } }),
    ],
    orderDiscount: orderDiscount(2),
    tip: mxn(7),
  }));

  assert.equal(result.subtotalBeforeOrderDiscount.amountMinor, 310);
  assert.equal(result.taxTotal.amountMinor, 10);
  assert.equal(result.orderDiscount.amountMinor, 2);
  assert.equal(result.orderDiscountSnapshot?.allocationStrategy, ORDER_DISCOUNT_ALLOCATION_STRATEGY);
  assert.deepEqual(result.lines.map((item) => [item.input.orderItemId, item.orderDiscount.amountMinor]), [
    ["line-b", 1],
    ["line-a", 1],
    ["line-c", 0],
  ]);
  assert.equal(result.tip.amountMinor, 7);
  assert.equal(result.total.amountMinor, 315);
  assert.equal(Object.isFrozen(result.lines), true);
  assert.equal(Object.isFrozen(result.input), true);
});

test("order discount tie breaks by orderItemId rather than input sequence", () => {
  const result = calculateOrderTotals(order({
    lines: [line("z"), line("a"), line("m")],
    orderDiscount: orderDiscount(1),
  }));

  assert.deepEqual(result.lines.map((item) => [item.input.orderItemId, item.orderDiscount.amountMinor]), [
    ["z", 0],
    ["a", 1],
    ["m", 0],
  ]);
});

test("order totals property: discount allocation conserves minor units and is stable by orderItemId across permutations", () => {
  const random = deterministicRandom(ORDER_TOTALS_PROPERTY_SEED);
  const cases = [
    {
      lines: [line("z", { snapshot: pricedSnapshot("z", 25) }), line("é", { snapshot: pricedSnapshot("é", 25) }), line("A", { snapshot: pricedSnapshot("A", 25) })],
      discount: 2,
      tip: 0,
    },
  ];

  for (let caseIndex = 0; caseIndex < 60; caseIndex += 1) {
    const lineCount = random.int(2, 6);
    const lines = Array.from({ length: lineCount }, (_, index) => {
      const orderItemId = `line-${caseIndex}-${String.fromCharCode(65 + index)}`;
      const price = random.int(1, 250);
      const quantity = random.int(1, 3);
      const taxVariant = random.int(0, 3);
      return line(orderItemId, {
        quantity,
        snapshot: pricedSnapshot(orderItemId, price, taxVariant),
      });
    });
    const withoutDiscount = calculateOrderTotals(order({ lines }));
    cases.push({
      lines,
      discount: random.int(0, withoutDiscount.subtotalBeforeOrderDiscount.amountMinor),
      tip: random.int(0, 30),
    });
  }

  for (const [caseIndex, generated] of cases.entries()) {
    const input = order({
      lines: generated.lines,
      orderDiscount: orderDiscount(generated.discount),
      tip: mxn(generated.tip),
    });
    const baseline = calculateOrderTotals(input);
    const baselineAllocation = allocationByOrderItemId(baseline);
    const allocated = baseline.lines.reduce((sum, item) => sum + item.orderDiscount.amountMinor, 0);
    const payable = baseline.lines.reduce((sum, item) => sum + item.totalAfterOrderDiscount.amountMinor, 0);

    assert.equal(allocated, generated.discount, `discount conservation case ${caseIndex}`);
    assert.equal(payable + baseline.tip.amountMinor, baseline.total.amountMinor, `total conservation case ${caseIndex}`);
    assert.equal(
      baseline.subtotalBeforeOrderDiscount.amountMinor - generated.discount + generated.tip,
      baseline.total.amountMinor,
      `order identity case ${caseIndex}`,
    );
    for (const calculatedLine of baseline.lines) {
      assert.ok(calculatedLine.orderDiscount.amountMinor >= 0, `non-negative allocation case ${caseIndex}`);
      assert.ok(
        calculatedLine.orderDiscount.amountMinor <= calculatedLine.total.amountMinor,
        `bounded allocation case ${caseIndex}`,
      );
    }

    if (caseIndex === 0) {
      assert.deepEqual(baselineAllocation, new Map([["A", 1], ["z", 1], ["é", 0]]));
    }

    for (let permutationIndex = 0; permutationIndex < 4; permutationIndex += 1) {
      const permuted = calculateOrderTotals(order({
        lines: shuffled(generated.lines, random),
        orderDiscount: orderDiscount(generated.discount),
        tip: mxn(generated.tip),
      }));
      assert.deepEqual(
        allocationByOrderItemId(permuted),
        baselineAllocation,
        `permutation ${permutationIndex} case ${caseIndex}`,
      );
    }
  }
});

test("order calculation never freezes or retains mutable caller-owned input", () => {
  const input = order({
    lines: [line("a"), line("b")],
    orderDiscount: orderDiscount(1),
    tip: mxn(2),
  });
  const result = calculateOrderTotals(input);

  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.lines), false);
  assert.equal(Object.isFrozen(input.lines[0]?.snapshot), false);
  (input.lines as OrderItemPricingInput[]).push(line("later"));
  (input.lines[0]?.snapshot as { name: string }).name = "Changed catalog";

  assert.equal(result.input.lines.length, 2);
  assert.equal(result.input.lines[0]?.snapshot.name, "Taco");
  assert.equal(Object.isFrozen(result.input.lines), true);
  assert.equal(Object.isFrozen(result.input.lines[0]?.snapshot), true);
});

test("rejections protect financial invariants and validate every money currency", () => {
  assert.throws(() => calculateOrderItemTotals(line("bad-quantity", { quantity: 0 })), InvalidQuantityError);
  assert.throws(
    () => calculateOrderItemTotals(line("negative-price", { snapshot: { catalogVersion: "v1", productId: "p", name: "P", stationId: "kitchen", unit: "each", unitPrice: mxn(-1), modifiers: [] } })),
    NegativeMoneyAmountError,
  );
  assert.throws(
    () => calculateOrderItemTotals(line("bad-tax", {
      snapshot: {
        catalogVersion: "v1", productId: "p", name: "P", stationId: "kitchen", unit: "each", unitPrice: mxn(1), modifiers: [],
        tax: { taxId: "tax", name: "Tax", taxRuleVersion: "test-v1", rate: { numerator: -1n, denominator: 100n }, inclusion: "excluded" },
      },
    })),
    InvalidTaxRateError,
  );
  for (const malformedTax of [
    { taxId: "tax", name: "Tax", taxRuleVersion: "test-v1", inclusion: "excluded" },
    { taxId: "tax", name: "Tax", taxRuleVersion: "test-v1", rate: null, inclusion: "excluded" },
    { taxId: "tax", name: "Tax", taxRuleVersion: "test-v1", rate: { numerator: 1, denominator: 100n }, inclusion: "excluded" },
    { taxId: "tax", name: "Tax", taxRuleVersion: "test-v1", rate: { numerator: 1n, denominator: 0 }, inclusion: "excluded" },
    { taxId: "tax", name: "Tax", taxRuleVersion: "test-v1", rate: { numerator: 1n, denominator: 0n }, inclusion: "excluded" },
  ]) {
    assert.throws(
      () => calculateOrderItemTotals(line("malformed-tax-rate", {
        snapshot: { ...line("template").snapshot, tax: malformedTax as never },
      })),
      InvalidTaxRateError,
    );
  }
  assert.throws(
    () => calculateOrderItemTotals(line("malformed-tax-snapshot", {
      snapshot: { ...line("template").snapshot, tax: null as never },
    })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => calculateOrderItemTotals(line("missing-station", {
      snapshot: { ...line("template").snapshot, stationId: "" },
    })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => calculateOrderItemTotals(line("missing-unit", {
      snapshot: { ...line("template").snapshot, unit: "" },
    })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => calculateOrderItemTotals(line("missing-tax-rule", {
      snapshot: {
        ...line("template").snapshot,
        tax: { taxId: "tax", name: "Tax", taxRuleVersion: "", rate: { numerator: 1n, denominator: 10n }, inclusion: "excluded" },
      },
    })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => calculateOrderTotals(order({ orderDiscount: { ...orderDiscount(1), discountRuleVersion: "" } })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => calculateOrderItemTotals(line("line-discount", { lineDiscount: { discountId: "d", discountRuleVersion: "test-v1", amount: mxn(101) } })),
    DiscountExceedsAmountError,
  );
  assert.throws(
    () => calculateOrderTotals(order({ orderDiscount: orderDiscount(101) })),
    DiscountExceedsAmountError,
  );
  assert.throws(() => calculateOrderTotals(order({ tip: mxn(-1) })), NegativeMoneyAmountError);
  assert.throws(() => calculateOrderTotals(order({ timeZone: "Not/A_Time_Zone" })), InvalidTimeZoneError);
  assert.throws(
    () => calculateOrderTotals(order({ lines: [line("usd", { snapshot: { catalogVersion: "v1", productId: "p", name: "P", stationId: "kitchen", unit: "each", unitPrice: new Money(1, "USD"), modifiers: [] } })] })),
    CurrencyMismatchError,
  );
  assert.throws(
    () => calculateOrderItemTotals(line("usd-modifier", {
      snapshot: {
        catalogVersion: "v1", productId: "p", name: "P", stationId: "kitchen", unit: "each", unitPrice: mxn(1),
        modifiers: [{ modifierId: "m", name: "M", unitPrice: new Money(1, "USD"), quantity: 1 }],
      },
    })),
    CurrencyMismatchError,
  );
  assert.throws(
    () => calculateOrderItemTotals(line("usd-line-discount", { lineDiscount: { discountId: "d", discountRuleVersion: "test-v1", amount: new Money(1, "USD") } })),
    CurrencyMismatchError,
  );
  assert.throws(() => calculateOrderTotals(order({ orderDiscount: { ...orderDiscount(1), amount: new Money(1, "USD") } })), CurrencyMismatchError);
  assert.throws(() => calculateOrderTotals(order({ tip: new Money(1, "USD") })), CurrencyMismatchError);
  assert.throws(() => calculateOrderTotals(order({ lines: [line("same"), line("same")] })), DuplicateOrderItemIdError);
  assert.throws(
    () => calculateOrderTotals(order({ orderDiscount: { discountId: "d", discountRuleVersion: "test-v1", amount: mxn(1), allocationStrategy: "legacy" } as never })),
    InvalidOrderDiscountAllocationStrategyError,
  );
});

test("a discount equal to its eligible amount produces a zero total, never a negative one", () => {
  const lineResult = calculateOrderItemTotals(line("free-line", { lineDiscount: { discountId: "comp", discountRuleVersion: "test-v1", amount: mxn(100) } }));
  const orderResult = calculateOrderTotals(order({
    lines: [line("free-order")],
    orderDiscount: orderDiscount(100),
  }));

  assert.equal(lineResult.total.amountMinor, 0);
  assert.equal(orderResult.lines[0]?.totalAfterOrderDiscount.amountMinor, 0);
  assert.equal(orderResult.total.amountMinor, 0);
});

test("zero lines permit only a zero order discount and preserve non-negative totals", () => {
  const result = calculateOrderTotals(order({ lines: [], orderDiscount: orderDiscount(0) }));
  assert.equal(result.total.amountMinor, 0);
  assert.equal(result.lines.length, 0);
});

function pricedSnapshot(orderItemId: string, unitPrice: number, taxVariant = 0): OrderItemPricingInput["snapshot"] {
  const tax = taxVariant === 1
    ? { taxId: "tax-excluded", name: "Tax excluded", taxRuleVersion: "test-v1", rate: { numerator: 1n, denominator: 10n }, inclusion: "excluded" as const }
    : taxVariant === 2
      ? { taxId: "tax-included", name: "Tax included", taxRuleVersion: "test-v1", rate: { numerator: 1n, denominator: 6n }, inclusion: "included" as const }
      : taxVariant === 3
        ? { taxId: "tax-half", name: "Tax half", taxRuleVersion: "test-v1", rate: { numerator: 1n, denominator: 2n }, inclusion: "excluded" as const }
        : undefined;
  return {
    catalogVersion: "property-v1",
    productId: `product-${orderItemId}`,
    name: `Product ${orderItemId}`,
    stationId: "kitchen",
    unit: "each",
    unitPrice: mxn(unitPrice),
    modifiers: [],
    ...(tax === undefined ? {} : { tax }),
  };
}

function allocationByOrderItemId(result: ReturnType<typeof calculateOrderTotals>): Map<string, number> {
  return new Map(result.lines.map((calculatedLine) => [calculatedLine.input.orderItemId, calculatedLine.orderDiscount.amountMinor]));
}

function shuffled<T>(values: readonly T[], random: ReturnType<typeof deterministicRandom>): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = random.int(0, index);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function deterministicRandom(seed: number): { int(min: number, max: number): number } {
  let state = seed >>> 0;
  return {
    int(min: number, max: number): number {
      state = (state * 1664525 + 1013904223) >>> 0;
      return min + (state % (max - min + 1));
    },
  };
}
