import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchScope, type BranchOrderWorkItemV1, type BranchOrderWorkTrayV1 } from "@super-restaurant/shared-types";
import {
  channelLabel,
  filterBranchOrderWorkItems,
  formatMinorUnits,
  formatOrderWorkTime,
  isPayableBranchOrderWorkStatus,
  preparationLabel,
  requestBranchOrderWorkTray,
  shouldApplyBranchOrderWorkTrayResponse,
} from "./branch-order-work-tray.js";

const scope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (scope === undefined) throw new Error("Invalid test scope.");
const orderId = "2ee5f057-7971-468d-b197-f946911743eb";

function item(overrides: Partial<BranchOrderWorkItemV1> = {}): BranchOrderWorkItemV1 {
  return {
    accountLabel: null, addressLabel: null, channel: "delivery", createdAt: "2026-09-26T18:00:00.000Z", customerLabel: null,
    deliveryState: null, fulfillmentChannel: "delivery", hasNotes: false, lineCount: 1, orderId, paymentIntent: null,
    preparation: "preparing", status: "open", tableId: null, timeZone: "America/Hermosillo",
    totals: { currency: "MXN", deliveryChargeMinor: 3000, itemsTotalMinor: 10000, tipMinor: 0, totalMinor: 13000 },
    updatedAt: "2026-09-26T18:05:00.000Z", ...overrides,
  };
}

test("money and time formatting render from the server's own minor-unit and ISO facts", () => {
  assert.equal(formatMinorUnits(13_000, "MXN"), "$130.00");
  assert.equal(formatOrderWorkTime("2026-09-26T18:05:00.000Z", "America/Hermosillo"),
    new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Hermosillo" }).format(new Date("2026-09-26T18:05:00.000Z")));
});

test("formatMinorUnits derives its decimal scale from the currency, never a hardcoded /100", () => {
  assert.equal(formatMinorUnits(12_345, "MXN"), "$123.45");
  // Expected "¥100"; this host's ICU renders the JPY symbol as the "JPY" code instead of "¥", so
  // only the digits (no division at all for JPY) are pinned here.
  assert.match(formatMinorUnits(100, "JPY"), /100$/u);
  assert.doesNotMatch(formatMinorUnits(100, "JPY"), /\./u);
  assert.equal(formatMinorUnits(100, "ZZZ"), "Moneda no admitida");
});

test("formatMinorUnits never divides a float, so a large exact integer keeps its exact cents", () => {
  assert.equal(formatMinorUnits(9_007_199_254_740_991, "MXN"), "$90,071,992,547,409.91");
});

test("formatMinorUnits places the sign per the locale's own layout, not by string concatenation", () => {
  assert.equal(formatMinorUnits(-1_050, "MXN"), "-$10.50");
});

test("channel and preparation labels are exhaustive and in Spanish", () => {
  assert.equal(channelLabel("table"), "Mesa");
  assert.equal(channelLabel("delivery"), "Domicilio");
  assert.equal(preparationLabel("ready"), "Lista");
  assert.equal(preparationLabel("not_sent"), "Sin enviar");
});

test("filtering by channel never mutates the list and 'all' passes everything through", () => {
  const items = [item({ channel: "table" }), item({ channel: "delivery" })];
  assert.equal(filterBranchOrderWorkItems(items, "all").length, 2);
  assert.deepEqual(filterBranchOrderWorkItems(items, "table"), [items[0]]);
  assert.deepEqual(filterBranchOrderWorkItems(items, "delivery"), [items[1]]);
});

test("branch order tray request sends the scope/cursor/limit and validates the response scope", async () => {
  const original = globalThis.fetch;
  const tray: BranchOrderWorkTrayV1 = { items: [item()], nextCursor: null, schemaVersion: 1, scope };
  try {
    let sent: unknown;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.example/api/v1/branch-orders/tray");
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(tray));
    };
    const result = await requestBranchOrderWorkTray("token", "https://api.example", scope, null, 25);
    assert.deepEqual(sent, { channel: null, cursor: null, limit: 25, schemaVersion: 1, scope });
    assert.deepEqual(result, { ok: true, value: tray });

    globalThis.fetch = async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify(tray)); };
    await requestBranchOrderWorkTray("token", "https://api.example", scope, null, 25, "delivery");
    assert.deepEqual(sent, { channel: "delivery", cursor: null, limit: 25, schemaVersion: 1, scope });

    globalThis.fetch = async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify(tray)); };
    await requestBranchOrderWorkTray("token", "https://api.example", scope, null, 100, null, true);
    assert.deepEqual(sent, { channel: null, cursor: null, limit: 100, schemaVersion: 1, scope, unassignedDeliveriesOnly: true });

    globalThis.fetch = async () => new Response(JSON.stringify({ ...tray, scope: { ...scope, branchId: orderId } }));
    assert.deepEqual(await requestBranchOrderWorkTray("token", "https://api.example", scope, null, 25), { error: "unavailable", ok: false });
  } finally { globalThis.fetch = original; }
});

