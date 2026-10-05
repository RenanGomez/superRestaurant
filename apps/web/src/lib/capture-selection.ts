import type { MenuCatalogV1, MenuCategoryV1, MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";

/** One chosen modifier option and how many units of it apply to a draft line. */
export interface SelectionPlanModifierSelectionDraft {
  readonly optionId: string;
  readonly quantity: number;
}

/** A modifier group's selections for one draft line. */
export interface SelectionPlanModifierGroupDraft {
  readonly groupId: string;
  readonly selections: readonly SelectionPlanModifierSelectionDraft[];
}

/** The sheet tracks one entry per tap; the API requires one entry per option with its count. */
export function countModifierSelections(optionIds: readonly string[]): readonly SelectionPlanModifierSelectionDraft[] {
  const counts = new Map<string, number>();
  for (const optionId of optionIds) counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
  return [...counts].map(([optionId, quantity]) => ({ optionId, quantity }));
}

/** Restore a server line into the sheet's per-unit selection state. */
export function expandModifierSelections(selections: readonly SelectionPlanModifierSelectionDraft[]): readonly string[] {
  return selections.flatMap(({ optionId, quantity }) => Array(quantity).fill(optionId) as string[]);
}

/** Toggle a single-unit option, or step a repeatable option one unit at a time. */
export function toggleOrStepOption(
  selection: readonly string[], optionId: string, delta: -1 | 1, maximumQuantity: number | null,
): readonly string[] {
  const selectedCount = selection.filter((id) => id === optionId).length;
  if (delta === 1) {
    if (maximumQuantity === 1 && selectedCount > 0) return selection.filter((id) => id !== optionId);
    if (maximumQuantity !== null && selectedCount >= maximumQuantity) return selection;
    return [...selection, optionId];
  }
  const index = selection.lastIndexOf(optionId);
  return index < 0 ? selection : selection.filter((_, position) => position !== index);
}

/**
 * One catalog-derived line as tracked by the client while building a selection. Carries no
 * price: the server derives money exclusively from the catalog at read/write time.
 */
export interface SelectionPlanLineDraft {
  readonly lineId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly quantity: number;
  readonly modifierGroups: readonly SelectionPlanModifierGroupDraft[];
  /** Free-text instruction for the preparation station (1-200 chars), or no note. */
  readonly note: string | null;
}

/** Catalog-only preview. The server remains authoritative for the accepted line price. */
export function estimateSelectionMinor(
  product: MenuProductV1,
  groups: readonly MenuModifierGroupV1[],
  selections: Readonly<Record<string, readonly string[]>>,
  quantity: number,
  variantId: string | null = null,
): number | null {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(product.unitPriceMinor)) return null;
  const activeVariants = product.variants?.filter((variant) => variant.active) ?? [];
  const selectedVariant = activeVariants.find((variant) => variant.variantId === variantId);
  if ((activeVariants.length > 0 && selectedVariant === undefined) || (activeVariants.length === 0 && variantId !== null)) return null;
  let unit = selectedVariant?.unitPriceMinor ?? product.unitPriceMinor;
  for (const group of groups) {
    for (const optionId of selections[group.groupId] ?? []) {
      const option = group.options.find((candidate) => candidate.optionId === optionId);
      if (option === undefined || !Number.isSafeInteger(option.unitPriceMinor)) return null;
      unit += option.unitPriceMinor;
    }
  }
  const total = unit * quantity;
  return Number.isSafeInteger(total) ? total : null;
}

export interface SelectionPlanCommandLineV1 {
  readonly lineId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly quantity: number;
  readonly modifierGroups: readonly { readonly groupId: string; readonly selections: readonly { readonly optionId: string; readonly quantity: number }[] }[];
  readonly note: string | null;
}

export interface SelectionPlanCommandV1 {
  readonly schemaVersion: 1;
  readonly catalogVersion: string;
  readonly lines: readonly SelectionPlanCommandLineV1[];
}

/**
 * Builds the `plan` payload of `ReplaceCaptureSelectionPlanCommandV1` from the client's working
 * set of draft lines, forwarding each line's kitchen note verbatim.
 */
export function buildSelectionPlan(
  lines: readonly SelectionPlanLineDraft[],
  catalogVersion: string,
): SelectionPlanCommandV1 {
  return {
    schemaVersion: 1,
    catalogVersion,
    lines: lines.map((line) => ({
      lineId: line.lineId,
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      modifierGroups: line.modifierGroups.map((group) => ({
        groupId: group.groupId,
        selections: group.selections.map((selection) => ({ optionId: selection.optionId, quantity: selection.quantity })),
      })),
      note: line.note,
    })),
  };
}

export type SelectionLineChange =
  | { readonly type: "add"; readonly lineId: string; readonly productId: string; readonly quantity: number;
      readonly variantId: string | null; readonly modifierGroups: readonly SelectionPlanModifierGroupDraft[]; readonly note: string | null }
  | { readonly type: "increment"; readonly lineId: string }
  | { readonly type: "decrement"; readonly lineId: string }
  | { readonly type: "remove"; readonly lineId: string }
  | { readonly type: "setQuantity"; readonly lineId: string; readonly quantity: number }
  | { readonly type: "setNote"; readonly lineId: string; readonly note: string | null };

