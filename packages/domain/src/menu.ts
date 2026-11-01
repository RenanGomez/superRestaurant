import {
  CurrencyMismatchError,
  DomainError,
  DuplicateMenuEntityIdError,
  DuplicateMenuModifierGroupSelectionError,
  DuplicateMenuProductSkuError,
  InactiveMenuCategoryError,
  InactiveMenuProductError,
  InactiveMenuProductVariantError,
  InvalidSnapshotError,
  MenuFractionSelectionInvalidError,
  MenuCatalogRestaurantMismatchError,
  MenuCatalogVersionMismatchError,
  MenuModifierGroupNotAllowedError,
  MenuProductCategoryNotFoundError,
  MenuProductModifierGroupNotFoundError,
  MenuProductNotFoundError,
  MenuProductVariantNotFoundError,
  MenuProductVariantRequiredError,
  ModifierGroupProductMismatchError,
  NegativeMoneyAmountError,
} from "./errors.js";
import {
  createModifierSelectionSnapshot,
  validateModifierGroupCatalog,
  type ModifierGroupCatalog,
  type ModifierOptionSelection,
  type ValidatedModifierGroupCatalog,
} from "./modifiers.js";
import {
  resolveFractionPricing,
  type FractionPricingVariant,
  type PizzaFraction,
} from "./fraction-pricing.js";
import { Money } from "./money.js";
import {
  calculateOrderItemTotals,
  type OrderItemPriceSnapshot,
  type TaxSnapshot,
} from "./order-totals.js";

export interface MenuCategoryCatalog {
  readonly id: string;
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly name: string;
  readonly active: boolean;
  readonly displayOrder: number;
}

/**
 * Half-and-half configuration. It lives on the product (all sizes, or the product without sizes);
 * the same shape on a size is the legacy source, used only while the product carries none.
 * Flavors are the options of `flavorGroupId` (an option priced at zero falls back to the size price,
 * or the product price when it has no sizes). `extraGroupId` is the ingredient group: its options
 * are the extras of a flavor half and the ingredients of a half built ingredient by ingredient. Both
 * groups belong to the product and are resolved only through the fraction rules while a line is split.
 */
export interface MenuVariantFractionConfig {
  readonly enabled: boolean;
  readonly flavorGroupId: string | null;
  readonly extraGroupId: string | null;
  /** Labels of ingredients that may be excluded on a half; the label is the frozen exclusion name. */
  readonly excludableIngredientIds: readonly string[];
}

export type MenuProductFractionConfig = MenuVariantFractionConfig;

/** A size of one product ("Chica", "Grande") with its own whole-unit price. */
export interface MenuProductVariantCatalog {
  readonly id: string;
  readonly name: string;
  readonly sku?: string;
  readonly active: boolean;
  readonly displayOrder: number;
  readonly unitPrice: Money;
  readonly fraction?: MenuVariantFractionConfig;
}

export interface MenuFractionSlotSelection {
  readonly fraction: Exclude<PizzaFraction, "whole">;
  /** `null` is a half built ingredient by ingredient (needs an ingredient group; not both halves). */
  readonly flavorOptionId: string | null;
  readonly extraOptionIds: readonly string[];
  readonly excludedIngredientIds: readonly string[];
}

/** A two-halves selection; the server prices it, the client never supplies amounts. */
export interface MenuFractionSelection {
  readonly geometry: "halves";
  readonly slots: readonly MenuFractionSlotSelection[];
}

export interface MenuProductCatalog {
  readonly id: string;
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly categoryId: string;
  readonly name: string;
  readonly sku?: string;
  readonly active: boolean;
  readonly displayOrder: number;
  readonly stationId: string;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly tax?: TaxSnapshot;
  /** Ordered allowlist of groups that may be resolved for this product. */
  readonly modifierGroupIds: readonly string[];
  /** Optional sizes; absent or empty means the product is sold at `unitPrice`. */
  readonly variants?: readonly MenuProductVariantCatalog[];
  /** Half-and-half setup for every size of the product (or the product itself when it has no sizes). */
  readonly fraction?: MenuProductFractionConfig;
}

/** One coherent, restaurant-owned menu release. Branch/time availability is deliberately outside this neutral slice. */
export interface MenuCatalog {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly categories: readonly MenuCategoryCatalog[];
  readonly products: readonly MenuProductCatalog[];
  readonly modifierGroups: readonly ModifierGroupCatalog[];
}

