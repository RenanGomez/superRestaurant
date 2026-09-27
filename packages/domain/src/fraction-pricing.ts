import { DomainError, InvalidSnapshotError } from "./errors.js";
import { Money } from "./money.js";
import type { ModifierPriceSnapshot, OrderItemPriceSnapshot, TaxSnapshot } from "./order-totals.js";

/** v1 supports only whole pizzas or two halves; quarters and other geometries are rejected. */
export type PizzaFraction = "whole" | "half-a" | "half-b";
export type FractionGeometry = "whole" | "halves";
export type FractionPricingActorRole = "staff" | "manager";

const MAX_EXTRAS_PER_FRACTION = 5;

export interface FractionFlavorOption {
  readonly optionId: string;
  readonly name: string;
  /** Price of this flavor as a whole pizza; halves are priced by the maximum selected flavor price. */
  readonly priceMinor: number;
  /** Branch supervisor availability flag; false blocks selection regardless of station. */
  readonly active: boolean;
}

export interface FractionExtraOption {
  readonly optionId: string;
  readonly name: string;
  /** Full charge when applied to a whole pizza; halved (rounded up) when applied to one half. */
  readonly priceMinor: number;
  readonly active: boolean;
}

export interface FractionIncludedIngredient {
  readonly ingredientId: string;
  readonly name: string;
}

export interface FractionComboSubstitutionOption {
  readonly optionId: string;
  readonly name: string;
  /** Equivalence group; substituting within the default option's group is free. */
  readonly groupId: string;
  /** Explicit surcharge charged only when the chosen option's group differs from the default's. */
  readonly surchargeMinor: number;
  readonly active: boolean;
}

export interface FractionComboSlot {
  readonly slotId: string;
  readonly defaultOptionId: string;
  readonly options: readonly FractionComboSubstitutionOption[];
}

/** Historical catalog facts for one configured pizza variant; read once, then frozen into a snapshot. */
export interface FractionPricingVariant {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly variantId: string;
  readonly productId: string;
  readonly name: string;
  readonly sku?: string;
  readonly stationId: string;
  readonly unit: string;
  readonly currency: string;
  /** Branch supervisor availability flag for the whole variant. */
  readonly active: boolean;
  readonly flavors: readonly FractionFlavorOption[];
  readonly extras: readonly FractionExtraOption[];
  readonly includedIngredients: readonly FractionIncludedIngredient[];
  readonly comboSlots: readonly FractionComboSlot[];
  readonly tax?: TaxSnapshot;
}

export interface ResolveFractionSlotSelection {
  readonly fraction: PizzaFraction;
  readonly flavorOptionId: string;
  readonly extraOptionIds: readonly string[];
  readonly excludedIngredientIds: readonly string[];
}

export interface ResolveFractionComboSubstitutionSelection {
  readonly slotId: string;
  readonly optionId: string;
}

export interface ResolveFractionPricingInput {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly variantId: string;
  readonly geometry: FractionGeometry;
  readonly slots: readonly ResolveFractionSlotSelection[];
  readonly comboSubstitutions: readonly ResolveFractionComboSubstitutionSelection[];
}

export interface ResolveFractionPricingContext {
  readonly actorId: string;
  readonly actorRole: FractionPricingActorRole;
  /** Required, audited, only honored when actorRole is "manager", to exceed the 5-extras-per-fraction limit. */
  readonly overrideReason?: string;
}

export type FractionPricingIssueCode =
  | "invalid_geometry"
  | "slot_mismatch"
  | "variant_scope_mismatch"
  | "variant_inactive"
  | "flavor_not_found"
  | "flavor_inactive"
  | "extra_not_found"
  | "extra_inactive"
  | "extra_duplicate"
  | "extra_limit_exceeded"
  | "extra_override_authorization_required"
  | "extra_override_reason_required"
  | "exclusion_not_found"
  | "exclusion_duplicate"
  | "combo_slot_not_found"
  | "combo_slot_duplicate"
  | "combo_option_not_found"
  | "combo_option_inactive";

export interface FractionPricingIssue {
  readonly code: FractionPricingIssueCode;
  readonly fraction?: PizzaFraction;
  readonly detail: string;
}

export interface FractionPriceBreakdownEntry {
  readonly fraction: PizzaFraction;
  readonly flavorOptionId: string;
  readonly amountMinor: number;
}

/** Additive, optional extension of the frozen order-item snapshot; existing consumers ignore these fields. */
export interface FractionOrderItemPriceSnapshot extends OrderItemPriceSnapshot {
  readonly variantId: string;
  readonly geometry: FractionGeometry;
  readonly fractionBreakdown: readonly FractionPriceBreakdownEntry[];
}

