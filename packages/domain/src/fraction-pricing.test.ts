import assert from "node:assert/strict";
import test from "node:test";

import { InvalidSnapshotError, Money, resolveFractionPricing } from "./index.js";
import type {
  FractionOrderItemPriceSnapshot,
  FractionPricingIssue,
  FractionPricingVariant,
  ResolveFractionPricingContext,
  ResolveFractionPricingInput,
} from "./index.js";

const CURRENCY = "MXN";
const RESTAURANT_ID = "restaurant-1";
const CATALOG_VERSION = "catalog-v1";
const VARIANT_ID = "variant-pizza-1";

function baseVariant(overrides: Partial<FractionPricingVariant> = {}): FractionPricingVariant {
  return {
    active: true,
    catalogVersion: CATALOG_VERSION,
    comboSlots: [
      {
        defaultOptionId: "drink-cola",
        options: [
          { active: true, groupId: "soda", name: "Cola", optionId: "drink-cola", surchargeMinor: 0 },
          { active: true, groupId: "soda", name: "Lemon soda", optionId: "drink-lemon", surchargeMinor: 0 },
          { active: true, groupId: "juice", name: "Orange juice", optionId: "drink-juice", surchargeMinor: 1500 },
        ],
        slotId: "combo-drink",
      },
    ],
    currency: CURRENCY,
    extras: [
      { active: true, name: "Extra cheese", optionId: "extra-cheese", priceMinor: 1000 },
      { active: true, name: "Extra pepperoni", optionId: "extra-pepperoni", priceMinor: 1300 },
      { active: false, name: "Extra truffle", optionId: "extra-truffle", priceMinor: 5000 },
    ],
    flavors: [
      { active: true, name: "Margherita", optionId: "flavor-margherita", priceMinor: 10000 },
      { active: true, name: "Pepperoni", optionId: "flavor-pepperoni", priceMinor: 15000 },
      { active: false, name: "Retired flavor", optionId: "flavor-retired", priceMinor: 20000 },
    ],
    includedIngredients: [
      { ingredientId: "cheese", name: "Cheese" },
      { ingredientId: "oregano", name: "Oregano" },
    ],
    name: "Pizza clasica",
    productId: "product-pizza",
    restaurantId: RESTAURANT_ID,
    stationId: "station-hot",
    unit: "unit",
    variantId: VARIANT_ID,
    ...overrides,
  };
}

function wholeInput(overrides: Partial<ResolveFractionPricingInput> = {}): ResolveFractionPricingInput {
  return {
    catalogVersion: CATALOG_VERSION,
    comboSubstitutions: [],
    geometry: "whole",
    restaurantId: RESTAURANT_ID,
    slots: [
      { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: "flavor-margherita", fraction: "whole" },
    ],
    variantId: VARIANT_ID,
    ...overrides,
  };
}

function halvesInput(
  flavorA: string,
  flavorB: string,
  overrides: Partial<ResolveFractionPricingInput> = {},
): ResolveFractionPricingInput {
  return {
    catalogVersion: CATALOG_VERSION,
    comboSubstitutions: [],
    geometry: "halves",
    restaurantId: RESTAURANT_ID,
    slots: [
      { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: flavorA, fraction: "half-a" },
      { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: flavorB, fraction: "half-b" },
    ],
    variantId: VARIANT_ID,
    ...overrides,
  };
}

const STAFF_CONTEXT: ResolveFractionPricingContext = { actorId: "actor-1", actorRole: "staff" };
const MANAGER_CONTEXT: ResolveFractionPricingContext = { actorId: "actor-manager", actorRole: "manager", overrideReason: "VIP order" };

function expectSnapshot(
  result: FractionOrderItemPriceSnapshot | readonly FractionPricingIssue[],
): FractionOrderItemPriceSnapshot {
  assert.equal(Array.isArray(result) ? "issues" : "snapshot", "snapshot", `expected a snapshot, got issues: ${JSON.stringify(result)}`);
  return result as FractionOrderItemPriceSnapshot;
}

