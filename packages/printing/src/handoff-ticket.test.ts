import assert from "node:assert/strict";
import test from "node:test";
import { Money, type OrderItem } from "@super-restaurant/domain";
import type { CaptureCustomerSnapshotV1, CaptureFulfillmentSnapshotV1 } from "@super-restaurant/shared-types";
import { renderHandoffTicket, UnsupportedCurrencyExponentError, type HandoffTicketInput } from "./handoff-ticket.js";

const money = (amountMinor: number) => new Money(amountMinor, "MXN");
const item: OrderItem = {
  orderItemId: "item-1", restaurantId: "restaurant-1", branchId: "branch-1", status: "pending",
  quantity: 2,
  snapshot: {
    catalogVersion: "v1", productId: "product-1", name: "Pizza", stationId: "kitchen",
    unit: "piece", unitPrice: money(12000), modifiers: [],
  },
};
const customer: CaptureCustomerSnapshotV1 = {
  contactId: "contact-1", customerId: "customer-1", displayName: "Ana Ruiz",
  phoneDisplayValue: "+52 55 1234 9876", phoneNormalizedValue: "525512349876",
  schemaVersion: 1, snapshotRef: "customer-v1",
};
const fulfillment: CaptureFulfillmentSnapshotV1 = {
  addressId: "address-1", countryCode: "MX", customerId: "customer-1",
  customerSnapshotRef: "customer-v1", legacyAddressInstructions: null,
  label: "Casa", latitudeE6: null, longitudeE6: null, locality: "CDMX",
  neighborhood: null, postalCode: "01000", referencesText: null, region: "CDMX",
  schemaVersion: 1, snapshotRef: "address-v1", streetLine: "Calle Uno 1", unit: "2B",
  validatedAt: "2026-09-26T11:00:00Z",
};
const base: HandoffTicketInput = {
  order: { orderId: "order-12345678", channel: "delivery", currency: "MXN", items: [item], deliveryCharge: null },
  totals: { subtotalBeforeOrderDiscount: money(24000), lineDiscountTotal: money(0),
    orderDiscount: money(0), total: money(24000) },
  customer, fulfillment, deliveryInstructions: "Tocar timbre", dateIso: "2026-09-26T12:00:00Z",
};

// Literal fixture text plus fixed ESC/POS framing forms a byte-for-byte snapshot.
function snapshot(lines: readonly string[]): Uint8Array {
  const cp1252 = (line: string): number[] => Array.from(line, (character) =>
    character === "í" ? 0xed : character.charCodeAt(0));
  return Uint8Array.from([
    0x1b, 0x40, 0x1b, 0x74, 0x10, 0x1b, 0x61, 1, 0x1b, 0x45, 1,
    ...cp1252(lines[0]!), 0x0a, 0x1b, 0x45, 0, 0x1b, 0x61, 0,
    ...lines.slice(1).flatMap((line) => line.startsWith("Total:")
      ? [0x1b, 0x45, 1, ...cp1252(line), 0x0a, 0x1b, 0x45, 0]
      : [...cp1252(line), 0x0a]),
    0x1b, 0x64, 3, 0x1d, 0x56, 1,
  ]);
}

test("delivery ticket snapshot includes address and instructions, with masked phone", () => {
  const actual = renderHandoffTicket(base);
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "2 x Pizza  $120.00", "------------------------",
    "Subtotal: $240.00", "Descuento líneas: $0.00", "Descuento orden: $0.00",
    "Total: $240.00", "Instrucciones: Tocar timbre",
  ]));
  assert.equal(Buffer.from(actual).includes(Buffer.from("525512349876")), false);
  assert.equal(Buffer.from(actual).includes(Buffer.from("+52 55 1234 9876")), false);
});

test("pickup ticket snapshot omits delivery address", () => {
  const actual = renderHandoffTicket({ ...base, order: { ...base.order, channel: "takeout" }, deliveryInstructions: null });
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: takeout", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "------------------------", "2 x Pizza  $120.00",
    "------------------------", "Subtotal: $240.00", "Descuento líneas: $0.00",
    "Descuento orden: $0.00", "Total: $240.00",
  ]));
});

test("discount and modifier ticket snapshot uses supplied totals", () => {
  const modifiedItem: OrderItem = { ...item, quantity: 1, snapshot: { ...item.snapshot,
    modifiers: [{ modifierId: "extra-1", name: "Queso", unitPrice: money(2000), quantity: 1 }],
  } };
  const actual = renderHandoffTicket({ ...base,
    order: { ...base.order, items: [modifiedItem] },
    totals: { subtotalBeforeOrderDiscount: money(14000), lineDiscountTotal: money(1000),
      orderDiscount: money(2000), total: money(12000) },
    deliveryInstructions: null,
  });
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "1 x Pizza  $120.00", "  + 1 x Queso  $20.00",
    "------------------------", "Subtotal: $140.00", "Descuento líneas: $10.00",
    "Descuento orden: $20.00", "Total: $120.00",
  ]));
});