/**
 * Resolves the frozen, historical price snapshot for one configured pizza selection.
 *
 * Pure and total: never throws for a well-formed but rule-violating selection (returns issues
 * instead); throws only for structurally malformed arguments (wrong shapes/types), consistent
 * with the domain's other snapshot boundaries. The returned snapshot never re-reads the catalog;
 * it is the sole pricing authority for the resulting order item.
 */
export function resolveFractionPricing(
  variantValue: FractionPricingVariant,
  inputValue: ResolveFractionPricingInput,
  contextValue: ResolveFractionPricingContext,
): FractionOrderItemPriceSnapshot | readonly FractionPricingIssue[] {
  const variant = normalizeVariant(variantValue);
  const input = normalizeInput(inputValue);
  const context = normalizeContext(contextValue);
  const issues: FractionPricingIssue[] = [];

  if (input.geometry !== "whole" && input.geometry !== "halves") {
    issues.push({ code: "invalid_geometry", detail: "geometry must be whole or halves; quarters are not supported in v1" });
    return deepFreeze(issues);
  }

  const expectedFractions: readonly PizzaFraction[] = input.geometry === "whole" ? ["whole"] : ["half-a", "half-b"];
  const slotFractions = input.slots.map((slot) => slot.fraction);
  const matchesGeometry = expectedFractions.length === slotFractions.length
    && expectedFractions.every((fraction) => slotFractions.includes(fraction))
    && new Set(slotFractions).size === slotFractions.length;
  if (!matchesGeometry) {
    issues.push({ code: "slot_mismatch", detail: `geometry ${input.geometry} requires exactly the fractions ${expectedFractions.join(", ")}` });
    return deepFreeze(issues);
  }

  if (variant.restaurantId !== input.restaurantId || variant.catalogVersion !== input.catalogVersion || variant.variantId !== input.variantId) {
    issues.push({ code: "variant_scope_mismatch", detail: "the selection does not match the variant's restaurant, catalogVersion, and variantId" });
    return deepFreeze(issues);
  }

  if (!variant.active) {
    issues.push({ code: "variant_inactive", detail: "the variant is marked unavailable for its branch" });
    return deepFreeze(issues);
  }

  const flavorsById = new Map(variant.flavors.map((flavor) => [flavor.optionId, flavor]));
  const extrasById = new Map(variant.extras.map((extra) => [extra.optionId, extra]));
  const ingredientsById = new Set(variant.includedIngredients.map((ingredient) => ingredient.ingredientId));

  const modifiers: ModifierPriceSnapshot[] = [];
  const fractionBreakdown: FractionPriceBreakdownEntry[] = [];

  for (const slot of input.slots) {
    const flavor = flavorsById.get(slot.flavorOptionId);
    if (flavor === undefined) {
      issues.push({ code: "flavor_not_found", fraction: slot.fraction, detail: `flavor ${slot.flavorOptionId} does not exist on this variant` });
      continue;
    }
    if (!flavor.active) {
      issues.push({ code: "flavor_inactive", fraction: slot.fraction, detail: `flavor ${slot.flavorOptionId} is unavailable for its branch` });
      continue;
    }
    fractionBreakdown.push({ amountMinor: flavor.priceMinor, flavorOptionId: flavor.optionId, fraction: slot.fraction });

    if (new Set(slot.extraOptionIds).size !== slot.extraOptionIds.length) {
      issues.push({ code: "extra_duplicate", fraction: slot.fraction, detail: "an extra was selected more than once on the same fraction" });
    }
    if (new Set(slot.excludedIngredientIds).size !== slot.excludedIngredientIds.length) {
      issues.push({ code: "exclusion_duplicate", fraction: slot.fraction, detail: "an ingredient was excluded more than once on the same fraction" });
    }

    if (slot.extraOptionIds.length > MAX_EXTRAS_PER_FRACTION) {
      if (context.actorRole !== "manager") {
        issues.push({ code: "extra_override_authorization_required", fraction: slot.fraction, detail: "exceeding 5 extras on one fraction requires a manager override" });
      } else if (context.overrideReason === undefined || context.overrideReason.trim().length === 0) {
        issues.push({ code: "extra_override_reason_required", fraction: slot.fraction, detail: "a manager override to exceed 5 extras requires a non-empty reason" });
      }
    }

    for (const extraOptionId of slot.extraOptionIds) {
      const extra = extrasById.get(extraOptionId);
      if (extra === undefined) {
        issues.push({ code: "extra_not_found", fraction: slot.fraction, detail: `extra ${extraOptionId} does not exist on this variant` });
        continue;
      }
      if (!extra.active) {
        issues.push({ code: "extra_inactive", fraction: slot.fraction, detail: `extra ${extraOptionId} is unavailable for its branch` });
        continue;
      }
      const charged = slot.fraction === "whole"
        ? new Money(extra.priceMinor, variant.currency)
        : new Money(extra.priceMinor, variant.currency).multiplyRatio(1n, 2n, "ceil");
      modifiers.push(deepFreeze({
        groupId: "fraction-extra",
        groupCatalogVersion: variant.catalogVersion,
        groupName: `extra:${slot.fraction}`,
        modifierId: `extra:${slot.fraction}:${extraOptionId}`,
        name: extra.name,
        quantity: 1,
        unitPrice: charged,
      }));
    }

    for (const ingredientId of slot.excludedIngredientIds) {
      if (!ingredientsById.has(ingredientId)) {
        issues.push({ code: "exclusion_not_found", fraction: slot.fraction, detail: `included ingredient ${ingredientId} does not exist on this variant` });
        continue;
      }
      modifiers.push(deepFreeze({
        groupId: "fraction-exclusion",
        groupCatalogVersion: variant.catalogVersion,
        groupName: `exclude:${slot.fraction}`,
        modifierId: `exclude:${slot.fraction}:${ingredientId}`,
        name: `Sin ${ingredientId}`,
        quantity: 0,
        unitPrice: new Money(0, variant.currency),
      }));
    }
  }

  if (new Set(input.comboSubstitutions.map((selection) => selection.slotId)).size !== input.comboSubstitutions.length) {
    issues.push({ code: "combo_slot_duplicate", detail: "a combo slot was substituted more than once" });
  }
  const comboSlotsById = new Map(variant.comboSlots.map((slot) => [slot.slotId, slot]));
  for (const selection of input.comboSubstitutions) {
    const comboSlot = comboSlotsById.get(selection.slotId);
    if (comboSlot === undefined) {
      issues.push({ code: "combo_slot_not_found", detail: `combo slot ${selection.slotId} does not exist on this variant` });
      continue;
    }
    const chosen = comboSlot.options.find((option) => option.optionId === selection.optionId);
    if (chosen === undefined) {
      issues.push({ code: "combo_option_not_found", detail: `combo option ${selection.optionId} does not exist in slot ${selection.slotId}` });
      continue;
    }
    if (!chosen.active) {
      issues.push({ code: "combo_option_inactive", detail: `combo option ${selection.optionId} is unavailable for its branch` });
      continue;
    }
    if (chosen.optionId === comboSlot.defaultOptionId) {
      continue;
    }
    const defaultOption = comboSlot.options.find((option) => option.optionId === comboSlot.defaultOptionId);
    const withinGroup = defaultOption !== undefined && defaultOption.groupId === chosen.groupId;
    modifiers.push(deepFreeze({
      groupId: "combo-substitution",
      groupCatalogVersion: variant.catalogVersion,
      groupName: `combo:${comboSlot.slotId}`,
      modifierId: `combo:${comboSlot.slotId}:${chosen.optionId}`,
      name: chosen.name,
      quantity: 1,
      unitPrice: withinGroup ? new Money(0, variant.currency) : new Money(chosen.surchargeMinor, variant.currency),
    }));
  }

  if (issues.length > 0) {
    return deepFreeze(issues);
  }

  const unitPriceMinor = fractionBreakdown.reduce((max, entry) => Math.max(max, entry.amountMinor), 0);

  return deepFreeze({
    catalogVersion: variant.catalogVersion,
    fractionBreakdown,
    geometry: input.geometry,
    modifiers,
    name: variant.name,
    productId: variant.productId,
    ...(variant.sku === undefined ? {} : { sku: variant.sku }),
    stationId: variant.stationId,
    ...(variant.tax === undefined ? {} : { tax: variant.tax }),
    unit: variant.unit,
    unitPrice: new Money(unitPriceMinor, variant.currency),
    variantId: variant.variantId,
  });
}

