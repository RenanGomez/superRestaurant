import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { MOBILE_API_PATHS } from "./mobile-client.js";
import type { OrderDraftLine } from "./order-draft.js";
import {
  buildOrderDraftHandoff,
  disconnectedOrderDraftIntegration,
  type AddOrderItemIntentV1,
  type CreateOrderIntentV1,
  type OpenOrderIntentV1,
} from "./order-intents.js";
import {
  FIXTURE_CURRENCY,
  FIXTURE_GROUP_DONENESS,
  FIXTURE_GROUP_EXTRAS,
  FIXTURE_OPTION_BACON,
  FIXTURE_OPTION_CHEESE,
  FIXTURE_OPTION_WELL_DONE,
  FIXTURE_PRODUCT_DRINK,
  FIXTURE_PRODUCT_MAIN,
  FIXTURE_PRODUCT_RETIRED,
  FIXTURE_TABLE_LONG_NAME,
  orderEntryCatalog,
  republishedOrderEntryCatalog,
  scopeA,
} from "./test-fixtures.js";

const catalog = orderEntryCatalog(scopeA);

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
    catalog,
    lines,
    scope: scopeA,
    tableId: FIXTURE_TABLE_LONG_NAME,
    ...overrides,
  });
}

/** One valid line of the main product, with the required «Término» satisfied. */
function mainLine(overrides: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return {
    draftLineId: "draft-line-1",
    modifierGroups: [{
      groupId: FIXTURE_GROUP_DONENESS,
      selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }],
    }],
    productId: FIXTURE_PRODUCT_MAIN,
    quantity: 1,
    ...overrides,
  };
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
    // The parser rejects most of these outright; whatever survives it must
    // still not reach a create-order intent.
    let republished: ReturnType<typeof republishedOrderEntryCatalog> | undefined;
    try {
      republished = republishedOrderEntryCatalog((body) => { body.catalog.currency = currency; });
    } catch {
      continue;
    }
    assert.equal(build({ catalog: republished }), undefined, currency);
  }
  assert.equal(build({ catalog: orderEntryCatalog(scopeA, "MXN") })?.createOrder.currency, "MXN");
  assert.equal(build()?.createOrder.currency, FIXTURE_CURRENCY);
});

test("an empty draft or a product the catalog no longer publishes fails closed", () => {
  assert.equal(build({ lines: [] }), undefined);
  // A product the catalog still lists but has deactivated is not orderable.
  assert.equal(build({ lines: [mainLine({ productId: FIXTURE_PRODUCT_RETIRED, modifierGroups: [] })] }), undefined);
  // A product id the catalog never published at all.
  assert.equal(build({ lines: [mainLine({ productId: FIXTURE_PRODUCT_DRINK, modifierGroups: [
    { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }] },
  ] })] }), undefined);
});

test("a catalog change between composing and sending is refused, never sent stale", () => {
  const valid = [mainLine()];
  assert.notEqual(build({ lines: valid }), undefined, "the baseline line is offerable");

  // The group the line selected from was retired while the operator composed.
  assert.equal(build({
    catalog: republishedOrderEntryCatalog((body) => {
      const group = body.catalog.modifierGroups.find((entry) => entry.groupId === FIXTURE_GROUP_DONENESS);
      if (group !== undefined) group.active = false;
    }),
    lines: valid,
  }), undefined, "retired group");

  // The option is gone, but the group still requires one.
  assert.equal(build({
    catalog: republishedOrderEntryCatalog((body) => {
      const group = body.catalog.modifierGroups.find((entry) => entry.groupId === FIXTURE_GROUP_DONENESS);
      const option = group?.options.find((entry) => entry.optionId === FIXTURE_OPTION_WELL_DONE);
      if (option !== undefined) option.active = false;
    }),
    lines: valid,
  }), undefined, "retired option");

  // A minimum the draft predates: «Extras» now requires one selection.
  assert.equal(build({
    catalog: republishedOrderEntryCatalog((body) => {
      const group = body.catalog.modifierGroups.find((entry) => entry.groupId === FIXTURE_GROUP_EXTRAS);
      if (group !== undefined) group.minimumQuantity = 1;
    }),
    lines: valid,
  }), undefined, "new required minimum");

  // A maximum lowered under an existing selection.
  assert.equal(build({
    catalog: republishedOrderEntryCatalog((body) => {
      const group = body.catalog.modifierGroups.find((entry) => entry.groupId === FIXTURE_GROUP_EXTRAS);
      const option = group?.options.find((entry) => entry.optionId === FIXTURE_OPTION_CHEESE);
      if (option !== undefined) option.maximumQuantity = 1;
    }),
    lines: [mainLine({
      modifierGroups: [
        { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }] },
        { groupId: FIXTURE_GROUP_EXTRAS, selections: [{ optionId: FIXTURE_OPTION_CHEESE, quantity: 2 }] },
      ],
    })],
  }), undefined, "lowered option maximum");
});

