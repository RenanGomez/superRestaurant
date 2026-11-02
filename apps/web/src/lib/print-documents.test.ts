import assert from "node:assert/strict";
import test from "node:test";
import { parseOrderDetailV1, type OrderDetailItemV1, type PaymentCollectionSummaryV1 } from "@super-restaurant/shared-types";
import { buildCustomerTicket, buildKitchenDocuments } from "./print-documents.js";

const scope = {
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
};
const orderId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const item = (orderItemId: string, status: OrderDetailItemV1["status"], name: string) => ({
  orderItemId, status, name, quantity: 1, unitPriceMinor: 1000, lineTotalMinor: 1000,
  note: null, modifiers: [], availableActions: [],
});

// This goes through the current public parser, which does not yet expose stationId.
const order = parseOrderDetailV1({
  schemaVersion: 1, scope, orderId, status: "open", channel: "counter", tableId: null,
  currency: "MXN", timeZone: "America/Mexico_City", createdAt: "2026-10-06T12:00:00.000Z",
  updatedAt: "2026-10-06T12:00:00.000Z", version: 2,
  items: [
    item("9544c299-d25b-44ce-98ed-d30116610887", "sent", "Pizza"),
    item("d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", "preparing", "Agua"),
    item("a409ec59-9f5e-496d-a45d-b83a46b49674", "pending", "Sin enviar"),
    item("c483b6e7-e102-4cc5-a887-d30712c85e52", "cancelled", "Cancelada"),
  ],
  totals: { currency: "MXN", itemsTotalMinor: 15450, deliveryChargeMinor: 0, tipMinor: 0, totalMinor: 15450 },
  fulfillment: { channel: "counter", tableId: null, customerLabel: "Ana", addressLabel: null, paymentIntent: null },
  availableActions: [],
});
assert.ok(order, "the legacy order detail fixture must parse");

test("legacy detail groups sent lines under an explicit unassigned station", () => {
  const documents = buildKitchenDocuments(order);
  assert.equal(documents.length, 1);
  assert.match(documents[0]!.title, /Sin estación asignada/u);
  assert.match(documents[0]!.lines.join(" "), /Pizza.*Agua/u);
  assert.doesNotMatch(documents[0]!.lines.join(" "), /Sin enviar|Cancelada/u);
});

test("typed historical stations separate documents and preserve halves and notes", () => {
  const stationedItems: readonly (OrderDetailItemV1 & { readonly stationId: string | null })[] = order.items.map((entry, index) => ({
    ...entry,
    stationId: index === 0 ? "horno" : "barra",
    ...(index === 0 ? {
      note: "Bien cocida",
      geometry: "halves" as const,
      fractionBreakdown: [
        { fraction: "half-a" as const, flavorName: "Queso", amountMinor: 1000, extras: ["Aceitunas"], exclusions: ["Cebolla"] },
        { fraction: "half-b" as const, flavorName: "Jamón", amountMinor: 1000, extras: [], exclusions: [] },
      ],
    } : {}),
  }));
  const documents = buildKitchenDocuments({ ...order, items: stationedItems });
  assert.deepEqual(documents.map((document) => document.title), ["Comanda · horno", "Comanda · barra"]);
  assert.match(documents[0]!.lines.join(" "), /Mitad A: Queso.*Aceitunas.*Sin Cebolla.*Mitad B: Jamón.*Bien cocida/u);
  assert.doesNotMatch(documents.flatMap((document) => document.lines).join(" "), /Sin enviar|Cancelada/u);
});

test("customer ticket prints captured tip alongside server-provided cash tender and change", () => {
  const payment: PaymentCollectionSummaryV1 = {
    schemaVersion: 1, scope: order.scope, orderId, paymentId: "63f7c434-f655-4885-9261-690d0208fb31",
    cashRegisterSessionId: "c3adc0d4-0c27-4450-bbfb-c858105f4c71", cashRegisterVersion: 2,
    currency: "MXN", method: "cash", orderStatus: "partially_paid", orderVersion: 3,
    paymentState: "captured", replayed: false, amountMinor: 10000, tipMinor: 1000,
    tenderedAmountMinor: 12000, changeMinor: 1000, remainingBalanceMinor: 5450, transferReference: null,
  };
  const ticket = buildCustomerTicket(order, [payment], { restaurantName: "Restaurante", branchName: "Centro" });
  const text = ticket.lines.join("\n");
  assert.match(text, /Total: \$154\.50/u);
  assert.match(text, /Efectivo: \$100\.00\nPropina del pago: \$10\.00\nRecibido: \$120\.00\nCambio: \$10\.00/u);
  assert.match(text, /Saldo: \$54\.50/u);
  assert.doesNotMatch(text, /Cancelada/u);
});