export interface ValidatedMenuCatalog {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly categories: readonly Readonly<MenuCategoryCatalog>[];
  readonly products: readonly Readonly<MenuProductCatalog>[];
  readonly modifierGroups: readonly ValidatedModifierGroupCatalog[];
}

export interface MenuProductSelectionContext {
  readonly restaurantId: string;
  readonly productId: string;
  readonly currency: string;
  /** Required when the product has active variants; rejected when the product has no such variant. */
  readonly variantId?: string | null | undefined;
  /** Optional half-and-half selection; requires fractions enabled on the product (or, legacy, on the size). */
  readonly fraction?: MenuFractionSelection | null | undefined;
}

export interface MenuModifierGroupSelection {
  readonly groupId: string;
  readonly selections: readonly ModifierOptionSelection[];
}

/** Validates, detaches, and freezes a complete menu release. */
export function validateMenuCatalog(value: MenuCatalog): ValidatedMenuCatalog {
  return atMenuBoundary("menu catalog", () => validateMenuCatalogCanonical(normalizeMenuCatalog(value)));
}

/**
 * Resolves current catalog data into the historical price facts retained by an
 * OrderItem. Required modifier groups cannot be skipped: omitted groups are
 * resolved with an empty selection, so their configured minimum still applies.
 */
export function createMenuProductPriceSnapshot(
  catalogValue: MenuCatalog,
  contextValue: MenuProductSelectionContext,
  selectionValues: readonly MenuModifierGroupSelection[] = [],
): OrderItemPriceSnapshot {
  return atMenuBoundary("menu product selection", () => {
    const catalog = validateMenuCatalog(catalogValue);
    const context = normalizeMenuProductSelectionContext(contextValue);
    const selections = normalizeMenuModifierGroupSelections(selectionValues);
    return createMenuProductPriceSnapshotCanonical(catalog, context, selections);
  });
}

