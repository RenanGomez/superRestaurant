import {
  DomainError,
  InactiveMenuCategoryError,
  InactiveMenuProductError,
  InvalidSnapshotError,
  MenuProductNotFoundError,
} from "./errors.js";
import {
  validateConfiguredCatalogRelease,
  type ConfiguredCatalogRelease,
  type ValidatedConfiguredCatalogRelease,
} from "./configured-catalog.js";
import {
  resolveModifierConstraints,
  type ModifierConstraintIssue,
  type ModifierConstraintResolution,
} from "./modifier-constraints.js";
import {
  createModifierSelectionSnapshot,
  type ModifierOptionSelection,
  type ModifierSelectionSnapshot,
} from "./modifiers.js";
import { Money } from "./money.js";
import type { OrderItemPriceSnapshot, TaxSnapshot } from "./order-totals.js";

export interface ConfiguredModifierGroupSelection {
  readonly groupId: string;
  readonly selections: readonly ModifierOptionSelection[];
}

export interface ConfiguredProductSelectionInput {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly productId: string;
  readonly variantId: string;
  /** Omitted groups use their published defaults; an explicit empty group overrides a zero-minimum default. */
  readonly modifierGroups: readonly ConfiguredModifierGroupSelection[];
}

export interface ResolvedProductConfiguration {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly productId: string;
  readonly productName: string;
  readonly variantId: string;
  readonly variantName: string;
  readonly sku?: string;
  readonly stationId: string;
  readonly recipeVersion: string;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly tax?: TaxSnapshot;
  readonly modifierGroups: readonly ModifierSelectionSnapshot[];
  readonly modifierTotal: Money;
  readonly constraintResolution: ModifierConstraintResolution;
}

export type ProductConfigurationResolution =
  | {
      readonly valid: true;
      readonly configuration: ResolvedProductConfiguration;
      readonly issues: readonly [];
    }
  | {
      readonly valid: false;
      readonly configuration: ResolvedProductConfiguration;
      readonly issues: readonly ModifierConstraintIssue[];
    };

/** Existing price snapshot plus the V2 facts required to identify a variant recipe historically. */
export interface ConfiguredOrderItemPriceSnapshot extends OrderItemPriceSnapshot {
  readonly restaurantId: string;
  readonly variantId: string;
  readonly variantName: string;
  readonly recipeVersion: string;
}

export function resolveProductConfiguration(
  releaseValue: ConfiguredCatalogRelease,
  inputValue: ConfiguredProductSelectionInput,
): ProductConfigurationResolution {
  return atConfiguredSelectionBoundary("configured product selection", () => {
    const release = validateConfiguredCatalogRelease(releaseValue);
    const input = normalizeSelectionInput(inputValue);
    return resolveProductConfigurationCanonical(release, input);
  });
}

export function materializeConfiguredOrderItemSnapshot(
  releaseValue: ConfiguredCatalogRelease,
  inputValue: ConfiguredProductSelectionInput,
): ConfiguredOrderItemPriceSnapshot {
  return atConfiguredSelectionBoundary("configured order-item snapshot", () => {
    const resolution = resolveProductConfiguration(releaseValue, inputValue);
    if (!resolution.valid) throw new InvalidSnapshotError("configured selection constraints");
    const configuration = resolution.configuration;
    return deepFreeze({
      catalogVersion: configuration.catalogVersion,
      modifiers: configuration.modifierGroups.flatMap((group) => group.modifiers),
      name: configuration.productName,
      productId: configuration.productId,
      recipeVersion: configuration.recipeVersion,
      restaurantId: configuration.restaurantId,
      ...(configuration.sku === undefined ? {} : { sku: configuration.sku }),
      stationId: configuration.stationId,
      ...(configuration.tax === undefined ? {} : { tax: configuration.tax }),
      unit: configuration.unit,
      unitPrice: new Money(configuration.unitPrice.amountMinor, configuration.unitPrice.currency),
      variantId: configuration.variantId,
      variantName: configuration.variantName,
    });
  });
}

