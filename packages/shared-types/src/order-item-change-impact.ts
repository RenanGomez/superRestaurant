export const ORDER_ITEM_CHANGE_IMPACT_SCHEMA_VERSION = 1 as const;

export const ORDER_ITEM_CHANGE_OPERATIONS_V1 = Object.freeze(["cancel", "replace"] as const);
export const ORDER_ITEM_INVENTORY_COMMITMENTS_V1 = Object.freeze(["none", "reserved", "consumed", "unknown"] as const);
export const ORDER_ITEM_STATES_V1 = Object.freeze([
  "pending", "sent", "preparing", "ready", "delivered", "cancelled",
] as const);
export const ORDER_STATES_V1 = Object.freeze([
  "draft", "open", "partially_paid", "paid", "closed", "cancelled",
] as const);
export const ORDER_ITEM_CHANGE_BLOCK_REASONS_V1 = Object.freeze([
  "already_cancelled", "financial_compensation_required", "order_terminal", "post_delivery_adjustment_required",
] as const);
/**
 * Decision 4/5 facts (production destination and reprint availability) are
 * declarative outcomes now carried on the projection directly — they are no
 * longer announced here as a pending policy decision.
 */
export const ORDER_ITEM_CHANGE_POLICY_DECISIONS_V1 = Object.freeze([
  "authorization_role", "financial_atomicity", "inventory_disposition",
] as const);

export type OrderItemChangeOperationV1 = (typeof ORDER_ITEM_CHANGE_OPERATIONS_V1)[number];
export type OrderItemInventoryCommitmentV1 = (typeof ORDER_ITEM_INVENTORY_COMMITMENTS_V1)[number];
export type OrderItemStateV1 = (typeof ORDER_ITEM_STATES_V1)[number];
export type OrderStateV1 = (typeof ORDER_STATES_V1)[number];
export type OrderItemChangeBlockReasonV1 = (typeof ORDER_ITEM_CHANGE_BLOCK_REASONS_V1)[number];
export type OrderItemChangePolicyDecisionV1 = (typeof ORDER_ITEM_CHANGE_POLICY_DECISIONS_V1)[number];
export type OrderItemChangeAuthorizationV1 = "elevated" | "not_applicable" | "standard";
export type OrderItemChangeExecutionV1 = "blocked" | "eligible";
export type OrderItemChangeFinancialV1 = "compensation_required" | "none";
export type OrderItemChangeInventoryV1 = "compensation_required" | "none" | "release_required" | "review_required";
export type OrderItemChangeProductionV1 = "correction_required" | "none" | "post_delivery_adjustment_required";
export type OrderItemChangeProductionDestinationV1 = "kds_primary";
export type OrderItemChangeRefundObligationV1 = "none" | "pending";

/**
 * Client-supplied facts only: current persisted item/order state and the
 * requested operation. `financialCompensationPending` is a fact about an
 * *already existing*, unresolved compensation (never derived from captured
 * money) — the server derives every other authorization and policy outcome
 * from this shape and never accepts a client-asserted decision.
 */
export interface AssessOrderItemChangeImpactRequestV1 {
  readonly capturedAmountMinor: number;
  readonly financialCompensationPending: boolean;
  readonly inventoryCommitment: OrderItemInventoryCommitmentV1;
  readonly itemStatus: OrderItemStateV1;
  readonly operation: OrderItemChangeOperationV1;
  readonly orderStatus: OrderStateV1;
  readonly schemaVersion: typeof ORDER_ITEM_CHANGE_IMPACT_SCHEMA_VERSION;
}

/** Authoritative projection: server-derived consequences of the requested change. */
export interface OrderItemChangeImpactProjectionV1 extends AssessOrderItemChangeImpactRequestV1 {
  readonly authorization: OrderItemChangeAuthorizationV1;
  readonly blockReason: OrderItemChangeBlockReasonV1 | null;
  readonly execution: OrderItemChangeExecutionV1;
  readonly financial: OrderItemChangeFinancialV1;
  readonly inventory: OrderItemChangeInventoryV1;
  readonly policyDecisions: readonly OrderItemChangePolicyDecisionV1[];
  readonly production: OrderItemChangeProductionV1;
  readonly productionDestination: OrderItemChangeProductionDestinationV1 | null;
  readonly refundObligation: OrderItemChangeRefundObligationV1;
  readonly reprintAvailable: boolean;
  readonly replacementLineRequired: boolean;
}

