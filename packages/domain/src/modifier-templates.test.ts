import assert from "node:assert/strict";
import test from "node:test";

import {
  instantiateModifierGroupTemplate,
  validateModifierGroupTemplateCatalog,
  type ModifierGroupTemplateBinding,
  type ModifierGroupTemplateCatalog,
} from "./modifier-templates.js";
import { createModifierSelectionSnapshot } from "./modifiers.js";
import { Money } from "./money.js";

const template = (): ModifierGroupTemplateCatalog => ({
  active: true,
  catalogVersion: "catalog-v2",
  id: "template-dough",
  name: "Masa",
  options: [
    { active: true, id: "thin", maximumQuantity: 1, name: "Delgada" },
    { active: true, id: "pan", maximumQuantity: 1, name: "Pan" },
    { active: false, id: "seasonal", maximumQuantity: 1, name: "Temporal" },
  ],
  restaurantId: "restaurant-1",
});

const binding = (productId = "pizza-large"): ModifierGroupTemplateBinding => ({
  active: true,
  groupId: `dough-${productId}`,
  maximumQuantity: 1,
  minimumQuantity: 1,
  name: "Elige masa",
  options: [
    { defaultQuantity: 1, maximumQuantity: 1, optionId: "thin", unitPrice: new Money(0, "MXN") },
    { defaultQuantity: 0, maximumQuantity: 1, optionId: "pan", unitPrice: new Money(2_500, "MXN") },
  ],
  productId,
});

test("instantiates one reusable template into detached product-specific modifier groups", () => {
  const source = template();
  const large = instantiateModifierGroupTemplate(source, binding());
  const medium = instantiateModifierGroupTemplate(source, {
    ...binding("pizza-medium"),
    options: [
      { defaultQuantity: 0, optionId: "thin", unitPrice: new Money(0, "MXN") },
      { defaultQuantity: 1, optionId: "pan", unitPrice: new Money(1_500, "MXN") },
    ],
  });

  assert.equal(large.templateId, source.id);
  assert.deepEqual(large.defaultSelections, [{ optionId: "thin", quantity: 1 }]);
  assert.deepEqual(medium.defaultSelections, [{ optionId: "pan", quantity: 1 }]);
  assert.equal(large.options[1]?.unitPrice.amountMinor, 2_500);
  assert.equal(medium.options[1]?.unitPrice.amountMinor, 1_500);
  assert.equal(Object.isFrozen(large), true);
  assert.equal(Object.isFrozen(large.options), true);
  assert.equal(Object.isFrozen(large.defaultSelections), true);
  assert.equal(source.options[1]?.name, "Pan");

  const snapshot = createModifierSelectionSnapshot(
    large,
    { productId: large.productId as string, restaurantId: large.restaurantId },
    large.defaultSelections,
  );
  assert.equal(snapshot.modifiers[0]?.modifierId, "thin");
  assert.equal(snapshot.total.amountMinor, 0);
});

test("validates template identity, option uniqueness and hostile values fail-closed", () => {
  assert.throws(() => validateModifierGroupTemplateCatalog({ ...template(), name: " Masa" }));
  assert.throws(() => validateModifierGroupTemplateCatalog({
    ...template(),
    options: [template().options[0]!, template().options[0]!],
  }));
  assert.throws(() => validateModifierGroupTemplateCatalog({
    ...template(),
    options: [{ ...template().options[0]!, maximumQuantity: 0 }],
  }));
  assert.throws(() => validateModifierGroupTemplateCatalog(new Proxy(template(), {
    getPrototypeOf() { throw new Error("hostile"); },
  })));
  const accessor = { ...template() } as Record<string, unknown>;
  Object.defineProperty(accessor, "name", { enumerable: true, get: () => "Masa" });
  assert.throws(() => validateModifierGroupTemplateCatalog(accessor as unknown as ModifierGroupTemplateCatalog));
});

test("bindings reject unknown, duplicate, inactive, widened and over-defaulted options", () => {
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: [{ defaultQuantity: 0, optionId: "missing", unitPrice: new Money(0, "MXN") }],
  }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: [binding().options[0]!, binding().options[0]!],
  }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: [{ defaultQuantity: 1, optionId: "seasonal", unitPrice: new Money(0, "MXN") }],
  }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: [{ defaultQuantity: 0, maximumQuantity: 2, optionId: "thin", unitPrice: new Money(0, "MXN") }],
  }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: [{ defaultQuantity: 2, maximumQuantity: 1, optionId: "thin", unitPrice: new Money(0, "MXN") }],
  }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    maximumQuantity: 1,
    options: [
      { defaultQuantity: 1, optionId: "thin", unitPrice: new Money(0, "MXN") },
      { defaultQuantity: 1, optionId: "pan", unitPrice: new Money(0, "MXN") },
    ],
  }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: [{ defaultQuantity: -1, optionId: "thin", unitPrice: new Money(0, "MXN") }],
  }));
});

test("bindings preserve existing money, currency and group-boundary validation", () => {
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: [
      { defaultQuantity: 1, optionId: "thin", unitPrice: new Money(0, "MXN") },
      { defaultQuantity: 0, optionId: "pan", unitPrice: new Money(100, "USD") },
    ],
  }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: [{ defaultQuantity: 1, optionId: "thin", unitPrice: new Money(-1, "MXN") }],
  }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), { ...binding(), minimumQuantity: 2 }));
  assert.throws(() => instantiateModifierGroupTemplate(template(), {
    ...binding(),
    options: binding().options.map((option) => ({ ...option, defaultQuantity: 0 })),
  }));
});
