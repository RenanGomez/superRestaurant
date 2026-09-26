import assert from "node:assert/strict";
import test from "node:test";

import {
  validateConfiguredCatalogRelease,
  type ConfiguredCatalogRelease,
} from "./configured-catalog.js";
import { Money } from "./money.js";

const release = (): ConfiguredCatalogRelease => ({
  catalogVersion: "catalog-v2",
  categories: [{
    active: true,
    catalogVersion: "catalog-v2",
    displayOrder: 2,
    id: "pizza",
    name: "Pizza",
    restaurantId: "restaurant-1",
  }],
  currency: "MXN",
  modifierTemplates: [{
    active: true,
    catalogVersion: "catalog-v2",
    id: "template-dough",
    name: "Masa",
    options: [
      { active: true, id: "thin", maximumQuantity: 1, name: "Delgada" },
      { active: true, id: "pan", maximumQuantity: 1, name: "Pan" },
    ],
    restaurantId: "restaurant-1",
  }],
  products: [{
    active: true,
    catalogVersion: "catalog-v2",
    categoryId: "pizza",
    displayOrder: 3,
    id: "pizza-product",
    name: "Pizza de especialidad",
    restaurantId: "restaurant-1",
    tax: {
      inclusion: "excluded",
      name: "IVA",
      rate: { denominator: 100n, numerator: 16n },
      taxId: "mx-vat",
      taxRuleVersion: "mx-v1",
    },
    variantIds: ["pizza-medium", "pizza-large"],
  }],
  restaurantId: "restaurant-1",
  variants: [variant("pizza-large", 20_000, 2), variant("pizza-medium", 15_000, 1)],
});

function variant(id: string, amountMinor: number, displayOrder: number): ConfiguredCatalogRelease["variants"][number] {
  return {
    active: true,
    catalogVersion: "catalog-v2",
    constraints: [],
    displayOrder,
    id,
    modifierGroups: [{
      binding: {
        active: true,
        groupId: `dough-${id}`,
        maximumQuantity: 1,
        minimumQuantity: 1,
        name: "Elige masa",
        options: [
          { defaultQuantity: 1, optionId: "thin", unitPrice: new Money(0, "MXN") },
          { defaultQuantity: 0, optionId: "pan", unitPrice: new Money(1_500, "MXN") },
        ],
        productId: "pizza-product",
      },
      templateId: "template-dough",
    }],
    name: id === "pizza-large" ? "Grande" : "Mediana",
    productId: "pizza-product",
    recipeVersion: "pizza-recipe-v3",
    restaurantId: "restaurant-1",
    sku: id.toUpperCase(),
    stationId: "pizza-station",
    unit: "piece",
    unitPrice: new Money(amountMinor, "MXN"),
  };
}

test("validates one immutable V2 release and preserves the product variant allowlist", () => {
  const result = validateConfiguredCatalogRelease(release());

  assert.equal(result.currency, "MXN");
  assert.deepEqual(result.products[0]?.variantIds, ["pizza-medium", "pizza-large"]);
  assert.deepEqual(result.variants.map(({ id }) => id), ["pizza-medium", "pizza-large"]);
  assert.equal(result.variants[0]?.unitPrice.amountMinor, 15_000);
  assert.equal(result.products[0]?.tax?.rate.numerator, 16n);
  assert.equal(Object.isFrozen(result.products[0]?.tax?.rate), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.products[0]?.variantIds), true);
});

test("rejects duplicate variant identities, SKUs and instantiated group identities", () => {
  const source = release();
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    variants: [source.variants[0]!, { ...source.variants[0]! }],
  }));
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    variants: [source.variants[0]!, { ...source.variants[1]!, sku: "PIZZA-LARGE" }],
  }));
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    variants: [source.variants[0]!, {
      ...source.variants[1]!,
      modifierGroups: source.variants[0]!.modifierGroups,
    }],
  }));
});

test("rejects incomplete, duplicate and cross-product variant publication graphs", () => {
  const source = release();
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    products: [{ ...source.products[0]!, variantIds: ["pizza-medium"] }],
  }));
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    products: [{ ...source.products[0]!, variantIds: ["pizza-medium", "pizza-medium"] }],
  }));
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    products: [{ ...source.products[0]!, variantIds: ["missing", "pizza-large"] }],
  }));
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    variants: [{ ...source.variants[0]!, productId: "other" }, source.variants[1]!],
  }));
});

test("rejects category, template, product and variant scope or version drift", () => {
  const source = release();
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    categories: [{ ...source.categories[0]!, restaurantId: "restaurant-2" }],
  }));
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    modifierTemplates: [{ ...source.modifierTemplates[0]!, catalogVersion: "catalog-v3" }],
  }));
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    products: [{ ...source.products[0]!, categoryId: "missing" }],
  }));
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    variants: [{ ...source.variants[0]!, restaurantId: "restaurant-2" }, source.variants[1]!],
  }));
});

test("rejects mixed release currency", () => {
  const source = release();
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    variants: [{ ...source.variants[0]!, unitPrice: new Money(20_000, "USD") }, source.variants[1]!],
  }));
});

test("rejects malformed product fiscal facts instead of publishing a taxless variant", () => {
  const source = release();
  assert.throws(() => validateConfiguredCatalogRelease({
    ...source,
    products: [{
      ...source.products[0]!,
      tax: {
        inclusion: "excluded",
        name: "IVA",
        rate: { denominator: 100n, numerator: -1n },
        taxId: "mx-vat",
        taxRuleVersion: "mx-v1",
      },
    }],
  }));
});

test("release boundaries reject accessors and hostile proxies without invoking them", () => {
  let invoked = false;
  const source = release() as unknown as Record<string, unknown>;
  Object.defineProperty(source, "currency", {
    enumerable: true,
    get: () => {
      invoked = true;
      return "MXN";
    },
  });
  assert.throws(() => validateConfiguredCatalogRelease(source as unknown as ConfiguredCatalogRelease));
  assert.equal(invoked, false);
  assert.throws(() => validateConfiguredCatalogRelease(new Proxy(release(), {
    getPrototypeOf() { throw new Error("hostile"); },
  })));
});