test("ticket from the detail prints folio, date and the real captured payments without deriving a balance", () => {
  const detail = parseOrderDetailV1({
    ...order, shortFolio: "AB12CD34", createdAt: "2026-10-06T18:30:00.000Z",
    payments: [
      { paymentId: "63f7c434-f655-4885-9261-690d0208fb31", method: "cash", amountMinor: 10000, tipMinor: 1000, tenderedAmountMinor: 12000, changeMinor: 1000, transferReference: null, capturedAt: "2026-10-06T18:40:00.000Z" },
      { paymentId: "73f7c434-f655-4885-9261-690d0208fb31", method: "transfer", amountMinor: 5450, tipMinor: 0, tenderedAmountMinor: null, changeMinor: null, transferReference: "SPEI-123", capturedAt: "2026-10-06T18:41:00.000Z" },
    ],
  });
  assert.ok(detail);
  const text = buildCustomerTicket(detail, [], { restaurantName: "Restaurante", branchName: "Centro" }).lines.join("\n");
  assert.match(text, /Orden AB12CD34/u);
  assert.match(text, /Hora: .*2026|Hora: .*26/u);
  assert.match(text, /Efectivo: \$100\.00\nPropina del pago: \$10\.00\nRecibido: \$120\.00\nCambio: \$10\.00\nTransferencia: \$54\.50\nReferencia: SPEI-123/u);
  assert.doesNotMatch(text, /Saldo|no disponibles|Sin pagos/u);
  assert.match(buildKitchenDocuments(detail)[0]!.lines.join("\n"), /Orden AB12CD34/u);
});

test("ticket from a detail with receipt data and no payments says so; without receipt data it keeps the old notice", () => {
  const empty = parseOrderDetailV1({ ...order, shortFolio: "AB12CD34", payments: [] });
  assert.ok(empty);
  assert.match(buildCustomerTicket(empty, [], { restaurantName: "R", branchName: "C" }).lines.join("\n"), /Sin pagos registrados/u);
  assert.match(buildCustomerTicket(order, [], { restaurantName: "R", branchName: "C" }).lines.join("\n"), /Orden EE50F0F6[\s\S]*Pagos y saldo no disponibles/u);
});

test("a just-collected receipt (server balance) wins over the detail payments", () => {
  const detail = parseOrderDetailV1({
    ...order, shortFolio: "AB12CD34",
    payments: [{ paymentId: "63f7c434-f655-4885-9261-690d0208fb31", method: "cash", amountMinor: 10000, tipMinor: 0, tenderedAmountMinor: null, changeMinor: null, transferReference: null, capturedAt: "2026-10-06T18:40:00.000Z" }],
  });
  assert.ok(detail);
  const collected: PaymentCollectionSummaryV1 = {
    schemaVersion: 1, scope: detail.scope, orderId, paymentId: "63f7c434-f655-4885-9261-690d0208fb31",
    cashRegisterSessionId: "c3adc0d4-0c27-4450-bbfb-c858105f4c71", cashRegisterVersion: 2,
    currency: "MXN", method: "cash", orderStatus: "partially_paid", orderVersion: 3,
    paymentState: "captured", replayed: false, amountMinor: 10000, tipMinor: 0,
    tenderedAmountMinor: null, changeMinor: null, remainingBalanceMinor: 5450, transferReference: null,
  };
  const text = buildCustomerTicket(detail, [collected], { restaurantName: "R", branchName: "C" }).lines.join("\n");
  assert.equal(text.match(/Efectivo:/gu)?.length, 1);
  assert.match(text, /Saldo: \$54\.50/u);
});

test("the table name reaches kitchen and ticket documents, and the fallback never prints the table id", () => {
  const tableId = "5b7f0c1e-2a4d-4e8b-9c3f-1d2e3f4a5b6c";
  const onTable = { ...order, tableId };
  const header = { restaurantName: "R", branchName: "S" };
  assert.ok(buildKitchenDocuments(onTable, "Mesa 4")[0]!.lines.includes("Mesa: Mesa 4"));
  assert.ok(buildCustomerTicket(onTable, [], header, "Mesa 4").lines.includes("Mesa: Mesa 4"));
  const unnamed = [...buildKitchenDocuments(onTable)[0]!.lines, ...buildCustomerTicket(onTable, [], header).lines];
  assert.ok(unnamed.includes("Mesa: Mesa"));
  assert.ok(!unnamed.some((line) => line.includes(tableId)));
});

test("account name formats as Mesa: <name> · <account> or Cuenta: <account> when tableId is null", () => {
  const tableId = "5b7f0c1e-2a4d-4e8b-9c3f-1d2e3f4a5b6c";
  const header = { restaurantName: "R", branchName: "S" };
  const onTableWithAccount = { ...order, tableId, accountLabel: "Juan" };
  assert.ok(buildKitchenDocuments(onTableWithAccount, "Mesa 2")[0]!.lines.includes("Mesa: Mesa 2 · Juan"));
  assert.ok(buildCustomerTicket(onTableWithAccount, [], header, "Mesa 2").lines.includes("Mesa: Mesa 2 · Juan"));

  const counterWithAccount = { ...order, tableId: null, accountLabel: "Familia Pérez" };
  assert.ok(buildKitchenDocuments(counterWithAccount)[0]!.lines.includes("Cuenta: Familia Pérez"));
  assert.ok(buildCustomerTicket(counterWithAccount, [], header).lines.includes("Cuenta: Familia Pérez"));

  const counterWithoutAccount = { ...order, tableId: null, accountLabel: null };
  const counterLines = [...buildKitchenDocuments(counterWithoutAccount)[0]!.lines, ...buildCustomerTicket(counterWithoutAccount, [], header).lines];
  assert.ok(!counterLines.some((line) => line.startsWith("Cuenta:")));
});
