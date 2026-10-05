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
  /** Frozen display name of the flavor, so kitchen tickets never re-read the catalog. */
  readonly flavorName: string;
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
    fractionBreakdown.push({ amountMinor: flavor.priceMinor, flavorName: flavor.name, flavorOptionId: flavor.optionId, fraction: slot.fraction });

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
        // Quantity 1 at a zero price: order-item snapshots reject non-positive quantities.
        quantity: 1,
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

/*
 * Normalization below deliberately duplicates the "own data descriptor" boundary pattern used by
 * order-totals.ts / configured-catalog.ts / configured-selection.ts (own asPlainRecord/ownData/
 * ownDataArray helpers per file) rather than importing theirs: every one of those modules keeps its
 * own copy so a change to one boundary can never silently loosen another's. Every record read goes
 * through `ownData`/`optionalOwnData`, which fail closed on a missing own-value descriptor — so a
 * getter, an inherited/prototype value, or a Proxy whose `get` trap fabricates a value is rejected
 * instead of silently accepted. Reading `Reflect.ownKeys`/`Object.getPrototypeOf` on a hostile Proxy
 * that throws from those traps propagates that throw here, which normalizeVariant/normalizeInput/
 * normalizeContext funnel into InvalidSnapshotError via atFractionPricingBoundary.
 */

function normalizeVariant(value: unknown): FractionPricingVariant {
  return atFractionPricingBoundary("fraction pricing variant", () => {
    const record = asPlainRecord(value, "fraction pricing variant");
    const restaurantId = ownData(record, "restaurantId", "variant restaurantId");
    const catalogVersion = ownData(record, "catalogVersion", "variant catalogVersion");
    const variantId = ownData(record, "variantId", "variant variantId");
    const productId = ownData(record, "productId", "variant productId");
    const name = ownData(record, "name", "variant name");
    const sku = optionalOwnData(record, "sku", "variant sku");
    const stationId = ownData(record, "stationId", "variant stationId");
    const unit = ownData(record, "unit", "variant unit");
    const currencyValue = ownData(record, "currency", "variant currency");
    const active = ownData(record, "active", "variant active");
    const tax = optionalOwnData(record, "tax", "variant tax");
    assertText(restaurantId as string, "variant restaurantId");
    assertText(catalogVersion as string, "variant catalogVersion");
    assertText(variantId as string, "variant variantId");
    assertText(productId as string, "variant productId");
    assertText(name as string, "variant name");
    if (sku !== undefined) assertText(sku as string, "variant sku");
    assertText(stationId as string, "variant stationId");
    assertText(unit as string, "variant unit");
    const currency = new Money(0, currencyValue as string).currency;
    if (typeof active !== "boolean") throw new InvalidSnapshotError("variant active");

    const flavors = ownDataArray(record, "flavors", "variant flavors").map((flavor) => normalizeFlavor(flavor, currency));
    if (flavors.length === 0) throw new InvalidSnapshotError("variant flavors");
    if (!unique(flavors.map((flavor) => flavor.optionId))) throw new InvalidSnapshotError("variant flavors optionId");

    const extras = ownDataArray(record, "extras", "variant extras").map((extra) => normalizeExtra(extra, currency));
    if (!unique(extras.map((extra) => extra.optionId))) throw new InvalidSnapshotError("variant extras optionId");

    const includedIngredients = ownDataArray(record, "includedIngredients", "variant includedIngredients").map(normalizeIngredient);
    if (!unique(includedIngredients.map((ingredient) => ingredient.ingredientId))) {
      throw new InvalidSnapshotError("variant includedIngredients ingredientId");
    }

    const comboSlots = ownDataArray(record, "comboSlots", "variant comboSlots").map(normalizeComboSlot);
    if (!unique(comboSlots.map((slot) => slot.slotId))) throw new InvalidSnapshotError("variant comboSlots slotId");

    return deepFreeze({
      active,
      catalogVersion: catalogVersion as string,
      comboSlots,
      currency,
      extras,
      flavors,
      includedIngredients,
      name: name as string,
      productId: productId as string,
      restaurantId: restaurantId as string,
      ...(sku === undefined ? {} : { sku: sku as string }),
      stationId: stationId as string,
      ...(tax === undefined ? {} : { tax: normalizeTaxSnapshot(tax) }),
      unit: unit as string,
      variantId: variantId as string,
    });
  });
}

