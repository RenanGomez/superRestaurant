import {
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
    const product = productsById.get(group.productId);
    if (product === undefined) throw new MenuProductModifierGroupNotFoundError(group.productId, group.id);
    if (!product.modifierGroupIds.includes(group.id)) {
      throw new MenuModifierGroupNotAllowedError(product.id, group.id);
    }
    for (const option of group.options) assertCurrencyMatches(catalogCurrency, option.unitPrice);
    return group;
  });

  const groupsById = new Map(modifierGroups.map((group) => [group.id, group]));
  for (const product of products) {
    for (const groupId of product.modifierGroupIds) {
      const group = groupsById.get(groupId);
      if (group === undefined) throw new MenuProductModifierGroupNotFoundError(product.id, groupId);
      if (group.productId !== product.id) {
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

  const selectionsByGroup = new Map<string, readonly ModifierOptionSelection[]>();
  for (const selection of selections) {
    assertText(selection.groupId, "selected modifier group id");
    if (selectionsByGroup.has(selection.groupId)) {
      throw new DuplicateMenuModifierGroupSelectionError(selection.groupId);
    }
    if (!product.modifierGroupIds.includes(selection.groupId)) {
      throw new MenuModifierGroupNotAllowedError(product.id, selection.groupId);
    }
    selectionsByGroup.set(selection.groupId, selection.selections);
  }

  const groupsById = new Map(catalog.modifierGroups.map((group) => [group.id, group]));
  const modifiers = product.modifierGroupIds.flatMap((groupId) => {
    const group = groupsById.get(groupId);
    if (group === undefined) throw new MenuProductModifierGroupNotFoundError(product.id, groupId);
    return createModifierSelectionSnapshot(
      group,
      { restaurantId: context.restaurantId, productId: product.id },
      selectionsByGroup.get(groupId) ?? [],
    ).modifiers;
  });

  return calculateOrderItemTotals({
    orderItemId: product.id,
    quantity: 1,
    snapshot: {
      catalogVersion: product.catalogVersion,
      productId: product.id,
      name: product.name,
      ...(product.sku === undefined ? {} : { sku: product.sku }),
      stationId: product.stationId,
      unit: product.unit,
      unitPrice: product.unitPrice,
      modifiers,
      ...(product.tax === undefined ? {} : { tax: product.tax }),
    },
  }).input.snapshot;
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
  });
}

function normalizeMenuProductSelectionContext(value: unknown): MenuProductSelectionContext {
  const context = asPlainRecord(value, "menu product selection context");
  return Object.freeze({
    restaurantId: ownData(context, "restaurantId", "selected menu restaurantId") as string,
    productId: ownData(context, "productId", "selected menu productId") as string,
    currency: ownData(context, "currency", "selected menu currency") as string,
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
