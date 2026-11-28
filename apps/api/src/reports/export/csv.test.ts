import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchDaySummaryV1 } from "@super-restaurant/shared-types";

import { daySummaryRows, serializeRfc4180 } from "./csv.js";

const HEADER = ["seccion", "concepto", "zona", "moneda", "importe", "conteo", "detalle"] as const;
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const shiftId = "3f0c1b8e-1111-4aaa-9bbb-000000000001";
const register1 = "3f0c1b8e-1111-4aaa-9bbb-000000000002";
const register2 = "3f0c1b8e-1111-4aaa-9bbb-000000000003";
const session1 = "3f0c1b8e-1111-4aaa-9bbb-000000000004";
const session2 = "3f0c1b8e-1111-4aaa-9bbb-000000000005";
const cashier1 = "3f0c1b8e-1111-4aaa-9bbb-000000000006";
const cashier2 = "3f0c1b8e-1111-4aaa-9bbb-000000000007";
const zero = { amountMinor: 0, paymentCount: 0, tipMinor: 0 };

function parsed(value: unknown) {
  const summary = parseBranchDaySummaryV1(value);
  if (summary === undefined) throw new Error("TEST_SUMMARY_INVALID");
  return summary;
}

function richSummary(): unknown {
  return {
    cancellations: { captures: 1, orders: 2, refundPendingMinor: 3000 },
    currency: "MXN",
    date: "2026-10-05",
    deliveriesSettled: { cashCollectedMinor: 2500, count: 1 },
    deliveryFees: { amountMinor: 2500, orderCount: 1 },
    ordersPaid: { amountMinor: 15000, count: 3 },
    salesByChannel: [
      { amountMinor: 10000, channel: "table", paymentCount: 2, tipMinor: 500 },
      { amountMinor: 5000, channel: "counter", paymentCount: 1, tipMinor: 0 },
      { channel: "takeout", ...zero },
      { channel: "delivery", ...zero },
    ],
    salesByMethod: [
      { amountMinor: 12000, method: "cash", paymentCount: 2, tipMinor: 500 },
      { method: "card_manual", ...zero },
      { amountMinor: 3000, method: "transfer", paymentCount: 1, tipMinor: 0 },
    ],
    schemaVersion: 1,
    scope: { branchId, restaurantId },
    shifts: [{
      closedAt: "2026-10-05T18:00:00.000Z",
      name: "Turno matutino",
      openedAt: "2026-10-05T10:00:00.000Z",
      registers: [{
        cashRegisterSessionId: session1,
        cashierId: cashier1,
        closedAt: "2026-10-05T14:00:00.000Z",
        countedClosingBalanceMinor: 4850,
        differenceMinor: -150,
        expectedCashBalanceMinor: 5000,
        movements: [{ amountMinor: 3000, count: 2, direction: "in", type: "cash_sale" }],
        openedAt: "2026-10-05T10:05:00.000Z",
        openingFloatMinor: 2000,
        registerId: register1,
        status: "closed",
      }, {
        cashRegisterSessionId: session2,
        cashierId: cashier2,
        closedAt: "2026-10-05T18:00:00.000Z",
        countedClosingBalanceMinor: 1000,
        differenceMinor: 0,
        expectedCashBalanceMinor: 1000,
        movements: [
          { amountMinor: 500, count: 1, direction: "in", type: "cash_in" },
          { amountMinor: 500, count: 1, direction: "out", type: "cash_out" },
        ],
        openedAt: "2026-10-05T14:05:00.000Z",
        openingFloatMinor: 1000,
        registerId: register2,
        status: "closed",
      }],
      shiftId,
      status: "closed",
    }],
    timeZone: "America/Hermosillo",
    totals: { cashTipsMinor: 500, paymentCount: 3, salesMinor: 15000, tipsMinor: 500 },
  };
}

function emptySummary(): unknown {
  return {
    cancellations: { captures: 0, orders: 0, refundPendingMinor: 0 },
    currency: "MXN",
    date: "2026-10-06",
    deliveriesSettled: { cashCollectedMinor: 0, count: 0 },
    deliveryFees: { amountMinor: 0, orderCount: 0 },
    ordersPaid: { amountMinor: 0, count: 0 },
    salesByChannel: ["table", "counter", "takeout", "delivery"].map((channel) => ({ channel, ...zero })),
    salesByMethod: ["cash", "card_manual", "transfer"].map((method) => ({ method, ...zero })),
    schemaVersion: 1,
    scope: { branchId, restaurantId },
    shifts: [],
    timeZone: "America/Hermosillo",
    totals: { cashTipsMinor: 0, paymentCount: 0, salesMinor: 0, tipsMinor: 0 },
  };
}

