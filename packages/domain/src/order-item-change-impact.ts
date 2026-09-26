import type { OrderItemState, OrderState } from "./order-state.js";

export const ORDER_ITEM_CHANGE_OPERATIONS = Object.freeze(["cancel", "replace"] as const);
export const ORDER_ITEM_INVENTORY_COMMITMENTS = Object.freeze(["none", "reserved", "consumed", "unknown"] as const);

export type OrderItemChangeOperation = (typeof ORDER_ITEM_CHANGE_OPERATIONS)[number];
export type OrderItemInventoryCommitment = (typeof ORDER_ITEM_INVENTORY_COMMITMENTS)[number];
export type OrderItemChangeBlockReason =
  | "already_cancelled"
  | "financial_compensation_required"
  | "order_terminal"
  | "post_delivery_adjustment_required";
export type OrderItemChangePolicyDecision =
  | "authorization_role"
  | "financial_atomicity"
  | "inventory_disposition"
  | "production_destinations";

export interface AssessOrderItemChangeImpactInput {
  readonly capturedAmountMinor: number;
  readonly inventoryCommitment: OrderItemInventoryCommitment;
  readonly itemStatus: OrderItemState;
  readonly operation: OrderItemChangeOperation;
  readonly orderStatus: OrderState;
}

export interface OrderItemChangeImpact {
  readonly authorization: "elevated" | "not_applicable" | "standard";
  readonly blockReason: OrderItemChangeBlockReason | null;
  readonly execution: "blocked" | "eligible";
  readonly financial: "compensation_required" | "none";
  readonly inventory: "compensation_required" | "none" | "release_required" | "review_required";
  readonly operation: OrderItemChangeOperation;
  readonly policyDecisions: readonly OrderItemChangePolicyDecision[];
  readonly production: "correction_required" | "none" | "post_delivery_adjustment_required";
  readonly replacementLineRequired: boolean;
}

/**
 * Classifies consequences without deciding restaurant policy or performing a mutation.
 * Callers must still authorize and persist every resulting effect atomically/idempotently.
 */
export function assessOrderItemChangeImpact(inputValue: AssessOrderItemChangeImpactInput): OrderItemChangeImpact {
  let input: AssessOrderItemChangeImpactInput;
  try {
    input = normalizeInput(inputValue);
  } catch (error: unknown) {
    if (error instanceof InvalidOrderItemChangeImpactError) throw error;
    throw new InvalidOrderItemChangeImpactError();
  }
  const financial = input.capturedAmountMinor === 0 ? "none" : "compensation_required";
  const production = productionImpact(input.itemStatus);
  const inventory = inventoryImpact(input.inventoryCommitment);
  const authorization = input.itemStatus === "pending"
    ? "standard"
    : input.itemStatus === "cancelled" ? "not_applicable" : "elevated";
  const blockReason = changeBlockReason(input, financial);
  const policyDecisions = new Set<OrderItemChangePolicyDecision>();
  if (authorization === "elevated") policyDecisions.add("authorization_role");
  if (financial === "compensation_required") policyDecisions.add("financial_atomicity");
  if (inventory !== "none") policyDecisions.add("inventory_disposition");
  if (production !== "none") policyDecisions.add("production_destinations");

  return deepFreeze({
    authorization,
    blockReason,
    execution: blockReason === null ? "eligible" : "blocked",
    financial,
    inventory,
    operation: input.operation,
    policyDecisions: [...policyDecisions].sort(compareCodeUnits),
    production,
    replacementLineRequired: input.operation === "replace" && input.itemStatus !== "cancelled",
  });
}

function changeBlockReason(
  input: AssessOrderItemChangeImpactInput,
  financial: OrderItemChangeImpact["financial"],
): OrderItemChangeBlockReason | null {
  if (input.itemStatus === "cancelled") return "already_cancelled";
  if (input.itemStatus === "delivered") return "post_delivery_adjustment_required";
  if (input.orderStatus === "closed" || input.orderStatus === "cancelled") return "order_terminal";
  if (input.orderStatus === "partially_paid" || input.orderStatus === "paid" || financial === "compensation_required") {
    return "financial_compensation_required";
  }
  return null;
}

function productionImpact(status: OrderItemState): OrderItemChangeImpact["production"] {
  if (status === "sent" || status === "preparing" || status === "ready") return "correction_required";
  if (status === "delivered") return "post_delivery_adjustment_required";
  return "none";
}

function inventoryImpact(commitment: OrderItemInventoryCommitment): OrderItemChangeImpact["inventory"] {
  if (commitment === "reserved") return "release_required";
  if (commitment === "consumed") return "compensation_required";
  if (commitment === "unknown") return "review_required";
  return "none";
}

function normalizeInput(value: AssessOrderItemChangeImpactInput): AssessOrderItemChangeImpactInput {
  const record = exactRecord(value, ["capturedAmountMinor", "inventoryCommitment", "itemStatus", "operation", "orderStatus"]);
  const capturedAmountMinor = data(record, "capturedAmountMinor");
  const inventoryCommitment = data(record, "inventoryCommitment");
  const itemStatus = data(record, "itemStatus");
  const operation = data(record, "operation");
  const orderStatus = data(record, "orderStatus");
  if (!Number.isSafeInteger(capturedAmountMinor) || (capturedAmountMinor as number) < 0
    || !includes(ORDER_ITEM_INVENTORY_COMMITMENTS, inventoryCommitment)
    || !includes(["pending", "sent", "preparing", "ready", "delivered", "cancelled"] as const, itemStatus)
    || !includes(ORDER_ITEM_CHANGE_OPERATIONS, operation)
    || !includes(["draft", "open", "partially_paid", "paid", "closed", "cancelled"] as const, orderStatus)) {
    throw new InvalidOrderItemChangeImpactError();
  }
  return Object.freeze({
    capturedAmountMinor: capturedAmountMinor as number,
    inventoryCommitment,
    itemStatus,
    operation,
    orderStatus,
  });
}

export class InvalidOrderItemChangeImpactError extends Error {
  public readonly code = "INVALID_ORDER_ITEM_CHANGE_IMPACT" as const;

  public constructor() {
    super("Order item change impact input is invalid");
    this.name = "InvalidOrderItemChangeImpactError";
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new InvalidOrderItemChangeImpactError();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new InvalidOrderItemChangeImpactError();
  }
  return value as Record<string, unknown>;
}

function data(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidOrderItemChangeImpactError();
  return descriptor.value;
}

function includes<const T extends readonly unknown[]>(values: T, value: unknown): value is T[number] {
  return values.includes(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
    Object.freeze(value);
  }
  return value;
}
