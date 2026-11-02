import assert from "node:assert/strict";
import test from "node:test";
import { accountTabLabel, gridPlacement, groupBoardByZone, orderStatusLabel, tableOpenAccountsCount, tableStatusLabel, waiterCardState, waiterInitials, waiterLabel, waiterOptionLabel, waiterOptions } from "./tables-board.js";
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

test("accountTabLabel formats account tabs with index, accountLabel and optional total", () => {
  // Without total, defaults to "Cuenta N" based on 0-based index
  assert.equal(accountTabLabel(0, { accountLabel: null }), "Cuenta 1");
  assert.equal(accountTabLabel(1, { accountLabel: null }), "Cuenta 2");
  assert.equal(accountTabLabel(2, { accountLabel: "" }), "Cuenta 3");
  assert.equal(accountTabLabel(0, null), "Cuenta 1");

  // With accountLabel, replaces "Cuenta N"
  assert.equal(accountTabLabel(0, { accountLabel: "Terraza" }), "Terraza");
  assert.equal(accountTabLabel(1, { accountLabel: "Familia Gómez" }), "Familia Gómez");

  // With total passed as parameter
  assert.equal(accountTabLabel(0, { accountLabel: null }, "$130"), "Cuenta 1 · $130");
  assert.equal(accountTabLabel(1, { accountLabel: null }, "$0"), "Cuenta 2 · $0");
  assert.equal(accountTabLabel(0, { accountLabel: "Juan" }, "$130"), "Juan · $130");

  // With total inside order object
  assert.equal(accountTabLabel(0, { accountLabel: null, total: "$130" }), "Cuenta 1 · $130");
  assert.equal(accountTabLabel(1, { accountLabel: "Mesa VIP", total: "$500" }), "Mesa VIP · $500");

  // Parameter total takes precedence
  assert.equal(accountTabLabel(0, { accountLabel: "Juan", total: "$100" }, "$130"), "Juan · $130");

  // Trims spaces and ignores empty totals
  assert.equal(accountTabLabel(0, { accountLabel: "  Amigos  " }, "  $80  "), "Amigos · $80");
  assert.equal(accountTabLabel(0, { accountLabel: "Amigos" }, "   "), "Amigos");
  assert.equal(accountTabLabel(0, { accountLabel: "   " }, "$50"), "Cuenta 1 · $50");
});

test("tableOpenAccountsCount returns activeOrders length or zero when state is null or empty", () => {
  assert.equal(tableOpenAccountsCount(null), 0);
  assert.equal(tableOpenAccountsCount({ tableId: "t1", status: "free", activeOrders: [] }), 0);
  assert.equal(tableOpenAccountsCount({
    tableId: "t1",
    status: "occupied",
    activeOrders: [
      { orderId: "o1", status: "open", version: 1, waiterUserId: null, openedAt: "2026-11-02T00:00:00Z", accountLabel: null },
    ],
  }), 1);
  assert.equal(tableOpenAccountsCount({
    tableId: "t1",
    status: "occupied",
    activeOrders: [
      { orderId: "o1", status: "open", version: 1, waiterUserId: null, openedAt: "2026-11-02T00:00:00Z", accountLabel: null },
      { orderId: "o2", status: "open", version: 1, waiterUserId: null, openedAt: "2026-11-02T00:00:00Z", accountLabel: "Juan" },
    ],
  }), 2);
});