test("rich day maps every section in table order, nested shift -> register -> movement", () => {
  const rows = daySummaryRows(parsed(richSummary()));
  assert.deepEqual(rows, [
    HEADER,
    ["totales", "pagos cobrados", "America/Hermosillo", "MXN", "15000", "3", "propinas=500;efectivo=500"],
    ["ordenes", "pagadas", "", "MXN", "15000", "3", "ticket="],
    ["entregas", "cargo congelado", "", "MXN", "2500", "1", ""],
    ["entregas", "liquidadas", "", "MXN", "2500", "1", ""],
    ["cancelaciones", "ordenes", "America/Hermosillo", "", "", "2", "capturas=1;devolucion_pendiente=3000"],
    ["canal", "table", "", "MXN", "10000", "2", "propina=500"],
    ["canal", "counter", "", "MXN", "5000", "1", "propina=0"],
    ["metodo", "cash", "", "MXN", "12000", "2", "propina=500"],
    ["metodo", "transfer", "", "MXN", "3000", "1", "propina=0"],
    ["turno", shiftId, "America/Hermosillo", "", "", "2",
      "nombre=Turno matutino;estado=closed;abierto=2026-10-05T10:00:00.000Z;cerrado=2026-10-05T18:00:00.000Z"],
    ["caja", register1, "America/Hermosillo", "MXN", "5000", "1",
      `turno=${shiftId};estado=closed;contado=4850;diferencia=-150`],
    ["movimiento", "cash_sale", "America/Hermosillo", "MXN", "3000", "2", `caja=${register1};direccion=in`],
    ["caja", register2, "America/Hermosillo", "MXN", "1000", "2",
      `turno=${shiftId};estado=closed;contado=1000;diferencia=0`],
    ["movimiento", "cash_in", "America/Hermosillo", "MXN", "500", "1", `caja=${register2};direccion=in`],
    ["movimiento", "cash_out", "America/Hermosillo", "MXN", "500", "1", `caja=${register2};direccion=out`],
  ]);
});

test("commas, quotes and line breaks are escaped and re-read by a minimal RFC 4180 reader", () => {
  const rows = [
    ["campo,coma", 'comilla "doble"', "salto\nlinea", "crlf\r\nfin", "normal"],
    ["", "", "", "", ""],
  ];
  const serialized = serializeRfc4180(rows);
  assert.equal(serialized,
    '"campo,coma","comilla ""doble""","salto\nlinea","crlf\r\nfin",normal\r\n,,,,\r\n');
  assert.deepEqual(readCsv(serialized), rows);
});

test("negative differenceMinor keeps its sign", () => {
  const caja = daySummaryRows(parsed(richSummary())).find((row) => row[0] === "caja" && row[1] === register1);
  assert.ok(caja !== undefined);
  assert.match(caja[6] ?? "", /diferencia=-150$/u);
});

test("a day without payments keeps the header and has no channel or method rows", () => {
  const rows = daySummaryRows(parsed(emptySummary()));
  assert.deepEqual(rows, [
    HEADER,
    ["totales", "pagos cobrados", "America/Hermosillo", "MXN", "0", "0", "propinas=0;efectivo=0"],
    ["ordenes", "pagadas", "", "MXN", "0", "0", "ticket="],
    ["entregas", "cargo congelado", "", "MXN", "0", "0", ""],
    ["entregas", "liquidadas", "", "MXN", "0", "0", ""],
    ["cancelaciones", "ordenes", "America/Hermosillo", "", "", "0", "capturas=0;devolucion_pendiente=0"],
  ]);
  assert.equal(rows.some((row) => row[0] === "canal" || row[0] === "metodo"), false);
});

test("bom is off by default, on with bom:true, every row ends in CRLF and empty fields keep their comma", () => {
  assert.equal(serializeRfc4180([]), "");
  assert.equal(serializeRfc4180([], { bom: true }), "\uFEFF");
  assert.equal(serializeRfc4180([["a", "b"]]), "a,b\r\n");
  assert.equal(serializeRfc4180([["a", "b"]], { bom: true }), "\uFEFFa,b\r\n");
  assert.equal(serializeRfc4180([["a", "", "c"], ["", ""]]), "a,,c\r\n,\r\n");
  assert.equal(serializeRfc4180([["a"]]).startsWith("\uFEFF"), false);
  assert.equal(serializeRfc4180([["a"]], { bom: true }).startsWith("\uFEFF"), true);
});

function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"') {
        if (text.charAt(index + 1) === '"') { field += '"'; index += 2; continue; }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') { quoted = true; index += 1; continue; }
    if (char === ",") { row.push(field); field = ""; index += 1; continue; }
    if (char === "\r" && text.charAt(index + 1) === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 2;
      continue;
    }
    field += char;
    index += 1;
  }
  return rows;
}