function normalizeVariant(value: FractionPricingVariant): FractionPricingVariant {
  return atFractionPricingBoundary("fraction pricing variant", () => {
    if (!isRecord(value)) throw new InvalidSnapshotError("fraction pricing variant");
    assertText(value.restaurantId, "variant restaurantId");
    assertText(value.catalogVersion, "variant catalogVersion");
    assertText(value.variantId, "variant variantId");
    assertText(value.productId, "variant productId");
    assertText(value.name, "variant name");
    assertText(value.stationId, "variant stationId");
    assertText(value.unit, "variant unit");
    const currency = new Money(0, value.currency).currency;
    if (typeof value.active !== "boolean") throw new InvalidSnapshotError("variant active");
    if (!Array.isArray(value.flavors) || value.flavors.length === 0) throw new InvalidSnapshotError("variant flavors");
    const flavors = value.flavors.map((flavor) => normalizeFlavor(flavor, currency));
    if (!unique(flavors.map((flavor) => flavor.optionId))) throw new InvalidSnapshotError("variant flavors optionId");
    if (!Array.isArray(value.extras)) throw new InvalidSnapshotError("variant extras");
    const extras = value.extras.map((extra) => normalizeExtra(extra, currency));
    if (!unique(extras.map((extra) => extra.optionId))) throw new InvalidSnapshotError("variant extras optionId");
    if (!Array.isArray(value.includedIngredients)) throw new InvalidSnapshotError("variant includedIngredients");
    const includedIngredients = value.includedIngredients.map(normalizeIngredient);
    if (!unique(includedIngredients.map((ingredient) => ingredient.ingredientId))) throw new InvalidSnapshotError("variant includedIngredients ingredientId");
    if (!Array.isArray(value.comboSlots)) throw new InvalidSnapshotError("variant comboSlots");
    const comboSlots = value.comboSlots.map(normalizeComboSlot);
    if (!unique(comboSlots.map((slot) => slot.slotId))) throw new InvalidSnapshotError("variant comboSlots slotId");
    if (value.sku !== undefined) assertText(value.sku, "variant sku");
    return deepFreeze({
      active: value.active,
      catalogVersion: value.catalogVersion,
      comboSlots,
      currency,
      extras,
      flavors,
      includedIngredients,
      name: value.name,
      productId: value.productId,
      restaurantId: value.restaurantId,
      ...(value.sku === undefined ? {} : { sku: value.sku }),
      stationId: value.stationId,
      ...(value.tax === undefined ? {} : { tax: cloneTaxSnapshot(value.tax) }),
      unit: value.unit,
      variantId: value.variantId,
    });
  });
}