test("an item note renders under its line with a Nota prefix, and no note omits the line", () => {
  const notedItem: OrderItem = { ...item, note: "Sin cebolla" };
  const actual = renderHandoffTicket({ ...base,
    order: { ...base.order, items: [notedItem] },
    deliveryInstructions: null,
  });
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "2 x Pizza  $120.00", "  Nota: Sin cebolla",
    "------------------------", "Subtotal: $240.00", "Descuento líneas: $0.00",
    "Descuento orden: $0.00", "Total: $240.00",
  ]));

  const nullNoteItem: OrderItem = { ...item, note: null };
  assert.deepEqual(
    renderHandoffTicket({ ...base, order: { ...base.order, items: [nullNoteItem] }, deliveryInstructions: null }),
    renderHandoffTicket({ ...base, order: { ...base.order, items: [item] }, deliveryInstructions: null }),
  );
});

test("cash payment intent prints the method and exact change, byte for byte", () => {
  const actual = renderHandoffTicket({ ...base, deliveryInstructions: null,
    paymentIntent: { method: "cash", changeDueMinor: 5000 },
  });
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "2 x Pizza  $120.00", "------------------------",
    "Subtotal: $240.00", "Descuento líneas: $0.00", "Descuento orden: $0.00",
    "Total: $240.00", "Pagará con: efectivo · cambio $50.00",
  ]));
});

test("cash payment intent with no stated change omits the change suffix", () => {
  const actual = renderHandoffTicket({ ...base, deliveryInstructions: null,
    paymentIntent: { method: "cash", changeDueMinor: null },
  });
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "2 x Pizza  $120.00", "------------------------",
    "Subtotal: $240.00", "Descuento líneas: $0.00", "Descuento orden: $0.00",
    "Total: $240.00", "Pagará con: efectivo",
  ]));
});

test("card payment intent never prints a change, even if the facts carried one", () => {
  const actual = renderHandoffTicket({ ...base, deliveryInstructions: null,
    paymentIntent: { method: "card_manual", changeDueMinor: 100 },
  });
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "2 x Pizza  $120.00", "------------------------",
    "Subtotal: $240.00", "Descuento líneas: $0.00", "Descuento orden: $0.00",
    "Total: $240.00", "Pagará con: tarjeta",
  ]));
});

test("transfer payment intent prints its label with no change", () => {
  const actual = renderHandoffTicket({ ...base, deliveryInstructions: null,
    paymentIntent: { method: "transfer", changeDueMinor: null },
  });
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "2 x Pizza  $120.00", "------------------------",
    "Subtotal: $240.00", "Descuento líneas: $0.00", "Descuento orden: $0.00",
    "Total: $240.00", "Pagará con: transferencia",
  ]));
});

test("no payment intent (null or absent) prints no payment line at all, byte-identical", () => {
  const withoutField = renderHandoffTicket({ ...base, deliveryInstructions: null });
  const withNull = renderHandoffTicket({ ...base, deliveryInstructions: null, paymentIntent: null });
  assert.deepEqual(withoutField, withNull);
  assert.deepEqual(withoutField, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "2 x Pizza  $120.00", "------------------------",
    "Subtotal: $240.00", "Descuento líneas: $0.00", "Descuento orden: $0.00",
    "Total: $240.00",
  ]));
});

test("H13: a delivery charge prints its own Envío line right before Total, byte for byte", () => {
  const actual = renderHandoffTicket({ ...base, deliveryInstructions: null,
    order: { ...base.order, deliveryCharge: { amount: money(3000), quoteId: "quote-1" } },
    totals: { subtotalBeforeOrderDiscount: money(24000), lineDiscountTotal: money(0),
      orderDiscount: money(0), total: money(27000) },
  });
  assert.deepEqual(actual, snapshot([
    "ENTREGA 12345678", "Canal: delivery", "Fecha: 2026-09-26T12:00:00Z",
    "Cliente: Ana Ruiz", "Tel: ***9876", "Calle Uno 1 2B", "CDMX, CDMX, 01000",
    "------------------------", "2 x Pizza  $120.00", "------------------------",
    "Subtotal: $240.00", "Descuento líneas: $0.00", "Descuento orden: $0.00",
    "Envío: $30.00", "Total: $270.00",
  ]));
});

test("H13: no delivery charge (null) never prints an Envío line", () => {
  const actual = renderHandoffTicket({ ...base, deliveryInstructions: null });
  assert.equal(Buffer.from(actual).includes(Buffer.from("Env")), false);
});

test("currencies without two minor digits fail with a typed error", () => {
  assert.throws(() => renderHandoffTicket({ ...base,
    order: { ...base.order, currency: "JPY" },
  }), UnsupportedCurrencyExponentError);
});
