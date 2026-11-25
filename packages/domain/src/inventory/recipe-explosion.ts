import { DomainError, InvalidQuantityError } from "../errors.js";
import {
  applyFraction,
  assertInventoryQuantity,
  unitsAreCompatible,
  type InventoryUnit,
} from "./units.js";

export interface RecipeLine {
  itemId: string;
  quantity: number;
  unit: InventoryUnit;
}

export interface RecipeVersion {
  recipeId: string;
  productId: string;
  version: number;
  lines: readonly RecipeLine[];
}

export interface RecipeModifierContribution {
  modifierId: string;
  lines: readonly RecipeLine[];
}

export interface ConsumptionRequest {
  productId: string;
  quantity: number;
  fraction?: { numerator: number; denominator: number } | null;
  modifierIds?: readonly string[];
}

export interface ConsumptionLine {
  itemId: string;
  quantity: number;
  unit: InventoryUnit;
  remainder: number;
}

export class RecipeIncompatibleUnitsError extends DomainError {
  public readonly code = "RECIPE_INCOMPATIBLE_UNITS";

  public constructor(itemId: string, left: InventoryUnit, right: InventoryUnit) {
    super("Recipe consumption lines for the same item must share one inventory unit.");
    this.itemId = itemId;
    this.left = left;
    this.right = right;
  }

  public readonly itemId: string;
  public readonly left: InventoryUnit;
  public readonly right: InventoryUnit;
}

interface ConsumptionAccumulator {
  itemId: string;
  unit: InventoryUnit;
  quantity: number;
  remainder: number;
}

function selectLatestRecipe(
  productId: string,
  recipes: readonly RecipeVersion[],
): RecipeVersion | undefined {
  let latest: RecipeVersion | undefined;
  for (const recipe of recipes) {
    if (recipe.productId !== productId) {
      continue;
    }
    if (latest === undefined || recipe.version > latest.version) {
      latest = recipe;
    }
  }

  return latest;
}

function accumulate(
  accumulators: Map<string, ConsumptionAccumulator>,
  itemId: string,
  unit: InventoryUnit,
  quantity: number,
  remainder: number,
): void {
  const existing = accumulators.get(itemId);
  if (existing === undefined) {
    accumulators.set(itemId, { itemId, unit, quantity, remainder });
    return;
  }
  if (!unitsAreCompatible(existing.unit, unit)) {
    throw new RecipeIncompatibleUnitsError(itemId, existing.unit, unit);
  }

  existing.quantity = assertInventoryQuantity(existing.quantity + quantity);
  existing.remainder += remainder;
}

/**
 * Explodes a sold product into whole inventory consumption.
 *
 * When several versions exist for the product, the highest `version` wins.
 * A product without a recipe produces no consumption instead of an error.
 */
export function explodeRecipe(
  request: ConsumptionRequest,
  recipes: readonly RecipeVersion[],
  modifierContributions: readonly RecipeModifierContribution[] = [],
): ConsumptionLine[] {
  const soldQuantity = assertInventoryQuantity(request.quantity);
  if (soldQuantity < 1) {
    throw new InvalidQuantityError(soldQuantity);
  }

  const recipe = selectLatestRecipe(request.productId, recipes);
  if (recipe === undefined) {
    return [];
  }

  const fraction = request.fraction ?? null;
  const contributions = new Map(
    modifierContributions.map((contribution) => [contribution.modifierId, contribution]),
  );
  const accumulators = new Map<string, ConsumptionAccumulator>();

  const addLine = (line: RecipeLine): void => {
    const base = assertInventoryQuantity(line.quantity * soldQuantity);
    const scaled =
      fraction === null
        ? { quantity: base, remainder: 0 }
        : applyFraction(base, fraction.numerator, fraction.denominator);
    accumulate(accumulators, line.itemId, line.unit, scaled.quantity, scaled.remainder);
  };

  for (const line of recipe.lines) {
    addLine(line);
  }

  for (const modifierId of request.modifierIds ?? []) {
    const contribution = contributions.get(modifierId);
    if (contribution === undefined) {
      continue;
    }
    for (const line of contribution.lines) {
      addLine(line);
    }
  }

  return [...accumulators.values()]
    .filter((accumulator) => accumulator.quantity > 0)
    .map((accumulator) => ({
      itemId: accumulator.itemId,
      quantity: accumulator.quantity,
      unit: accumulator.unit,
      remainder: accumulator.remainder,
    }));
}
