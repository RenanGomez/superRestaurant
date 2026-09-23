import { CurrencyMismatchError, DomainError } from "./errors.js";
import {
  createMenuProductPriceSnapshot,
  validateMenuCatalog,
  type MenuCatalog,
  type MenuModifierGroupSelection,
  type ValidatedMenuCatalog,
} from "./menu.js";
import type { ModifierPriceSnapshot, OrderItemPriceSnapshot } from "./order-totals.js";
import { calculateOrderAggregateTotals, type Order, type OrderItem } from "./order.js";

export const REPEAT_ORDER_ISSUE_CODES = Object.freeze([
  "historical_item_cancelled",
  "product_removed",
  "product_inactive",
  "category_inactive",
  "historical_modifier_unmapped",
  "modifier_group_unavailable",
  "modifier_group_inactive",
  "modifier_option_removed",
  "modifier_option_inactive",
  "modifier_quantity_invalid",
  "modifier_group_requirements_changed",
  "product_price_changed",
  "modifier_price_changed",
] as const);

export type RepeatOrderIssueCode = (typeof REPEAT_ORDER_ISSUE_CODES)[number];
export type RepeatOrderIssueSeverity = "blocking" | "warning";

export interface RepeatOrderIssue {
  readonly code: RepeatOrderIssueCode;
  readonly severity: RepeatOrderIssueSeverity;
  readonly groupId?: string;
  readonly modifierId?: string;
  readonly historicalAmountMinor?: number;
  readonly currentAmountMinor?: number;
}

export interface RepeatOrderSelection {
  readonly productId: string;
  readonly modifierGroups: readonly MenuModifierGroupSelection[];
}

export interface RepeatOrderLinePlan {
  readonly sourceOrderItemId: string;
  readonly productId: string;
  readonly historicalName: string;
  readonly currentName: string | null;
  readonly quantity: number;
  readonly status: "ready" | "blocked";
  readonly selection: RepeatOrderSelection | null;
  /** Current catalog facts only. Historical prices remain evidence, never a new sale input. */
  readonly currentSnapshot: OrderItemPriceSnapshot | null;
  readonly issues: readonly RepeatOrderIssue[];
}

export interface RepeatOrderPlan {
  readonly sourceOrderId: string;
  readonly restaurantId: string;
  readonly sourceBranchId: string;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly readyLineCount: number;
  readonly blockedLineCount: number;
  readonly hasPriceChanges: boolean;
  readonly lines: readonly RepeatOrderLinePlan[];
}

export class RepeatOrderScopeMismatchError extends DomainError {
  public readonly code = "REPEAT_ORDER_SCOPE_MISMATCH";

  public constructor(
    public readonly orderRestaurantId: string,
    public readonly catalogRestaurantId: string,
  ) {
    super("The historical order and current catalog must belong to the same restaurant.");
  }
}

/**
 * Rebuilds historical lines against the current catalog without silently
 * carrying forward unavailable choices, historical prices, or discounts.
 */
export function buildRepeatOrderPlan(order: Order, currentCatalog: MenuCatalog): RepeatOrderPlan {
  calculateOrderAggregateTotals(order);
  const catalog = validateMenuCatalog(currentCatalog);
  if (order.restaurantId !== catalog.restaurantId) {
    throw new RepeatOrderScopeMismatchError(order.restaurantId, catalog.restaurantId);
  }
  if (order.currency !== catalog.currency) {
    throw new CurrencyMismatchError(order.currency, catalog.currency);
  }

  const lines = order.items.map((item) => reconcileLine(item, catalog));
  const readyLineCount = lines.filter(({ status }) => status === "ready").length;
  const hasPriceChanges = lines.some(({ issues }) => issues.some(({ code }) =>
    code === "product_price_changed" || code === "modifier_price_changed"));

  return deepFreeze({
    sourceOrderId: order.orderId,
    restaurantId: order.restaurantId,
    sourceBranchId: order.branchId,
    catalogVersion: catalog.catalogVersion,
    currency: catalog.currency,
    readyLineCount,
    blockedLineCount: lines.length - readyLineCount,
    hasPriceChanges,
    lines,
  });
}

function reconcileLine(item: OrderItem, catalog: ValidatedMenuCatalog): RepeatOrderLinePlan {
  const issues: RepeatOrderIssue[] = [];
  const product = catalog.products.find(({ id }) => id === item.snapshot.productId);
  if (item.status === "cancelled") addIssue(issues, { code: "historical_item_cancelled", severity: "blocking" });
  if (product === undefined) {
    addIssue(issues, { code: "product_removed", severity: "blocking" });
  } else if (!product.active) {
    addIssue(issues, { code: "product_inactive", severity: "blocking" });
  } else {
    const category = catalog.categories.find(({ id }) => id === product.categoryId);
    if (category === undefined || !category.active) {
      addIssue(issues, { code: "category_inactive", severity: "blocking" });
    }
  }

  const grouped = groupHistoricalModifiers(item.snapshot.modifiers, issues);
  const selections = product === undefined ? [] : reconcileModifierSelections(product.modifierGroupIds, grouped, catalog, issues);

  if (issues.some(({ severity }) => severity === "blocking") || product === undefined) {
    return deepFreeze({
      sourceOrderItemId: item.orderItemId,
      productId: item.snapshot.productId,
      historicalName: item.snapshot.name,
      currentName: product?.name ?? null,
      quantity: item.quantity,
      status: "blocked",
      selection: null,
      currentSnapshot: null,
      issues,
    });
  }

  const currentSnapshot = createMenuProductPriceSnapshot(catalog, {
    restaurantId: catalog.restaurantId,
    productId: product.id,
    currency: catalog.currency,
  }, selections);
  appendPriceChanges(item.snapshot, currentSnapshot, issues);

  return deepFreeze({
    sourceOrderItemId: item.orderItemId,
    productId: product.id,
    historicalName: item.snapshot.name,
    currentName: product.name,
    quantity: item.quantity,
    status: "ready",
    selection: { productId: product.id, modifierGroups: selections },
    currentSnapshot,
    issues,
  });
}

