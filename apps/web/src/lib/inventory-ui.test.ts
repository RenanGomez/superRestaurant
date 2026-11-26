import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INVENTORY_TAB,
  INVENTORY_TABS,
  ensureInventoryIdempotencyKey,
  filterInventoryItems,
  formatInventoryMovementQuantity,
  formatInventoryNumber,
  formatInventoryTimestamp,
  formatMinorUnits,
  formatPercentFromMinor,
  formatRecipeVersionLabel,
  inventoryMovementKindLabel,
  inventoryTabHref,
  inventoryUnitLabel,
  isInventoryTab,
  matchesInventoryQuery,
  parseInventoryTab,
  parseInventoryWholeNumber,
  purchaseOrderStatusLabel,
  recipeVersionStateLabel,
  stockAlertSummary,
  validateInventoryMovementDraft,
  validatePurchaseOrderDraft,
  validateRecipeLineDrafts,
  validateSupplierDraft,
} from "./inventory-ui.js";

test("inventory tabs are stable and parse untrusted values", () => {
  assert.deepEqual(INVENTORY_TABS, ["insumos", "recetas", "almacenes", "movimientos", "compras", "alertas"]);
  assert.equal(DEFAULT_INVENTORY_TAB, "insumos");
  assert.equal(isInventoryTab("insumos"), true);
  assert.equal(isInventoryTab("recetas"), true);
  assert.equal(isInventoryTab("ALMACENES"), false);
  assert.equal(parseInventoryTab("  Almacenes  "), "almacenes");
  assert.equal(parseInventoryTab("movimientos"), "movimientos");
  assert.equal(parseInventoryTab("recetas"), "recetas");
  assert.equal(parseInventoryTab("compras"), "compras");
  assert.equal(isInventoryTab("compras"), true);
  assert.equal(parseInventoryTab("alertas"), "alertas");
  assert.equal(isInventoryTab("alertas"), true);
  assert.equal(parseInventoryTab("otra"), undefined);
  assert.equal(parseInventoryTab(undefined), undefined);
});

test("inventoryTabHref keeps other query parameters", () => {
  assert.equal(inventoryTabHref("insumos"), "/app/inventario?tab=insumos");
  assert.equal(inventoryTabHref("almacenes", "?foo=bar&tab=insumos"), "/app/inventario?foo=bar&tab=almacenes");
  assert.equal(inventoryTabHref("almacenes", "tab=insumos"), "/app/inventario?tab=almacenes");
});

test("unit labels are readable for operators", () => {
  assert.equal(inventoryUnitLabel("g"), "gramos");
  assert.equal(inventoryUnitLabel("ml"), "mililitros");
  assert.equal(inventoryUnitLabel("piece"), "pieza");
  assert.equal(inventoryUnitLabel("unknown"), "unidad");
});

test("search matches name and internal key case-insensitively", () => {
  const item = { name: "Harina de trigo", sku: "HAR-01" };
  assert.equal(matchesInventoryQuery(item, "harina"), true);
  assert.equal(matchesInventoryQuery(item, "har-01"), true);
  assert.equal(matchesInventoryQuery(item, "  TRIGO "), true);
  assert.equal(matchesInventoryQuery(item, "azúcar"), false);
  assert.equal(matchesInventoryQuery(item, ""), true);
});

test("filterInventoryItems returns every item for a blank term", () => {
  const items = [
    { name: "Harina", sku: "HAR" },
    { name: "Leche", sku: null },
  ] as const;
  assert.equal(filterInventoryItems(items, "   ").length, 2);
  assert.deepEqual(filterInventoryItems(items, "leche"), [items[1]]);
  assert.deepEqual(filterInventoryItems(items, "har"), [items[0]]);
});

test("whole-number parsing rejects decimals, signs and small values", () => {
  assert.equal(parseInventoryWholeNumber("1000", 1), 1000);
  assert.equal(parseInventoryWholeNumber(" 0 ", 0), 0);
  assert.equal(parseInventoryWholeNumber("12.5", 1), undefined);
  assert.equal(parseInventoryWholeNumber("-1", 0), undefined);
  assert.equal(parseInventoryWholeNumber("", 0), undefined);
  assert.equal(parseInventoryWholeNumber("3", 4), undefined);
});

