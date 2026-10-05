import {
  InvalidSnapshotError,
  Money,
  validateConfiguredCatalogRelease,
  type ConfiguredCatalogRelease,
  type ConfiguredProductSelectionInput,
  type MenuCatalog,
  type ModifierConstraint,
} from "@super-restaurant/domain";
import {
  CONFIGURED_CATALOG_SCHEMA_VERSION,
  CONFIGURED_SELECTION_SCHEMA_VERSION,
  parseConfiguredCatalogReleaseV2,
  parseResolveConfiguredProductSelectionV2,
  type ConfiguredCatalogReleaseV2,
  type ConfiguredModifierConstraintV2,
  type ResolveConfiguredProductSelectionV2,
  type MenuCatalogV1,
} from "@super-restaurant/shared-types";

/** Converts an already validated transport catalog into the pure domain model. */
export function toDomainMenuCatalog(catalog: MenuCatalogV1, restaurantId: string): MenuCatalog {
  return {
    catalogVersion: catalog.catalogVersion,
    categories: catalog.categories.map((category) => ({
      active: category.active,
      catalogVersion: catalog.catalogVersion,
      displayOrder: category.displayOrder,
      id: category.categoryId,
      name: category.name,
      restaurantId,
    })),
    currency: catalog.currency,
    modifierGroups: catalog.modifierGroups.map((group) => ({
      active: group.active,
      catalogVersion: catalog.catalogVersion,
      id: group.groupId,
      maximumQuantity: group.maximumQuantity,
      minimumQuantity: group.minimumQuantity,
      name: group.name,
      options: group.options.map((option) => ({
        active: option.active,
        id: option.optionId,
        ...(option.maximumQuantity === null ? {} : { maximumQuantity: option.maximumQuantity }),
        name: option.name,
        unitPrice: new Money(option.unitPriceMinor, catalog.currency),
      })),
      productId: group.productId,
      restaurantId,
    })),
    products: catalog.products.map((product) => ({
      active: product.active,
      catalogVersion: catalog.catalogVersion,
      categoryId: product.categoryId,
      displayOrder: product.displayOrder,
      id: product.productId,
      modifierGroupIds: catalog.modifierGroups
        .filter((group) => group.productId === product.productId)
        .map((group) => group.groupId),
      name: product.name,
      restaurantId,
      ...(product.sku === null ? {} : { sku: product.sku }),
      stationId: product.stationId,
      ...(product.tax === null ? {} : { tax: {
        inclusion: product.tax.inclusion,
        name: product.tax.name,
        rate: {
          denominator: BigInt(product.tax.rateDenominator),
          numerator: BigInt(product.tax.rateNumerator),
        },
        taxId: product.tax.taxId,
        taxRuleVersion: product.tax.taxRuleVersion,
      } }),
      unit: product.unit,
      unitPrice: new Money(product.unitPriceMinor, catalog.currency),
      ...((product.variants ?? []).length === 0 ? {} : {
        variants: (product.variants ?? []).map((variant) => ({
          active: variant.active,
          displayOrder: variant.displayOrder,
          id: variant.variantId,
          name: variant.name,
          ...(variant.sku === null ? {} : { sku: variant.sku }),
          unitPrice: new Money(variant.unitPriceMinor, catalog.currency),
        })),
      }),
    })),
    restaurantId,
  };
}

export interface DomainConfiguredSelectionRequest {
  readonly branchId: string;
  readonly selection: ConfiguredProductSelectionInput;
}

