import { DomainError, InvalidSnapshotError, NegativeMoneyAmountError } from "./errors.js";
import {
  resolveModifierConstraints,
  validateModifierConstraintCatalog,
  type ModifierConstraint,
  type ModifierConstraintCatalog,
  type ModifierConstraintResolution,
  type ValidatedModifierConstraintCatalog,
} from "./modifier-constraints.js";
import {
  instantiateModifierGroupTemplate,
  validateModifierGroupTemplateCatalog,
  type InstantiatedModifierGroupCatalog,
  type ModifierGroupTemplateBinding,
  type ModifierGroupTemplateCatalog,
  type ValidatedModifierGroupTemplateCatalog,
} from "./modifier-templates.js";
import { Money } from "./money.js";

export interface ProductVariantModifierGroupBinding {
  readonly templateId: string;
  readonly binding: ModifierGroupTemplateBinding;
}

/**
 * Decision-neutral variant facts. Fraction geometry and pricing policy are
 * deliberately absent until the business rules are approved.
 */
export interface ProductVariantCatalog {
  readonly id: string;
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly productId: string;
  readonly name: string;
  readonly sku?: string;
  readonly active: boolean;
  readonly displayOrder: number;
  readonly stationId: string;
  readonly recipeVersion: string;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly modifierGroups: readonly ProductVariantModifierGroupBinding[];
  readonly constraints: readonly ModifierConstraint[];
}

export interface InstantiatedProductVariantCatalog {
  readonly id: string;
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly productId: string;
  readonly name: string;
  readonly sku?: string;
  readonly active: boolean;
  readonly displayOrder: number;
  readonly stationId: string;
  readonly recipeVersion: string;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly modifierGroups: readonly InstantiatedModifierGroupCatalog[];
  readonly constraintCatalog: ValidatedModifierConstraintCatalog;
  readonly defaultConstraintResolution: ModifierConstraintResolution;
}

export function instantiateProductVariantCatalog(
  templateValues: readonly ModifierGroupTemplateCatalog[],
  variantValue: ProductVariantCatalog,
): InstantiatedProductVariantCatalog {
  return atVariantBoundary("product variant catalog", () => {
    const templates = normalizeTemplates(templateValues).map(validateModifierGroupTemplateCatalog);
    const variant = normalizeVariant(variantValue);
    validateVariantIdentity(variant);
    const templateById = validateTemplatesForVariant(templates, variant);
    const unitPrice = new Money(variant.unitPrice.amountMinor, variant.unitPrice.currency);
    if (unitPrice.amountMinor < 0) throw new NegativeMoneyAmountError("product variant unit price");

    const groupIds = new Set<string>();
    const modifierGroups = variant.modifierGroups.map(({ templateId, binding }) => {
      const template = templateById.get(templateId);
      if (template === undefined || binding.productId !== variant.productId || groupIds.has(binding.groupId)) {
        throw new InvalidSnapshotError("product variant modifier binding");
      }
      groupIds.add(binding.groupId);
      const group = instantiateModifierGroupTemplate(template, binding);
      for (const option of group.options) unitPrice.add(new Money(0, option.unitPrice.currency));
      return group;
    });

    const constraintCatalogValue: ModifierConstraintCatalog = {
      catalogVersion: variant.catalogVersion,
      constraints: variant.constraints,
      groups: modifierGroups.map((group) => ({
        groupId: group.id,
        optionIds: group.options.map((option) => option.id),
      })),
      restaurantId: variant.restaurantId,
    };
    const constraintCatalog = validateModifierConstraintCatalog(constraintCatalogValue);
    const defaultConstraintResolution = resolveModifierConstraints(constraintCatalog, {
      completedGroupIds: modifierGroups.map((group) => group.id),
      selectedOptions: modifierGroups.flatMap((group) => group.defaultSelections.map((selection) => ({
        groupId: group.id,
        optionId: selection.optionId,
      }))),
    });
    if (!defaultConstraintResolution.valid) {
      throw new InvalidSnapshotError("product variant default constraints");
    }

    return deepFreeze({
      active: variant.active,
      catalogVersion: variant.catalogVersion,
      constraintCatalog,
      defaultConstraintResolution,
      displayOrder: variant.displayOrder,
      id: variant.id,
      modifierGroups,
      name: variant.name,
      productId: variant.productId,
      recipeVersion: variant.recipeVersion,
      restaurantId: variant.restaurantId,
      ...(variant.sku === undefined ? {} : { sku: variant.sku }),
      stationId: variant.stationId,
      unit: variant.unit,
      unitPrice,
    });
  });
}

