import {
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
  ModifierGroupOptionsRequiredError,
  ModifierGroupProductMismatchError,
  ModifierGroupRestaurantMismatchError,
  ModifierOptionMaximumExceededError,
  ModifierOptionNotInGroupError,
  NegativeMoneyAmountError,
} from "./errors.js";
import { Money } from "./money.js";
import type { ModifierPriceSnapshot } from "./order-totals.js";

/** A catalog group whose bounds apply to the sum of all selected option quantities. */
export interface ModifierGroupCatalog {
  readonly id: string;
  /** Restaurant that owns this catalog group; branch locality is not assumed. */
  readonly restaurantId: string;
  readonly name: string;
  /** Version of the allowlist from which this group was resolved. */
  readonly catalogVersion: string;
  /** Product that alone is permitted to use this group. */
  readonly productId: string;
  readonly active: boolean;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
  readonly options: readonly ModifierOptionCatalog[];
}

/** A catalog option. The optional cap handles items such as "at most two extra shots". */
export interface ModifierOptionCatalog {
  readonly id: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly active: boolean;
  readonly maximumQuantity?: number;
}

/** One selected catalog option. Repeating an option is forbidden; increase quantity instead. */
export interface ModifierOptionSelection {
  readonly optionId: string;
  readonly quantity: number;
}

export interface ModifierSelectionContext {
  readonly restaurantId: string;
  readonly productId: string;
}

/** A validated, detached catalog value safe to keep only for the duration of selection. */
export interface ValidatedModifierGroupCatalog {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly catalogVersion: string;
  readonly productId: string;
  readonly active: boolean;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
  readonly options: readonly Readonly<ModifierOptionCatalog>[];
}

/** A group-identified modifier snapshot structurally assignable to `ModifierPriceSnapshot`. */
export interface ModifierSelectionPriceSnapshot extends ModifierPriceSnapshot {
  readonly groupId: string;
  readonly groupName: string;
  readonly groupCatalogVersion: string;
}

/** Immutable price facts suitable for `OrderItemPriceSnapshot.modifiers`. */
export interface ModifierSelectionSnapshot {
  readonly groupId: string;
  readonly groupName: string;
  readonly groupCatalogVersion: string;
  readonly modifiers: readonly ModifierSelectionPriceSnapshot[];
  readonly total: Money;
}

/**
 * Validates and detaches a modifier catalog. A group must have an option so its
 * currency can be unambiguous; every option price must use that same currency.
 */
export function validateModifierGroupCatalog(group: ModifierGroupCatalog): ValidatedModifierGroupCatalog {
  assertText(group.id, "modifier group id");
  assertText(group.restaurantId, "modifier group restaurantId");
  assertText(group.name, "modifier group name");
  assertText(group.catalogVersion, "modifier group catalogVersion");
  assertText(group.productId, "modifier group productId");
  assertBoolean(group.active, "modifier group active");
  assertBounds(group);
  if (group.options.length === 0) {
    throw new ModifierGroupOptionsRequiredError(group.id);
  }

  const optionIds = new Set<string>();
  let currency: string | undefined;
  const options = group.options.map((option) => {
    assertText(option.id, "modifier option id");
    assertText(option.name, "modifier option name");
    assertBoolean(option.active, "modifier option active");
    if (optionIds.has(option.id)) {
      throw new DuplicateModifierOptionIdError(group.id, option.id);
    }
    optionIds.add(option.id);

    if (option.maximumQuantity !== undefined && (!Number.isSafeInteger(option.maximumQuantity) || option.maximumQuantity <= 0)) {
      throw new InvalidModifierOptionMaximumError(option.id, option.maximumQuantity);
    }

    const unitPrice = new Money(option.unitPrice.amountMinor, option.unitPrice.currency);
    if (unitPrice.amountMinor < 0) {
      throw new NegativeMoneyAmountError("modifier unit price");
    }
    if (currency === undefined) {
      currency = unitPrice.currency;
    } else {
      new Money(0, currency).add(unitPrice);
    }

    return Object.freeze({
      id: option.id,
      name: option.name,
      unitPrice,
      active: option.active,
      ...(option.maximumQuantity === undefined ? {} : { maximumQuantity: option.maximumQuantity }),
    });
  });

  return deepFreeze({
    id: group.id,
    restaurantId: group.restaurantId,
    name: group.name,
    catalogVersion: group.catalogVersion,
    productId: group.productId,
    active: group.active,
    minimumQuantity: group.minimumQuantity,
    maximumQuantity: group.maximumQuantity,
    options,
  });
}