function normalizeFlavor(value: unknown, currency: string): FractionFlavorOption {
  if (!isRecord(value)) throw new InvalidSnapshotError("fraction flavor option");
  assertText(value.optionId as string, "flavor optionId");
  assertText(value.name as string, "flavor name");
  const priceMinor = new Money(value.priceMinor as number, currency).amountMinor;
  if (priceMinor < 0) throw new InvalidSnapshotError("flavor priceMinor");
  if (typeof value.active !== "boolean") throw new InvalidSnapshotError("flavor active");
  return deepFreeze({ active: value.active, name: value.name as string, optionId: value.optionId as string, priceMinor });
}

function normalizeExtra(value: unknown, currency: string): FractionExtraOption {
  if (!isRecord(value)) throw new InvalidSnapshotError("fraction extra option");
  assertText(value.optionId as string, "extra optionId");
  assertText(value.name as string, "extra name");
  const priceMinor = new Money(value.priceMinor as number, currency).amountMinor;
  if (priceMinor < 0) throw new InvalidSnapshotError("extra priceMinor");
  if (typeof value.active !== "boolean") throw new InvalidSnapshotError("extra active");
  return deepFreeze({ active: value.active, name: value.name as string, optionId: value.optionId as string, priceMinor });
}

function normalizeIngredient(value: unknown): FractionIncludedIngredient {
  if (!isRecord(value)) throw new InvalidSnapshotError("fraction included ingredient");
  assertText(value.ingredientId as string, "ingredient ingredientId");
  assertText(value.name as string, "ingredient name");
  return deepFreeze({ ingredientId: value.ingredientId as string, name: value.name as string });
}

function normalizeComboSlot(value: unknown): FractionComboSlot {
  if (!isRecord(value)) throw new InvalidSnapshotError("fraction combo slot");
  assertText(value.slotId as string, "combo slot slotId");
  assertText(value.defaultOptionId as string, "combo slot defaultOptionId");
  if (!Array.isArray(value.options) || value.options.length === 0) throw new InvalidSnapshotError("combo slot options");
  const options = value.options.map(normalizeComboOption);
  if (!unique(options.map((option) => option.optionId))) throw new InvalidSnapshotError("combo slot options optionId");
  if (!options.some((option) => option.optionId === value.defaultOptionId)) {
    throw new InvalidSnapshotError("combo slot defaultOptionId");
  }
  return deepFreeze({ defaultOptionId: value.defaultOptionId as string, options, slotId: value.slotId as string });
}

