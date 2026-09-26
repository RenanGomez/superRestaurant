export const CONFIGURED_CATALOG_SCHEMA_VERSION = 2 as const;
export const CONFIGURED_SELECTION_SCHEMA_VERSION = 2 as const;

export interface ConfiguredCatalogCategoryV2 {
  readonly categoryId: string;
  readonly name: string;
  readonly active: boolean;
  readonly displayOrder: number;
}

export interface ConfiguredCatalogTaxV2 {
  readonly taxId: string;
  readonly name: string;
  readonly taxRuleVersion: string;
  readonly rateNumerator: number;
  readonly rateDenominator: number;
  readonly inclusion: "included" | "excluded";
}

export interface ConfiguredCatalogProductV2 {
  readonly productId: string;
  readonly categoryId: string;
  readonly name: string;
  readonly active: boolean;
  readonly displayOrder: number;
  readonly tax: ConfiguredCatalogTaxV2 | null;
  readonly variantIds: readonly string[];
}

export interface ConfiguredModifierTemplateOptionV2 {
  readonly optionId: string;
  readonly name: string;
  readonly active: boolean;
  readonly maximumQuantity: number | null;
}

export interface ConfiguredModifierTemplateV2 {
  readonly templateId: string;
  readonly name: string;
  readonly active: boolean;
  readonly options: readonly ConfiguredModifierTemplateOptionV2[];
}

export interface ConfiguredVariantOptionV2 {
  readonly optionId: string;
  readonly unitPriceMinor: number;
  readonly maximumQuantity: number | null;
  readonly defaultQuantity: number;
}

export interface ConfiguredVariantGroupV2 {
  readonly templateId: string;
  readonly groupId: string;
  readonly name: string;
  readonly active: boolean;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
  readonly options: readonly ConfiguredVariantOptionV2[];
}

export interface ConfiguredOptionReferenceV2 {
  readonly groupId: string;
  readonly optionId: string;
}

export type ConfiguredModifierConstraintV2 =
  | Readonly<{
      constraintId: string;
      kind: "requires" | "excludes" | "enables";
      source: ConfiguredOptionReferenceV2;
      target: ConfiguredOptionReferenceV2;
    }>
  | Readonly<{
      constraintId: string;
      kind: "requires_group";
      source: ConfiguredOptionReferenceV2;
      targetGroupId: string;
    }>;

export interface ConfiguredProductVariantV2 {
  readonly variantId: string;
  readonly productId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly active: boolean;
  readonly displayOrder: number;
  readonly stationId: string;
  readonly recipeVersion: string;
  readonly unit: string;
  readonly unitPriceMinor: number;
  readonly modifierGroups: readonly ConfiguredVariantGroupV2[];
  readonly constraints: readonly ConfiguredModifierConstraintV2[];
}

export interface ConfiguredCatalogReleaseV2 {
  readonly schemaVersion: typeof CONFIGURED_CATALOG_SCHEMA_VERSION;
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly categories: readonly ConfiguredCatalogCategoryV2[];
  readonly products: readonly ConfiguredCatalogProductV2[];
  readonly modifierTemplates: readonly ConfiguredModifierTemplateV2[];
  readonly variants: readonly ConfiguredProductVariantV2[];
}

export interface ConfiguredSelectionOptionV2 {
  readonly optionId: string;
  readonly quantity: number;
}

export interface ConfiguredSelectionGroupV2 {
  readonly groupId: string;
  readonly selections: readonly ConfiguredSelectionOptionV2[];
}

export interface ResolveConfiguredProductSelectionV2 {
  readonly schemaVersion: typeof CONFIGURED_SELECTION_SCHEMA_VERSION;
  readonly scope: Readonly<{ restaurantId: string; branchId: string }>;
  readonly expectedCatalogVersion: string;
  readonly productId: string;
  readonly variantId: string;
  readonly modifierGroups: readonly ConfiguredSelectionGroupV2[];
}

