import type { CaptureLineQuoteResultV1, MenuModifierGroupV1, MenuModifierOptionV1, MenuProductV1, MenuProductVariantV1 } from "@super-restaurant/shared-types";

/**
 * Pizza V2 capture helpers (pure). The client only assembles ids: it never prices anything. Amounts come from the
 * server quote, and the server revalidates every reference, count and rule.
 */
export const PIZZA_RULE_V2 = "pizza-halves-v2" as const;

export type PizzaHalfFraction = "half-a" | "half-b";
export type PizzaOptionRole = "ingredientOptionIds" | "extraOptionIds" | "removedIngredientOptionIds";

/** Wire shape of one half, identical to what the API parses. */
export interface PizzaHalfV2 {
  readonly fraction: PizzaHalfFraction;
  readonly productId: string;
  readonly variantId: string | null;
  readonly ingredientOptionIds: readonly string[];
  readonly extraOptionIds: readonly string[];
  readonly removedIngredientOptionIds: readonly string[];
}

export interface PizzaLineV2 {
  readonly ruleVersion: typeof PIZZA_RULE_V2;
  readonly halves: readonly [PizzaHalfV2, PizzaHalfV2];
}

/** What the operator picks for one half; the product's own groups define which role each option plays. */
export interface PizzaHalfDraft {
  readonly productId: string;
  readonly ingredientOptionIds: readonly string[];
  readonly extraOptionIds: readonly string[];
  readonly removedIngredientOptionIds: readonly string[];
}

export interface PizzaDraft {
  /** `false`: one product for the whole pizza (half B mirrors half A). */
  readonly split: boolean;
  readonly a: PizzaHalfDraft;
  readonly b: PizzaHalfDraft | null;
}

export function isPizzaProduct(product: MenuProductV1): boolean {
  return product.pizzaMode !== undefined;
}

export function emptyPizzaHalf(productId: string): PizzaHalfDraft {
  return { extraOptionIds: [], ingredientOptionIds: [], productId, removedIngredientOptionIds: [] };
}

/** Initial draft: the saved line when editing, otherwise a whole pizza of `productId`. */
export function pizzaDraftFromLine(line: PizzaLineV2 | undefined, productId: string): PizzaDraft {
  const half = (entry: PizzaHalfV2): PizzaHalfDraft => ({
    extraOptionIds: entry.extraOptionIds, ingredientOptionIds: entry.ingredientOptionIds,
    productId: entry.productId, removedIngredientOptionIds: entry.removedIngredientOptionIds,
  });
  if (line === undefined) return { a: emptyPizzaHalf(productId), b: null, split: false };
  const [first, second] = line.halves;
  return { a: half(first), b: first.productId === second.productId && sameHalfPicks(first, second) ? null : half(second),
    split: !(first.productId === second.productId && sameHalfPicks(first, second)) };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]);
}

function sameHalfPicks(left: PizzaHalfDraft | PizzaHalfV2, right: PizzaHalfDraft | PizzaHalfV2): boolean {
  return sameIds(left.ingredientOptionIds, right.ingredientOptionIds) && sameIds(left.extraOptionIds, right.extraOptionIds)
    && sameIds(left.removedIngredientOptionIds, right.removedIngredientOptionIds);
}

/** Toggles one option id of a role in a half. Duplicates never accumulate. */
export function togglePizzaOption(half: PizzaHalfDraft, role: PizzaOptionRole, optionId: string): PizzaHalfDraft {
  const current = half[role];
  const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
  return { ...half, [role]: next };
}

/** Switching the product of a half drops every pick: they belong to the previous product's groups. */
export function pickHalfProduct(productId: string): PizzaHalfDraft {
  return emptyPizzaHalf(productId);
}

/** One base group of the product with its active, selectable options. */
export interface PizzaSetupGroup {
  readonly group: MenuModifierGroupV1;
  readonly options: readonly MenuModifierOptionV1[];
}

/** One loose charged option and the group that offers it (the group may also be a base group). */
export interface PizzaExtraChoice {
  readonly group: MenuModifierGroupV1;
  readonly option: MenuModifierOptionV1;
}

export interface PizzaHalfSetup {
  /** Every free/base group; N is shared and split among all of them. */
  readonly baseGroups: readonly PizzaSetupGroup[];
  /** Recipe options of a specialty, taken from any base group. */
  readonly recipeOptions: readonly MenuModifierOptionV1[];
  /** Loose charged options; they never consume N and are never merged with ingredients. */
  readonly extraOptions: readonly PizzaExtraChoice[];
  /** Custom: choose ingredients. */
  readonly canChooseIngredients: boolean;
  /** Specialty with `customizeAtOrder`: remove recipe ingredients. */
  readonly canRemove: boolean;
  /** Extras are offered when the pizza is custom or the specialty allows customizing at order time. */
  readonly canAddExtras: boolean;
}