const MAX_LINE_QUANTITY = 1_000;

/**
 * Applies one local change to the working set of draft lines. Adding a product with the same
 * modifier selection as an existing line merges into it (quantity increases) instead of creating
 * a duplicate line; adding with a different (or no) selection creates a new line. Quantities are
 * clamped to `[0, 1000]`; reaching 0 removes the line.
 */
export function applyLineChange(
  lines: readonly SelectionPlanLineDraft[],
  change: SelectionLineChange,
): readonly SelectionPlanLineDraft[] {
  if (change.type === "add") {
    const existingIndex = lines.findIndex((line) => line.productId === change.productId && line.variantId === change.variantId
      && sameModifierSelection(line.modifierGroups, change.modifierGroups) && line.note === change.note);
    if (existingIndex === -1) {
      return [...lines, { lineId: change.lineId, productId: change.productId, variantId: change.variantId,
        quantity: clampQuantity(change.quantity), modifierGroups: change.modifierGroups, note: change.note }];
    }
    return lines.map((line, index) => index === existingIndex
      ? { ...line, quantity: clampQuantity(line.quantity + change.quantity) }
      : line);
  }
  if (change.type === "increment") {
    return lines.map((line) => line.lineId === change.lineId
      ? { ...line, quantity: clampQuantity(line.quantity + 1) }
      : line);
  }
  if (change.type === "decrement") {
    return lines.flatMap((line) => {
      if (line.lineId !== change.lineId) return [line];
      const next = line.quantity - 1;
      return next <= 0 ? [] : [{ ...line, quantity: next }];
    });
  }
  if (change.type === "remove") return lines.filter((line) => line.lineId !== change.lineId);
  if (change.type === "setNote") {
    return lines.map((line) => line.lineId === change.lineId ? { ...line, note: change.note } : line);
  }
  return lines.flatMap((line) => {
    if (line.lineId !== change.lineId) return [line];
    const next = clampQuantity(change.quantity);
    return next <= 0 ? [] : [{ ...line, quantity: next }];
  });
}

function clampQuantity(value: number): number {
  return Math.max(0, Math.min(MAX_LINE_QUANTITY, Math.trunc(value)));
}

function sameModifierSelection(
  left: readonly SelectionPlanModifierGroupDraft[],
  right: readonly SelectionPlanModifierGroupDraft[],
): boolean {
  if (left.length !== right.length) return false;
  const canonical = (groups: readonly SelectionPlanModifierGroupDraft[]) => [...groups]
    .map((group) => ({ groupId: group.groupId,
      selections: [...group.selections].map((s) => `${s.optionId}:${s.quantity}`).sort() }))
    .sort((a, b) => a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0);
  const canonicalLeft = canonical(left);
  const canonicalRight = canonical(right);
  return canonicalLeft.every((group, index) => group.groupId === canonicalRight[index]?.groupId
    && group.selections.length === canonicalRight[index]?.selections.length
    && group.selections.every((s, i) => s === canonicalRight[index]?.selections[i]));
}

export interface CategoryWithProducts {
  readonly category: MenuCategoryV1;
  readonly products: readonly MenuProductV1[];
}

/** Groups active categories (sorted by `displayOrder`) with their catalog products (sorted by `displayOrder`). */
export function groupProductsByCategory(catalog: MenuCatalogV1 | null): readonly CategoryWithProducts[] {
  if (catalog === null) return [];
  const categories = [...catalog.categories].filter((category) => category.active)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  return categories.map((category) => ({
    category,
    products: [...catalog.products].filter((product) => product.categoryId === category.categoryId)
      .sort((a, b) => a.displayOrder - b.displayOrder),
  }));
}

export interface ModifierSelectionValidation {
  readonly valid: boolean;
  readonly reason?: "min" | "max" | "option_max";
}

/**
 * Client-side-only UX validation of a modifier group's selections against its
 * `minimumQuantity`/`maximumQuantity` and each option's own `maximumQuantity`. The server
 * revalidates independently; this never authorizes a write.
 */
export function validateModifierSelection(
  group: MenuModifierGroupV1,
  selections: readonly SelectionPlanModifierSelectionDraft[],
): ModifierSelectionValidation {
  const total = selections.reduce((sum, selection) => sum + selection.quantity, 0);
  for (const selection of selections) {
    const option = group.options.find((candidate) => candidate.optionId === selection.optionId);
    if (option?.maximumQuantity !== null && option?.maximumQuantity !== undefined
      && selection.quantity > option.maximumQuantity) {
      return { valid: false, reason: "option_max" };
    }
  }
  if (total < group.minimumQuantity) return { valid: false, reason: "min" };
  if (total > group.maximumQuantity) return { valid: false, reason: "max" };
  return { valid: true };
}