export function parseAssessOrderItemChangeImpactRequestV1(value: unknown): AssessOrderItemChangeImpactRequestV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "capturedAmountMinor", "financialCompensationPending", "inventoryCommitment", "itemStatus",
      "operation", "orderStatus",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== ORDER_ITEM_CHANGE_IMPACT_SCHEMA_VERSION) return undefined;
    const capturedAmountMinor = money(own(record, "capturedAmountMinor"));
    const financialCompensationPending = own(record, "financialCompensationPending");
    const inventoryCommitment = enumValue(own(record, "inventoryCommitment"), ORDER_ITEM_INVENTORY_COMMITMENTS_V1);
    const itemStatus = enumValue(own(record, "itemStatus"), ORDER_ITEM_STATES_V1);
    const operation = enumValue(own(record, "operation"), ORDER_ITEM_CHANGE_OPERATIONS_V1);
    const orderStatus = enumValue(own(record, "orderStatus"), ORDER_STATES_V1);
    if (capturedAmountMinor === undefined || typeof financialCompensationPending !== "boolean"
      || inventoryCommitment === undefined || itemStatus === undefined
      || operation === undefined || orderStatus === undefined) return undefined;
    return Object.freeze({
      capturedAmountMinor,
      financialCompensationPending,
      inventoryCommitment,
      itemStatus,
      operation,
      orderStatus,
      schemaVersion: ORDER_ITEM_CHANGE_IMPACT_SCHEMA_VERSION,
    });
  });
}

export function parseOrderItemChangeImpactProjectionV1(value: unknown): OrderItemChangeImpactProjectionV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "capturedAmountMinor", "financialCompensationPending", "inventoryCommitment", "itemStatus",
      "operation", "orderStatus", "authorization", "blockReason", "execution", "financial", "inventory",
      "policyDecisions", "production", "productionDestination", "refundObligation", "reprintAvailable",
      "replacementLineRequired",
    ]);
    if (record === undefined) return undefined;
    const request = parseAssessOrderItemChangeImpactRequestV1({
      capturedAmountMinor: own(record, "capturedAmountMinor"),
      financialCompensationPending: own(record, "financialCompensationPending"),
      inventoryCommitment: own(record, "inventoryCommitment"),
      itemStatus: own(record, "itemStatus"),
      operation: own(record, "operation"),
      orderStatus: own(record, "orderStatus"),
      schemaVersion: own(record, "schemaVersion"),
    });
    if (request === undefined) return undefined;

    const authorization = enumValue(own(record, "authorization"), ["elevated", "not_applicable", "standard"] as const);
    const rawBlockReason = own(record, "blockReason");
    const blockReason = rawBlockReason === null ? null : enumValue(rawBlockReason, ORDER_ITEM_CHANGE_BLOCK_REASONS_V1);
    const execution = enumValue(own(record, "execution"), ["blocked", "eligible"] as const);
    const financial = enumValue(own(record, "financial"), ["compensation_required", "none"] as const);
    const inventory = enumValue(
      own(record, "inventory"),
      ["compensation_required", "none", "release_required", "review_required"] as const,
    );
    const production = enumValue(
      own(record, "production"),
      ["correction_required", "none", "post_delivery_adjustment_required"] as const,
    );
    const rawProductionDestination = own(record, "productionDestination");
    const productionDestination = rawProductionDestination === null
      ? null
      : enumValue(rawProductionDestination, ["kds_primary"] as const);
    const refundObligation = enumValue(own(record, "refundObligation"), ["none", "pending"] as const);
    const reprintAvailable = own(record, "reprintAvailable");
    const replacementLineRequired = own(record, "replacementLineRequired");
    const policyDecisions = parsePolicyDecisions(own(record, "policyDecisions"));

    if (authorization === undefined || blockReason === undefined || execution === undefined || financial === undefined
      || inventory === undefined || production === undefined || productionDestination === undefined
      || refundObligation === undefined || typeof reprintAvailable !== "boolean"
      || typeof replacementLineRequired !== "boolean" || policyDecisions === undefined) return undefined;

    const expected = deriveExpectedImpact(request);
    if (
      authorization !== expected.authorization
      || blockReason !== expected.blockReason
      || execution !== expected.execution
      || financial !== expected.financial
      || inventory !== expected.inventory
      || production !== expected.production
      || productionDestination !== expected.productionDestination
      || refundObligation !== expected.refundObligation
      || reprintAvailable !== expected.reprintAvailable
      || replacementLineRequired !== expected.replacementLineRequired
      || policyDecisions.length !== expected.policyDecisions.length
      || policyDecisions.some((decision, index) => decision !== expected.policyDecisions[index])
    ) return undefined;

    return Object.freeze({
      ...request,
      authorization,
      blockReason,
      execution,
      financial,
      inventory,
      policyDecisions,
      production,
      productionDestination,
      refundObligation,
      reprintAvailable,
      replacementLineRequired,
    });
  });
}