function validateMenuCatalogCanonical(catalog: MenuCatalog): ValidatedMenuCatalog {
  assertText(catalog.restaurantId, "menu restaurantId");
  assertText(catalog.catalogVersion, "menu catalogVersion");
  const catalogCurrency = new Money(0, catalog.currency).currency;

  const categoryIds = new Set<string>();
  const categories = catalog.categories.map((category) => {
    assertText(category.id, "menu category id");
    assertText(category.restaurantId, "menu category restaurantId");
    assertText(category.catalogVersion, "menu category catalogVersion");
    assertText(category.name, "menu category name");
    assertBoolean(category.active, "menu category active");
    assertDisplayOrder(category.displayOrder, "menu category displayOrder");
    if (category.restaurantId !== catalog.restaurantId) {
      throw new MenuCatalogRestaurantMismatchError("category", category.id);
    }
    if (category.catalogVersion !== catalog.catalogVersion) {
      throw new MenuCatalogVersionMismatchError("category", category.id);
    }
    if (categoryIds.has(category.id)) throw new DuplicateMenuEntityIdError("category", category.id);
    categoryIds.add(category.id);
    return Object.freeze({ ...category });
  }).sort(compareMenuDisplayOrder);

  const productIds = new Set<string>();
  const productSkus = new Set<string>();
  const products = catalog.products.map((product) => {
    assertText(product.id, "menu product id");
    assertText(product.restaurantId, "menu product restaurantId");
    assertText(product.catalogVersion, "menu product catalogVersion");
    assertText(product.categoryId, "menu product categoryId");
    assertText(product.name, "menu product name");
    assertText(product.stationId, "menu product stationId");
    assertText(product.unit, "menu product unit");
    assertBoolean(product.active, "menu product active");
    assertDisplayOrder(product.displayOrder, "menu product displayOrder");
    if (product.sku !== undefined) assertText(product.sku, "menu product sku");
    if (product.restaurantId !== catalog.restaurantId) {
      throw new MenuCatalogRestaurantMismatchError("product", product.id);
    }
    if (product.catalogVersion !== catalog.catalogVersion) {
      throw new MenuCatalogVersionMismatchError("product", product.id);
    }
    if (!categoryIds.has(product.categoryId)) {
      throw new MenuProductCategoryNotFoundError(product.id, product.categoryId);
    }
    if (productIds.has(product.id)) throw new DuplicateMenuEntityIdError("product", product.id);
    productIds.add(product.id);
    if (product.sku !== undefined) {
      if (productSkus.has(product.sku)) throw new DuplicateMenuProductSkuError(product.sku);
      productSkus.add(product.sku);
    }
    const unitPrice = new Money(product.unitPrice.amountMinor, product.unitPrice.currency);
    if (unitPrice.amountMinor < 0) throw new NegativeMoneyAmountError("menu product unit price");
    assertCurrencyMatches(catalogCurrency, unitPrice);

    const groupIds = new Set<string>();
    for (const groupId of product.modifierGroupIds) {
      assertText(groupId, "menu product modifierGroupId");
      if (groupIds.has(groupId)) throw new DuplicateMenuEntityIdError("modifier group", groupId);
      groupIds.add(groupId);
    }

    const variantIds = new Set<string>();
    const variantNames = new Set<string>();
    const variants = (product.variants ?? []).map((variant) => {
      assertText(variant.id, "menu product variant id");
      assertText(variant.name, "menu product variant name");
      assertBoolean(variant.active, "menu product variant active");
      assertDisplayOrder(variant.displayOrder, "menu product variant displayOrder");
      if (variant.sku !== undefined) assertText(variant.sku, "menu product variant sku");
      if (variantIds.has(variant.id)) throw new DuplicateMenuEntityIdError("product variant", variant.id);
      variantIds.add(variant.id);
      const nameKey = variant.name.trim().toLowerCase();
      if (variantNames.has(nameKey)) throw new DuplicateMenuEntityIdError("product variant", variant.name);
      variantNames.add(nameKey);
      const variantPrice = new Money(variant.unitPrice.amountMinor, variant.unitPrice.currency);
      if (variantPrice.amountMinor < 0) throw new NegativeMoneyAmountError("menu product variant unit price");
      assertCurrencyMatches(catalogCurrency, variantPrice);
      const fraction = variant.fraction === undefined ? undefined : validateFractionConfig(variant.fraction, product.modifierGroupIds);
      return deepFreeze({
        id: variant.id,
        name: variant.name,
        ...(variant.sku === undefined ? {} : { sku: variant.sku }),
        active: variant.active,
        displayOrder: variant.displayOrder,
        unitPrice: variantPrice,
        ...(fraction === undefined ? {} : { fraction }),
      });
    }).sort(compareMenuDisplayOrder);

    const productFraction = product.fraction === undefined
      ? undefined
      : validateFractionConfig(product.fraction, product.modifierGroupIds);

    return deepFreeze({
      id: product.id,
      restaurantId: product.restaurantId,
      catalogVersion: product.catalogVersion,
      categoryId: product.categoryId,
      name: product.name,
      ...(product.sku === undefined ? {} : { sku: product.sku }),
      active: product.active,
      displayOrder: product.displayOrder,
      stationId: product.stationId,
      unit: product.unit,
      unitPrice,
      ...(product.tax === undefined ? {} : { tax: product.tax }),
      modifierGroupIds: [...product.modifierGroupIds],
      ...(variants.length === 0 ? {} : { variants }),
      ...(productFraction === undefined ? {} : { fraction: productFraction }),
    });
  }).sort(compareMenuDisplayOrder);

  const productsById = new Map(products.map((product) => [product.id, product]));
  const groupIds = new Set<string>();
  const modifierGroups = catalog.modifierGroups.map((groupValue) => {
    const group = validateModifierGroupCatalog(groupValue);
    if (group.restaurantId !== catalog.restaurantId) {
      throw new MenuCatalogRestaurantMismatchError("modifier group", group.id);
    }
    if (group.catalogVersion !== catalog.catalogVersion) {
      throw new MenuCatalogVersionMismatchError("modifier group", group.id);
    }
    if (groupIds.has(group.id)) throw new DuplicateMenuEntityIdError("modifier group", group.id);
    groupIds.add(group.id);
    // A shared group (`productId` null) belongs to the restaurant catalog; products opt in through
    // their allowlist. A legacy owner must still exist and list its own group.
    if (group.productId !== null) {
      const product = productsById.get(group.productId);
      if (product === undefined) throw new MenuProductModifierGroupNotFoundError(group.productId, group.id);
      if (!product.modifierGroupIds.includes(group.id)) {
        throw new MenuModifierGroupNotAllowedError(product.id, group.id);
      }
    }
    for (const option of group.options) assertCurrencyMatches(catalogCurrency, option.unitPrice);
    return group;
  });

  const groupsById = new Map(modifierGroups.map((group) => [group.id, group]));
  for (const product of products) {
    for (const groupId of product.modifierGroupIds) {
      const group = groupsById.get(groupId);
      if (group === undefined) throw new MenuProductModifierGroupNotFoundError(product.id, groupId);
      if (group.productId !== null && group.productId !== product.id) {
        throw new ModifierGroupProductMismatchError(group.id, group.productId, product.id);
      }
    }
  }

  return deepFreeze({
    restaurantId: catalog.restaurantId,
    catalogVersion: catalog.catalogVersion,
    currency: catalogCurrency,
    categories,
    products,
    modifierGroups,
  });
}