export function parseConfiguredCatalogReleaseV2(value: unknown): ConfiguredCatalogReleaseV2 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "restaurantId", "catalogVersion", "currency", "categories", "products",
      "modifierTemplates", "variants",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== CONFIGURED_CATALOG_SCHEMA_VERSION) return undefined;
    const restaurantId = uuid(own(record, "restaurantId"));
    const catalogVersion = uuid(own(record, "catalogVersion"));
    const currency = currencyCode(own(record, "currency"));
    const categories = parsedArray(own(record, "categories"), 200, parseCategory);
    const products = parsedArray(own(record, "products"), 2_000, parseProduct);
    const modifierTemplates = parsedArray(own(record, "modifierTemplates"), 2_000, parseTemplate);
    const variants = parsedArray(own(record, "variants"), 5_000, parseVariant);
    if (
      restaurantId === undefined || catalogVersion === undefined || currency === undefined
      || categories === undefined || products === undefined || modifierTemplates === undefined || variants === undefined
    ) return undefined;
    if (!validReleaseGraph(categories, products, modifierTemplates, variants)) return undefined;
    return Object.freeze({
      catalogVersion, categories, currency, modifierTemplates, products, restaurantId,
      schemaVersion: CONFIGURED_CATALOG_SCHEMA_VERSION, variants,
    });
  });
}

export function parseResolveConfiguredProductSelectionV2(
  value: unknown,
): ResolveConfiguredProductSelectionV2 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "scope", "expectedCatalogVersion", "productId", "variantId", "modifierGroups",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== CONFIGURED_SELECTION_SCHEMA_VERSION) return undefined;
    const scopeRecord = exactRecord(own(record, "scope"), ["restaurantId", "branchId"]);
    if (scopeRecord === undefined) return undefined;
    const restaurantId = uuid(own(scopeRecord, "restaurantId"));
    const branchId = uuid(own(scopeRecord, "branchId"));
    const expectedCatalogVersion = uuid(own(record, "expectedCatalogVersion"));
    const productId = uuid(own(record, "productId"));
    const variantId = uuid(own(record, "variantId"));
    const modifierGroups = parsedArray(own(record, "modifierGroups"), 100, parseSelectionGroup);
    if (
      restaurantId === undefined || branchId === undefined || expectedCatalogVersion === undefined
      || productId === undefined || variantId === undefined || modifierGroups === undefined
      || !unique(modifierGroups.map(({ groupId }) => groupId))
    ) return undefined;
    return Object.freeze({
      expectedCatalogVersion,
      modifierGroups,
      productId,
      schemaVersion: CONFIGURED_SELECTION_SCHEMA_VERSION,
      scope: Object.freeze({ branchId, restaurantId }),
      variantId,
    });
  });
}

function parseCategory(value: unknown): ConfiguredCatalogCategoryV2 | undefined {
  const record = exactRecord(value, ["categoryId", "name", "active", "displayOrder"]);
  if (record === undefined) return undefined;
  const categoryId = uuid(own(record, "categoryId"));
  const name = text(own(record, "name"), 80);
  const active = own(record, "active");
  const displayOrder = integer(own(record, "displayOrder"), 0, 1_000_000);
  return categoryId !== undefined && name !== undefined && typeof active === "boolean" && displayOrder !== undefined
    ? Object.freeze({ active, categoryId, displayOrder, name })
    : undefined;
}

function parseProduct(value: unknown): ConfiguredCatalogProductV2 | undefined {
  const record = exactRecord(value, ["productId", "categoryId", "name", "active", "displayOrder", "tax", "variantIds"]);
  if (record === undefined) return undefined;
  const productId = uuid(own(record, "productId"));
  const categoryId = uuid(own(record, "categoryId"));
  const name = text(own(record, "name"), 120);
  const active = own(record, "active");
  const displayOrder = integer(own(record, "displayOrder"), 0, 1_000_000);
  const rawTax = own(record, "tax");
  const tax = rawTax === null ? null : parseTax(rawTax);
  const variantIds = parsedArray(own(record, "variantIds"), 500, uuid);
  if (
    productId === undefined || categoryId === undefined || name === undefined || typeof active !== "boolean"
    || displayOrder === undefined || tax === undefined || variantIds === undefined || variantIds.length === 0
    || !unique(variantIds)
  ) return undefined;
  return Object.freeze({ active, categoryId, displayOrder, name, productId, tax, variantIds });
}

