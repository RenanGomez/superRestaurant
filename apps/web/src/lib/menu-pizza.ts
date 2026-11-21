import {
  MENU_PIZZA_MAX_EXTRA_GROUPS,
  MENU_PIZZA_MAX_FREE_INGREDIENTS,
  type MenuModifierGroupV1,
  type MenuPizzaModeV1,
  type MenuProductV1,
} from "@super-restaurant/shared-types";

const PIZZA_KEYS = ["pizzaMode", "freeIngredientCount", "baseGroupId", "defaultIngredientOptionIds", "customizeAtOrder", "extraGroupIds"] as const;

export const PIZZA_MODE_LABELS: Readonly<Record<MenuPizzaModeV1, string>> = Object.freeze({
  custom: "Armable (el cliente elige ingredientes)",
  specialty: "Especialidad (receta fija)",
});

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
    baseGroupId: product.baseGroupId ?? null,
    customizeAtOrder: product.customizeAtOrder ?? false,
    defaultIngredientOptionIds: product.defaultIngredientOptionIds ?? [],
    extraGroupIds: product.extraGroupIds ?? [],
    freeIngredientCount: product.freeIngredientCount ?? 0,
    pizzaMode: mode,
  };
}

/** Changes the ingredient group; the recipe ids belong to the previous group, so they are dropped. */
export function setPizzaBaseGroup(product: MenuProductV1, groupId: string | null): MenuProductV1 {
  if (product.pizzaMode === undefined || (product.baseGroupId ?? null) === groupId) return product;
  return {
    ...product,
    baseGroupId: groupId,
    defaultIngredientOptionIds: [],
    extraGroupIds: (product.extraGroupIds ?? []).filter((id) => id !== groupId),
  };
}

export function toggleListedId(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
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
  const baseGroupId = product.baseGroupId ?? null;
  if (baseGroupId === null) return "Elige el grupo de ingredientes de la pizza.";
  const baseGroup = catalogGroups.find((group) => group.groupId === baseGroupId);
  if (baseGroup === undefined || !assigned.has(baseGroupId)) return "El grupo de ingredientes ya no está asignado a este producto; elígelo de nuevo.";
  const extraGroupIds = product.extraGroupIds ?? [];
  if (extraGroupIds.length > MENU_PIZZA_MAX_EXTRA_GROUPS) return `Máximo ${MENU_PIZZA_MAX_EXTRA_GROUPS} grupos de extras.`;
  if (extraGroupIds.includes(baseGroupId)) return "Un grupo no puede ser a la vez ingredientes y extras.";
  if (extraGroupIds.some((id) => !assigned.has(id) || !catalogGroups.some((group) => group.groupId === id))) {
    return "Un grupo de extras ya no está asignado a este producto; elígelo de nuevo.";
  }
  const freeCount = product.freeIngredientCount ?? 0;
  if (!Number.isInteger(freeCount) || freeCount < 0 || freeCount > MENU_PIZZA_MAX_FREE_INGREDIENTS) {
    return `Los ingredientes gratis deben ser un entero de 0 a ${MENU_PIZZA_MAX_FREE_INGREDIENTS}.`;
  }
  const baseOptionIds = new Set(baseGroup.options.map((option) => option.optionId));
  const defaults = product.defaultIngredientOptionIds ?? [];
  if (defaults.some((id) => !baseOptionIds.has(id))) return "La receta incluye un ingrediente que ya no existe en el grupo; revísala.";
  if (product.pizzaMode === "specialty" && defaults.length === 0) return "Marca los ingredientes de la receta de la especialidad.";
  return null;
}