function createMenuProductPriceSnapshotCanonical(
  catalog: ValidatedMenuCatalog,
  context: MenuProductSelectionContext,
  selections: readonly MenuModifierGroupSelection[],
): OrderItemPriceSnapshot {
  assertText(context.restaurantId, "selected menu restaurantId");
  assertText(context.productId, "selected menu productId");
  if (context.restaurantId !== catalog.restaurantId) {
    throw new MenuCatalogRestaurantMismatchError("product", context.productId);
  }
  assertCurrencyMatches(catalog.currency, new Money(0, context.currency));

  const product = catalog.products.find(({ id }) => id === context.productId);
  if (product === undefined) throw new MenuProductNotFoundError(context.productId);
  if (!product.active) throw new InactiveMenuProductError(product.id);
  const category = catalog.categories.find(({ id }) => id === product.categoryId);
  if (category === undefined) throw new MenuProductCategoryNotFoundError(product.id, product.categoryId);
  if (!category.active) throw new InactiveMenuCategoryError(category.id);

  const variants = product.variants ?? [];
  let variant: MenuProductVariantCatalog | undefined;
  if (context.variantId !== undefined && context.variantId !== null) {
    assertText(context.variantId, "selected menu variantId");
    variant = variants.find(({ id }) => id === context.variantId);
    if (variant === undefined) throw new MenuProductVariantNotFoundError(product.id, context.variantId);
    if (!variant.active) throw new InactiveMenuProductVariantError(product.id, variant.id);
  } else if (variants.some(({ active }) => active)) {
    throw new MenuProductVariantRequiredError(product.id);
  }

  const fractionSelection = context.fraction ?? null;
  const fractionConfig = effectiveFractionConfig(product, variant);
  if (fractionSelection !== null && fractionConfig?.enabled !== true) {
    throw new MenuFractionSelectionInvalidError(product.id, ["fraction_not_enabled"]);
  }
  // Same slot order the SQL requires: half-a first, half-b second.
  if (
    fractionSelection !== null
    && fractionSelection.slots.length === 2
    && (fractionSelection.slots[0]?.fraction !== "half-a"
      || fractionSelection.slots[1]?.fraction !== "half-b")
  ) {
    throw new MenuFractionSelectionInvalidError(product.id, ["fraction_slot_order"]);
  }
  // While a line is split, the flavor and extra groups are priced only by the fraction rules.
  const fractionGroupIds = new Set<string>(
    fractionSelection === null || fractionConfig === undefined
      ? []
      : [fractionConfig.flavorGroupId, fractionConfig.extraGroupId].filter((id): id is string => id !== null),
  );

  const selectionsByGroup = new Map<string, readonly ModifierOptionSelection[]>();
  for (const selection of selections) {
    assertText(selection.groupId, "selected modifier group id");
    if (fractionGroupIds.has(selection.groupId)) {
      // Callers list every product group; the fraction pair must simply stay empty.
      if (selection.selections.length > 0) {
        throw new MenuFractionSelectionInvalidError(product.id, ["fraction_group_selection_forbidden"]);
      }
      continue;
    }
    if (selectionsByGroup.has(selection.groupId)) {
      throw new DuplicateMenuModifierGroupSelectionError(selection.groupId);
    }
    if (!product.modifierGroupIds.includes(selection.groupId)) {
      throw new MenuModifierGroupNotAllowedError(product.id, selection.groupId);
    }
    selectionsByGroup.set(selection.groupId, selection.selections);
  }

  const groupsById = new Map(catalog.modifierGroups.map((group) => [group.id, group]));
  const modifiers = product.modifierGroupIds.filter((groupId) => !fractionGroupIds.has(groupId)).flatMap((groupId) => {
    const group = groupsById.get(groupId);
    if (group === undefined) throw new MenuProductModifierGroupNotFoundError(product.id, groupId);
    return createModifierSelectionSnapshot(
      group,
      { restaurantId: context.restaurantId, productId: product.id },
      selectionsByGroup.get(groupId) ?? [],
    ).modifiers;
  });

  if (fractionSelection !== null) {
    const resolved = resolveFractionPricing(
      catalogVariantToFractionVariant(catalog, product.id, variant?.id ?? null),
      {
        catalogVersion: product.catalogVersion,
        comboSubstitutions: [],
        geometry: fractionSelection.geometry,
        restaurantId: context.restaurantId,
        slots: fractionSelection.slots,
        variantId: variant?.id ?? product.id,
      },
      { actorId: "menu-selection", actorRole: "staff" },
    );
    if (Array.isArray(resolved)) {
      throw new MenuFractionSelectionInvalidError(
        product.id,
        (resolved as readonly { readonly code: string }[]).map((issue) => issue.code),
      );
    }
    const priced = resolved as Exclude<typeof resolved, readonly unknown[]>;
    return calculateOrderItemTotals({
      orderItemId: product.id,
      quantity: 1,
      snapshot: {
        catalogVersion: priced.catalogVersion,
        fractionBreakdown: priced.fractionBreakdown,
        geometry: priced.geometry,
        modifiers: [...modifiers, ...priced.modifiers],
        name: priced.name,
        productId: priced.productId,
        ...(priced.sku === undefined ? {} : { sku: priced.sku }),
        stationId: priced.stationId,
        ...(priced.tax === undefined ? {} : { tax: priced.tax }),
        unit: priced.unit,
        unitPrice: priced.unitPrice,
        ...(variant === undefined ? {} : { variantId: variant.id, variantName: variant.name }),
      },
    }).input.snapshot;
  }

  return calculateOrderItemTotals({
    orderItemId: product.id,
    quantity: 1,
    snapshot: {
      catalogVersion: product.catalogVersion,
      productId: product.id,
      name: product.name,
      ...(variant?.sku !== undefined
        ? { sku: variant.sku }
        : product.sku === undefined ? {} : { sku: product.sku }),
      stationId: product.stationId,
      unit: product.unit,
      unitPrice: variant === undefined ? product.unitPrice : variant.unitPrice,
      modifiers,
      ...(product.tax === undefined ? {} : { tax: product.tax }),
      ...(variant === undefined ? {} : { variantId: variant.id, variantName: variant.name }),
    },
  }).input.snapshot;
}

