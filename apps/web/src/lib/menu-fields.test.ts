import assert from "node:assert/strict";
import test from "node:test";
import { stationValues, unitOptions } from "./menu-fields.js";

test("unit list is fixed and keeps an unknown stored unit as an extra selected option", () => {
  assert.deepEqual(unitOptions("pieza").map((option) => option.value),
    ["pieza", "porción", "orden", "rebanada", "paquete", "g", "kg", "ml", "L"]);
  const legacy = unitOptions("cubeta");
  assert.equal(legacy.length, 10);
  assert.deepEqual(legacy[9], { label: "cubeta", value: "cubeta" });
});

test("station values are distinct, trimmed, include general first and the current value", () => {
  assert.deepEqual(stationValues(["pizzas", "barra", "pizzas", " "], "cocina"), ["general", "barra", "cocina", "pizzas"]);
  assert.deepEqual(stationValues([], "general"), ["general"]);
});