function parseTax(value: unknown): ConfiguredCatalogTaxV2 | undefined {
  const record = exactRecord(value, ["taxId", "name", "taxRuleVersion", "rateNumerator", "rateDenominator", "inclusion"]);
  if (record === undefined) return undefined;
  const taxId = text(own(record, "taxId"), 64);
  const name = text(own(record, "name"), 80);
  const taxRuleVersion = text(own(record, "taxRuleVersion"), 64);
  const rateNumerator = integer(own(record, "rateNumerator"), 0, 1_000_000);
  const rateDenominator = integer(own(record, "rateDenominator"), 1, 1_000_000);
  const inclusion = own(record, "inclusion");
  return taxId !== undefined && name !== undefined && taxRuleVersion !== undefined
    && rateNumerator !== undefined && rateDenominator !== undefined
    && (inclusion === "included" || inclusion === "excluded")
    ? Object.freeze({ inclusion, name, rateDenominator, rateNumerator, taxId, taxRuleVersion })
    : undefined;
}

function parseTemplate(value: unknown): ConfiguredModifierTemplateV2 | undefined {
  const record = exactRecord(value, ["templateId", "name", "active", "options"]);
  if (record === undefined) return undefined;
  const templateId = uuid(own(record, "templateId"));
  const name = text(own(record, "name"), 80);
  const active = own(record, "active");
  const options = parsedArray(own(record, "options"), 200, parseTemplateOption);
  if (
    templateId === undefined || name === undefined || typeof active !== "boolean" || options === undefined
    || options.length === 0 || !unique(options.map(({ optionId }) => optionId))
  ) return undefined;
  return Object.freeze({ active, name, options, templateId });
}

function parseTemplateOption(value: unknown): ConfiguredModifierTemplateOptionV2 | undefined {
  const record = exactRecord(value, ["optionId", "name", "active", "maximumQuantity"]);
  if (record === undefined) return undefined;
  const optionId = uuid(own(record, "optionId"));
  const name = text(own(record, "name"), 80);
  const active = own(record, "active");
  const rawMaximum = own(record, "maximumQuantity");
  const maximumQuantity = rawMaximum === null ? null : integer(rawMaximum, 1, 1_000);
  return optionId !== undefined && name !== undefined && typeof active === "boolean" && maximumQuantity !== undefined
    ? Object.freeze({ active, maximumQuantity, name, optionId })
    : undefined;
}

function parseVariant(value: unknown): ConfiguredProductVariantV2 | undefined {
  const record = exactRecord(value, [
    "variantId", "productId", "name", "sku", "active", "displayOrder", "stationId", "recipeVersion",
    "unit", "unitPriceMinor", "modifierGroups", "constraints",
  ]);
  if (record === undefined) return undefined;
  const variantId = uuid(own(record, "variantId"));
  const productId = uuid(own(record, "productId"));
  const name = text(own(record, "name"), 120);
  const rawSku = own(record, "sku");
  const sku = rawSku === null ? null : text(rawSku, 64);
  const active = own(record, "active");
  const displayOrder = integer(own(record, "displayOrder"), 0, 1_000_000);
  const stationId = text(own(record, "stationId"), 64);
  const recipeVersion = text(own(record, "recipeVersion"), 64);
  const unit = text(own(record, "unit"), 32);
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  const modifierGroups = parsedArray(own(record, "modifierGroups"), 100, parseVariantGroup);
  const constraints = parsedArray(own(record, "constraints"), 1_000, parseConstraint);
  if (
    variantId === undefined || productId === undefined || name === undefined || sku === undefined
    || typeof active !== "boolean" || displayOrder === undefined || stationId === undefined
    || recipeVersion === undefined || unit === undefined || unitPriceMinor === undefined
    || modifierGroups === undefined || constraints === undefined
    || !unique(modifierGroups.map(({ groupId }) => groupId))
    || !unique(constraints.map(({ constraintId }) => constraintId))
  ) return undefined;
  if (!validVariantGraph(modifierGroups, constraints)) return undefined;
  return Object.freeze({
    active, constraints, displayOrder, modifierGroups, name, productId, recipeVersion, sku,
    stationId, unit, unitPriceMinor, variantId,
  });
}