function normalizeComboOption(value: unknown): FractionComboSubstitutionOption {
  if (!isRecord(value)) throw new InvalidSnapshotError("fraction combo option");
  assertText(value.optionId as string, "combo option optionId");
  assertText(value.name as string, "combo option name");
  assertText(value.groupId as string, "combo option groupId");
  if (!Number.isSafeInteger(value.surchargeMinor) || (value.surchargeMinor as number) < 0) {
    throw new InvalidSnapshotError("combo option surchargeMinor");
  }
  if (typeof value.active !== "boolean") throw new InvalidSnapshotError("combo option active");
  return deepFreeze({
    active: value.active,
    groupId: value.groupId as string,
    name: value.name as string,
    optionId: value.optionId as string,
    surchargeMinor: value.surchargeMinor as number,
  });
}

function normalizeInput(value: ResolveFractionPricingInput): ResolveFractionPricingInput {
  return atFractionPricingBoundary("fraction pricing selection", () => {
    if (!isRecord(value)) throw new InvalidSnapshotError("fraction pricing selection");
    assertText(value.restaurantId, "selection restaurantId");
    assertText(value.catalogVersion, "selection catalogVersion");
    assertText(value.variantId, "selection variantId");
    if (typeof value.geometry !== "string") throw new InvalidSnapshotError("selection geometry");
    if (!Array.isArray(value.slots) || value.slots.length === 0) throw new InvalidSnapshotError("selection slots");
    const slots = value.slots.map(normalizeSlotSelection);
    if (!Array.isArray(value.comboSubstitutions)) throw new InvalidSnapshotError("selection comboSubstitutions");
    const comboSubstitutions = value.comboSubstitutions.map(normalizeComboSelection);
    return deepFreeze({
      catalogVersion: value.catalogVersion,
      comboSubstitutions,
      geometry: value.geometry as FractionGeometry,
      restaurantId: value.restaurantId,
      slots,
      variantId: value.variantId,
    });
  });
}

function normalizeSlotSelection(value: unknown): ResolveFractionSlotSelection {
  if (!isRecord(value)) throw new InvalidSnapshotError("fraction slot selection");
  if (value.fraction !== "whole" && value.fraction !== "half-a" && value.fraction !== "half-b") {
    throw new InvalidSnapshotError("slot fraction");
  }
  assertText(value.flavorOptionId as string, "slot flavorOptionId");
  if (!Array.isArray(value.extraOptionIds)) throw new InvalidSnapshotError("slot extraOptionIds");
  if (!Array.isArray(value.excludedIngredientIds)) throw new InvalidSnapshotError("slot excludedIngredientIds");
  const extraOptionIds = value.extraOptionIds.map((id) => assertTextReturn(id, "slot extraOptionId"));
  const excludedIngredientIds = value.excludedIngredientIds.map((id) => assertTextReturn(id, "slot excludedIngredientId"));
  return deepFreeze({
    excludedIngredientIds,
    extraOptionIds,
    flavorOptionId: value.flavorOptionId as string,
    fraction: value.fraction,
  });
}

function normalizeComboSelection(value: unknown): ResolveFractionComboSubstitutionSelection {
  if (!isRecord(value)) throw new InvalidSnapshotError("fraction combo selection");
  assertText(value.slotId as string, "combo selection slotId");
  assertText(value.optionId as string, "combo selection optionId");
  return deepFreeze({ optionId: value.optionId as string, slotId: value.slotId as string });
}

function normalizeContext(value: ResolveFractionPricingContext): ResolveFractionPricingContext {
  return atFractionPricingBoundary("fraction pricing context", () => {
    if (!isRecord(value)) throw new InvalidSnapshotError("fraction pricing context");
    assertText(value.actorId, "context actorId");
    if (value.actorRole !== "staff" && value.actorRole !== "manager") throw new InvalidSnapshotError("context actorRole");
    if (value.overrideReason !== undefined && typeof value.overrideReason !== "string") {
      throw new InvalidSnapshotError("context overrideReason");
    }
    return deepFreeze({
      actorId: value.actorId,
      actorRole: value.actorRole,
      ...(value.overrideReason === undefined ? {} : { overrideReason: value.overrideReason }),
    });
  });
}

function cloneTaxSnapshot(tax: TaxSnapshot): TaxSnapshot {
  if (!isRecord(tax)) throw new InvalidSnapshotError("tax snapshot");
  return deepFreeze({ ...tax, rate: deepFreeze({ ...tax.rate }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new InvalidSnapshotError(field);
}

function assertTextReturn(value: unknown, field: string): string {
  assertText(value as string, field);
  return value as string;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function atFractionPricingBoundary<T>(field: string, operation: () => T): T {
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