function resolveProductConfigurationCanonical(
  release: ValidatedConfiguredCatalogRelease,
  input: ConfiguredProductSelectionInput,
): ProductConfigurationResolution {
  if (input.restaurantId !== release.restaurantId || input.catalogVersion !== release.catalogVersion) {
    throw new InvalidSnapshotError("configured selection scope");
  }
  const product = release.products.find(({ id }) => id === input.productId);
  if (product === undefined) throw new MenuProductNotFoundError(input.productId);
  if (!product.active) throw new InactiveMenuProductError(product.id);
  const category = release.categories.find(({ id }) => id === product.categoryId);
  if (category === undefined) throw new InvalidSnapshotError("configured selection category");
  if (!category.active) throw new InactiveMenuCategoryError(category.id);
  const variant = release.variants.find(({ id }) => id === input.variantId);
  if (
    variant === undefined
    || variant.productId !== product.id
    || !product.variantIds.includes(variant.id)
    || !variant.active
  ) throw new InvalidSnapshotError("configured selection variant");

  const selectionsByGroup = new Map<string, readonly ModifierOptionSelection[]>();
  for (const groupSelection of input.modifierGroups) {
    if (selectionsByGroup.has(groupSelection.groupId)) {
      throw new InvalidSnapshotError("configured selection duplicate group");
    }
    selectionsByGroup.set(groupSelection.groupId, groupSelection.selections);
  }
  const knownGroupIds = new Set(variant.modifierGroups.map(({ id }) => id));
  if ([...selectionsByGroup.keys()].some((groupId) => !knownGroupIds.has(groupId))) {
    throw new InvalidSnapshotError("configured selection group");
  }

  let modifierTotal = new Money(0, release.currency);
  const modifierGroups = variant.modifierGroups.map((group) => {
    const selections = selectionsByGroup.get(group.id) ?? group.defaultSelections;
    const snapshot = createModifierSelectionSnapshot(group, {
      productId: product.id,
      restaurantId: release.restaurantId,
    }, selections);
    modifierTotal = modifierTotal.add(snapshot.total);
    return snapshot;
  });
  const constraintResolution = resolveModifierConstraints(variant.constraintCatalog, {
    completedGroupIds: modifierGroups.map(({ groupId }) => groupId),
    selectedOptions: modifierGroups.flatMap((group) => group.modifiers.map((modifier) => ({
      groupId: group.groupId,
      optionId: modifier.modifierId,
    }))),
  });
  const configuration = deepFreeze({
    catalogVersion: release.catalogVersion,
    constraintResolution,
    modifierGroups,
    modifierTotal,
    productId: product.id,
    productName: product.name,
    recipeVersion: variant.recipeVersion,
    restaurantId: release.restaurantId,
    ...(variant.sku === undefined ? {} : { sku: variant.sku }),
    stationId: variant.stationId,
    ...(product.tax === undefined ? {} : { tax: product.tax }),
    unit: variant.unit,
    unitPrice: new Money(variant.unitPrice.amountMinor, variant.unitPrice.currency),
    variantId: variant.id,
    variantName: variant.name,
  });
  if (!constraintResolution.valid) {
    return deepFreeze({ configuration, issues: constraintResolution.issues, valid: false as const });
  }
  return deepFreeze({ configuration, issues: [] as const, valid: true as const });
}

function normalizeSelectionInput(value: unknown): ConfiguredProductSelectionInput {
  const record = asPlainRecord(value, "configured selection");
  return deepFreeze({
    catalogVersion: ownText(record, "catalogVersion", "configured selection catalogVersion"),
    modifierGroups: ownDataArray(record, "modifierGroups", "configured selection groups").map(normalizeGroupSelection),
    productId: ownText(record, "productId", "configured selection productId"),
    restaurantId: ownText(record, "restaurantId", "configured selection restaurantId"),
    variantId: ownText(record, "variantId", "configured selection variantId"),
  });
}

function normalizeGroupSelection(value: unknown): ConfiguredModifierGroupSelection {
  const record = asPlainRecord(value, "configured group selection");
  return deepFreeze({
    groupId: ownText(record, "groupId", "configured group selection groupId"),
    selections: ownDataArray(record, "selections", "configured option selections").map((selection) => {
      const selectionRecord = asPlainRecord(selection, "configured option selection");
      return Object.freeze({
        optionId: ownText(selectionRecord, "optionId", "configured option selection optionId"),
        quantity: ownData(selectionRecord, "quantity", "configured option selection quantity") as number,
      });
    }),
  });
}

function asPlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidSnapshotError(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidSnapshotError(field);
  return value as Record<string, unknown>;
}

function ownText(record: Record<string, unknown>, key: string, field: string): string {
  const value = ownData(record, key, field);
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InvalidSnapshotError(field);
  }
  return value;
}

function ownData(record: Record<string, unknown>, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidSnapshotError(field);
  return descriptor.value;
}

function ownDataArray(record: Record<string, unknown>, key: string, field: string): readonly unknown[] {
  const value = ownData(record, key, field);
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

function atConfiguredSelectionBoundary<T>(field: string, operation: () => T): T {
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