/**
 * The half-and-half setup in force for a selection: the product's own when it carries one (even a
 * disabled one), otherwise the legacy per-size setup of the chosen size.
 */
function effectiveFractionConfig(
  product: Readonly<MenuProductCatalog>,
  variant: MenuProductVariantCatalog | undefined,
): MenuVariantFractionConfig | undefined {
  return product.fraction ?? variant?.fraction;
}

/**
 * Builds the fraction-pricing view of one half-and-half size (or of the product itself when
 * `variantId` is null) from a validated menu release. A flavor option priced at zero takes the size
 * price, or the product price without sizes; an option is selectable only while both its group and
 * the option are active. A half built ingredient by ingredient costs the same base price and is
 * offered only when the setup has an ingredient group.
 */
export function catalogVariantToFractionVariant(
  catalog: ValidatedMenuCatalog,
  productId: string,
  variantId: string | null,
): FractionPricingVariant {
  const product = catalog.products.find(({ id }) => id === productId);
  if (product === undefined) throw new MenuProductNotFoundError(productId);
  const variant = variantId === null ? undefined : (product.variants ?? []).find(({ id }) => id === variantId);
  if (variantId !== null && variant === undefined) throw new MenuProductVariantNotFoundError(productId, variantId);
  const config = effectiveFractionConfig(product, variant);
  const basePriceMinor = (variant?.unitPrice ?? product.unitPrice).amountMinor;
  if (config === undefined || !config.enabled || config.flavorGroupId === null) {
    throw new MenuFractionSelectionInvalidError(productId, ["fraction_not_enabled"]);
  }
  const groupsById = new Map(catalog.modifierGroups.map((group) => [group.id, group]));
  const flavorGroup = groupsById.get(config.flavorGroupId);
  if (flavorGroup === undefined) throw new MenuProductModifierGroupNotFoundError(productId, config.flavorGroupId);
  const extraGroup = config.extraGroupId === null ? undefined : groupsById.get(config.extraGroupId);
  if (config.extraGroupId !== null && extraGroup === undefined) {
    throw new MenuProductModifierGroupNotFoundError(productId, config.extraGroupId);
  }
  const sku = variant?.sku ?? product.sku;
  return deepFreeze({
    active: (variant?.active ?? true) && product.active,
    catalogVersion: product.catalogVersion,
    comboSlots: [],
    currency: catalog.currency,
    ...(config.extraGroupId === null ? {} : { customHalfPriceMinor: basePriceMinor }),
    extras: (extraGroup?.options ?? []).map((option) => ({
      active: extraGroup!.active && option.active,
      name: option.name,
      optionId: option.id,
      priceMinor: option.unitPrice.amountMinor,
    })),
    flavors: flavorGroup.options.map((option) => ({
      active: flavorGroup.active && option.active,
      name: option.name,
      optionId: option.id,
      priceMinor: option.unitPrice.amountMinor === 0 ? basePriceMinor : option.unitPrice.amountMinor,
    })),
    includedIngredients: config.excludableIngredientIds.map((label) => ({ ingredientId: label, name: label })),
    name: product.name,
    productId: product.id,
    restaurantId: catalog.restaurantId,
    ...(sku === undefined ? {} : { sku }),
    stationId: product.stationId,
    ...(product.tax === undefined ? {} : { tax: product.tax }),
    unit: product.unit,
    // A product without sizes uses its own id as the (internal) size id of the pricing view.
    variantId: variant?.id ?? product.id,
  });
}