function parseVariantGroup(value: unknown): ConfiguredVariantGroupV2 | undefined {
  const record = exactRecord(value, [
    "templateId", "groupId", "name", "active", "minimumQuantity", "maximumQuantity", "options",
  ]);
  if (record === undefined) return undefined;
  const templateId = uuid(own(record, "templateId"));
  const groupId = uuid(own(record, "groupId"));
  const name = text(own(record, "name"), 80);
  const active = own(record, "active");
  const minimumQuantity = integer(own(record, "minimumQuantity"), 0, 1_000);
  const maximumQuantity = integer(own(record, "maximumQuantity"), 0, 1_000);
  const options = parsedArray(own(record, "options"), 200, parseVariantOption);
  if (
    templateId === undefined || groupId === undefined || name === undefined || typeof active !== "boolean"
    || minimumQuantity === undefined || maximumQuantity === undefined || minimumQuantity > maximumQuantity
    || options === undefined || options.length === 0 || !unique(options.map(({ optionId }) => optionId))
  ) return undefined;
  const defaultTotal = options.reduce((sum, option) => sum + option.defaultQuantity, 0);
  if (defaultTotal < minimumQuantity || defaultTotal > maximumQuantity) return undefined;
  return Object.freeze({ active, groupId, maximumQuantity, minimumQuantity, name, options, templateId });
}

function parseVariantOption(value: unknown): ConfiguredVariantOptionV2 | undefined {
  const record = exactRecord(value, ["optionId", "unitPriceMinor", "maximumQuantity", "defaultQuantity"]);
  if (record === undefined) return undefined;
  const optionId = uuid(own(record, "optionId"));
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  const rawMaximum = own(record, "maximumQuantity");
  const maximumQuantity = rawMaximum === null ? null : integer(rawMaximum, 1, 1_000);
  const defaultQuantity = integer(own(record, "defaultQuantity"), 0, 1_000);
  return optionId !== undefined && unitPriceMinor !== undefined && maximumQuantity !== undefined && defaultQuantity !== undefined
    ? Object.freeze({ defaultQuantity, maximumQuantity, optionId, unitPriceMinor })
    : undefined;
}

function parseConstraint(value: unknown): ConfiguredModifierConstraintV2 | undefined {
  const base = exactRecord(value, ["constraintId", "kind", "source", "target"])
    ?? exactRecord(value, ["constraintId", "kind", "source", "targetGroupId"]);
  if (base === undefined) return undefined;
  const constraintId = uuid(own(base, "constraintId"));
  const kind = own(base, "kind");
  const source = parseReference(own(base, "source"));
  if (constraintId === undefined || source === undefined) return undefined;
  if (kind === "requires_group") {
    const targetGroupId = uuid(own(base, "targetGroupId"));
    return targetGroupId === undefined ? undefined : Object.freeze({ constraintId, kind, source, targetGroupId });
  }
  if (kind !== "requires" && kind !== "excludes" && kind !== "enables") return undefined;
  const target = parseReference(own(base, "target"));
  return target === undefined ? undefined : Object.freeze({ constraintId, kind, source, target });
}

function parseReference(value: unknown): ConfiguredOptionReferenceV2 | undefined {
  const record = exactRecord(value, ["groupId", "optionId"]);
  if (record === undefined) return undefined;
  const groupId = uuid(own(record, "groupId"));
  const optionId = uuid(own(record, "optionId"));
  return groupId === undefined || optionId === undefined ? undefined : Object.freeze({ groupId, optionId });
}

function parseSelectionGroup(value: unknown): ConfiguredSelectionGroupV2 | undefined {
  const record = exactRecord(value, ["groupId", "selections"]);
  if (record === undefined) return undefined;
  const groupId = uuid(own(record, "groupId"));
  const selections = parsedArray(own(record, "selections"), 200, parseSelectionOption);
  return groupId !== undefined && selections !== undefined && unique(selections.map(({ optionId }) => optionId))
    ? Object.freeze({ groupId, selections })
    : undefined;
}