function expectIssues(
  result: FractionOrderItemPriceSnapshot | readonly FractionPricingIssue[],
): readonly FractionPricingIssue[] {
  assert.equal(Array.isArray(result), true, "expected issues, got a snapshot");
  return result as readonly FractionPricingIssue[];
}

test("whole pizza is priced at the flavor's whole price", () => {
  const snapshot = expectSnapshot(resolveFractionPricing(baseVariant(), wholeInput(), STAFF_CONTEXT));
  assert.deepEqual(snapshot.unitPrice, new Money(10000, CURRENCY));
  assert.equal(snapshot.geometry, "whole");
  assert.equal(snapshot.fractionBreakdown.length, 1);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.modifiers), true);
});

test("halves are priced at the maximum of the two selected flavor prices (3+ combinations)", () => {
  const cases: readonly [string, string, number][] = [
    ["flavor-margherita", "flavor-pepperoni", 15000],
    ["flavor-pepperoni", "flavor-margherita", 15000],
    ["flavor-margherita", "flavor-margherita", 10000],
  ];
  for (const [flavorA, flavorB, expected] of cases) {
    const snapshot = expectSnapshot(resolveFractionPricing(baseVariant(), halvesInput(flavorA, flavorB), STAFF_CONTEXT));
    assert.deepEqual(snapshot.unitPrice, new Money(expected, CURRENCY), `${flavorA}/${flavorB} should charge ${expected}`);
  }
});

test("an extra on the whole pizza is charged at 100%", () => {
  const input = wholeInput({
    slots: [{ excludedIngredientIds: [], extraOptionIds: ["extra-cheese"], flavorOptionId: "flavor-margherita", fraction: "whole" }],
  });
  const snapshot = expectSnapshot(resolveFractionPricing(baseVariant(), input, STAFF_CONTEXT));
  const extraLine = snapshot.modifiers.find((modifier) => modifier.modifierId === "extra:whole:extra-cheese");
  assert.deepEqual(extraLine?.unitPrice, new Money(1000, CURRENCY));
});

test("the same extra on one half is charged at 50% rounded up to the minor unit", () => {
  const cases: readonly [number, number][] = [
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
  ];
  for (const [priceMinor, expected] of cases) {
    const variant = baseVariant({
      extras: [{ active: true, name: "Micro extra", optionId: "extra-micro", priceMinor }],
    });
    const input = halvesInput("flavor-margherita", "flavor-margherita", {
      slots: [
        { excludedIngredientIds: [], extraOptionIds: ["extra-micro"], flavorOptionId: "flavor-margherita", fraction: "half-a" },
        { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: "flavor-margherita", fraction: "half-b" },
      ],
    });
    const snapshot = expectSnapshot(resolveFractionPricing(variant, input, STAFF_CONTEXT));
    const extraLine = snapshot.modifiers.find((modifier) => modifier.modifierId === "extra:half-a:extra-micro");
    assert.equal(extraLine?.unitPrice.amountMinor, expected, `priceMinor ${priceMinor} should charge ${expected} on a half`);
  }
});

test("excluding an included ingredient does not reduce the price and carries a zero-delta marker", () => {
  const input = wholeInput({
    slots: [{ excludedIngredientIds: ["cheese"], extraOptionIds: [], flavorOptionId: "flavor-margherita", fraction: "whole" }],
  });
  const snapshot = expectSnapshot(resolveFractionPricing(baseVariant(), input, STAFF_CONTEXT));
  assert.deepEqual(snapshot.unitPrice, new Money(10000, CURRENCY));
  const exclusionLine = snapshot.modifiers.find((modifier) => modifier.modifierId === "exclude:whole:cheese");
  assert.equal(exclusionLine?.quantity, 0);
});