function groupHistoricalModifiers(
  modifiers: readonly ModifierPriceSnapshot[],
  issues: RepeatOrderIssue[],
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const groups = new Map<string, Map<string, number>>();
  for (const modifier of modifiers) {
    if (modifier.groupId === undefined) {
      addIssue(issues, {
        code: "historical_modifier_unmapped",
        severity: "blocking",
        modifierId: modifier.modifierId,
      });
      continue;
    }
    const options = groups.get(modifier.groupId) ?? new Map<string, number>();
    if (options.has(modifier.modifierId)) {
      addIssue(issues, {
        code: "modifier_quantity_invalid",
        severity: "blocking",
        groupId: modifier.groupId,
        modifierId: modifier.modifierId,
      });
    } else {
      options.set(modifier.modifierId, modifier.quantity);
      groups.set(modifier.groupId, options);
    }
  }
  return groups;
}

function reconcileModifierSelections(
  allowedGroupIds: readonly string[],
  historicalGroups: ReadonlyMap<string, ReadonlyMap<string, number>>,
  catalog: ValidatedMenuCatalog,
  issues: RepeatOrderIssue[],
): readonly MenuModifierGroupSelection[] {
  const allowed = new Set(allowedGroupIds);
  for (const [groupId, options] of historicalGroups) {
    if (!allowed.has(groupId)) {
      for (const modifierId of options.keys()) {
        addIssue(issues, { code: "modifier_group_unavailable", severity: "blocking", groupId, modifierId });
      }
    }
  }

  return allowedGroupIds.map((groupId) => {
    const group = catalog.modifierGroups.find(({ id }) => id === groupId);
    const historical = historicalGroups.get(groupId) ?? new Map<string, number>();
    if (group === undefined) {
      addIssue(issues, { code: "modifier_group_unavailable", severity: "blocking", groupId });
      return deepFreeze({ groupId, selections: [] });
    }
    if (!group.active) {
      addIssue(issues, { code: "modifier_group_inactive", severity: "blocking", groupId });
    }

    const selections = [...historical].map(([modifierId, quantity]) => {
      const option = group.options.find(({ id }) => id === modifierId);
      if (option === undefined) {
        addIssue(issues, { code: "modifier_option_removed", severity: "blocking", groupId, modifierId });
      } else if (!option.active) {
        addIssue(issues, { code: "modifier_option_inactive", severity: "blocking", groupId, modifierId });
      } else if (option.maximumQuantity !== undefined && quantity > option.maximumQuantity) {
        addIssue(issues, { code: "modifier_quantity_invalid", severity: "blocking", groupId, modifierId });
      }
      return Object.freeze({ optionId: modifierId, quantity });
    });
    const selectedQuantity = selections.reduce((total, { quantity }) => total + quantity, 0);
    if (selectedQuantity < group.minimumQuantity || selectedQuantity > group.maximumQuantity) {
      addIssue(issues, { code: "modifier_group_requirements_changed", severity: "blocking", groupId });
    }
    return deepFreeze({ groupId, selections });
  });
}

function appendPriceChanges(
  historical: OrderItemPriceSnapshot,
  current: OrderItemPriceSnapshot,
  issues: RepeatOrderIssue[],
): void {
  if (!historical.unitPrice.equals(current.unitPrice)) {
    addIssue(issues, {
      code: "product_price_changed",
      severity: "warning",
      historicalAmountMinor: historical.unitPrice.amountMinor,
      currentAmountMinor: current.unitPrice.amountMinor,
    });
  }
  const historicalByKey = new Map(historical.modifiers.map((modifier) => [modifierKey(modifier), modifier]));
  for (const modifier of current.modifiers) {
    const previous = historicalByKey.get(modifierKey(modifier));
    if (previous !== undefined && !previous.unitPrice.equals(modifier.unitPrice)) {
      addIssue(issues, {
        code: "modifier_price_changed",
        severity: "warning",
        ...(modifier.groupId === undefined ? {} : { groupId: modifier.groupId }),
        modifierId: modifier.modifierId,
        historicalAmountMinor: previous.unitPrice.amountMinor,
        currentAmountMinor: modifier.unitPrice.amountMinor,
      });
    }
  }
}

function modifierKey(modifier: ModifierPriceSnapshot): string {
  return `${modifier.groupId ?? ""}\u0000${modifier.modifierId}`;
}

function addIssue(issues: RepeatOrderIssue[], issue: RepeatOrderIssue): void {
  const key = `${issue.code}\u0000${issue.groupId ?? ""}\u0000${issue.modifierId ?? ""}`;
  if (!issues.some((candidate) =>
    `${candidate.code}\u0000${candidate.groupId ?? ""}\u0000${candidate.modifierId ?? ""}` === key)) {
    issues.push(Object.freeze(issue));
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}