test("isPayableBranchOrderWorkStatus only allows Cobrar en caja for open/partially_paid, never draft", () => {
  assert.equal(isPayableBranchOrderWorkStatus("open"), true);
  assert.equal(isPayableBranchOrderWorkStatus("partially_paid"), true);
  assert.equal(isPayableBranchOrderWorkStatus("draft"), false);
});

test("shouldApplyBranchOrderWorkTrayResponse discards any response that is not the latest issued request", () => {
  assert.equal(shouldApplyBranchOrderWorkTrayResponse({ cursor: null, replace: true, requestSeq: 1 }, 2, null), false);
  assert.equal(shouldApplyBranchOrderWorkTrayResponse({ cursor: null, replace: true, requestSeq: 2 }, 2, null), true);
});

test("shouldApplyBranchOrderWorkTrayResponse always applies a 'replace' (refresh) response when it is latest", () => {
  const cursor = { orderId: "2ee5f057-7971-468d-b197-f946911743eb", updatedAt: "2026-09-26T18:00:00.000000Z" };
  assert.equal(shouldApplyBranchOrderWorkTrayResponse({ cursor: null, replace: true, requestSeq: 1 }, 1, cursor), true);
});

test("shouldApplyBranchOrderWorkTrayResponse only applies 'Cargar más' when its cursor still matches the current one", () => {
  const requested = { orderId: "2ee5f057-7971-468d-b197-f946911743eb", updatedAt: "2026-09-26T18:00:00.000000Z" };
  const moved = { orderId: "72371a5f-2056-448d-9ddb-14ab6664a4e8", updatedAt: "2026-09-26T18:05:00.000000Z" };
  assert.equal(shouldApplyBranchOrderWorkTrayResponse({ cursor: requested, replace: false, requestSeq: 1 }, 1, requested), true);
  assert.equal(shouldApplyBranchOrderWorkTrayResponse({ cursor: requested, replace: false, requestSeq: 1 }, 1, moved), false);
  assert.equal(shouldApplyBranchOrderWorkTrayResponse({ cursor: requested, replace: false, requestSeq: 1 }, 1, null), false);
});

test("branch order tray request maps HTTP status codes and transport failure", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, error] of [[400, "invalid"], [401, "denied"], [403, "denied"], [503, "unavailable"]] as const) {
      globalThis.fetch = async () => new Response("{}", { status });
      assert.deepEqual(await requestBranchOrderWorkTray("token", "https://api.example", scope, null, 25), { error, ok: false });
    }
    globalThis.fetch = async () => { throw new Error("unexpected transport"); };
    assert.deepEqual(await requestBranchOrderWorkTray("token", "https://api.example", scope, null, 25), { error: "unavailable", ok: false });
  } finally { globalThis.fetch = original; }
});
