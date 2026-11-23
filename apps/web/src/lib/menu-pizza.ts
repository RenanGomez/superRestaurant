import {
  MENU_PIZZA_MAX_EXTRA_OPTIONS,
  MENU_PIZZA_MAX_FREE_INGREDIENTS,
  type MenuModifierGroupV1,
  type MenuPizzaModeV1,
  type MenuProductV1,
} from "@super-restaurant/shared-types";

const PIZZA_KEYS = [
  "pizzaMode", "freeIngredientCount", "baseGroupIds", "baseGroupId",
  "defaultIngredientOptionIds", "customizeAtOrder", "extraOptionIds", "extraGroupIds",
] as const;

/** Product without any pizza V2 field: the contract rejects V2 fields while `pizzaMode` is absent. */
function withoutPizza(product: MenuProductV1): MenuProductV1 {
  const copy: Record<string, unknown> = { ...product };
  for (const key of PIZZA_KEYS) delete copy[key];
  return copy as unknown as MenuProductV1;
}

/** Switches a product to a pizza V2 mode (with empty defaults) or back to a legacy product (`null`). */
export function setPizzaMode(product: MenuProductV1, mode: MenuPizzaModeV1 | null): MenuProductV1 {
  if (mode === null) return withoutPizza(product);
  if (product.pizzaMode === mode) return product;
  return {
    ...withoutPizza(product),
    baseGroupIds: product.baseGroupIds ?? (product.baseGroupId == null ? [] : [product.baseGroupId]),
    customizeAtOrder: mode === "custom",
    defaultIngredientOptionIds: mode === "custom" ? [] : (product.defaultIngredientOptionIds ?? []),
    extraOptionIds: product.extraOptionIds ?? [],
    freeIngredientCount: mode === "custom" ? (product.freeIngredientCount ?? 0) : 0,
    pizzaMode: mode,
  };
}

/** The unified block: a specialty is a marked recipe, a custom pizza is chosen while taking the order. */
export function setPizzaCustomizeAtOrder(product: MenuProductV1, customize: boolean): MenuProductV1 {
  if (product.pizzaMode === undefined) return product;
  return setPizzaMode(product, customize ? "custom" : "specialty");
}

/**
 * Adds or removes an assigned group from the free base groups. Removing a base group drops the recipe options
 * that lived in it; extras of that same group are kept because a group may also offer extras.
 */
export function togglePizzaBaseGroup(product: MenuProductV1, group: MenuModifierGroupV1): MenuProductV1 {
  if (product.pizzaMode === undefined) return product;
  const baseGroupIds = product.baseGroupIds ?? [];
  if (!baseGroupIds.includes(group.groupId)) return { ...product, baseGroupIds: [...baseGroupIds, group.groupId] };
  const removedOptions = new Set(group.options.map((option) => option.optionId));
  return {
    ...product,
    baseGroupIds: baseGroupIds.filter((groupId) => groupId !== group.groupId),
    defaultIngredientOptionIds: (product.defaultIngredientOptionIds ?? []).filter((optionId) => !removedOptions.has(optionId)),
  };
}

/** Marks a recipe option of a specialty; a recipe option can never also be a charged extra. */
export function togglePizzaRecipeOption(product: MenuProductV1, optionId: string): MenuProductV1 {
  if (product.pizzaMode === undefined) return product;
  const defaults = product.defaultIngredientOptionIds ?? [];
  if (defaults.includes(optionId)) return { ...product, defaultIngredientOptionIds: defaults.filter((id) => id !== optionId) };
  return {
    ...product,
    defaultIngredientOptionIds: [...defaults, optionId],
    extraOptionIds: (product.extraOptionIds ?? []).filter((id) => id !== optionId),
  };
}

/** Marks a loose charged option of any assigned group; it never consumes N and cannot be part of the recipe. */
export function togglePizzaExtraOption(product: MenuProductV1, optionId: string): MenuProductV1 {
  if (product.pizzaMode === undefined) return product;
  const extras = product.extraOptionIds ?? [];
  if (extras.includes(optionId)) return { ...product, extraOptionIds: extras.filter((id) => id !== optionId) };
  return {
    ...product,
    extraOptionIds: [...extras, optionId],
    defaultIngredientOptionIds: (product.defaultIngredientOptionIds ?? []).filter((id) => id !== optionId),
  };
}

/** Clamps a typed free-ingredient count into the contract range (integers only, never NaN). */
export function clampFreeIngredientCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MENU_PIZZA_MAX_FREE_INGREDIENTS, Math.max(0, Math.trunc(value)));
}

/**
 * Visible validation of a pizza V2 product against the groups the product offers. The server revalidates;
 * this only stops an obviously invalid draft from being published. `null` means no issue (or a legacy product).
 */
export function pizzaProductIssue(product: MenuProductV1, catalogGroups: readonly MenuModifierGroupV1[]): string | null {
  if (product.pizzaMode === undefined) return null;
  const assigned = new Set(product.modifierGroupIds ?? []);
  const baseGroupIds = product.baseGroupIds ?? [];
  if (new Set(baseGroupIds).size !== baseGroupIds.length) return "Un grupo base está repetido; revisa los grupos del producto.";
  const baseGroups = baseGroupIds.map((groupId) => catalogGroups.find((group) => group.groupId === groupId));
  if (baseGroupIds.some((groupId, index) => baseGroups[index] === undefined || !assigned.has(groupId))) {
    return "Un grupo base ya no está asignado a este producto; elígelo de nuevo.";
  }
  if (product.pizzaMode === "custom" && baseGroupIds.length === 0) return "Elige al menos un grupo base para la pizza personalizada.";
  const baseOptionIds = new Set(baseGroups.flatMap((group) => group?.options.map((option) => option.optionId) ?? []));
  const defaults = product.defaultIngredientOptionIds ?? [];
  if (defaults.some((optionId) => !baseOptionIds.has(optionId))) {
    return "La receta incluye un ingrediente que ya no existe en los grupos base; revísala.";
  }
  if (product.pizzaMode === "specialty" && defaults.length === 0) return "Marca los ingredientes de la receta de la especialidad.";
  const extras = product.extraOptionIds ?? [];
  if (extras.length > MENU_PIZZA_MAX_EXTRA_OPTIONS) return `Máximo ${MENU_PIZZA_MAX_EXTRA_OPTIONS} extras.`;
  const assignedOptionIds = new Set(catalogGroups
    .filter((group) => assigned.has(group.groupId))
    .flatMap((group) => group.options.map((option) => option.optionId)));
  if (extras.some((optionId) => !assignedOptionIds.has(optionId))) {
    return "Un extra ya no pertenece a un grupo asignado a este producto; elígelo de nuevo.";
  }
  if (extras.some((optionId) => defaults.includes(optionId))) return "Un ingrediente no puede ser receta y extra a la vez.";
  const freeCount = product.freeIngredientCount ?? 0;
  if (!Number.isInteger(freeCount) || freeCount < 0 || freeCount > MENU_PIZZA_MAX_FREE_INGREDIENTS) {
    return `Los ingredientes gratis deben ser un entero de 0 a ${MENU_PIZZA_MAX_FREE_INGREDIENTS}.`;
  }
  return null;
}