/** Parses transport again, then maps every V2 release fact into the pure domain authority. */
export function toDomainConfiguredCatalog(value: unknown): ConfiguredCatalogRelease {
  const release = parseConfiguredCatalogReleaseV2(value);
  if (release === undefined) throw new InvalidSnapshotError("configured catalog transport");
  const domain: ConfiguredCatalogRelease = {
    catalogVersion: release.catalogVersion,
    categories: release.categories.map((category) => ({
      active: category.active,
      catalogVersion: release.catalogVersion,
      displayOrder: category.displayOrder,
      id: category.categoryId,
      name: category.name,
      restaurantId: release.restaurantId,
    })),
    currency: release.currency,
    modifierTemplates: release.modifierTemplates.map((template) => ({
      active: template.active,
      catalogVersion: release.catalogVersion,
      id: template.templateId,
      name: template.name,
      options: template.options.map((option) => ({
        active: option.active,
        id: option.optionId,
        ...(option.maximumQuantity === null ? {} : { maximumQuantity: option.maximumQuantity }),
        name: option.name,
      })),
      restaurantId: release.restaurantId,
    })),
    products: release.products.map((product) => ({
      active: product.active,
      catalogVersion: release.catalogVersion,
      categoryId: product.categoryId,
      displayOrder: product.displayOrder,
      id: product.productId,
      name: product.name,
      restaurantId: release.restaurantId,
      ...(product.tax === null ? {} : { tax: {
        inclusion: product.tax.inclusion,
        name: product.tax.name,
        rate: {
          denominator: BigInt(product.tax.rateDenominator),
          numerator: BigInt(product.tax.rateNumerator),
        },
        taxId: product.tax.taxId,
        taxRuleVersion: product.tax.taxRuleVersion,
      } }),
      variantIds: [...product.variantIds],
    })),
    restaurantId: release.restaurantId,
    variants: release.variants.map((variant) => ({
      active: variant.active,
      catalogVersion: release.catalogVersion,
      constraints: variant.constraints.map(toDomainConstraint),
      displayOrder: variant.displayOrder,
      id: variant.variantId,
      modifierGroups: variant.modifierGroups.map((group) => ({
        binding: {
          active: group.active,
          groupId: group.groupId,
          maximumQuantity: group.maximumQuantity,
          minimumQuantity: group.minimumQuantity,
          name: group.name,
          options: group.options.map((option) => ({
            defaultQuantity: option.defaultQuantity,
            ...(option.maximumQuantity === null ? {} : { maximumQuantity: option.maximumQuantity }),
            optionId: option.optionId,
            unitPrice: new Money(option.unitPriceMinor, release.currency),
          })),
          productId: variant.productId,
        },
        templateId: group.templateId,
      })),
      name: variant.name,
      productId: variant.productId,
      recipeVersion: variant.recipeVersion,
      restaurantId: release.restaurantId,
      ...(variant.sku === null ? {} : { sku: variant.sku }),
      stationId: variant.stationId,
      unit: variant.unit,
      unitPrice: new Money(variant.unitPriceMinor, release.currency),
    })),
  };
  validateConfiguredCatalogRelease(domain);
  return deepFreeze(domain);
}