test("combo substitution within the same group is free; outside the group carries an explicit surcharge", () => {
  const freeSnapshot = expectSnapshot(resolveFractionPricing(
    baseVariant(),
    wholeInput({ comboSubstitutions: [{ optionId: "drink-lemon", slotId: "combo-drink" }] }),
    STAFF_CONTEXT,
  ));
  const freeLine = freeSnapshot.modifiers.find((modifier) => modifier.modifierId === "combo:combo-drink:drink-lemon");
  assert.deepEqual(freeLine?.unitPrice, new Money(0, CURRENCY));

  const surchargeSnapshot = expectSnapshot(resolveFractionPricing(
    baseVariant(),
    wholeInput({ comboSubstitutions: [{ optionId: "drink-juice", slotId: "combo-drink" }] }),
    STAFF_CONTEXT,
  ));
  const surchargeLine = surchargeSnapshot.modifiers.find((modifier) => modifier.modifierId === "combo:combo-drink:drink-juice");
  assert.deepEqual(surchargeLine?.unitPrice, new Money(1500, CURRENCY));
  assert.equal(freeSnapshot.fractionBreakdown[0]?.flavorOptionId, "flavor-margherita");
});

test("choosing the default combo option produces no substitution line", () => {
  const snapshot = expectSnapshot(resolveFractionPricing(
    baseVariant(),
    wholeInput({ comboSubstitutions: [{ optionId: "drink-cola", slotId: "combo-drink" }] }),
    STAFF_CONTEXT,
  ));
  assert.equal(snapshot.modifiers.some((modifier) => modifier.modifierId.startsWith("combo:")), false);
});

test("more than 5 extras on one fraction is rejected without a manager override", () => {
  const manyExtras = ["extra-cheese", "extra-pepperoni", "extra-cheese-2", "extra-cheese-3", "extra-cheese-4", "extra-cheese-5"];
  const variant = baseVariant({
    extras: manyExtras.map((optionId) => ({ active: true, name: optionId, optionId, priceMinor: 100 })),
  });
  const input = wholeInput({
    slots: [{ excludedIngredientIds: [], extraOptionIds: manyExtras, flavorOptionId: "flavor-margherita", fraction: "whole" }],
  });

  const staffIssues = expectIssues(resolveFractionPricing(variant, input, STAFF_CONTEXT));
  assert.ok(staffIssues.some((issue) => issue.code === "extra_override_authorization_required"));

  const managerNoReasonIssues = expectIssues(resolveFractionPricing(variant, input, { actorId: "m", actorRole: "manager" }));
  assert.ok(managerNoReasonIssues.some((issue) => issue.code === "extra_override_reason_required"));

  const managerWithReason = expectSnapshot(resolveFractionPricing(variant, input, MANAGER_CONTEXT));
  assert.equal(managerWithReason.modifiers.filter((modifier) => modifier.modifierId.startsWith("extra:")).length, 6);
});

test("decision 7: a manager override with a non-empty reason accepts more than 5 extras on one fraction", () => {
  const manyExtras = ["extra-cheese", "extra-pepperoni", "extra-cheese-2", "extra-cheese-3", "extra-cheese-4", "extra-cheese-5"];
  const variant = baseVariant({
    extras: manyExtras.map((optionId) => ({ active: true, name: optionId, optionId, priceMinor: 100 })),
  });
  const input = wholeInput({
    slots: [{ excludedIngredientIds: [], extraOptionIds: manyExtras, flavorOptionId: "flavor-margherita", fraction: "whole" }],
  });
  const snapshot = expectSnapshot(resolveFractionPricing(variant, input, {
    actorId: "manager-1",
    actorRole: "manager",
    overrideReason: "Cliente frecuente, autorizado por gerente",
  }));
  assert.equal(snapshot.modifiers.filter((modifier) => modifier.modifierId.startsWith("extra:")).length, 6);
});