test("a line the reducer could not have produced is still refused", () => {
  // Nothing below can come out of `reduceOrderDraft`; the hand-over does not
  // rely on that, because a bug there would otherwise become a request.
  const cases: readonly (readonly [string, OrderDraftLine])[] = [
    ["missing required group", mainLine({ modifierGroups: [] })],
    ["duplicated group", mainLine({
      modifierGroups: [
        { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }] },
        { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }] },
      ],
    })],
    ["duplicated option inside a group", mainLine({
      modifierGroups: [
        { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }] },
        {
          groupId: FIXTURE_GROUP_EXTRAS,
          selections: [
            { optionId: FIXTURE_OPTION_BACON, quantity: 1 },
            { optionId: FIXTURE_OPTION_BACON, quantity: 1 },
          ],
        },
      ],
    })],
    ["option belonging to another group", mainLine({
      modifierGroups: [
        { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_CHEESE, quantity: 1 }] },
      ],
    })],
    ["group maximum exceeded", mainLine({
      modifierGroups: [
        { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }] },
        { groupId: FIXTURE_GROUP_EXTRAS, selections: [{ optionId: FIXTURE_OPTION_BACON, quantity: 4 }] },
      ],
    })],
    ["quantity zero", mainLine({ quantity: 0 })],
    ["negative quantity", mainLine({ quantity: -1 })],
    ["fractional quantity", mainLine({ quantity: 1.5 })],
    ["quantity above the contract range", mainLine({ quantity: 1_001 })],
    ["non-finite quantity", mainLine({ quantity: Number.NaN })],
    ["infinite quantity", mainLine({ quantity: Number.POSITIVE_INFINITY })],
    ["option quantity zero", mainLine({
      modifierGroups: [
        { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 0 }] },
      ],
    })],
    ["fractional option quantity", mainLine({
      modifierGroups: [
        { groupId: FIXTURE_GROUP_DONENESS, selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1.5 }] },
      ],
    })],
  ];
  for (const [label, line] of cases) {
    assert.equal(build({ lines: [line] }), undefined, label);
  }
});

test("one invalid line poisons the whole hand-over: nothing partial is offered", () => {
  const handoff = build({ lines: [mainLine(), mainLine({ draftLineId: "draft-line-2", quantity: 0 })] });
  assert.equal(handoff, undefined);
});

test("two lines may not share a handle, or the feedback for one would be ambiguous", () => {
  assert.equal(build({ lines: [mainLine(), mainLine()] }), undefined);
  assert.notEqual(build({ lines: [mainLine(), mainLine({ draftLineId: "draft-line-2" })] }), undefined);
});

test("the hand-over is the single delivery boundary: no callback surface beside it", () => {
  // A second surface is exactly what let a wired integration create, add and
  // open twice. The contract exposes `deliver` and nothing else.
  assert.deepEqual(Object.keys(disconnectedOrderDraftIntegration), ["deliver"]);
});

test("the integration this slice ships with performs no write and says so", async () => {
  const handoff = build();
  assert.ok(handoff !== undefined);
  assert.equal(await disconnectedOrderDraftIntegration.deliver(handoff), "notConnected");
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
  for (const file of [
    "src/order-draft.ts",
    "src/order-delivery.ts",
    "src/order-intents.ts",
    "src/ui/order-draft-screen.tsx",
  ]) {
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