/** The legacy singular fields are still read and normalized here; the editor never emits them. */
function baseGroupIds(product: MenuProductV1): readonly string[] {
  return product.baseGroupIds ?? (product.baseGroupId == null ? [] : [product.baseGroupId]);
}

function looseExtras(product: MenuProductV1, catalogGroups: readonly MenuModifierGroupV1[]): readonly PizzaExtraChoice[] {
  const activeGroups = catalogGroups.filter((group) => group.active !== false);
  const find = (optionId: string): PizzaExtraChoice | undefined => {
    for (const group of activeGroups) {
      const option = group.options.find((candidate) => candidate.optionId === optionId && candidate.active);
      if (option !== undefined) return { group, option };
    }
    return undefined;
  };
  if (product.extraOptionIds !== undefined) {
    return product.extraOptionIds.flatMap((optionId) => find(optionId) ?? []);
  }
  // Legacy `extraGroupIds` expands to the active options of those groups, the same offer the old model had.
  return (product.extraGroupIds ?? []).flatMap((groupId) => {
    const group = activeGroups.find((candidate) => candidate.groupId === groupId);
    return group === undefined ? [] : group.options.filter((option) => option.active).map((option) => ({ group, option }));
  });
}

export function pizzaHalfSetup(product: MenuProductV1, catalogGroups: readonly MenuModifierGroupV1[]): PizzaHalfSetup {
  const custom = product.pizzaMode === "custom";
  const customize = product.customizeAtOrder === true;
  const baseGroups = baseGroupIds(product).flatMap((groupId) => {
    const group = catalogGroups.find((candidate) => candidate.groupId === groupId);
    return group === undefined ? [] : [{ group, options: group.options.filter((option) => option.active) }];
  });
  const recipeIds = new Set(product.defaultIngredientOptionIds ?? []);
  const extraOptions = looseExtras(product, catalogGroups);
  return {
    baseGroups,
    canAddExtras: (custom || customize) && extraOptions.length > 0,
    canChooseIngredients: custom && baseGroups.length > 0,
    canRemove: product.pizzaMode === "specialty" && customize,
    extraOptions,
    recipeOptions: baseGroups.flatMap(({ options }) => options.filter((option) => recipeIds.has(option.optionId))),
  };
}

/** Ingredients chosen in one half against the product's N, for the visible counter. Never an amount. */
export interface PizzaIngredientCounter {
  readonly chosen: number;
  readonly free: number;
}

export function pizzaIngredientCounter(product: MenuProductV1, half: Pick<PizzaHalfDraft, "ingredientOptionIds">): PizzaIngredientCounter {
  return { chosen: half.ingredientOptionIds.length, free: product.freeIngredientCount ?? 0 };
}

/**
 * Charges the server reports for a line, taken from its quote only (`subtotalMinor` already includes them).
 * The client never prices the catalog; this just subtracts the quoted base to label the counter's `+$X`.
 */
export function pizzaServerChargesMinor(
  quote: Pick<CaptureLineQuoteResultV1, "subtotalMinor" | "unitPriceMinor">,
  quantity: number,
): number {
  const charged = quote.subtotalMinor - quote.unitPriceMinor * Math.max(1, quantity);
  return charged > 0 ? charged : 0;
}

/** Variant of `product` that matches a size name (the two halves must share the size), `null` when sold without sizes. */
export function matchingVariantId(product: MenuProductV1, sizeName: string | null): string | null | undefined {
  const variants: readonly MenuProductVariantV1[] = (product.variants ?? []).filter((variant) => variant.active);
  if (variants.length === 0) return sizeName === null ? null : undefined;
  if (sizeName === null) return undefined;
  const key = sizeName.trim().toLowerCase();
  return variants.find((variant) => variant.name.trim().toLowerCase() === key)?.variantId;
}