test("decision 7: a manager override with a blank reason is rejected", () => {
  const manyExtras = ["extra-cheese", "extra-pepperoni", "extra-cheese-2", "extra-cheese-3", "extra-cheese-4", "extra-cheese-5"];
  const variant = baseVariant({
    extras: manyExtras.map((optionId) => ({ active: true, name: optionId, optionId, priceMinor: 100 })),
  });
  const input = wholeInput({
    slots: [{ excludedIngredientIds: [], extraOptionIds: manyExtras, flavorOptionId: "flavor-margherita", fraction: "whole" }],
  });
  const blankReasonIssues = expectIssues(resolveFractionPricing(variant, input, {
    actorId: "manager-1",
    actorRole: "manager",
    overrideReason: "   ",
  }));
  assert.ok(blankReasonIssues.some((issue) => issue.code === "extra_override_reason_required"));
});

test("quarters and other geometries are rejected", () => {
  const input = { ...wholeInput(), geometry: "quarters" as never };
  const issues = expectIssues(resolveFractionPricing(baseVariant(), input, STAFF_CONTEXT));
  assert.ok(issues.some((issue) => issue.code === "invalid_geometry"));
});

test("an inactive flavor, extra, or variant blocks the selection", () => {
  const inactiveFlavor = expectIssues(resolveFractionPricing(
    baseVariant(),
    wholeInput({ slots: [{ excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: "flavor-retired", fraction: "whole" }] }),
    STAFF_CONTEXT,
  ));
  assert.ok(inactiveFlavor.some((issue) => issue.code === "flavor_inactive"));

  const inactiveExtra = expectIssues(resolveFractionPricing(
    baseVariant(),
    wholeInput({ slots: [{ excludedIngredientIds: [], extraOptionIds: ["extra-truffle"], flavorOptionId: "flavor-margherita", fraction: "whole" }] }),
    STAFF_CONTEXT,
  ));
  assert.ok(inactiveExtra.some((issue) => issue.code === "extra_inactive"));

  const inactiveVariant = expectIssues(resolveFractionPricing(baseVariant({ active: false }), wholeInput(), STAFF_CONTEXT));
  assert.ok(inactiveVariant.some((issue) => issue.code === "variant_inactive"));
});

test("resolution is bit-exact idempotent across repeated calls", () => {
  const variant = baseVariant();
  const input = halvesInput("flavor-margherita", "flavor-pepperoni", {
    comboSubstitutions: [{ optionId: "drink-juice", slotId: "combo-drink" }],
    slots: [
      { excludedIngredientIds: ["cheese"], extraOptionIds: ["extra-cheese"], flavorOptionId: "flavor-margherita", fraction: "half-a" },
      { excludedIngredientIds: [], extraOptionIds: ["extra-pepperoni"], flavorOptionId: "flavor-pepperoni", fraction: "half-b" },
    ],
  });
  const first = resolveFractionPricing(variant, input, STAFF_CONTEXT);
  const second = resolveFractionPricing(variant, input, STAFF_CONTEXT);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first, moneyReplacer), JSON.stringify(second, moneyReplacer));
});

test("the returned snapshot is deeply frozen and immune to caller mutation attempts", () => {
  const snapshot = expectSnapshot(resolveFractionPricing(baseVariant(), wholeInput(), STAFF_CONTEXT));
  assert.throws(() => {
    (snapshot.modifiers as unknown as unknown[]).push({});
  }, TypeError);
  assert.throws(() => {
    (snapshot as { name: string }).name = "tampered";
  }, TypeError);
  assert.throws(() => {
    (snapshot.fractionBreakdown[0] as { amountMinor: number }).amountMinor = 1;
  }, TypeError);
});

test("malformed structural input throws InvalidSnapshotError rather than silently coercing", () => {
  assert.throws(() => resolveFractionPricing(null as unknown as FractionPricingVariant, wholeInput(), STAFF_CONTEXT), InvalidSnapshotError);
  assert.throws(() => resolveFractionPricing(baseVariant(), null as unknown as ResolveFractionPricingInput, STAFF_CONTEXT), InvalidSnapshotError);
  assert.throws(() => resolveFractionPricing(baseVariant(), wholeInput(), { actorId: "a" } as unknown as ResolveFractionPricingContext), InvalidSnapshotError);
});