test("formatInventoryNumber keeps whole quantities readable", () => {
  assert.equal(formatInventoryNumber(0), "0");
  assert.equal(formatInventoryNumber(12), "12");
});

test("percent from minor integers rounds half away from zero and guards zero", () => {
  assert.equal(formatPercentFromMinor(300, 1000), "30%");
  assert.equal(formatPercentFromMinor(333, 1000), "33.3%");
  assert.equal(formatPercentFromMinor(335, 1000), "33.5%");
  assert.equal(formatPercentFromMinor(334, 1000), "33.4%");
  assert.equal(formatPercentFromMinor(1, 3), "33.3%");
  assert.equal(formatPercentFromMinor(2, 3), "66.7%");
  assert.equal(formatPercentFromMinor(-250, 1000), "-25%");
  assert.equal(formatPercentFromMinor(500, 0), "—");
  assert.equal(formatPercentFromMinor(1.5, 1000), "—");
  assert.equal(formatPercentFromMinor(Number.NaN, 1000), "—");
});

test("stock alerts summarize the shortfall without internal codes", () => {
  assert.equal(stockAlertSummary({ deficit: 12, unitCode: "g" }), "Faltan 12 gramos");
  assert.equal(stockAlertSummary({ deficit: 1, unitCode: "piece" }), "Faltan 1 pieza");
  assert.equal(stockAlertSummary({ deficit: 3, unitCode: "piece" }), "Faltan 3 piezas");
  assert.equal(stockAlertSummary({ deficit: 2, unitCode: "unknown" }), "Faltan 2 unidades");
  assert.equal(stockAlertSummary({ deficit: 0, unitCode: "g" }), "Sin déficit");
  assert.equal(stockAlertSummary({ deficit: -5, unitCode: "g" }), "Sin déficit");
});

test("movement kinds carry an operator-facing Spanish label", () => {
  assert.equal(inventoryMovementKindLabel("adjustment"), "Ajuste");
  assert.equal(inventoryMovementKindLabel("waste"), "Merma");
  assert.equal(inventoryMovementKindLabel("count_adjustment"), "Conteo");
  assert.equal(inventoryMovementKindLabel("transfer_out"), "Transferencia");
  assert.equal(inventoryMovementKindLabel("transfer_in"), "Transferencia");
  assert.equal(inventoryMovementKindLabel("receipt"), "Recepción");
  assert.equal(inventoryMovementKindLabel("sale_consumption"), "Consumo por venta");
  assert.equal(inventoryMovementKindLabel("sale_reversal"), "Reversa de venta");
  assert.equal(inventoryMovementKindLabel("unknown"), "Movimiento");
});

test("movement quantity formats its sign and unit", () => {
  assert.equal(formatInventoryMovementQuantity(12, "g"), "+12 gramos");
  assert.equal(formatInventoryMovementQuantity(-3, "piece"), "-3 pieza");
  assert.equal(formatInventoryMovementQuantity(1500, "ml"), "+1,500 mililitros");
});

test("movement timestamps fall back to a dash for invalid input", () => {
  assert.equal(formatInventoryTimestamp("no-es-fecha", "UTC"), "—");
  assert.match(formatInventoryTimestamp("2026-11-25T18:05:00.000Z", "UTC"), /2026/u);
});

