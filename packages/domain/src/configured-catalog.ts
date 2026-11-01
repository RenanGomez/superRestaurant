import { DomainError, InvalidSnapshotError } from "./errors.js";
import type { MenuCategoryCatalog } from "./menu.js";
import {
  validateModifierGroupTemplateCatalog,
  type ModifierGroupTemplateCatalog,
  type ValidatedModifierGroupTemplateCatalog,
} from "./modifier-templates.js";
import { Money } from "./money.js";
import { validateTaxSnapshot, type TaxSnapshot } from "./order-totals.js";
import {
  instantiateProductVariantCatalog,
  type InstantiatedProductVariantCatalog,
  type ProductVariantCatalog,
} from "./product-variants.js";

export interface ConfiguredProductCatalog {
  readonly id: string;
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly categoryId: string;
  readonly name: string;
  readonly active: boolean;
  readonly displayOrder: number;
  /** Product-level fiscal rule inherited by every variant in this release. */
  readonly tax?: TaxSnapshot;
  /** Ordered allowlist; every published variant belongs to exactly one product. */
  readonly variantIds: readonly string[];
}

/** V2 release authority; V1 remains readable but is not embedded or mutated. */
export interface ConfiguredCatalogRelease {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly categories: readonly MenuCategoryCatalog[];
  readonly products: readonly ConfiguredProductCatalog[];
  readonly modifierTemplates: readonly ModifierGroupTemplateCatalog[];
  readonly variants: readonly ProductVariantCatalog[];
}

export interface ValidatedConfiguredCatalogRelease {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly categories: readonly Readonly<MenuCategoryCatalog>[];
  readonly products: readonly Readonly<ConfiguredProductCatalog>[];
  readonly modifierTemplates: readonly ValidatedModifierGroupTemplateCatalog[];
  readonly variants: readonly InstantiatedProductVariantCatalog[];
}

export function validateConfiguredCatalogRelease(
  value: ConfiguredCatalogRelease,
): ValidatedConfiguredCatalogRelease {
  return atConfiguredCatalogBoundary("configured catalog release", () => {
    const release = normalizeRelease(value);
    assertText(release.restaurantId, "configured catalog restaurantId");
    assertText(release.catalogVersion, "configured catalog version");
    const currency = new Money(0, release.currency).currency;
    const categories = validateCategories(release);
    const products = validateProducts(release, new Set(categories.map((category) => category.id)));
    const templates = validateTemplates(release);
    const variants = validateVariants(release, products, templates, currency);
    assertProductVariantGraph(products, variants);
    return deepFreeze({
      catalogVersion: release.catalogVersion,
      categories,
      currency,
      modifierTemplates: templates,
      products,
      restaurantId: release.restaurantId,
      variants,
    });
  });
}

function validateCategories(release: ConfiguredCatalogRelease): readonly Readonly<MenuCategoryCatalog>[] {
  const ids = new Set<string>();
  return release.categories.map((category) => {
    assertText(category.id, "configured category id");
    assertText(category.name, "configured category name");
    assertBoolean(category.active, "configured category active");
    assertDisplayOrder(category.displayOrder, "configured category displayOrder");
    if (
      ids.has(category.id)
      || category.restaurantId !== release.restaurantId
      || category.catalogVersion !== release.catalogVersion
    ) throw new InvalidSnapshotError("configured category scope");
    ids.add(category.id);
    return Object.freeze({ ...category });
  }).sort(compareDisplayOrder);
}

function validateProducts(
  release: ConfiguredCatalogRelease,
  categoryIds: ReadonlySet<string>,
): readonly Readonly<ConfiguredProductCatalog>[] {
  const ids = new Set<string>();
  return release.products.map((product) => {
    assertText(product.id, "configured product id");
    assertText(product.categoryId, "configured product categoryId");
    assertText(product.name, "configured product name");
    assertBoolean(product.active, "configured product active");
    assertDisplayOrder(product.displayOrder, "configured product displayOrder");
    const variantIds = validateUniqueIds(product.variantIds, "configured product variantId");
    if (
      ids.has(product.id)
      || !categoryIds.has(product.categoryId)
      || product.restaurantId !== release.restaurantId
      || product.catalogVersion !== release.catalogVersion
      || variantIds.length === 0
    ) throw new InvalidSnapshotError("configured product release");
    ids.add(product.id);
    return deepFreeze({ ...product, variantIds });
  }).sort(compareDisplayOrder);
}

function validateTemplates(
  release: ConfiguredCatalogRelease,
): readonly ValidatedModifierGroupTemplateCatalog[] {
  const ids = new Set<string>();
  return release.modifierTemplates.map((value) => {
    const template = validateModifierGroupTemplateCatalog(value);
    if (
      ids.has(template.id)
      || template.restaurantId !== release.restaurantId
      || template.catalogVersion !== release.catalogVersion
    ) throw new InvalidSnapshotError("configured template release");
    ids.add(template.id);
    return template;
  });
}

