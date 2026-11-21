import {
  createMenuProductPriceSnapshot,
  Money,
  PIZZA_HALVES_RULE_V2,
  resolvePizzaHalvesPricing,
  validateMenuCatalog,
  type MenuCatalog,
  type MenuProductCatalog,
  type ModifierPriceSnapshot,
  type OrderItemPriceSnapshot,
  type PizzaHalfInputV2,
  type PizzaHalfOptionPrice,
  type ValidatedMenuCatalog,
} from "@super-restaurant/domain";
import type { CaptureSelectionLineV1 } from "@super-restaurant/shared-types";

import type { CapturePizzaHalfV2, CapturePizzaLineV2 } from "./capture-pizza-plan.js";

/** Any reason a pizza V2 line cannot be priced from the live catalog; callers map it to a 409. */
export class PizzaLinePricingError extends Error {
  public constructor(public readonly reason: string) {
    super(`PIZZA_LINE_${reason}`);
    this.name = "PizzaLinePricingError";
  }
}

const fail = (reason: string): never => { throw new PizzaLinePricingError(reason); };

type ValidatedProduct = ValidatedMenuCatalog["products"][number];
type ValidatedGroup = ValidatedMenuCatalog["modifierGroups"][number];

function taxKey(product: ValidatedProduct): string {
  const tax = product.tax;
  return tax === undefined ? "" : [tax.taxId, tax.taxRuleVersion, tax.rate.numerator.toString(), tax.rate.denominator.toString(), tax.inclusion].join("|");
}

function pizzaGroupIds(product: Pick<MenuProductCatalog, "baseGroupId" | "extraGroupIds">): readonly string[] {
  return [...(product.baseGroupId == null ? [] : [product.baseGroupId]), ...(product.extraGroupIds ?? [])];
}

function optionPrice(group: ValidatedGroup, optionId: string): PizzaHalfOptionPrice {
  const option = group.options.find((candidate) => candidate.id === optionId);
  if (option === undefined || !option.active || !group.active) return fail("option");
  return { groupId: group.id, name: option.name, optionId: option.id, priceMinor: option.unitPrice.amountMinor };
}

function resolveHalf(catalog: ValidatedMenuCatalog, half: CapturePizzaHalfV2): { input: PizzaHalfInputV2; sizeKey: string; taxKey: string; removedNames: ReadonlyMap<string, string> } {
  const product = catalog.products.find((candidate) => candidate.id === half.productId);
  const category = product === undefined ? undefined : catalog.categories.find((candidate) => candidate.id === product.categoryId);
  if (product === undefined || !product.active || category === undefined || !category.active || product.pizzaMode === undefined) return fail("product");

  const activeVariants = (product.variants ?? []).filter((variant) => variant.active);
  const variant = half.variantId === null ? undefined : activeVariants.find((candidate) => candidate.id === half.variantId);
  if (half.variantId === null ? activeVariants.length > 0 : variant === undefined) return fail("variant");

  const customizeAtOrder = product.customizeAtOrder === true;
  if (product.pizzaMode === "specialty" && !customizeAtOrder
    && (half.extraOptionIds.length > 0 || half.removedIngredientOptionIds.length > 0)) return fail("customization_not_allowed");
  const defaults = product.defaultIngredientOptionIds ?? [];
  if (half.removedIngredientOptionIds.some((id) => !defaults.includes(id))) return fail("removal_not_in_recipe");

  const baseGroup = product.baseGroupId == null ? undefined : catalog.modifierGroups.find((group) => group.id === product.baseGroupId);
  if (baseGroup === undefined) return fail("base_group");
  const ingredients = half.ingredientOptionIds.map((id) => optionPrice(baseGroup, id));
  if (ingredients.length > baseGroup.maximumQuantity
    || (product.pizzaMode === "custom" && ingredients.length < baseGroup.minimumQuantity)) return fail("ingredient_quantity");
  const removedNames = new Map(half.removedIngredientOptionIds.map((id) => {
    const option = baseGroup.options.find((candidate) => candidate.id === id);
    return option === undefined ? fail("removal_not_in_base_group") : [id, option.name] as const;
  }));

  const extraGroups = (product.extraGroupIds ?? []).map((groupId) => {
    const group = catalog.modifierGroups.find((candidate) => candidate.id === groupId);
    return group === undefined ? fail("extra_group") : group;
  });
  const extras = half.extraOptionIds.map((id) => {
    const group = extraGroups.find((candidate) => candidate.options.some((option) => option.id === id));
    return group === undefined ? fail("option") : optionPrice(group, id);
  });
  for (const group of extraGroups) {
    const chosen = extras.filter((extra) => extra.groupId === group.id).length;
    if (chosen > group.maximumQuantity || ((product.pizzaMode === "custom" || customizeAtOrder) && chosen < group.minimumQuantity)) {
      return fail("extra_quantity");
    }
  }

  return {
    input: {
      basePriceMinor: (variant?.unitPrice ?? product.unitPrice).amountMinor,
      extras,
      fraction: half.fraction,
      freeIngredientCount: product.freeIngredientCount ?? 0,
      ingredients,
      kind: product.pizzaMode,
      productId: product.id,
      productName: product.name,
      removedIngredientOptionIds: half.removedIngredientOptionIds,
      sizeId: variant?.id ?? product.id,
      sizeName: variant?.name ?? "Única",
      stationId: product.stationId,
    },
    removedNames,
    sizeKey: variant === undefined ? "" : variant.name.trim().toLowerCase(),
    taxKey: taxKey(product),
  };
}