/** Serializes only validated domain facts; the transport parser is the final exactness gate. */
export function toTransportConfiguredCatalog(value: ConfiguredCatalogRelease): ConfiguredCatalogReleaseV2 {
  const release = validateConfiguredCatalogRelease(value);
  const transport = {
    catalogVersion: release.catalogVersion,
    categories: release.categories.map((category) => ({
      active: category.active,
      categoryId: category.id,
      displayOrder: category.displayOrder,
      name: category.name,
    })),
    currency: release.currency,
    modifierTemplates: release.modifierTemplates.map((template) => ({
      active: template.active,
      name: template.name,
      options: template.options.map((option) => ({
        active: option.active,
        maximumQuantity: option.maximumQuantity ?? null,
        name: option.name,
        optionId: option.id,
      })),
      templateId: template.id,
    })),
    products: release.products.map((product) => ({
      active: product.active,
      categoryId: product.categoryId,
      displayOrder: product.displayOrder,
      name: product.name,
      productId: product.id,
      tax: product.tax === undefined ? null : {
        inclusion: product.tax.inclusion,
        name: product.tax.name,
        rateDenominator: exactTransportInteger(product.tax.rate.denominator, "tax denominator"),
        rateNumerator: exactTransportInteger(product.tax.rate.numerator, "tax numerator"),
        taxId: product.tax.taxId,
        taxRuleVersion: product.tax.taxRuleVersion,
      },
      variantIds: [...product.variantIds],
    })),
    restaurantId: release.restaurantId,
    schemaVersion: CONFIGURED_CATALOG_SCHEMA_VERSION,
    variants: release.variants.map((variant) => ({
      active: variant.active,
      constraints: variant.constraintCatalog.constraints.map(toTransportConstraint),
      displayOrder: variant.displayOrder,
      modifierGroups: variant.modifierGroups.map((group) => ({
        active: group.active,
        groupId: group.id,
        maximumQuantity: group.maximumQuantity,
        minimumQuantity: group.minimumQuantity,
        name: group.name,
        options: group.options.map((option) => ({
          defaultQuantity: group.defaultSelections.find(({ optionId }) => optionId === option.id)?.quantity ?? 0,
          maximumQuantity: option.maximumQuantity ?? null,
          optionId: option.id,
          unitPriceMinor: option.unitPrice.amountMinor,
        })),
        templateId: group.templateId,
      })),
      name: variant.name,
      productId: variant.productId,
      recipeVersion: variant.recipeVersion,
      sku: variant.sku ?? null,
      stationId: variant.stationId,
      unit: variant.unit,
      unitPriceMinor: variant.unitPrice.amountMinor,
      variantId: variant.id,
    })),
  };
  const parsed = parseConfiguredCatalogReleaseV2(transport);
  if (parsed === undefined) throw new InvalidSnapshotError("configured catalog transport");
  return parsed;
}

export function toDomainConfiguredSelection(value: unknown): DomainConfiguredSelectionRequest {
  const request = parseResolveConfiguredProductSelectionV2(value);
  if (request === undefined) throw new InvalidSnapshotError("configured selection transport");
  return deepFreeze({
    branchId: request.scope.branchId,
    selection: {
      catalogVersion: request.expectedCatalogVersion,
      modifierGroups: request.modifierGroups.map((group) => ({
        groupId: group.groupId,
        selections: group.selections.map((selection) => ({ ...selection })),
      })),
      productId: request.productId,
      restaurantId: request.scope.restaurantId,
      variantId: request.variantId,
    },
  });
}

export function toTransportConfiguredSelection(
  selection: ConfiguredProductSelectionInput,
  branchId: string,
): ResolveConfiguredProductSelectionV2 {
  const transport = {
    expectedCatalogVersion: selection.catalogVersion,
    modifierGroups: selection.modifierGroups.map((group) => ({
      groupId: group.groupId,
      selections: group.selections.map((option) => ({ ...option })),
    })),
    productId: selection.productId,
    schemaVersion: CONFIGURED_SELECTION_SCHEMA_VERSION,
    scope: { branchId, restaurantId: selection.restaurantId },
    variantId: selection.variantId,
  };
  const parsed = parseResolveConfiguredProductSelectionV2(transport);
  if (parsed === undefined) throw new InvalidSnapshotError("configured selection transport");
  return parsed;
}

function toDomainConstraint(constraint: ConfiguredModifierConstraintV2): ModifierConstraint {
  return constraint.kind === "requires_group"
    ? {
        id: constraint.constraintId,
        kind: constraint.kind,
        source: { ...constraint.source },
        targetGroupId: constraint.targetGroupId,
      }
    : {
        id: constraint.constraintId,
        kind: constraint.kind,
        source: { ...constraint.source },
        target: { ...constraint.target },
      };
}

function toTransportConstraint(constraint: ModifierConstraint): ConfiguredModifierConstraintV2 {
  return constraint.kind === "requires_group"
    ? Object.freeze({
        constraintId: constraint.id,
        kind: constraint.kind,
        source: { ...constraint.source },
        targetGroupId: constraint.targetGroupId,
      })
    : Object.freeze({
        constraintId: constraint.id,
        kind: constraint.kind,
        source: { ...constraint.source },
        target: { ...constraint.target },
      });
}

function exactTransportInteger(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new InvalidSnapshotError(field);
  return Number(value);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