/**
 * Resolves a selection from one catalog group into deeply immutable historical
 * option-price snapshots. The returned `modifiers` can be assigned directly to
 * an `OrderItemPriceSnapshot`; all arithmetic stays in Money minor units.
 * Modifier prices carry no individual tax rule: the immutable product/order-item
 * tax snapshot governs their treatment when totals are calculated.
 */
export function createModifierSelectionSnapshot(
  group: ModifierGroupCatalog,
  context: ModifierSelectionContext,
  selections: readonly ModifierOptionSelection[],
): ModifierSelectionSnapshot {
  const catalog = validateModifierGroupCatalog(group);
  assertText(context.restaurantId, "selected restaurant id");
  assertText(context.productId, "selected product id");
  if (catalog.restaurantId !== context.restaurantId) {
    throw new ModifierGroupRestaurantMismatchError(catalog.id, catalog.restaurantId, context.restaurantId);
  }
  if (catalog.productId !== context.productId) {
    throw new ModifierGroupProductMismatchError(catalog.id, catalog.productId, context.productId);
  }
  if (!catalog.active) {
    throw new InactiveModifierGroupError(catalog.id);
  }
  const optionsById = new Map(catalog.options.map((option) => [option.id, option]));
  const selectedIds = new Set<string>();

  const resolved = selections.map((selection) => {
    assertText(selection.optionId, "selected modifier option id");
    assertPositiveQuantity(selection.quantity);
    if (selectedIds.has(selection.optionId)) {
      throw new DuplicateModifierSelectionError(catalog.id, selection.optionId);
    }
    selectedIds.add(selection.optionId);

    const option = optionsById.get(selection.optionId);
    if (option === undefined) {
      throw new ModifierOptionNotInGroupError(catalog.id, selection.optionId);
    }
    if (!option.active) {
      throw new InactiveModifierOptionError(catalog.id, option.id);
    }
    if (option.maximumQuantity !== undefined && selection.quantity > option.maximumQuantity) {
      throw new ModifierOptionMaximumExceededError(catalog.id, option.id, option.maximumQuantity, selection.quantity);
    }

    return { option, quantity: selection.quantity };
  });

  const selectedQuantity = resolved.reduce((total, selection) => total + BigInt(selection.quantity), 0n);
  if (selectedQuantity < BigInt(catalog.minimumQuantity)) {
    throw new ModifierGroupMinimumNotMetError(catalog.id, catalog.minimumQuantity, selectedQuantity);
  }
  if (selectedQuantity > BigInt(catalog.maximumQuantity)) {
    throw new ModifierGroupMaximumExceededError(catalog.id, catalog.maximumQuantity, selectedQuantity);
  }

  const modifiers = resolved
    .sort((left, right) => compareCodeUnits(left.option.id, right.option.id))
    .map(({ option, quantity }) => Object.freeze({
      groupId: catalog.id,
      groupName: catalog.name,
      groupCatalogVersion: catalog.catalogVersion,
      modifierId: option.id,
      name: option.name,
      unitPrice: new Money(option.unitPrice.amountMinor, option.unitPrice.currency),
      quantity,
    }));
  const total = modifiers.reduce(
    (sum, modifier) => sum.add(modifier.unitPrice.multiplyRatio(BigInt(modifier.quantity), 1n)),
    new Money(0, catalog.options[0]!.unitPrice.currency),
  );

  return deepFreeze({
    groupId: catalog.id,
    groupName: catalog.name,
    groupCatalogVersion: catalog.catalogVersion,
    modifiers,
    total,
  });
}

function assertBounds(group: ModifierGroupCatalog): void {
  if (
    !Number.isSafeInteger(group.minimumQuantity)
    || !Number.isSafeInteger(group.maximumQuantity)
    || group.minimumQuantity < 0
    || group.maximumQuantity < 0
    || group.minimumQuantity > group.maximumQuantity
  ) {
    throw new InvalidModifierGroupBoundsError(group.id, group.minimumQuantity, group.maximumQuantity);
  }
}

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new InvalidQuantityError(quantity);
  }
}

function assertText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidSnapshotError(field);
  }
}

function assertBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") {
    throw new InvalidSnapshotError(field);
  }
}

function compareCodeUnits(left: string, right: string): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) {
      deepFreeze(child, seen);
    }
    Object.freeze(value);
  }
  return value;
}