/**
 * Prices one two-halves pizza line (plan schemaVersion 2) from the live catalog and returns the frozen
 * snapshot the Order would carry: the half-a product and size, the rule's base as `unitPrice`, one modifier
 * per charge (free ones at zero) and per removal, `geometry: "halves"` and the full `pizzaHalves` snapshot.
 * Non-pizza groups of the product price exactly like a whole line. Throws `PizzaLinePricingError` (or the
 * domain's own error) for anything the rules reject; the server never trusts client amounts.
 */
export function pricePizzaLineSnapshot(
  domainCatalog: MenuCatalog,
  restaurantId: string,
  line: Pick<CaptureSelectionLineV1, "modifierGroups" | "productId" | "variantId">,
  pizza: CapturePizzaLineV2,
): OrderItemPriceSnapshot {
  const catalog = validateMenuCatalog(domainCatalog);
  const resolved = pizza.halves.map((half) => resolveHalf(catalog, half));
  const [first, second] = resolved;
  if (first === undefined || second === undefined) return fail("halves");
  // Both halves are the same physical pizza: same size and the same fiscal treatment.
  if (first.sizeKey !== second.sizeKey || first.taxKey !== second.taxKey) return fail("halves_differ");

  const priced = resolvePizzaHalvesPricing({
    currency: catalog.currency,
    halves: resolved.map((entry) => entry.input),
    ruleVersion: pizza.ruleVersion,
  });
  if (Array.isArray(priced)) return fail((priced as readonly { code: string }[])[0]?.code ?? "rule");
  const pizzaHalves = priced as Exclude<typeof priced, readonly unknown[]>;

  const lineProduct = domainCatalog.products.find((candidate) => candidate.id === line.productId);
  if (lineProduct === undefined) return fail("product");
  const ownGroupIds = new Set(pizzaGroupIds(lineProduct));
  // The base and extra groups are priced by the rule and must arrive empty, like the legacy fraction groups.
  if (line.modifierGroups.some((group) => ownGroupIds.has(group.groupId) && group.selections.length > 0)) {
    return fail("pizza_group_selection");
  }
  // Price the product's other groups with the regular pipeline on a catalog where the pizza fields and groups
  // of this one product are not part of the product (they are handled above).
  const plainProduct: Record<string, unknown> = { ...lineProduct };
  for (const key of ["baseGroupId", "customizeAtOrder", "defaultIngredientOptionIds", "extraGroupIds", "freeIngredientCount", "pizzaMode"]) {
    delete plainProduct[key];
  }
  const regularCatalog: MenuCatalog = {
    ...domainCatalog,
    modifierGroups: domainCatalog.modifierGroups.map((group) => (ownGroupIds.has(group.id) ? { ...group, productId: null } : group)),
    products: domainCatalog.products.map((product) => (product.id === lineProduct.id
      ? { ...(plainProduct as unknown as typeof lineProduct), modifierGroupIds: lineProduct.modifierGroupIds.filter((id) => !ownGroupIds.has(id)) }
      : product)),
  };
  const regular = createMenuProductPriceSnapshot(regularCatalog, {
    currency: catalog.currency,
    fraction: null,
    productId: line.productId,
    restaurantId,
    variantId: line.variantId,
  }, line.modifierGroups.filter((group) => !ownGroupIds.has(group.groupId)));

  const zero = new Money(0, catalog.currency);
  const removedNames = new Map(resolved.flatMap((entry) => [...entry.removedNames]));
  const catalogVersion = catalog.catalogVersion;
  const charged: ModifierPriceSnapshot[] = pizzaHalves.charges.map((charge) => {
    const scope = charge.fractions.length === 2 ? "both" : charge.fractions[0];
    return {
      groupCatalogVersion: catalogVersion,
      groupId: `pizza-${charge.role}`,
      groupName: `${charge.role}:${scope}`,
      modifierId: `pizza-${charge.role}:${scope}:${charge.optionId}`,
      name: charge.name,
      quantity: 1,
      unitPrice: charge.amount,
    };
  });
  const removed: ModifierPriceSnapshot[] = pizzaHalves.halves.flatMap((half) => half.removedIngredientOptionIds.map((id) => ({
    groupCatalogVersion: catalogVersion,
    groupId: "fraction-exclusion",
    groupName: `exclude:${half.fraction}`,
    modifierId: `exclude:${half.fraction}:${id}`,
    name: `Sin ${removedNames.get(id) ?? fail("removal_not_in_base_group")}`,
    quantity: 1,
    unitPrice: zero,
  })));

  if (pizzaHalves.ruleVersion !== PIZZA_HALVES_RULE_V2) return fail("rule");
  return Object.freeze({
    ...regular,
    geometry: "halves" as const,
    modifiers: Object.freeze([...regular.modifiers, ...charged, ...removed]),
    pizzaHalves,
    unitPrice: pizzaHalves.basePrice,
  });
}