function normalizeMenuCatalog(value: unknown): MenuCatalog {
  const catalog = asPlainRecord(value, "menu catalog");
  const restaurantId = ownData(catalog, "restaurantId", "menu restaurantId");
  const catalogVersion = ownData(catalog, "catalogVersion", "menu catalogVersion");
  const currency = ownData(catalog, "currency", "menu currency");
  const categories = ownDataArray(catalog, "categories", "menu categories").map(normalizeMenuCategory);
  const products = ownDataArray(catalog, "products", "menu products").map(normalizeMenuProduct);
  const modifierGroups = ownDataArray(catalog, "modifierGroups", "menu modifierGroups")
    .map((group) => validateModifierGroupCatalog(group as ModifierGroupCatalog));
  return deepFreeze({
    restaurantId: restaurantId as string,
    catalogVersion: catalogVersion as string,
    currency: currency as string,
    categories,
    products,
    modifierGroups,
  });
}

function normalizeMenuCategory(value: unknown): MenuCategoryCatalog {
  const category = asPlainRecord(value, "menu category");
  return Object.freeze({
    id: ownData(category, "id", "menu category id") as string,
    restaurantId: ownData(category, "restaurantId", "menu category restaurantId") as string,
    catalogVersion: ownData(category, "catalogVersion", "menu category catalogVersion") as string,
    name: ownData(category, "name", "menu category name") as string,
    active: ownData(category, "active", "menu category active") as boolean,
    displayOrder: ownData(category, "displayOrder", "menu category displayOrder") as number,
  });
}

