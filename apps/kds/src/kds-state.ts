import type { KdsTicketV1 } from "@super-restaurant/shared-types";

export type KdsAction = "preparing" | "ready";

export function nextKdsAction(status: KdsTicketV1["status"]): KdsAction | undefined {
  if (status === "sent") return "preparing";
  if (status === "preparing") return "ready";
  return undefined;
}

export function orderTicketsForDisplay(tickets: readonly KdsTicketV1[]): readonly KdsTicketV1[] {
  const priority: Readonly<Record<KdsTicketV1["status"], number>> = { preparing: 0, sent: 1, ready: 2 };
  return Object.freeze([...tickets].sort((left, right) => (
    priority[left.status] - priority[right.status]
    || left.queuedAt.localeCompare(right.queuedAt)
    || left.orderId.localeCompare(right.orderId)
    || left.orderItemId.localeCompare(right.orderItemId)
  )));
}
