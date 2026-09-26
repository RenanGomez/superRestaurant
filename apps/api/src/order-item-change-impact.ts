import {
  parseAssessOrderItemChangeImpactRequestV1,
  parseOrderItemChangeImpactProjectionV1,
  type OrderItemChangeImpactProjectionV1,
} from "@super-restaurant/shared-types";
import {
  InvalidOrderItemChangeImpactError,
  assessOrderItemChangeImpact,
} from "@super-restaurant/domain";

export type OrderItemChangeImpactApplicationErrorCode = "request" | "unavailable";

export class OrderItemChangeImpactApplicationError extends Error {
  public constructor(public readonly code: OrderItemChangeImpactApplicationErrorCode) {
    super(`ORDER_ITEM_CHANGE_IMPACT_${code.toUpperCase()}`);
    this.name = "OrderItemChangeImpactApplicationError";
  }
}

/**
 * Pure transport/domain boundary. It classifies the consequences of a
 * requested order-item change (cancel or replace) from persisted-state facts
 * only. The caller must supply itemStatus/orderStatus/inventoryCommitment as
 * read from the authoritative record, and must independently authorize the
 * actor's role and audit reason before executing anything — this function
 * never accepts a client-asserted authorization decision, never persists,
 * and never issues SQL.
 */
export function projectOrderItemChangeImpact(input: unknown): OrderItemChangeImpactProjectionV1 {
  const request = parseAssessOrderItemChangeImpactRequestV1(input);
  if (request === undefined) throw applicationError("request");
  try {
    const impact = assessOrderItemChangeImpact({
      capturedAmountMinor: request.capturedAmountMinor,
      inventoryCommitment: request.inventoryCommitment,
      itemStatus: request.itemStatus,
      operation: request.operation,
      orderStatus: request.orderStatus,
    });
    const result = parseOrderItemChangeImpactProjectionV1({ ...request, ...impact });
    if (result === undefined) throw unavailable();
    return result;
  } catch (error: unknown) {
    if (error instanceof OrderItemChangeImpactApplicationError) throw error;
    if (error instanceof InvalidOrderItemChangeImpactError) throw applicationError("request");
    throw unavailable();
  }
}

function applicationError(code: OrderItemChangeImpactApplicationErrorCode): OrderItemChangeImpactApplicationError {
  return new OrderItemChangeImpactApplicationError(code);
}

function unavailable(): OrderItemChangeImpactApplicationError {
  return applicationError("unavailable");
}