function validateVariantIdentity(variant: ProductVariantCatalog): void {
  assertText(variant.id, "product variant id");
  assertText(variant.restaurantId, "product variant restaurantId");
  assertText(variant.catalogVersion, "product variant catalogVersion");
  assertText(variant.productId, "product variant productId");
  assertText(variant.name, "product variant name");
  if (variant.sku !== undefined) assertText(variant.sku, "product variant sku");
  assertBoolean(variant.active, "product variant active");
  if (!Number.isSafeInteger(variant.displayOrder) || variant.displayOrder < 0) {
    throw new InvalidSnapshotError("product variant displayOrder");
  }
  assertText(variant.stationId, "product variant stationId");
  assertText(variant.recipeVersion, "product variant recipeVersion");
  assertText(variant.unit, "product variant unit");
}

function validateTemplatesForVariant(
  templates: readonly ValidatedModifierGroupTemplateCatalog[],
  variant: ProductVariantCatalog,
): ReadonlyMap<string, ValidatedModifierGroupTemplateCatalog> {
  const byId = new Map<string, ValidatedModifierGroupTemplateCatalog>();
  for (const template of templates) {
    if (
      byId.has(template.id)
      || template.restaurantId !== variant.restaurantId
      || template.catalogVersion !== variant.catalogVersion
    ) throw new InvalidSnapshotError("product variant template scope");
    byId.set(template.id, template);
  }
  return byId;
}

function normalizeTemplates(value: unknown): readonly ModifierGroupTemplateCatalog[] {
  return asDataArray(value, "product variant templates") as readonly ModifierGroupTemplateCatalog[];
}

function normalizeVariant(value: unknown): ProductVariantCatalog {
  const record = asPlainRecord(value, "product variant catalog");
  const sku = optionalOwnData(record, "sku", "product variant sku");
  return Object.freeze({
    active: ownData(record, "active", "product variant active") as boolean,
    catalogVersion: ownData(record, "catalogVersion", "product variant catalogVersion") as string,
    constraints: Object.freeze([...ownDataArray(record, "constraints", "product variant constraints")]) as readonly ModifierConstraint[],
    displayOrder: ownData(record, "displayOrder", "product variant displayOrder") as number,
    id: ownData(record, "id", "product variant id") as string,
    modifierGroups: Object.freeze(ownDataArray(record, "modifierGroups", "product variant modifier groups").map(normalizeBinding)),
    name: ownData(record, "name", "product variant name") as string,
    productId: ownData(record, "productId", "product variant productId") as string,
    recipeVersion: ownData(record, "recipeVersion", "product variant recipeVersion") as string,
    restaurantId: ownData(record, "restaurantId", "product variant restaurantId") as string,
    ...(sku === undefined ? {} : { sku: sku as string }),
    stationId: ownData(record, "stationId", "product variant stationId") as string,
    unit: ownData(record, "unit", "product variant unit") as string,
    unitPrice: normalizeMoney(ownData(record, "unitPrice", "product variant unitPrice")),
  });
}

function normalizeBinding(value: unknown): ProductVariantModifierGroupBinding {
  const record = asPlainRecord(value, "product variant modifier binding");
  return Object.freeze({
    binding: ownData(record, "binding", "product variant binding") as ModifierGroupTemplateBinding,
    templateId: ownData(record, "templateId", "product variant template id") as string,
  });
}

function normalizeMoney(value: unknown): Money {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Money.prototype) {
    throw new InvalidSnapshotError("product variant unitPrice");
  }
  const record = value as Record<string, unknown>;
  return new Money(
    ownData(record, "amountMinor", "product variant amountMinor") as number,
    ownData(record, "currency", "product variant currency") as string,
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

function optionalOwnData(record: Record<string, unknown>, key: string, field: string): unknown {
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
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InvalidSnapshotError(field);
  }
}

function assertBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") throw new InvalidSnapshotError(field);
}

function atVariantBoundary<T>(field: string, operation: () => T): T {
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
