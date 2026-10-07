import type { KdsTicketV1 } from "@super-restaurant/shared-types";

export type KdsAction = "preparing" | "ready";
export const AMBER_AFTER_MINUTES = 10;
export const RED_AFTER_MINUTES = 20;
export const NEW_FOR_SECONDS = 60;

export type KdsOrderGroup = { readonly orderId: string; readonly queuedAt: string; readonly tickets: readonly KdsTicketV1[] };

export function ageBucket(queuedAt: string, now: number): "green" | "amber" | "red" {
  const minutes = Math.max(0, (now - Date.parse(queuedAt)) / 60_000);
  if (minutes < AMBER_AFTER_MINUTES) return "green";
  return minutes <= RED_AFTER_MINUTES ? "amber" : "red";
}

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

export function groupTicketsByOrder(tickets: readonly KdsTicketV1[]): readonly KdsOrderGroup[] {
  const groups = new Map<string, KdsTicketV1[]>();
  for (const ticket of tickets) {
    const group = groups.get(ticket.orderId) ?? [];
    group.push(ticket);
    groups.set(ticket.orderId, group);
  }
  return [...groups].map(([orderId, lines]) => {
    const active = lines.filter((line) => line.status !== "ready");
    const ageLines = active.length > 0 ? active : lines;
    return {
      orderId,
      queuedAt: ageLines.reduce((first, line) => line.queuedAt < first ? line.queuedAt : first, ageLines[0]!.queuedAt),
      tickets: orderTicketsForDisplay(lines),
    };
  }).sort((left, right) => {
    const leftReady = left.tickets.every((line) => line.status === "ready");
    const rightReady = right.tickets.every((line) => line.status === "ready");
    return Number(leftReady) - Number(rightReady) || left.queuedAt.localeCompare(right.queuedAt) || left.orderId.localeCompare(right.orderId);
  });
}

export function planBatchTransition(group: KdsOrderGroup, target: KdsAction): readonly KdsTicketV1[] {
  const from = target === "preparing" ? "sent" : "preparing";
  return group.tickets.filter((ticket) => ticket.status === from);
}

export class BatchTransitionError extends Error {
  public constructor(public readonly completed: number, public override readonly cause: unknown) {
    super("KDS_BATCH_TRANSITION_FAILED");
  }
}

export async function runBatchTransition(
  lines: readonly KdsTicketV1[],
  transition: (ticket: KdsTicketV1) => Promise<{ readonly version: number }>,
): Promise<number> {
  let version = lines[0]?.orderVersion;
  let completed = 0;
  for (const line of lines) {
    try {
      const result = await transition({ ...line, orderVersion: version ?? line.orderVersion });
      version = result.version;
      completed += 1;
    } catch (error) {
      throw new BatchTransitionError(completed, error);
    }
  }
  return completed;
}