function normalizeMenuProduct(value: unknown): MenuProductCatalog {
  const product = asPlainRecord(value, "menu product");
  const id = ownData(product, "id", "menu product id");
  const restaurantId = ownData(product, "restaurantId", "menu product restaurantId");
  const catalogVersion = ownData(product, "catalogVersion", "menu product catalogVersion");
  const categoryId = ownData(product, "categoryId", "menu product categoryId");
  const name = ownData(product, "name", "menu product name");
  const sku = optionalOwnData(product, "sku", "menu product sku");
  const active = ownData(product, "active", "menu product active");
  const displayOrder = ownData(product, "displayOrder", "menu product displayOrder");
  const stationId = ownData(product, "stationId", "menu product stationId");
  const unit = ownData(product, "unit", "menu product unit");
  const tax = optionalOwnData(product, "tax", "menu product tax");
  const modifierGroupIds = ownDataArray(product, "modifierGroupIds", "menu product modifierGroupIds")
    .map((groupId) => groupId as string);
  const variantsValue = optionalOwnData(product, "variants", "menu product variants");
  const variants = variantsValue === undefined
    ? []
    : asDataArray(variantsValue, "menu product variants").map(normalizeMenuProductVariant);
  const fractionValue = optionalOwnData(product, "fraction", "menu product fraction");
  const normalizedSnapshot = calculateOrderItemTotals({
    orderItemId: id as string,
    quantity: 1,
    snapshot: {
      catalogVersion: catalogVersion as string,
      productId: id as string,
      name: name as string,
      ...(sku === undefined ? {} : { sku: sku as string }),
      stationId: stationId as string,
      unit: unit as string,
      unitPrice: normalizeMoney(ownData(product, "unitPrice", "menu product unit price"), "menu product unit price"),
      modifiers: [],
      ...(tax === undefined ? {} : { tax: tax as TaxSnapshot }),
    },
  }).input.snapshot;
  return deepFreeze({
    id: normalizedSnapshot.productId,
    restaurantId: restaurantId as string,
    catalogVersion: normalizedSnapshot.catalogVersion,
    categoryId: categoryId as string,
    name: normalizedSnapshot.name,
    ...(normalizedSnapshot.sku === undefined ? {} : { sku: normalizedSnapshot.sku }),
    active: active as boolean,
    displayOrder: displayOrder as number,
    stationId: normalizedSnapshot.stationId,
    unit: normalizedSnapshot.unit,
    unitPrice: normalizedSnapshot.unitPrice,
    ...(normalizedSnapshot.tax === undefined ? {} : { tax: normalizedSnapshot.tax }),
    modifierGroupIds,
    ...(variants.length === 0 ? {} : { variants }),
    ...(fractionValue === undefined ? {} : { fraction: normalizeFractionConfig(fractionValue) }),
  });
}

function normalizeMenuProductVariant(value: unknown): MenuProductVariantCatalog {
  const variant = asPlainRecord(value, "menu product variant");
  const sku = optionalOwnData(variant, "sku", "menu product variant sku");
  const fractionValue = optionalOwnData(variant, "fraction", "menu product variant fraction");
  return Object.freeze({
    id: ownData(variant, "id", "menu product variant id") as string,
    name: ownData(variant, "name", "menu product variant name") as string,
    ...(sku === undefined ? {} : { sku: sku as string }),
    active: ownData(variant, "active", "menu product variant active") as boolean,
    displayOrder: ownData(variant, "displayOrder", "menu product variant displayOrder") as number,
    unitPrice: normalizeMoney(ownData(variant, "unitPrice", "menu product variant unit price"), "menu product variant unit price"),
    ...(fractionValue === undefined ? {} : { fraction: normalizeFractionConfig(fractionValue) }),
  });
}

function normalizeFractionConfig(value: unknown): MenuVariantFractionConfig {
  const config = asPlainRecord(value, "menu variant fraction");
  return Object.freeze({
    enabled: ownData(config, "enabled", "menu variant fraction enabled") as boolean,
    flavorGroupId: ownData(config, "flavorGroupId", "menu variant fraction flavorGroupId") as string | null,
    extraGroupId: ownData(config, "extraGroupId", "menu variant fraction extraGroupId") as string | null,
    excludableIngredientIds: Object.freeze(
      ownDataArray(config, "excludableIngredientIds", "menu variant fraction excludableIngredientIds").map((id) => id as string),
    ),
  });
}

function validateFractionConfig(
  config: MenuVariantFractionConfig,
  productGroupIds: readonly string[],
): MenuVariantFractionConfig {
  assertBoolean(config.enabled, "menu variant fraction enabled");
  for (const [field, groupId] of [["flavorGroupId", config.flavorGroupId], ["extraGroupId", config.extraGroupId]] as const) {
    if (groupId === null) continue;
    assertText(groupId, `menu variant fraction ${field}`);
    if (!productGroupIds.includes(groupId)) throw new InvalidSnapshotError(`menu variant fraction ${field}`);
  }
  if (config.enabled && config.flavorGroupId === null) throw new InvalidSnapshotError("menu variant fraction flavorGroupId");
  if (config.flavorGroupId !== null && config.flavorGroupId === config.extraGroupId) {
    throw new InvalidSnapshotError("menu variant fraction groups");
  }
  const labels = new Set<string>();
  for (const label of config.excludableIngredientIds) {
    assertText(label, "menu variant fraction excludableIngredientId");
    if (labels.has(label)) throw new InvalidSnapshotError("menu variant fraction excludableIngredientIds");
    labels.add(label);
  }
  return Object.freeze({
    enabled: config.enabled,
    excludableIngredientIds: Object.freeze([...config.excludableIngredientIds]),
    extraGroupId: config.extraGroupId,
    flavorGroupId: config.flavorGroupId,
  });
}