function normalizeFlavor(value: unknown, currency: string): FractionFlavorOption {
  const record = asPlainRecord(value, "fraction flavor option");
  const optionId = ownData(record, "optionId", "flavor optionId");
  const name = ownData(record, "name", "flavor name");
  const priceMinorValue = ownData(record, "priceMinor", "flavor priceMinor");
  const active = ownData(record, "active", "flavor active");
  assertText(optionId as string, "flavor optionId");
  assertText(name as string, "flavor name");
  const priceMinor = new Money(priceMinorValue as number, currency).amountMinor;
  if (priceMinor < 0) throw new InvalidSnapshotError("flavor priceMinor");
  if (typeof active !== "boolean") throw new InvalidSnapshotError("flavor active");
  return deepFreeze({ active, name: name as string, optionId: optionId as string, priceMinor });
}

function normalizeExtra(value: unknown, currency: string): FractionExtraOption {
  const record = asPlainRecord(value, "fraction extra option");
  const optionId = ownData(record, "optionId", "extra optionId");
  const name = ownData(record, "name", "extra name");
  const priceMinorValue = ownData(record, "priceMinor", "extra priceMinor");
  const active = ownData(record, "active", "extra active");
  assertText(optionId as string, "extra optionId");
  assertText(name as string, "extra name");
  const priceMinor = new Money(priceMinorValue as number, currency).amountMinor;
  if (priceMinor < 0) throw new InvalidSnapshotError("extra priceMinor");
  if (typeof active !== "boolean") throw new InvalidSnapshotError("extra active");
  return deepFreeze({ active, name: name as string, optionId: optionId as string, priceMinor });
}

function normalizeIngredient(value: unknown): FractionIncludedIngredient {
  const record = asPlainRecord(value, "fraction included ingredient");
  const ingredientId = ownData(record, "ingredientId", "ingredient ingredientId");
  const name = ownData(record, "name", "ingredient name");
  assertText(ingredientId as string, "ingredient ingredientId");
  assertText(name as string, "ingredient name");
  return deepFreeze({ ingredientId: ingredientId as string, name: name as string });
}

function normalizeComboSlot(value: unknown): FractionComboSlot {
  const record = asPlainRecord(value, "fraction combo slot");
  const slotId = ownData(record, "slotId", "combo slot slotId");
  const defaultOptionId = ownData(record, "defaultOptionId", "combo slot defaultOptionId");
  assertText(slotId as string, "combo slot slotId");
  assertText(defaultOptionId as string, "combo slot defaultOptionId");
  const options = ownDataArray(record, "options", "combo slot options").map(normalizeComboOption);
  if (options.length === 0) throw new InvalidSnapshotError("combo slot options");
  if (!unique(options.map((option) => option.optionId))) throw new InvalidSnapshotError("combo slot options optionId");
  if (!options.some((option) => option.optionId === defaultOptionId)) {
    throw new InvalidSnapshotError("combo slot defaultOptionId");
  }
  return deepFreeze({ defaultOptionId: defaultOptionId as string, options, slotId: slotId as string });
}

function normalizeComboOption(value: unknown): FractionComboSubstitutionOption {
  const record = asPlainRecord(value, "fraction combo option");
  const optionId = ownData(record, "optionId", "combo option optionId");
  const name = ownData(record, "name", "combo option name");
  const groupId = ownData(record, "groupId", "combo option groupId");
  const surchargeMinor = ownData(record, "surchargeMinor", "combo option surchargeMinor");
  const active = ownData(record, "active", "combo option active");
  assertText(optionId as string, "combo option optionId");
  assertText(name as string, "combo option name");
  assertText(groupId as string, "combo option groupId");
  if (!Number.isSafeInteger(surchargeMinor) || (surchargeMinor as number) < 0) {
    throw new InvalidSnapshotError("combo option surchargeMinor");
  }
  if (typeof active !== "boolean") throw new InvalidSnapshotError("combo option active");
  return deepFreeze({
    active,
    groupId: groupId as string,
    name: name as string,
    optionId: optionId as string,
    surchargeMinor: surchargeMinor as number,
  });
}

