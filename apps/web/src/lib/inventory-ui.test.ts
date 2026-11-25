import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INVENTORY_TAB,
  INVENTORY_TABS,
  filterInventoryItems,
  formatInventoryNumber,
  inventoryTabHref,
  inventoryUnitLabel,
  isInventoryTab,
  matchesInventoryQuery,
  parseInventoryTab,
  parseInventoryWholeNumber,
} from "./inventory-ui.js";

test("inventory tabs are stable and parse untrusted values", () => {
  assert.deepEqual(INVENTORY_TABS, ["insumos", "almacenes"]);
  assert.equal(DEFAULT_INVENTORY_TAB, "insumos");
  assert.equal(isInventoryTab("insumos"), true);
  assert.equal(isInventoryTab("ALMACENES"), false);
  assert.equal(parseInventoryTab("  Almacenes  "), "almacenes");
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