function normalizeMenuFractionSelection(value: unknown): MenuFractionSelection {
  const selection = asPlainRecord(value, "menu fraction selection");
  const geometry = ownData(selection, "geometry", "menu fraction geometry");
  if (geometry !== "halves") throw new InvalidSnapshotError("menu fraction geometry");
  return deepFreeze({
    geometry: "halves" as const,
    slots: ownDataArray(selection, "slots", "menu fraction slots").map((entry) => {
      const slot = asPlainRecord(entry, "menu fraction slot");
      return {
        excludedIngredientIds: ownDataArray(slot, "excludedIngredientIds", "menu fraction excludedIngredientIds").map((id) => id as string),
        extraOptionIds: ownDataArray(slot, "extraOptionIds", "menu fraction extraOptionIds").map((id) => id as string),
        flavorOptionId: ownData(slot, "flavorOptionId", "menu fraction flavorOptionId") as string | null,
        fraction: ownData(slot, "fraction", "menu fraction fraction") as MenuFractionSlotSelection["fraction"],
      };
    }),
  });
}

function normalizeMenuProductSelectionContext(value: unknown): MenuProductSelectionContext {
  const context = asPlainRecord(value, "menu product selection context");
  const fractionValue = optionalOwnData(context, "fraction", "selected menu fraction");
  return Object.freeze({
    restaurantId: ownData(context, "restaurantId", "selected menu restaurantId") as string,
    productId: ownData(context, "productId", "selected menu productId") as string,
    currency: ownData(context, "currency", "selected menu currency") as string,
    variantId: optionalOwnData(context, "variantId", "selected menu variantId") as string | null | undefined,
    fraction: fractionValue === undefined || fractionValue === null ? null : normalizeMenuFractionSelection(fractionValue),
  });
}

function normalizeMenuModifierGroupSelections(value: unknown): readonly MenuModifierGroupSelection[] {
  return asDataArray(value, "menu modifier group selections").map((entry) => {
    const selection = asPlainRecord(entry, "menu modifier group selection");
    const optionSelections = ownDataArray(selection, "selections", "menu modifier option selections").map((item) => {
      const option = asPlainRecord(item, "menu modifier option selection");
      return Object.freeze({
        optionId: ownData(option, "optionId", "selected modifier option id") as string,
        quantity: ownData(option, "quantity", "selected modifier quantity") as number,
      });
    });
    return deepFreeze({
      groupId: ownData(selection, "groupId", "selected modifier group id") as string,
      selections: optionSelections,
    });
  });
}

function normalizeMoney(value: unknown, field: string): Money {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Money.prototype) {
    throw new InvalidSnapshotError(field);
  }
  const record = value as Record<string, unknown>;
  return new Money(
    ownData(record, "amountMinor", `${field} amountMinor`) as number,
    ownData(record, "currency", `${field} currency`) as string,
  );
}

function asPlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidSnapshotError(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidSnapshotError(field);
  return value as Record<string, unknown>;
}

function ownData(record: Record<string, unknown>, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidSnapshotError(field);
  return descriptor.value;
}

function optionalOwnData(record: Record<string, unknown>, key: string, field: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new InvalidSnapshotError(field);
  return descriptor.value;
}

function ownDataArray(record: Record<string, unknown>, key: string, field: string): readonly unknown[] {
  return asDataArray(ownData(record, key, field), field);
}

function asDataArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new InvalidSnapshotError(field);
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) {
    throw new InvalidSnapshotError(field);
  }
  const items: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    items.push(ownData(value as unknown as Record<string, unknown>, String(index), field));
  }
  return items;
}

function assertText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new InvalidSnapshotError(field);
}

function assertBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") throw new InvalidSnapshotError(field);
}

function assertDisplayOrder(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new InvalidSnapshotError(field);
}

function compareMenuDisplayOrder(
  left: { readonly id: string; readonly displayOrder: number },
  right: { readonly id: string; readonly displayOrder: number },
): number {
  return left.displayOrder - right.displayOrder || compareCodeUnits(left.id, right.id);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertCurrencyMatches(expected: string, actual: Money): void {
  if (actual.currency !== expected) throw new CurrencyMismatchError(expected, actual.currency);
}

function atMenuBoundary<T>(field: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new InvalidSnapshotError(field);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