function normalizeInput(value: unknown): ResolveFractionPricingInput {
  return atFractionPricingBoundary("fraction pricing selection", () => {
    const record = asPlainRecord(value, "fraction pricing selection");
    const restaurantId = ownData(record, "restaurantId", "selection restaurantId");
    const catalogVersion = ownData(record, "catalogVersion", "selection catalogVersion");
    const variantId = ownData(record, "variantId", "selection variantId");
    const geometry = ownData(record, "geometry", "selection geometry");
    assertText(restaurantId as string, "selection restaurantId");
    assertText(catalogVersion as string, "selection catalogVersion");
    assertText(variantId as string, "selection variantId");
    if (typeof geometry !== "string") throw new InvalidSnapshotError("selection geometry");

    const slots = ownDataArray(record, "slots", "selection slots").map(normalizeSlotSelection);
    if (slots.length === 0) throw new InvalidSnapshotError("selection slots");
    const comboSubstitutions = ownDataArray(record, "comboSubstitutions", "selection comboSubstitutions").map(normalizeComboSelection);

    return deepFreeze({
      catalogVersion: catalogVersion as string,
      comboSubstitutions,
      geometry: geometry as FractionGeometry,
      restaurantId: restaurantId as string,
      slots,
      variantId: variantId as string,
    });
  });
}

function normalizeSlotSelection(value: unknown): ResolveFractionSlotSelection {
  const record = asPlainRecord(value, "fraction slot selection");
  const fraction = ownData(record, "fraction", "slot fraction");
  const flavorOptionId = ownData(record, "flavorOptionId", "slot flavorOptionId");
  if (fraction !== "whole" && fraction !== "half-a" && fraction !== "half-b") {
    throw new InvalidSnapshotError("slot fraction");
  }
  assertText(flavorOptionId as string, "slot flavorOptionId");
  const extraOptionIds = ownDataArray(record, "extraOptionIds", "slot extraOptionIds")
    .map((id) => assertTextReturn(id, "slot extraOptionId"));
  const excludedIngredientIds = ownDataArray(record, "excludedIngredientIds", "slot excludedIngredientIds")
    .map((id) => assertTextReturn(id, "slot excludedIngredientId"));
  return deepFreeze({
    excludedIngredientIds,
    extraOptionIds,
    flavorOptionId: flavorOptionId as string,
    fraction,
  });
}

function normalizeComboSelection(value: unknown): ResolveFractionComboSubstitutionSelection {
  const record = asPlainRecord(value, "fraction combo selection");
  const slotId = ownData(record, "slotId", "combo selection slotId");
  const optionId = ownData(record, "optionId", "combo selection optionId");
  assertText(slotId as string, "combo selection slotId");
  assertText(optionId as string, "combo selection optionId");
  return deepFreeze({ optionId: optionId as string, slotId: slotId as string });
}

function normalizeContext(value: unknown): ResolveFractionPricingContext {
  return atFractionPricingBoundary("fraction pricing context", () => {
    const record = asPlainRecord(value, "fraction pricing context");
    const actorId = ownData(record, "actorId", "context actorId");
    const actorRole = ownData(record, "actorRole", "context actorRole");
    const overrideReason = optionalOwnData(record, "overrideReason", "context overrideReason");
    assertText(actorId as string, "context actorId");
    if (actorRole !== "staff" && actorRole !== "manager") throw new InvalidSnapshotError("context actorRole");
    if (overrideReason !== undefined && typeof overrideReason !== "string") {
      throw new InvalidSnapshotError("context overrideReason");
    }
    return deepFreeze({
      actorId: actorId as string,
      actorRole,
      ...(overrideReason === undefined ? {} : { overrideReason: overrideReason as string }),
    });
  });
}

function normalizeTaxSnapshot(value: unknown): TaxSnapshot {
  const record = asPlainRecord(value, "variant tax snapshot");
  const taxId = ownData(record, "taxId", "tax taxId");
  const name = ownData(record, "name", "tax name");
  const taxRuleVersion = ownData(record, "taxRuleVersion", "tax taxRuleVersion");
  const inclusion = ownData(record, "inclusion", "tax inclusion");
  const rate = asPlainRecord(ownData(record, "rate", "tax rate"), "tax rate");
  const numerator = ownData(rate, "numerator", "tax rate numerator");
  const denominator = ownData(rate, "denominator", "tax rate denominator");
  assertText(taxId as string, "tax taxId");
  assertText(name as string, "tax name");
  assertText(taxRuleVersion as string, "tax taxRuleVersion");
  if (inclusion !== "included" && inclusion !== "excluded") throw new InvalidSnapshotError("tax inclusion");
  if (typeof numerator !== "bigint" || typeof denominator !== "bigint" || numerator < 0n || denominator <= 0n) {
    throw new InvalidSnapshotError("tax rate");
  }
  return deepFreeze({
    inclusion,
    name: name as string,
    rate: deepFreeze({ denominator, numerator }),
    taxId: taxId as string,
    taxRuleVersion: taxRuleVersion as string,
  });
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