interface ExpectedImpact {
  readonly authorization: OrderItemChangeAuthorizationV1;
  readonly blockReason: OrderItemChangeBlockReasonV1 | null;
  readonly execution: OrderItemChangeExecutionV1;
  readonly financial: OrderItemChangeFinancialV1;
  readonly inventory: OrderItemChangeInventoryV1;
  readonly policyDecisions: readonly OrderItemChangePolicyDecisionV1[];
  readonly production: OrderItemChangeProductionV1;
  readonly productionDestination: OrderItemChangeProductionDestinationV1 | null;
  readonly refundObligation: OrderItemChangeRefundObligationV1;
  readonly reprintAvailable: boolean;
  readonly replacementLineRequired: boolean;
}

/**
 * Mirrors the pure policy in packages/domain/src/order-item-change-impact.ts
 * so this contract can validate an authoritative projection without importing
 * domain (transport contracts stay independent of business-rule packages).
 * Keep both derivations in lockstep when the approved S6 matrix changes.
 *
 * Approved S6 decision 6: captured money never blocks a change by itself; it
 * only creates a refund obligation. Only an already-pending compensation
 * (`financialCompensationPending`, an input fact) blocks. Decisions 4/5 are
 * carried as declarative facts (`productionDestination`, `reprintAvailable`);
 * S6.3 owns KDS/printer reconciliation and is out of scope here.
 */
function deriveExpectedImpact(request: AssessOrderItemChangeImpactRequestV1): ExpectedImpact {
  const financial: OrderItemChangeFinancialV1 = request.financialCompensationPending
    ? "compensation_required"
    : "none";
  const refundObligation: OrderItemChangeRefundObligationV1 = request.capturedAmountMinor > 0
    || request.orderStatus === "partially_paid" || request.orderStatus === "paid"
    ? "pending"
    : "none";
  const production: OrderItemChangeProductionV1 = request.itemStatus === "sent" || request.itemStatus === "preparing"
    || request.itemStatus === "ready"
    ? "correction_required"
    : request.itemStatus === "delivered" ? "post_delivery_adjustment_required" : "none";
  const inventory: OrderItemChangeInventoryV1 = request.inventoryCommitment === "reserved" ? "release_required"
    : request.inventoryCommitment === "consumed" ? "compensation_required"
      : request.inventoryCommitment === "unknown" ? "review_required" : "none";
  const authorization: OrderItemChangeAuthorizationV1 = request.itemStatus === "pending" ? "standard"
    : request.itemStatus === "cancelled" ? "not_applicable" : "elevated";
  const blockReason: OrderItemChangeBlockReasonV1 | null = request.itemStatus === "cancelled" ? "already_cancelled"
    : request.itemStatus === "delivered" ? "post_delivery_adjustment_required"
      : request.orderStatus === "closed" || request.orderStatus === "cancelled" ? "order_terminal"
        : financial === "compensation_required" ? "financial_compensation_required"
          : null;
  const policyDecisions: OrderItemChangePolicyDecisionV1[] = [];
  if (authorization === "elevated") policyDecisions.push("authorization_role");
  if (financial === "compensation_required") policyDecisions.push("financial_atomicity");
  if (inventory !== "none") policyDecisions.push("inventory_disposition");
  policyDecisions.sort(compareCodeUnits);
  return {
    authorization,
    blockReason,
    execution: blockReason === null ? "eligible" : "blocked",
    financial,
    inventory,
    policyDecisions: Object.freeze(policyDecisions),
    production,
    productionDestination: production === "none" ? null : "kds_primary",
    refundObligation,
    reprintAvailable: production !== "none",
    replacementLineRequired: request.operation === "replace" && request.itemStatus !== "cancelled",
  };
}

function parsePolicyDecisions(value: unknown): readonly OrderItemChangePolicyDecisionV1[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) return undefined;
    const decisions: OrderItemChangePolicyDecisionV1[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      const decision = enumValue(descriptor.value, ORDER_ITEM_CHANGE_POLICY_DECISIONS_V1);
      if (decision === undefined) return undefined;
      decisions.push(decision);
    }
    return Object.freeze(decisions);
  } catch {
    return undefined;
  }
}

type PlainRecord = Record<string, unknown>;

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key))
    ? value as PlainRecord : undefined;
}

function own(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function money(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safely<T>(operation: () => T | undefined): T | undefined {
  try { return operation(); } catch { return undefined; }
}