test("hostile getters on the variant, selection, or context are rejected instead of invoked", () => {
  let getterInvoked = false;
  const hostileVariant = { ...baseVariant() };
  Object.defineProperty(hostileVariant, "currency", {
    enumerable: true,
    get(): string {
      getterInvoked = true;
      return "MXN";
    },
  });
  assert.throws(() => resolveFractionPricing(hostileVariant, wholeInput(), STAFF_CONTEXT), InvalidSnapshotError);
  assert.equal(getterInvoked, false, "a getter-backed field must never be read for arithmetic");

  const hostileContext = { ...STAFF_CONTEXT };
  Object.defineProperty(hostileContext, "actorRole", {
    enumerable: true,
    get(): string {
      getterInvoked = true;
      return "manager";
    },
  });
  assert.throws(() => resolveFractionPricing(baseVariant(), wholeInput(), hostileContext), InvalidSnapshotError);
  assert.equal(getterInvoked, false, "a getter-backed actorRole must never be trusted for authorization");
});

test("a variant or selection with a foreign, non-plain prototype is rejected", () => {
  const hostileVariant = Object.create({ tampered: true }, Object.getOwnPropertyDescriptors(baseVariant()));
  assert.throws(() => resolveFractionPricing(hostileVariant, wholeInput(), STAFF_CONTEXT), InvalidSnapshotError);

  const hostileSlot = Object.create({ tampered: true }, Object.getOwnPropertyDescriptors(wholeInput().slots[0]));
  const inputWithHostileSlot = { ...wholeInput(), slots: [hostileSlot] };
  assert.throws(() => resolveFractionPricing(baseVariant(), inputWithHostileSlot, STAFF_CONTEXT), InvalidSnapshotError);
});

test("a Proxy whose getOwnPropertyDescriptor trap throws propagates as InvalidSnapshotError instead of a raw error leaking out", () => {
  const proxiedVariant = new Proxy(baseVariant(), {
    getOwnPropertyDescriptor(): never {
      throw new Error("hostile getOwnPropertyDescriptor trap");
    },
  });
  assert.throws(() => resolveFractionPricing(proxiedVariant, wholeInput(), STAFF_CONTEXT), InvalidSnapshotError);

  const proxiedContext = new Proxy(STAFF_CONTEXT, {
    getOwnPropertyDescriptor(): never {
      throw new Error("hostile getOwnPropertyDescriptor trap");
    },
  });
  assert.throws(() => resolveFractionPricing(baseVariant(), wholeInput(), proxiedContext), InvalidSnapshotError);
});

test("a Proxy 'get' trap on a field is never actually invoked (only own descriptors are read)", () => {
  let getTrapInvoked = false;
  const proxiedContext = new Proxy(STAFF_CONTEXT, {
    get(target, key, receiver): unknown {
      if (key === "actorRole") getTrapInvoked = true;
      return Reflect.get(target, key, receiver);
    },
  });
  const snapshot = expectSnapshot(resolveFractionPricing(baseVariant(), wholeInput(), proxiedContext));
  assert.equal(getTrapInvoked, false, "resolution must read actorRole via getOwnPropertyDescriptor, never via a 'get' trap");
  assert.deepEqual(snapshot.unitPrice, new Money(10000, CURRENCY));
});

test("an array field whose prototype was swapped away from Array.prototype is rejected, even though Array.isArray still reports true", () => {
  const tamperedFlavors = baseVariant().flavors.slice();
  Object.setPrototypeOf(tamperedFlavors, {});
  assert.equal(Array.isArray(tamperedFlavors), true, "test setup sanity check: Array.isArray still says true");
  const variant = { ...baseVariant(), flavors: tamperedFlavors };
  assert.throws(() => resolveFractionPricing(variant, wholeInput(), STAFF_CONTEXT), InvalidSnapshotError);
});

function moneyReplacer(_key: string, value: unknown): unknown {
  return value;
}