function parseSelectionOption(value: unknown): ConfiguredSelectionOptionV2 | undefined {
  const record = exactRecord(value, ["optionId", "quantity"]);
  if (record === undefined) return undefined;
  const optionId = uuid(own(record, "optionId"));
  const quantity = integer(own(record, "quantity"), 1, 1_000);
  return optionId === undefined || quantity === undefined ? undefined : Object.freeze({ optionId, quantity });
}

function validReleaseGraph(
  categories: readonly ConfiguredCatalogCategoryV2[],
  products: readonly ConfiguredCatalogProductV2[],
  templates: readonly ConfiguredModifierTemplateV2[],
  variants: readonly ConfiguredProductVariantV2[],
): boolean {
  if (!unique(categories.map(({ categoryId }) => categoryId)) || !unique(products.map(({ productId }) => productId))) return false;
  const categoryIds = new Set(categories.map(({ categoryId }) => categoryId));
  if (products.some(({ categoryId }) => !categoryIds.has(categoryId))) return false;
  if (!unique(templates.map(({ templateId }) => templateId)) || !unique(variants.map(({ variantId }) => variantId))) return false;
  const skus = variants.flatMap(({ sku }) => sku === null ? [] : [sku]);
  if (!unique(skus)) return false;
  const productIds = new Set(products.map(({ productId }) => productId));
  const templateById = new Map(templates.map((template) => [template.templateId, template]));
  const variantById = new Map(variants.map((variant) => [variant.variantId, variant]));
  const listed = new Set<string>();
  for (const product of products) {
    for (const variantId of product.variantIds) {
      const variant = variantById.get(variantId);
      if (variant === undefined || variant.productId !== product.productId || listed.has(variantId)) return false;
      listed.add(variantId);
    }
  }
  if (listed.size !== variants.length || variants.some(({ productId }) => !productIds.has(productId))) return false;
  const groupIds = new Set<string>();
  for (const variant of variants) {
    for (const group of variant.modifierGroups) {
      if (groupIds.has(group.groupId)) return false;
      groupIds.add(group.groupId);
      const template = templateById.get(group.templateId);
      if (template === undefined) return false;
      const options = new Map(template.options.map((option) => [option.optionId, option]));
      for (const binding of group.options) {
        const option = options.get(binding.optionId);
        const effectiveMaximum = binding.maximumQuantity ?? option?.maximumQuantity ?? null;
        if (
          option === undefined || !option.active
          || (binding.maximumQuantity !== null && option.maximumQuantity !== null && binding.maximumQuantity > option.maximumQuantity)
          || (effectiveMaximum !== null && binding.defaultQuantity > effectiveMaximum)
        ) return false;
      }
    }
  }
  return true;
}

function validVariantGraph(
  groups: readonly ConfiguredVariantGroupV2[],
  constraints: readonly ConfiguredModifierConstraintV2[],
): boolean {
  const options = new Set(groups.flatMap((group) => group.options.map(({ optionId }) => `${group.groupId}:${optionId}`)));
  const groupIds = new Set(groups.map(({ groupId }) => groupId));
  const known = (reference: ConfiguredOptionReferenceV2): boolean => options.has(`${reference.groupId}:${reference.optionId}`);
  return constraints.every((constraint) => known(constraint.source) && (
    constraint.kind === "requires_group" ? groupIds.has(constraint.targetGroupId) : known(constraint.target)
  ));
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
  }
  return value as Record<string, unknown>;
}

function own(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function exactArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > maximum) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) return undefined;
  const items: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    items.push(descriptor.value);
  }
  return items;
}

function parsedArray<T>(value: unknown, maximum: number, parser: (item: unknown) => T | undefined): readonly T[] | undefined {
  const items = exactArray(value, maximum);
  if (items === undefined) return undefined;
  const parsed = items.map(parser);
  return parsed.some((item) => item === undefined) ? undefined : Object.freeze(parsed as T[]);
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function currencyCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value) ? value : undefined;
}

function text(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function safely<T>(operation: () => T | undefined): T | undefined {
  try { return operation(); } catch { return undefined; }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