/** Visible reason a half cannot be sent, or `null`. The server still revalidates against the live catalog. */
export function pizzaHalfIssue(product: MenuProductV1, catalogGroups: readonly MenuModifierGroupV1[], half: PizzaHalfDraft): string | null {
  const setup = pizzaHalfSetup(product, catalogGroups);
  const name = product.name;
  if (setup.baseGroups.length === 0) return `${name} no tiene grupo de ingredientes configurado.`;
  const baseOptionIds = new Set(setup.baseGroups.flatMap(({ options }) => options.map((option) => option.optionId)));
  if (half.ingredientOptionIds.some((id) => !baseOptionIds.has(id))) return `${name}: un ingrediente ya no está disponible.`;
  for (const { group, options } of setup.baseGroups) {
    const chosen = half.ingredientOptionIds.filter((id) => options.some((option) => option.optionId === id)).length;
    if (product.pizzaMode === "custom" && chosen < group.minimumQuantity) {
      return `${name}: elige al menos ${group.minimumQuantity} ingredientes de ${group.name || "Ingredientes"}.`;
    }
    if (chosen > group.maximumQuantity) return `${group.name || name}: máximo ${group.maximumQuantity}.`;
    if (product.pizzaMode !== "custom" && chosen > 0) return `${name}: una especialidad no lleva ingredientes elegidos.`;
  }
  const recipeIds = new Set(setup.recipeOptions.map((option) => option.optionId));
  if (half.removedIngredientOptionIds.some((id) => !recipeIds.has(id))) return `${name}: sólo se pueden quitar ingredientes de la receta.`;
  if (half.removedIngredientOptionIds.length > 0 && !setup.canRemove) return `${name}: no se pueden quitar ingredientes.`;
  const extraIds = new Set(setup.extraOptions.map(({ option }) => option.optionId));
  if (half.extraOptionIds.some((id) => !extraIds.has(id))) return `${name}: un extra ya no está disponible.`;
  if (half.extraOptionIds.some((id) => half.ingredientOptionIds.includes(id))) return `${name}: un ingrediente no puede ser extra a la vez.`;
  if (half.extraOptionIds.length > 0 && !setup.canAddExtras) return `${name}: no admite extras.`;
  const extraGroups = new Map<string, MenuModifierGroupV1>();
  for (const { group } of setup.extraOptions) extraGroups.set(group.groupId, group);
  for (const group of extraGroups.values()) {
    const offered = setup.extraOptions.filter(({ group: owner }) => owner.groupId === group.groupId).map(({ option }) => option.optionId);
    const chosen = half.extraOptionIds.filter((id) => offered.includes(id)).length;
    if (chosen > group.maximumQuantity) return `${group.name || "Extras"}: máximo ${group.maximumQuantity}.`;
    if (setup.canAddExtras && chosen < group.minimumQuantity) return `${group.name || "Extras"}: elige al menos ${group.minimumQuantity}.`;
  }
  return null;
}

export interface PizzaBuildContext {
  /** Name of the size picked on half A (`null` when the product has no sizes). */
  readonly sizeName: string | null;
  readonly variantIdA: string | null;
  readonly productsById: ReadonlyMap<string, MenuProductV1>;
  readonly catalogGroups: readonly MenuModifierGroupV1[];
}

export type PizzaBuildResult =
  | { readonly ok: true; readonly pizza: PizzaLineV2 }
  | { readonly ok: false; readonly message: string };

/** Validates the draft and builds the wire `pizza`. A whole pizza sends half A's picks on both halves. */
export function buildPizzaLine(draft: PizzaDraft, context: PizzaBuildContext): PizzaBuildResult {
  const productA = context.productsById.get(draft.a.productId);
  if (productA === undefined) return { message: "La pizza ya no está en el menú.", ok: false };
  const halfB = draft.split ? draft.b : draft.a;
  if (halfB === null) return { message: "Elige la pizza de la otra mitad.", ok: false };
  const productB = context.productsById.get(halfB.productId);
  if (productB === undefined) return { message: "La otra mitad ya no está en el menú.", ok: false };
  const variantIdB = draft.split ? matchingVariantId(productB, context.sizeName) : context.variantIdA;
  if (variantIdB === undefined) return { message: `${productB.name} no se vende en este tamaño.`, ok: false };
  const issue = pizzaHalfIssue(productA, context.catalogGroups, draft.a) ?? (draft.split ? pizzaHalfIssue(productB, context.catalogGroups, halfB) : null);
  if (issue !== null) return { message: issue, ok: false };
  const wire = (fraction: PizzaHalfFraction, half: PizzaHalfDraft, variantId: string | null): PizzaHalfV2 => ({
    extraOptionIds: half.extraOptionIds, fraction, ingredientOptionIds: half.ingredientOptionIds,
    productId: half.productId, removedIngredientOptionIds: half.removedIngredientOptionIds, variantId,
  });
  return { ok: true, pizza: { halves: [wire("half-a", draft.a, context.variantIdA), wire("half-b", halfB, variantIdB)], ruleVersion: PIZZA_RULE_V2 } };
}

