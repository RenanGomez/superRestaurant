/**
 * The plan of one logical delivery: every identifier the Order mutations will
 * carry, minted **once**, before the first request.
 *
 * This is what makes a retry safe. `eventId` and `idempotencyKey` are how the
 * server recognises a command it has already applied, so they cannot be minted
 * per attempt: a second try with fresh keys is a second order, a duplicated
 * line, a double open. So one logical delivery builds one immutable plan, and
 * an ambiguous outcome — a request that may or may not have arrived — is
 * retried with that same plan, byte for byte. A *new* delivery builds a new
 * plan and therefore new identities.
 *
 * Nothing here performs a request or persists anything: the plan is a value.
 * The draft itself is never written to the keystore, and no token is part of
 * it; the only stored thing this app has is the `deviceId` (see
 * `src/device-identity.ts`).
 *
 * Validation is not repeated here either. The plan is built on top of
 * `buildOrderDraftHandoff`, so a draft that the published catalog no longer
 * accepts yields `undefined` from the same fail-closed check the composer
 * already used — one rule, one place.
 */
import type { MenuCatalogV1, ModifierGroupSelectionV1 } from "@super-restaurant/shared-types";

import type { MobileBranchScope } from "./mobile-client.js";
import type { OrderDraftLine } from "./order-draft.js";
import { buildOrderDraftHandoff } from "./order-intents.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

/** The audit identity of exactly one mutation. Distinct for every step. */
export interface OrderMutationIdentityV1 {
  readonly eventId: string;
  readonly idempotencyKey: string;
}

export interface OrderDeliveryLinePlanV1 extends OrderMutationIdentityV1 {
  /** The composer's local handle, kept so feedback can name the right line. */
  readonly draftLineId: string;
  readonly modifierGroups: readonly ModifierGroupSelectionV1[];
  readonly orderItemId: string;
  readonly productId: string;
  readonly quantity: number;
}

export interface OrderDeliveryPlanV1 {
  readonly addItems: readonly OrderDeliveryLinePlanV1[];
  /** Mobile order entry is table service; no other channel is offered. */
  readonly channel: "table";
  readonly createOrder: OrderMutationIdentityV1;
  /** Exactly as the published catalog delivered it. Never defaulted. */
  readonly currency: string;
  readonly deviceId: string;
  /** Canonical UTC instant, the one form the shared commands accept. */
  readonly occurredAt: string;
  readonly openOrder: OrderMutationIdentityV1;
  readonly orderId: string;
  readonly scope: MobileBranchScope;
  readonly shiftId: string;
  readonly tableId: string;
  /** The branch's authoritative zone, from the operational context response. */
  readonly timeZone: string;
}

export function buildOrderDeliveryPlan(input: {
  readonly catalog: MenuCatalogV1;
  readonly deviceId: string;
  readonly lines: readonly OrderDraftLine[];
  /** Milliseconds since the epoch; the plan keeps the canonical UTC form of it. */
  readonly now: number;
  readonly randomUuid: () => string;
  readonly scope: MobileBranchScope;
  readonly shiftId: string;
  readonly tableId: string;
  readonly timeZone: string;
}): OrderDeliveryPlanV1 | undefined {
  const handoff = buildOrderDraftHandoff({
    catalog: input.catalog,
    lines: input.lines,
    scope: input.scope,
    tableId: input.tableId,
  });
  if (handoff === undefined) return undefined;

  if (!UUID_PATTERN.test(input.deviceId) || !UUID_PATTERN.test(input.shiftId) || !UUID_PATTERN.test(input.tableId)) {
    return undefined;
  }
  if (!CURRENCY_PATTERN.test(handoff.createOrder.currency)) return undefined;
  const timeZone = validTimeZone(input.timeZone);
  const occurredAt = canonicalInstant(input.now);
  if (timeZone === undefined || occurredAt === undefined) return undefined;

  // Every identity is minted here and checked here: a generator that repeats a
  // value, or returns something that is not a UUID, must not become an audit
  // record. `mint` refuses both.
  const minted = new Set<string>();
  const mint = (): string | undefined => {
    let value: string;
    try { value = input.randomUuid().toLowerCase(); } catch { return undefined; }
    if (!UUID_PATTERN.test(value) || minted.has(value)) return undefined;
    minted.add(value);
    return value;
  };

  const orderId = mint();
  const createOrder = mintIdentity(mint);
  if (orderId === undefined || createOrder === undefined) return undefined;

  const addItems: OrderDeliveryLinePlanV1[] = [];
  for (const item of handoff.addItems) {
    const orderItemId = mint();
    const identity = mintIdentity(mint);
    if (orderItemId === undefined || identity === undefined) return undefined;
    addItems.push(Object.freeze({
      ...identity,
      draftLineId: item.draftLineId,
      modifierGroups: item.modifierGroups,
      orderItemId,
      productId: item.productId,
      quantity: item.quantity,
    }));
  }

  const openOrder = mintIdentity(mint);
  if (openOrder === undefined) return undefined;

  return Object.freeze({
    addItems: Object.freeze(addItems),
    channel: "table",
    createOrder,
    currency: handoff.createOrder.currency,
    deviceId: input.deviceId.toLowerCase(),
    occurredAt,
    openOrder,
    orderId,
    scope: handoff.createOrder.scope,
    shiftId: input.shiftId.toLowerCase(),
    tableId: input.tableId.toLowerCase(),
    timeZone,
  });
}

/**
 * `eventId` and `idempotencyKey` are separate values on purpose: the first
 * identifies the audit event, the second the client's intent to perform it, and
 * the server matches on the second. Sharing one value between them would make
 * two different guarantees depend on the same string.
 */
function mintIdentity(mint: () => string | undefined): OrderMutationIdentityV1 | undefined {
  const eventId = mint();
  const idempotencyKey = mint();
  return eventId === undefined || idempotencyKey === undefined
    ? undefined
    : Object.freeze({ eventId, idempotencyKey });
}

/** The exact `YYYY-MM-DDTHH:mm:ss.sssZ` form the shared commands require. */
function canonicalInstant(now: number): string | undefined {
  if (!Number.isFinite(now) || !Number.isSafeInteger(now)) return undefined;
  try {
    const instant = new Date(now).toISOString();
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(instant) ? instant : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The zone comes from the server, never from the device. It is still checked
 * here, because a zone this runtime cannot resolve would be rejected by the
 * command parser after the first request had already been sent.
 */
function validTimeZone(timeZone: string): string | undefined {
  if (typeof timeZone !== "string" || timeZone !== timeZone.trim() || timeZone.length === 0 || timeZone.length > 100) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return timeZone;
  } catch {
    return undefined;
  }
}
