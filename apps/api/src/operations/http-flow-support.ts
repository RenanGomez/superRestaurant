import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { HttpFlowContext, Json } from "./http-test-harness.js";

export const TIME_ZONE = "America/Hermosillo";

/** Asserts a 2xx and returns the body; the failure message carries status and body for diagnosis. */
export function ok(response: { status: number; body: Json }, label: string): Json {
  assert.ok(response.status >= 200 && response.status < 300, `${label}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

export function record(value: unknown): Json {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Json;
}

export interface PublishedCatalog { readonly catalogVersion: string; }

export async function publishCatalog(context: HttpFlowContext, catalog: Json): Promise<PublishedCatalog> {
  const catalogVersion = randomUUID();
  ok(await context.send("manager", "PUT", "/catalog/menu", {
    ...context.audit(), schemaVersion: 1, scope: context.scope, expectedVersion: 0, catalogVersion, currency: "MXN", ...catalog,
  }), "catalog");
  return { catalogVersion };
}

export interface OpenRegister { readonly cashRegisterSessionId: string; readonly registerId: string; readonly shiftId: string; }

export async function openShiftAndRegister(context: HttpFlowContext, openingFloatMinor: number): Promise<OpenRegister> {
  const shiftId = randomUUID();
  const registerId = randomUUID();
  const cashRegisterSessionId = randomUUID();
  ok(await context.send("cashier", "POST", "/shifts/open", { ...context.audit(), schemaVersion: 1, scope: context.scope, shiftId, name: "Turno HTTP" }), "shift");
  ok(await context.send("cashier", "POST", "/cash-registers/open", { ...context.audit(), schemaVersion: 1, scope: context.scope,
    cashRegisterSessionId, registerId, shiftId, openingFloatMinor, currency: "MXN" }), "register");
  return { cashRegisterSessionId, registerId, shiftId };
}

export async function checkout(context: HttpFlowContext, register: OpenRegister, orderId: string): Promise<Json> {
  return ok(await context.send("cashier", "GET", `/payments/checkout${context.query({ ...context.scope, registerId: register.registerId,
    cashRegisterSessionId: register.cashRegisterSessionId, deviceId: context.deviceId, orderId })}`), "checkout");
}

export async function cutX(context: HttpFlowContext, register: OpenRegister): Promise<Json> {
  return ok(await context.send("cashier", "GET", `/cash-registers/report${context.query({ ...context.scope, registerId: register.registerId,
    cashRegisterSessionId: register.cashRegisterSessionId, deviceId: context.deviceId })}`), "report");
}

export async function createCoveredZone(context: HttpFlowContext, feeMinor: number, postalCode: string): Promise<string> {
  const zoneId = randomUUID();
  ok(await context.send("manager", "POST", "/delivery-zones/upsert", { ...context.audit(), schemaVersion: 1,
    scope: context.scope, zoneId, expectedVersion: 0, name: "Centro", postalCodes: [postalCode], localities: [], feeMinor,
    currency: "MXN", active: true, reason: null }), "zone");
  return zoneId;
}

export interface CustomerWithAddress { readonly addressId: string; readonly contactId: string; readonly customerId: string; }

/** Saves a customer with one phone and one validated address (profile v1, address v2 after validation). */
export async function createCustomerWithAddress(context: HttpFlowContext, postalCode: string): Promise<CustomerWithAddress> {
  const customerId = randomUUID();
  const contactId = randomUUID();
  const addressId = randomUUID();
  const base = { schemaVersion: 1, scope: context.scope, customerId };
  ok(await context.send("cashier", "POST", "/customers/profile", { ...context.audit(), ...base, expectedVersion: 0,
    displayName: "Cliente Telefonico", phones: [{ contactId, label: "Celular", displayValue: "662 123 4567" }] }), "customer");
  ok(await context.send("cashier", "POST", "/customers/address", { ...context.audit(), ...base, expectedVersion: 0, addressId,
    address: { label: "Casa", streetLine: "Calle Reforma 123", unit: null, neighborhood: "Centro", locality: "Hermosillo", region: "Sonora",
      countryCode: "MX", postalCode, references: "Porton negro", instructions: null, coordinates: null } }), "address");
  ok(await context.send("cashier", "POST", "/customers/address/validate", { ...context.audit(), ...base, expectedVersion: 1, addressId }), "address_validate");
  return { addressId, contactId, customerId };
}

export interface CaptureLine { readonly fraction?: unknown; readonly lineId: string; readonly productId: string; readonly quantity: number; readonly variantId: string | null; }

export interface CapturedOrder { readonly captureDraftId: string; readonly orderId: string; readonly workspace: Json; }

/**
 * Phone capture end to end through the real endpoints: draft -> customer -> (delivery: address, quote) ->

 * selection plan -> payment intent -> confirm. The quote is scheduled 45 min ahead: an ASAP quote (scheduledFor null) expires at
 * its own quotedAt (expiresAt = promise start), so the server rejects confirming it (DELIVERY_QUOTE_EXPIRED); product gap. Every mutation reads the version from the previous response.
 */
export async function captureAndConfirm(context: HttpFlowContext, input: {
  readonly catalogVersion: string; readonly customer?: CustomerWithAddress; readonly lines: readonly CaptureLine[];
  readonly paymentIntent?: { readonly method: string; readonly tenderedAmountMinor: number | null; readonly tipMinor: number };
  readonly shiftId: string;
}): Promise<CapturedOrder> {
  const captureDraftId = randomUUID();
  const orderId = randomUUID();
  const delivery = input.customer !== undefined;
  const created = ok(await context.send("cashier", "POST", "/captures", { ...context.audit(), schemaVersion: 1, scope: context.scope,
    captureDraftId, expectedVersion: 0, sourceChannel: delivery ? "phone" : "counter", fulfillmentChannel: delivery ? "delivery" : "counter" }), "capture_create");
  let detail = record(created.detail);
  const attentionLeaseId = detail.attentionLeaseId as string;
  const command = () => ({ ...context.audit(), schemaVersion: 1, scope: context.scope, captureDraftId, expectedVersion: detail.version as number, attentionLeaseId });
  if (input.customer !== undefined) {
    detail = record(ok(await context.send("cashier", "POST", "/captures/customer", { ...command(), customerId: input.customer.customerId,
      contactId: input.customer.contactId, expectedCustomerVersion: 1 }), "capture_customer").detail);
    detail = record(ok(await context.send("cashier", "POST", "/captures/fulfillment", { ...command(), customerSnapshotRef: detail.customerSnapshotRef,
      addressId: input.customer.addressId, expectedAddressVersion: 2 }), "capture_fulfillment").detail);
  }
  let workspace = ok(await context.send("cashier", "POST", "/captures/selection-plan", { ...command(),
    plan: { schemaVersion: 1, catalogVersion: input.catalogVersion, lines: input.lines.map((line) => ({ modifierGroups: [], note: null, ...line })) } }), "capture_selection_plan");
  detail = record(workspace.detail);
  if (delivery) {
    workspace = ok(await context.send("cashier", "POST", "/captures/delivery-quote", { ...command(), scheduledFor: new Date(Date.now() + 45 * 60_000).toISOString() }), "capture_delivery_quote");
    detail = record(workspace.detail);
  }
  if (input.paymentIntent !== undefined) {
    workspace = ok(await context.send("cashier", "POST", "/captures/payment-intent", { ...command(), ...input.paymentIntent }), "capture_payment_intent");
    detail = record(workspace.detail);
  }
  const confirmed = ok(await context.send("cashier", "POST", "/captures/confirm", { ...context.audit(), schemaVersion: 2, scope: context.scope,
    captureDraftId, expectedVersion: detail.version, attentionLeaseId, orderId, shiftId: input.shiftId, tableId: null, currency: "MXN", timeZone: TIME_ZONE }), "capture_confirm");
  assert.equal(record(confirmed.detail).confirmedOrderId, orderId);
  return { captureDraftId, orderId, workspace };
}

/**
 * A confirmed capture materializes a `draft` Order; it becomes `open` (and reaches KDS and the delivery trays)
 * only when sent to the kitchen. Returns the order detail read just before sending.
 */
export async function sendOrderToKitchen(context: HttpFlowContext, orderId: string): Promise<Json> {
  const detail = ok(await context.send("cashier", "POST", "/orders/detail", { schemaVersion: 1, scope: context.scope, orderId }), "order_detail");
  const itemIds = (detail.items as Json[]).map((item) => item.orderItemId);
  ok(await context.send("cashier", "POST", "/orders/send-to-kitchen", { ...context.audit(), schemaVersion: 1, scope: context.scope, orderId,
    orderItemIds: itemIds, expectedVersion: detail.version }), "send_to_kitchen");
  return detail;
}
