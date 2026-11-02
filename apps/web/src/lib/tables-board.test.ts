import assert from "node:assert/strict";
import test from "node:test";
import { gridPlacement, groupBoardByZone, orderStatusLabel, tableStatusLabel, waiterCardState, waiterInitials, waiterLabel, waiterOptionLabel, waiterOptions } from "./tables-board.js";
import type { DiningLayoutV1, TableBoardV1 } from "@super-restaurant/shared-types";

const scope = { restaurantId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };

test("board groups state into the layout's zones and preserves positions", () => {
  const table = { tableId: "33333333-3333-4333-8333-333333333333", name: "Mesa 3", capacity: 4,
    layout: { x: 2, y: 5, width: 4, height: 3 } };
  const layout = { zones: [{ zoneId: "44444444-4444-4444-8444-444444444444", name: "Salón", tables: [table] }] } as unknown as DiningLayoutV1;
  const state = { tableId: table.tableId, status: "occupied", activeOrders: [{ orderId: "55555555-5555-4555-8555-555555555555", status: "open", version: 1, waiterUserId: null, openedAt: "2026-10-03T12:00:00.000Z" }] };
  const board = { schemaVersion: 1, scope, tables: [state], unassignedOrders: [] } as unknown as TableBoardV1;
  const grouped = groupBoardByZone(layout, board);
  assert.equal(grouped[0]?.tables[0]?.state?.status, "occupied");
  assert.deepEqual(gridPlacement(table.layout), { gridColumn: "3 / span 4", gridRow: "6 / span 3" });
  assert.equal(tableStatusLabel(grouped[0]?.tables[0]?.state ?? null), "Ocupada");
  assert.equal(tableStatusLabel(null), "Sin estado");
  assert.equal(orderStatusLabel("draft"), "Borrador");
  assert.equal(orderStatusLabel("open"), "Abierta");
  assert.equal(orderStatusLabel("partially_paid"), "Pago parcial");
});

test("waiter initials show a useful label without leaking an unknown id", () => {
  assert.equal(waiterInitials("Ana Pérez"), "AP");
  assert.equal(waiterInitials(null), "Sin mesero");
});

test("waiterLabel resolves names and falls back without exposing the full id", () => {
  const members = [{ userId: "aaaa1111-1111-4111-8111-111111111111", displayName: "Ana Pérez" }, { userId: "bbbb2222-2222-4222-8222-222222222222", displayName: null }];
  assert.equal(waiterLabel(members, "aaaa1111-1111-4111-8111-111111111111"), "Ana Pérez");
  assert.equal(waiterLabel(members, "bbbb2222-2222-4222-8222-222222222222"), "Mesero BBBB");
  assert.equal(waiterLabel(members, "cccc3333-3333-4333-8333-333333333333", "cccc3333-3333-4333-8333-333333333333"), "Yo");
  assert.equal(waiterLabel(members, null), "Sin mesero");
});

test("waiter options never produce an empty label and skip the actor and duplicates", () => {
  const actor = "aaaa1111-1111-4111-8111-111111111111";
  const members = [
    { userId: actor, displayName: "Yo mismo" },
    { userId: "bbbb2222-2222-4222-8222-222222222222", displayName: "  ​ " },
    { userId: "bbbb2222-2222-4222-8222-222222222222", displayName: "Duplicado" },
    { userId: "cccc3333-3333-4333-8333-333333333333", displayName: " Luis " },
  ];
  assert.deepEqual(waiterOptions(members, actor), [
    { userId: "bbbb2222-2222-4222-8222-222222222222", label: "Mesero sin nombre (BBBB)" },
    { userId: "cccc3333-3333-4333-8333-333333333333", label: "Luis" },
  ]);
  assert.equal(waiterOptionLabel({ userId: "dddd4444", displayName: null }), "Mesero sin nombre (DDDD)");
});

test("waiter card state marks only the order being saved", () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(waiterCardState(first, first), { busy: true, label: "Guardando…" });
  assert.deepEqual(waiterCardState(second, first), { busy: false, label: "Mesero" });
  assert.deepEqual(waiterCardState(first, null), { busy: false, label: "Mesero" });
});
