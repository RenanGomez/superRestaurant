import { parseSendOrderToKitchenCommandV1, type ActiveTableOrderSummaryV2, type SendOrderToKitchenCommandV1 } from "@super-restaurant/shared-types";
import type { MobileBranchScope } from "./mobile-client.js";

/** Snapshot the exact pending lines and identity once so an ambiguous retry is identical. */
export function kitchenCommand(input: {
  readonly deviceId: string; readonly scope: MobileBranchScope; readonly order: ActiveTableOrderSummaryV2;
  readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string;
}): SendOrderToKitchenCommandV1 | undefined {
  if (input.order.status !== "draft" && input.order.status !== "open") return undefined;
  return parseSendOrderToKitchenCommandV1({
    deviceId: input.deviceId, eventId: input.eventId, idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt, orderId: input.order.orderId,
    orderItemIds: input.order.items.filter((item) => item.status === "pending").map((item) => item.orderItemId),
    expectedVersion: input.order.version, schemaVersion: 1, scope: input.scope,
  });
}

/** A retry keeps the original snapshot and audit identity, even if the displayed order changes. */
export function kitchenAttempt(previous: SendOrderToKitchenCommandV1 | undefined, input: Parameters<typeof kitchenCommand>[0]): SendOrderToKitchenCommandV1 | undefined {
  return previous ?? kitchenCommand(input);
}