test("movement form requires warehouse, item, whole quantity and a reason", () => {
  const base = {
    itemId: "item",
    kind: "adjustment" as const,
    quantity: "5",
    reason: "  conteo físico  ",
    warehouseId: "warehouse",
  };
  const valid = validateInventoryMovementDraft(base);
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(
    { kind: valid.kind, quantityDelta: valid.quantityDelta, reason: valid.reason },
    { kind: "adjustment", quantityDelta: 5, reason: "conteo físico" },
  );

  assert.equal(validateInventoryMovementDraft({ ...base, warehouseId: " " }).ok, false);
  assert.equal(validateInventoryMovementDraft({ ...base, itemId: "" }).ok, false);
  assert.equal(validateInventoryMovementDraft({ ...base, quantity: "0" }).ok, false);
  assert.equal(validateInventoryMovementDraft({ ...base, quantity: "2.5" }).ok, false);
  assert.equal(validateInventoryMovementDraft({ ...base, quantity: "-2" }).ok, false);
  assert.equal(validateInventoryMovementDraft({ ...base, reason: "  x " }).ok, false);
});

test("movement form signs waste and transfers correctly", () => {
  const waste = validateInventoryMovementDraft({
    itemId: "item",
    kind: "waste",
    quantity: "2",
    reason: "producto vencido",
    warehouseId: "warehouse",
  });
  assert.equal(waste.ok, true);
  if (waste.ok) {
    assert.equal(waste.kind, "waste");
    assert.equal(waste.quantityDelta, -2);
  }

  const transfer = validateInventoryMovementDraft({
    itemId: "item",
    kind: "transfer",
    quantity: "3",
    reason: "mover a cámara",
    toWarehouseId: "other",
    warehouseId: "warehouse",
  });
  assert.equal(transfer.ok, true);
  if (transfer.ok) {
    assert.equal(transfer.kind, "transfer_out");
    assert.equal(transfer.quantityDelta, -3);
  }

  assert.equal(validateInventoryMovementDraft({
    itemId: "item",
    kind: "transfer",
    quantity: "3",
    reason: "mover a cámara",
    toWarehouseId: "warehouse",
    warehouseId: "warehouse",
  }).ok, false);
  assert.equal(validateInventoryMovementDraft({
    itemId: "item",
    kind: "transfer",
    quantity: "3",
    reason: "mover a cámara",
    toWarehouseId: "",
    warehouseId: "warehouse",
  }).ok, false);
});

test("idempotency key survives a retry and is generated only once", () => {
  let generated = 0;
  const generate = (): string => {
    generated += 1;
    return "generated-key";
  };
  assert.equal(ensureInventoryIdempotencyKey("opened-key", generate), "opened-key");
  assert.equal(generated, 0);
  assert.equal(ensureInventoryIdempotencyKey(undefined, generate), "generated-key");
  assert.equal(generated, 1);
  assert.equal(ensureInventoryIdempotencyKey("", generate), "generated-key");
  assert.equal(generated, 2);
});

test("recipe version labels separate the active version from history", () => {
  assert.equal(formatRecipeVersionLabel(1), "Versión 1");
  assert.equal(formatRecipeVersionLabel(1500), "Versión 1,500");
  assert.equal(recipeVersionStateLabel(true), "Activa");
  assert.equal(recipeVersionStateLabel(false), "Histórica");
});

test("recipe drafts require at least one complete line", () => {
  assert.equal(validateRecipeLineDrafts([]).ok, false);

  const base = { itemId: "item-a", quantity: "250", unitCode: "g" as const };
  const valid = validateRecipeLineDrafts([base, { itemId: "item-b", quantity: " 2 ", unitCode: "piece" }]);
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(valid.lines, [
    { itemId: "item-a", quantity: 250, unitCode: "g" },
    { itemId: "item-b", quantity: 2, unitCode: "piece" },
  ]);

  assert.equal(validateRecipeLineDrafts([{ ...base, itemId: " " }]).ok, false);
  assert.equal(validateRecipeLineDrafts([{ ...base, quantity: "0" }]).ok, false);
  assert.equal(validateRecipeLineDrafts([{ ...base, quantity: "2.5" }]).ok, false);
  assert.equal(validateRecipeLineDrafts([{ ...base, quantity: "-3" }]).ok, false);
  assert.equal(validateRecipeLineDrafts([base, { ...base, quantity: "10" }]).ok, false);
});

