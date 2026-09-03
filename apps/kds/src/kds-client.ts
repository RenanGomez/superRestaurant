import {
  parseBranchMembershipListV1,
  parseKdsEventPageV1,
  parseKdsTicketListV1,
  parseOrderMutationSummaryV1,
  type BranchMembershipListV1,
  type KdsCursorV1,
  type KdsEventPageV1,
  type KdsTicketListV1,
  type KdsTicketV1,
  type OrderItemForwardStatusV1,
  type OrderMutationSummaryV1,
  type RealtimeSubscriptionV1,
} from "@super-restaurant/shared-types";

import type { KdsConfig } from "./config.js";

export class KdsRequestError extends Error {
  public constructor(public readonly status: number | "network" | "protocol") {
    super("KDS_REQUEST_FAILED");
    this.name = "KdsRequestError";
  }
}

export async function listMemberships(
  config: KdsConfig,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<BranchMembershipListV1> {
  return request(config, accessToken, "/api/v1/access/memberships", parseBranchMembershipListV1, fetcher);
}

export async function listKdsTickets(
  config: KdsConfig,
  accessToken: string,
  subscription: RealtimeSubscriptionV1,
  fetcher: typeof fetch = fetch,
): Promise<KdsTicketListV1> {
  const query = subscriptionQuery(subscription);
  return request(config, accessToken, `/api/v1/kds/tickets?${query}`, parseKdsTicketListV1, fetcher);
}

export async function recoverKdsEvents(
  config: KdsConfig,
  accessToken: string,
  subscription: RealtimeSubscriptionV1,
  after: KdsCursorV1,
  fetcher: typeof fetch = fetch,
): Promise<KdsEventPageV1> {
  const query = `${subscriptionQuery(subscription)}&after=${encodeURIComponent(after)}&limit=200`;
  return request(config, accessToken, `/api/v1/kds/events?${query}`, parseKdsEventPageV1, fetcher);
}

export async function transitionKdsTicket(
  config: KdsConfig,
  accessToken: string,
  ticket: KdsTicketV1,
  to: Extract<OrderItemForwardStatusV1, "preparing" | "ready">,
  deviceId: string,
  createId: () => string = () => crypto.randomUUID(),
  fetcher: typeof fetch = fetch,
): Promise<OrderMutationSummaryV1> {
  const eventId = createId();
  const body = {
    deviceId,
    eventId,
    expectedVersion: ticket.orderVersion,
    idempotencyKey: eventId,
    occurredAt: new Date().toISOString(),
    orderId: ticket.orderId,
    orderItemId: ticket.orderItemId,
    schemaVersion: 1,
    scope: ticket.scope,
    to,
  };
  return request(config, accessToken, "/api/v1/orders/items/transition", parseOrderMutationSummaryV1, fetcher, {
    body: JSON.stringify(body),
    method: "POST",
  });
}

function subscriptionQuery(subscription: RealtimeSubscriptionV1): string {
  return new URLSearchParams({
    branchId: subscription.scope.branchId,
    restaurantId: subscription.scope.restaurantId,
    stationId: subscription.stationId,
  }).toString();
}

async function request<T>(
  config: KdsConfig,
  accessToken: string,
  path: string,
  parser: (value: unknown) => T | undefined,
  fetcher: typeof fetch,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${config.apiBaseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
    });
  } catch {
    throw new KdsRequestError("network");
  }
  if (!response.ok) throw new KdsRequestError(response.status);
  let value: unknown;
  try { value = await response.json(); } catch { throw new KdsRequestError("protocol"); }
  const parsed = parser(value);
  if (parsed === undefined) throw new KdsRequestError("protocol");
  return parsed;
}