function validateVariants(
  release: ConfiguredCatalogRelease,
  products: readonly Readonly<ConfiguredProductCatalog>[],
  templates: readonly ValidatedModifierGroupTemplateCatalog[],
  currency: string,
): readonly InstantiatedProductVariantCatalog[] {
  const productIds = new Set(products.map((product) => product.id));
  const ids = new Set<string>();
  const skus = new Set<string>();
  return release.variants.map((value) => {
    const variant = instantiateProductVariantCatalog(templates, value);
    if (
      ids.has(variant.id)
      || !productIds.has(variant.productId)
      || variant.restaurantId !== release.restaurantId
      || variant.catalogVersion !== release.catalogVersion
    ) throw new InvalidSnapshotError("configured variant release");
    ids.add(variant.id);
    if (variant.sku !== undefined) {
      if (skus.has(variant.sku)) throw new InvalidSnapshotError("configured variant sku");
      skus.add(variant.sku);
    }
    new Money(0, currency).add(variant.unitPrice);
    // Shared modifier groups may be bound by several variants; `instantiateProductVariantCatalog`
    // already rejects a group id repeated inside one variant.
    const variantGroupIds = new Set<string>();
    for (const group of variant.modifierGroups) {
      if (variantGroupIds.has(group.id)) throw new InvalidSnapshotError("configured modifier group id");
      variantGroupIds.add(group.id);
    }
    return variant;
  }).sort(compareDisplayOrder);
}

function assertProductVariantGraph(
  products: readonly Readonly<ConfiguredProductCatalog>[],
  variants: readonly InstantiatedProductVariantCatalog[],
): void {
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  const listed = new Set<string>();
  for (const product of products) {
    for (const variantId of product.variantIds) {
      const variant = variantsById.get(variantId);
      if (variant === undefined || variant.productId !== product.id || listed.has(variantId)) {
        throw new InvalidSnapshotError("configured product variant graph");
      }
      listed.add(variantId);
    }
  }
  if (listed.size !== variants.length) throw new InvalidSnapshotError("configured product variant graph");
}

function normalizeRelease(value: unknown): ConfiguredCatalogRelease {
  const record = asPlainRecord(value, "configured catalog release");
  return Object.freeze({
    catalogVersion: ownData(record, "catalogVersion", "configured catalog version") as string,
    categories: Object.freeze(ownDataArray(record, "categories", "configured categories").map(normalizeCategory)),
    currency: ownData(record, "currency", "configured catalog currency") as string,
    modifierTemplates: Object.freeze([
      ...ownDataArray(record, "modifierTemplates", "configured modifier templates"),
    ]) as readonly ModifierGroupTemplateCatalog[],
    products: Object.freeze(ownDataArray(record, "products", "configured products").map(normalizeProduct)),
    restaurantId: ownData(record, "restaurantId", "configured catalog restaurantId") as string,
    variants: Object.freeze([...ownDataArray(record, "variants", "configured variants")]) as readonly ProductVariantCatalog[],
  });
}

function normalizeCategory(value: unknown): MenuCategoryCatalog {
  const record = asPlainRecord(value, "configured category");
  return Object.freeze({
    active: ownData(record, "active", "configured category active") as boolean,
    catalogVersion: ownData(record, "catalogVersion", "configured category catalogVersion") as string,
    displayOrder: ownData(record, "displayOrder", "configured category displayOrder") as number,
    id: ownData(record, "id", "configured category id") as string,
    name: ownData(record, "name", "configured category name") as string,
    restaurantId: ownData(record, "restaurantId", "configured category restaurantId") as string,
  });
}

function normalizeProduct(value: unknown): ConfiguredProductCatalog {
  const record = asPlainRecord(value, "configured product");
  const tax = optionalOwnData(record, "tax", "configured product tax");
  return deepFreeze({
    active: ownData(record, "active", "configured product active") as boolean,
    catalogVersion: ownData(record, "catalogVersion", "configured product catalogVersion") as string,
    categoryId: ownData(record, "categoryId", "configured product categoryId") as string,
    displayOrder: ownData(record, "displayOrder", "configured product displayOrder") as number,
    id: ownData(record, "id", "configured product id") as string,
    name: ownData(record, "name", "configured product name") as string,
    restaurantId: ownData(record, "restaurantId", "configured product restaurantId") as string,
    ...(tax === undefined ? {} : { tax: validateTaxSnapshot(tax as TaxSnapshot) }),
    variantIds: ownDataArray(record, "variantIds", "configured product variantIds") as readonly string[],
  });
}

function validateUniqueIds(values: readonly string[], field: string): readonly string[] {
  const ids = new Set<string>();
  return Object.freeze(values.map((value) => {
    assertText(value, field);
    if (ids.has(value)) throw new InvalidSnapshotError(field);
    ids.add(value);
    return value;
  }));
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

function assertText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InvalidSnapshotError(field);
  }
}

function assertBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") throw new InvalidSnapshotError(field);
}

function assertDisplayOrder(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new InvalidSnapshotError(field);
}

function compareDisplayOrder(
  left: { readonly id: string; readonly displayOrder: number },
  right: { readonly id: string; readonly displayOrder: number },
): number {
  return left.displayOrder - right.displayOrder || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function atConfiguredCatalogBoundary<T>(field: string, operation: () => T): T {
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