test("purchase money formats from the exact minor total, never a local sum", () => {
  assert.equal(formatMinorUnits(12_550, "MXN"), "$125.50");
  assert.equal(formatMinorUnits(0, "MXN"), "$0.00");
  assert.match(formatMinorUnits(100, "JPY"), /100$/u);
  assert.doesNotMatch(formatMinorUnits(100, "JPY"), /\./u);
  assert.match(formatMinorUnits(100, "GBP"), /1\.00$/u);
  assert.equal(formatMinorUnits(123_456_789, "MXN"), formatMinorUnits(123_456_789, "MXN"));
  assert.doesNotMatch(formatMinorUnits(123_456_789, "MXN"), /e/iu);
  assert.equal(formatMinorUnits(100, "ZZZ"), "Moneda no admitida");
});

test("supplier drafts accept a name and an optional contact", () => {
  const valid = validateSupplierDraft({ contact: " 555 123 4567 ", name: "  Distribuidora Sol  " });
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(valid, { contact: "555 123 4567", name: "Distribuidora Sol", ok: true });

  const withoutContact = validateSupplierDraft({ contact: "   ", name: "Sin contacto" });
  assert.equal(withoutContact.ok, true);
  if (withoutContact.ok) assert.equal(withoutContact.contact, null);

  assert.equal(validateSupplierDraft({ contact: "", name: "   " }).ok, false);
  assert.equal(validateSupplierDraft({ contact: "", name: "x".repeat(161) }).ok, false);
  assert.equal(validateSupplierDraft({ contact: "x".repeat(201), name: "Proveedor" }).ok, false);
});

test("purchase order drafts require supplier, ISO currency and valid unique lines", () => {
  const base = {
    currency: "mxn",
    lines: [{ itemId: "item-a", quantity: "2", unitCode: "g" as const, unitCostMinor: "1250" }],
    supplierId: "supplier",
  };
  const valid = validatePurchaseOrderDraft(base);
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.currency, "MXN");
  assert.deepEqual(valid.lines, [{ itemId: "item-a", quantity: 2, unitCode: "g", unitCostMinor: 1250 }]);

  assert.equal(validatePurchaseOrderDraft({ ...base, supplierId: " " }).ok, false);
  assert.equal(validatePurchaseOrderDraft({ ...base, currency: "MX" }).ok, false);
  assert.equal(validatePurchaseOrderDraft({ ...base, currency: "MXN1" }).ok, false);
  assert.equal(validatePurchaseOrderDraft({ ...base, lines: [] }).ok, false);
  assert.equal(validatePurchaseOrderDraft({
    ...base,
    lines: [{ itemId: "", quantity: "1", unitCode: "g", unitCostMinor: "0" }],
  }).ok, false);
  assert.equal(validatePurchaseOrderDraft({
    ...base,
    lines: [{ itemId: "item-a", quantity: "0", unitCode: "g", unitCostMinor: "0" }],
  }).ok, false);
  assert.equal(validatePurchaseOrderDraft({
    ...base,
    lines: [{ itemId: "item-a", quantity: "2.5", unitCode: "g", unitCostMinor: "0" }],
  }).ok, false);
  assert.equal(validatePurchaseOrderDraft({
    ...base,
    lines: [{ itemId: "item-a", quantity: "1", unitCode: "g", unitCostMinor: "-1" }],
  }).ok, false);
  assert.equal(validatePurchaseOrderDraft({
    ...base,
    lines: [
      { itemId: "item-a", quantity: "1", unitCode: "g", unitCostMinor: "0" },
      { itemId: "item-a", quantity: "3", unitCode: "g", unitCostMinor: "100" },
    ],
  }).ok, false);
});

test("purchase order statuses carry an operator-facing Spanish label", () => {
  assert.equal(purchaseOrderStatusLabel("draft"), "Borrador");
  assert.equal(purchaseOrderStatusLabel("sent"), "Enviada");
  assert.equal(purchaseOrderStatusLabel("received"), "Recibida");
  assert.equal(purchaseOrderStatusLabel("cancelled"), "Cancelada");
  assert.equal(purchaseOrderStatusLabel("unknown"), "Orden");
});
