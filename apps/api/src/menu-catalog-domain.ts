import { Money, type MenuCatalog } from "@super-restaurant/domain";
import type { MenuCatalogV1 } from "@super-restaurant/shared-types";

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
    })),
    restaurantId,
  };
}
