import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { MOBILE_API_PATHS } from "./mobile-client.js";
import type { OrderDraftLine } from "./order-draft.js";
import {
  buildOrderDraftHandoff,
  disconnectedOrderDraftIntegration,
  offerOrderDraft,
  type AddOrderItemIntentV1,
  type CreateOrderIntentV1,
  type OpenOrderIntentV1,
} from "./order-intents.js";
import {
  FIXTURE_CURRENCY,
  FIXTURE_GROUP_DONENESS,
  FIXTURE_OPTION_WELL_DONE,
  FIXTURE_PRODUCT_DRINK,
  FIXTURE_PRODUCT_MAIN,
  FIXTURE_TABLE_LONG_NAME,
  scopeA,
} from "./test-fixtures.js";

const knownProductIds: ReadonlySet<string> = new Set([FIXTURE_PRODUCT_MAIN, FIXTURE_PRODUCT_DRINK]);

const lines: readonly OrderDraftLine[] = Object.freeze([
  Object.freeze({
    draftLineId: "draft-line-1",
    modifierGroups: Object.freeze([Object.freeze({
      groupId: FIXTURE_GROUP_DONENESS,
      selections: Object.freeze([Object.freeze({ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 })]),
    })]),
    productId: FIXTURE_PRODUCT_MAIN,
    quantity: 2,
  }),
  Object.freeze({
    draftLineId: "draft-line-2",
    modifierGroups: Object.freeze([]),
    productId: FIXTURE_PRODUCT_DRINK,
    quantity: 1,
  }),
]);

function build(overrides: Partial<Parameters<typeof buildOrderDraftHandoff>[0]> = {}): ReturnType<typeof buildOrderDraftHandoff> {
  return buildOrderDraftHandoff({
    currency: FIXTURE_CURRENCY,
    knownProductIds,
    lines,
    scope: scopeA,
    tableId: FIXTURE_TABLE_LONG_NAME,
    ...overrides,
  });
}

test("the hand-over carries exactly what the operator composed", () => {
  const handoff = build();
  assert.ok(handoff !== undefined);
  assert.deepEqual(handoff.createOrder, {
    channel: "table",
    currency: FIXTURE_CURRENCY,
    scope: { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId },
    tableId: FIXTURE_TABLE_LONG_NAME,
  } satisfies CreateOrderIntentV1);
  assert.deepEqual(handoff.openOrder, {
    scope: { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId },
    tableId: FIXTURE_TABLE_LONG_NAME,
  } satisfies OpenOrderIntentV1);
  assert.equal(handoff.addItems.length, 2);
  assert.deepEqual(handoff.addItems[0], {
    draftLineId: "draft-line-1",
    modifierGroups: [{ groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }] }],
    productId: FIXTURE_PRODUCT_MAIN,
    quantity: 2,
    scope: { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId },
  } satisfies AddOrderItemIntentV1);
});

test("no audit identity, version or time zone is invented on the client", () => {
  const handoff = build();
  assert.ok(handoff !== undefined);
  const forbidden = ["deviceId", "eventId", "idempotencyKey", "occurredAt", "expectedVersion", "orderId", "orderItemId", "timeZone", "schemaVersion"];
  for (const key of forbidden) {
    assert.equal(key in handoff.createOrder, false, `createOrder carries ${key}`);
    assert.equal(key in handoff.openOrder, false, `openOrder carries ${key}`);
    for (const item of handoff.addItems) assert.equal(key in item, false, `addItem carries ${key}`);
  }
  assert.deepEqual(Object.keys(handoff.createOrder).sort(), ["channel", "currency", "scope", "tableId"]);
  assert.deepEqual(Object.keys(handoff.openOrder).sort(), ["scope", "tableId"]);
});

test("mobile order entry only offers the table channel", () => {
  const handoff = build();
  assert.equal(handoff?.createOrder.channel, "table");
  assert.equal(typeof handoff?.createOrder.tableId, "string");
});

test("the currency comes from the contract and is never defaulted", () => {
  for (const currency of ["", "mxn", "MX", "MXNN", " MXN", "XT1"]) {
    assert.equal(build({ currency }), undefined, currency);
  }
  assert.equal(build({ currency: "MXN" })?.createOrder.currency, "MXN");
  assert.equal(build({ currency: "XTS" })?.createOrder.currency, "XTS");
});

test("an empty draft or a product the catalog no longer publishes fails closed", () => {
  assert.equal(build({ lines: [] }), undefined);
  assert.equal(build({ knownProductIds: new Set([FIXTURE_PRODUCT_MAIN]) }), undefined);
});

test("the draft is offered as create, then one item per line, then open", () => {
  const handoff = build();
  assert.ok(handoff !== undefined);
  const calls: string[] = [];
  offerOrderDraft(handoff, {
    onAddItem: (intent) => { calls.push(`add:${intent.draftLineId}`); },
    onCreateOrder: () => { calls.push("create"); },
    onOpenOrder: () => { calls.push("open"); },
  });
  assert.deepEqual(calls, ["create", "add:draft-line-1", "add:draft-line-2", "open"]);
});

test("the integration this slice ships with performs no write and says so", async () => {
  const handoff = build();
  assert.ok(handoff !== undefined);
  assert.equal(disconnectedOrderDraftIntegration.onCreateOrder(handoff.createOrder), undefined);
  assert.equal(await disconnectedOrderDraftIntegration.submit(handoff), "notConnected");
});

test("no Order endpoint is reachable from the app: the allowlist is unchanged", () => {
  assert.deepEqual(Object.values(MOBILE_API_PATHS).sort(), [
    "/api/v1/access/branch",
    "/api/v1/access/memberships",
    "/api/v1/catalog/menu",
    "/api/v1/dining/layout",
    "/api/v1/shifts/active",
  ]);
  for (const endpoint of Object.values(MOBILE_API_PATHS)) {
    assert.equal(endpoint.includes("orders"), false, endpoint);
  }
});

test("no order-entry source performs or names a request", () => {
  const root = process.cwd();
  for (const file of ["src/order-draft.ts", "src/order-intents.ts", "src/ui/order-draft-screen.tsx"]) {
    const source = readFileSync(path.join(root, ...file.split("/")), "utf8");
    for (const forbidden of ["fetch(", "/api/", "XMLHttpRequest", "WebSocket", "MOBILE_API_PATHS"]) {
      assert.equal(source.includes(forbidden), false, `${file} contains ${forbidden}`);
    }
    // The HTTP client may only be referenced for a type, which compiles away.
    const clientLines = source.split(/\r?\n/u).filter((candidate) => candidate.includes("mobile-client.js"));
    for (const line of clientLines) {
      assert.match(line, /^import type /u, `${file}: ${line}`);
    }
  }
});