/** Canonical comparison used to merge identical lines (the order of ids inside a role is irrelevant). */
export function samePizzaLine(left: PizzaLineV2 | undefined, right: PizzaLineV2 | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.halves.every((half, index) => {
    const other = right.halves[index];
    return other !== undefined && half.productId === other.productId && half.variantId === other.variantId && sameHalfPicks(half, other);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function uuidList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 60) return undefined;
  return value.every((entry) => typeof entry === "string" && UUID.test(entry)) ? (value as string[]) : undefined;
}

/** Structural check of a `pizza` object before it is forwarded; the API remains the authority. */
export function parsePizzaLineV2(value: unknown): PizzaLineV2 | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { halves, ruleVersion } = value as { halves?: unknown; ruleVersion?: unknown };
  if (ruleVersion !== PIZZA_RULE_V2 || !Array.isArray(halves) || halves.length !== 2) return undefined;
  const parsed: PizzaHalfV2[] = [];
  for (const [index, raw] of halves.entries()) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const half = raw as Record<string, unknown>;
    const ingredientOptionIds = uuidList(half.ingredientOptionIds);
    const extraOptionIds = uuidList(half.extraOptionIds);
    const removedIngredientOptionIds = uuidList(half.removedIngredientOptionIds);
    const variantId = half.variantId;
    const fraction: PizzaHalfFraction = index === 0 ? "half-a" : "half-b";
    if (half.fraction !== fraction || typeof half.productId !== "string" || !UUID.test(half.productId)
      || (variantId !== null && (typeof variantId !== "string" || !UUID.test(variantId)))
      || ingredientOptionIds === undefined || extraOptionIds === undefined || removedIngredientOptionIds === undefined) return undefined;
    parsed.push({ extraOptionIds, fraction,ingredientOptionIds, productId: half.productId, removedIngredientOptionIds, variantId });
  }
  const [first, second] = parsed;
  return first === undefined || second === undefined ? undefined : { halves: [first, second], ruleVersion: PIZZA_RULE_V2 };
}

export interface PizzaSplitInput {
  /** The input without any `pizza`, ready for the shared V1 parser. */
  readonly rest: unknown;
  readonly pizza: PizzaLineV2 | null;
}

/** Separates an optional `pizza` from a quote request; `undefined` when `pizza` is present but malformed. */
export function splitQuotePizza(input: unknown): PizzaSplitInput | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input) || !Object.hasOwn(input, "pizza")) return { pizza: null, rest: input };
  const { pizza: raw, ...rest } = input as Record<string, unknown>;
  const pizza = parsePizzaLineV2(raw);
  return pizza === undefined ? undefined : { pizza, rest };
}

export interface PizzaSplitPlan {
  /** The command as a schemaVersion 1 command without `pizza`, ready for the shared V1 parser. */
  readonly v1Input: unknown;
  readonly pizzaByLineId: ReadonlyMap<string, PizzaLineV2>;
  readonly schemaVersion: 1 | 2;
}

/**
 * Separates the `pizza` of every line of a schemaVersion 2 replace-plan command. Version 1 passes through
 * untouched; any other version, or a malformed pizza, returns `undefined` (fail closed).
 */
export function splitPlanPizza(input: unknown): PizzaSplitPlan | undefined {
  const plan = typeof input === "object" && input !== null ? (input as { plan?: unknown }).plan : undefined;
  const version = typeof plan === "object" && plan !== null ? (plan as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version !== 2) return { pizzaByLineId: new Map(), schemaVersion: 1, v1Input: input };
  const lines = (plan as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return undefined;
  const pizzaByLineId = new Map<string, PizzaLineV2>();
  const stripped: unknown[] = [];
  for (const line of lines) {
    if (typeof line !== "object" || line === null || Array.isArray(line)) return undefined;
    const { pizza, ...rest } = line as Record<string, unknown>;
    if (Object.hasOwn(line, "pizza")) {
      const parsed = parsePizzaLineV2(pizza);
      if (parsed === undefined || typeof rest.lineId !== "string" || Object.hasOwn(rest, "fraction")) return undefined;
      pizzaByLineId.set(rest.lineId, parsed);
    }
    stripped.push(rest);
  }
  return { pizzaByLineId, schemaVersion: 2, v1Input: { ...(input as Record<string, unknown>), plan: { ...(plan as Record<string, unknown>), lines: stripped, schemaVersion: 1 } } };
}

/** Rebuilds the schemaVersion 2 body from a validated V1 command and the separated pizza lines. */
export function withPlanPizza<T extends { readonly plan: { readonly lines: readonly { readonly lineId: string }[] } }>(
  command: T, pizzaByLineId: ReadonlyMap<string, PizzaLineV2>,
): unknown {
  return { ...command, plan: { ...command.plan, lines: command.plan.lines.map((line) => pizzaByLineId.has(line.lineId) ? { ...line, pizza: pizzaByLineId.get(line.lineId) } : line), schemaVersion: 2 } };
}
