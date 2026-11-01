/**
 * Fixture cleanup for `app.menu_product_variants`. The table references `app.menu_products` with
 * ON DELETE RESTRICT, so a fixture product with sizes cannot be deleted first. The delete is bound to
 * the verified fixtures' exact restaurant, release and product ids (all three predicates), so it can
 * never touch another release or another restaurant's variants. Fixtures publish none, so no row
 * count is required.
 */
export const DELETE_MENU_PRODUCT_VARIANTS_SQL =
  "delete from app.menu_product_variants where restaurant_id = any($1::uuid[]) and catalog_id = any($2::uuid[]) and product_id = any($3::uuid[])";

/**
 * Fixture cleanup for `app.menu_product_modifier_groups`. Its composite foreign keys to groups and to
 * products are ON DELETE RESTRICT, so the assignments must go before either. Bound to the verified
 * fixtures' restaurant, release and group ids together; the row count is not required.
 */
export const DELETE_MENU_PRODUCT_MODIFIER_GROUPS_SQL =
  "delete from app.menu_product_modifier_groups where restaurant_id = any($1::uuid[]) and catalog_id = any($2::uuid[]) and group_id = any($3::uuid[])";

export function menuProductVariantDeleteParameters(
  restaurantIds: readonly string[],
  catalogIds: readonly string[],
  productIds: readonly string[],
): [string[], string[], string[]] {
  return [[...restaurantIds], [...catalogIds], [...productIds]];
}
