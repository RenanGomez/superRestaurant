import { parseMenuCategoryAppearanceV1 } from "@super-restaurant/shared-types";
import type { MenuCategoryV1, MenuModifierGroupV1, MenuProductV1, MenuSizePresetV1 } from "@super-restaurant/shared-types";

export interface LocalMenuDraft {
  readonly categories: readonly MenuCategoryV1[];
  readonly expectedVersion: number;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly products: readonly MenuProductV1[];
  readonly sizePresets?: readonly MenuSizePresetV1[];
}

export type MenuDraftParts = Pick<LocalMenuDraft, "categories" | "groups" | "products" | "sizePresets">;

const PREFIX = "menu-draft:";

export function menuDraftKeyPrefix(restaurantId: string, branchId: string): string {
  return `${PREFIX}${restaurantId}:${branchId}:`;
}

export function menuDraftKey(restaurantId: string, branchId: string, expectedVersion: number): string {
  return `${menuDraftKeyPrefix(restaurantId, branchId)}${expectedVersion}`;
}

/** Stable text of the editable parts; two drafts with equal text are the same draft. */
export function menuDraftSnapshot(parts: MenuDraftParts): string {
  return JSON.stringify({ categories: parts.categories, groups: parts.groups, products: parts.products, sizePresets: parts.sizePresets ?? [] });
}

export function serializeMenuDraft(draft: LocalMenuDraft): string {
  return JSON.stringify({ categories: draft.categories, expectedVersion: draft.expectedVersion, groups: draft.groups, products: draft.products, sizePresets: draft.sizePresets ?? [] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allHaveString(values: unknown, field: string): boolean {
  return Array.isArray(values) && values.every((entry) => isRecord(entry) && typeof entry[field] === "string");
}

function validModifierGroupIds(products: readonly Record<string, unknown>[], groupIds: ReadonlySet<string>): boolean {
  return products.every((product) => {
    const ids = product.modifierGroupIds;
    if (ids === undefined) return true;
    return Array.isArray(ids) && ids.every((id) => typeof id === "string" && groupIds.has(id))
      && new Set(ids).size === ids.length;
  });
}

/** Parses a stored draft; `null` for anything that is not a draft of `expectedVersion` (the server revalidates on publish). */
export function parseMenuDraft(raw: string | null, expectedVersion: number): LocalMenuDraft | null {
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value) || value.expectedVersion !== expectedVersion) return null;
  const { categories, groups, products } = value;
  const sizePresets = value.sizePresets;
  if (sizePresets !== undefined && !allHaveString(sizePresets, "id")) return null;
  if (!allHaveString(categories, "categoryId") || !allHaveString(products, "productId") || !allHaveString(groups, "groupId")) return null;
  if (!(groups as readonly Record<string, unknown>[]).every((group) => Array.isArray(group.options))) return null;
  const groupIds = new Set((groups as readonly Record<string, unknown>[]).map((group) => group.groupId as string));
  if (!validModifierGroupIds(products as readonly Record<string, unknown>[], groupIds)) return null;
  // Drafts saved before category colours/images existed lack both fields (read as null); present values must be valid.
  const normalized: MenuCategoryV1[] = [];
  for (const entry of categories as readonly Record<string, unknown>[]) {
    const appearance = parseMenuCategoryAppearanceV1(entry, entry.categoryId as string);
    if (appearance === undefined) return null;
    normalized.push({ ...(entry as unknown as Omit<MenuCategoryV1, "color" | "imagePath">), ...appearance });
  }
  return { categories: normalized, expectedVersion, groups: groups as readonly MenuModifierGroupV1[], products: products as readonly MenuProductV1[], ...(sizePresets === undefined ? {} : { sizePresets: sizePresets as readonly MenuSizePresetV1[] }) };
}

/** Keys of this branch's drafts for versions other than the current one; they can never be recovered. */
export function staleMenuDraftKeys(keys: readonly string[], restaurantId: string, branchId: string, expectedVersion: number): readonly string[] {
  const prefix = menuDraftKeyPrefix(restaurantId, branchId);
  const current = menuDraftKey(restaurantId, branchId, expectedVersion);
  return keys.filter((key) => key.startsWith(prefix) && key !== current);
}

export function recoveredSizePresets(draft: LocalMenuDraft, published: readonly MenuSizePresetV1[]): readonly MenuSizePresetV1[] {
  return draft.sizePresets ?? published;
}
