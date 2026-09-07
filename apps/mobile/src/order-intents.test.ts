import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { MAX_ORDER_ITEM_MODIFIER_GROUPS } from "@super-restaurant/shared-types";

import { MOBILE_API_PATHS } from "./mobile-client.js";
import {
  DRAFT_MAX_GROUPS,
  activeProductGroups,
  draftLineIssues,
  isOrderableProduct,
  orderableGroups,
  type OrderDraftLine,
} from "./order-draft.js";
import {
  buildOrderDraftHandoff,
  type AddOrderItemIntentV1,
  type CreateOrderIntentV1,
  type OpenOrderIntentV1,
} from "./order-intents.js";
import {
  FIXTURE_CATEGORY_STARTERS,
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
  bulkGroupId,
  bulkOptionId,
  orderEntryCatalog,
  orderEntryCatalogMissingCategory,
  orderEntryCatalogWithBulkGroups,
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

test("a required group past the presentation cap is still enforced", () => {
  // 51 active groups: the first 50 optional, the 51st required. The screen can
  // only present DRAFT_MAX_GROUPS of them, so before this fix the 51st was
  // invisible to validation too and the line was handed over unsatisfied.
  const catalogWith51 = orderEntryCatalogWithBulkGroups(51, (index) => index === 51);
  assert.equal(activeProductGroups(catalogWith51, FIXTURE_PRODUCT_MAIN).length, 51);
  assert.equal(orderableGroups(catalogWith51, FIXTURE_PRODUCT_MAIN).length, DRAFT_MAX_GROUPS);
  // The required group really is the one the presentation list drops.
  assert.equal(
    orderableGroups(catalogWith51, FIXTURE_PRODUCT_MAIN).some((g) => g.groupId === bulkGroupId(51)),
    false,
  );

  const unsatisfied = mainLine({ modifierGroups: [] });
  assert.deepEqual(build({ catalog: catalogWith51, lines: [unsatisfied] }), undefined);
  assert.equal(draftLineIssues(catalogWith51, unsatisfied).length > 0, true);

  // Satisfying the 51st group makes the very same line offerable, so the rule
  // is "the requirement is enforced", not "many groups are refused".
  const satisfied = mainLine({
    modifierGroups: [{ groupId: bulkGroupId(51), selections: [{ optionId: bulkOptionId(51), quantity: 1 }] }],
  });
  const handoff = build({ catalog: catalogWith51, lines: [satisfied] });
  assert.notEqual(handoff, undefined);
  // And the command still carries far fewer groups than the contract's bound.
  assert.equal(handoff?.addItems[0]?.modifierGroups.length, 1);
});

test("a catalog demanding more mandatory groups than a command can carry cannot be published", () => {
  // This used to be a case this app had to refuse on its own. The shared
  // contract now forbids it upstream: a published catalog may not declare more
  // than MAX_ORDER_ITEM_MODIFIER_GROUPS required groups for one product, so the
  // fixture cannot even build such a body. The invariant is upstream, and the
  // check that it *is* upstream belongs here, at the boundary this app trusts.
  assert.throws(
    () => orderEntryCatalogWithBulkGroups(MAX_ORDER_ITEM_MODIFIER_GROUPS + 1, () => true),
    /FIXTURE_CATALOG_INVALID/u,
  );
  // The fixture parses its own body with the shared parser, so its refusal to
  // build one *is* the shared parser refusing it.
});

test("a line that leaves a mandatory group unselected is refused, never truncated", () => {
  // The boundary the contract does allow: exactly as many required groups as a
  // command can carry. Nothing may be dropped to make a draft fit.
  const atTheLimit = orderEntryCatalogWithBulkGroups(DRAFT_MAX_GROUPS, () => true);
  const unselected = draftLineIssues(atTheLimit, mainLine({ modifierGroups: [] }));
  // One issue per group left unselected: the operator is told about every one,
  // not about a count they would then have to go and find.
  assert.equal(unselected.length, DRAFT_MAX_GROUPS);
  for (const issue of unselected) assert.match(issue, /requiere/u);
  assert.equal(build({ catalog: atTheLimit, lines: [mainLine({ modifierGroups: [] })] }), undefined);

  // Selecting every one of them is what makes the line offerable.
  const all = mainLine({
    modifierGroups: Array.from({ length: DRAFT_MAX_GROUPS }, (_unused, index) => ({
      groupId: bulkGroupId(index + 1),
      selections: [{ optionId: bulkOptionId(index + 1), quantity: 1 }],
    })),
  });
  assert.deepEqual(draftLineIssues(atTheLimit, all), []);
  assert.notEqual(build({ catalog: atTheLimit, lines: [all] }), undefined);

  // One left out is still a refusal, not a truncation to 49.
  assert.equal(
    build({
      catalog: atTheLimit,
      lines: [mainLine({ modifierGroups: all.modifierGroups.slice(0, DRAFT_MAX_GROUPS - 1) })],
    }),
    undefined,
  );
});

test("a product whose category was retired is no longer orderable", () => {
  const valid = [mainLine()];
  assert.notEqual(build({ lines: valid }), undefined, "the baseline line is offerable");

  // The category is deactivated between composing and sending.
  const deactivated = republishedOrderEntryCatalog((body) => {
    const category = body.catalog.categories.find((entry) => entry.categoryId === FIXTURE_CATEGORY_STARTERS);
    if (category !== undefined) category.active = false;
  });
  assert.equal(isOrderableProduct(deactivated, FIXTURE_PRODUCT_MAIN), false);
  assert.equal(build({ catalog: deactivated, lines: valid }), undefined, "inactive category");
  assert.deepEqual(draftLineIssues(deactivated, mainLine()), ["La categoría de este producto ya no está publicada."]);

  // A category that is not in the catalog at all. The shared parser refuses
  // such a body — asserted just below — so this only reaches the client's
  // defensive branch, which must still fail closed rather than assume.
  assert.throws(
    () => republishedOrderEntryCatalog((body) => {
      body.catalog.categories = body.catalog.categories
        .filter((entry) => entry.categoryId !== FIXTURE_CATEGORY_STARTERS);
    }),
    /FIXTURE_CATALOG_INVALID/u,
    "the contract should refuse a product whose category is absent",
  );
  const removed = orderEntryCatalogMissingCategory(FIXTURE_CATEGORY_STARTERS);
  assert.equal(isOrderableProduct(removed, FIXTURE_PRODUCT_MAIN), false);
  assert.equal(build({ catalog: removed, lines: valid }), undefined, "missing category");
  assert.deepEqual(draftLineIssues(removed, mainLine()), ["La categoría de este producto ya no está publicada."]);

  // A line of a still-published category is not dragged down by its own merits,
  // but it is by sharing the hand-over with a retired one: nothing partial.
  const drink = mainLine({ draftLineId: "draft-line-2", modifierGroups: [], productId: FIXTURE_PRODUCT_DRINK });
  assert.notEqual(build({ catalog: deactivated, lines: [drink] }), undefined, "the drinks category is untouched");
  assert.equal(build({ catalog: deactivated, lines: [drink, ...valid] }), undefined, "mixed hand-over");
});

test("one invalid line poisons the whole hand-over: nothing partial is offered", () => {
  const handoff = build({ lines: [mainLine(), mainLine({ draftLineId: "draft-line-2", quantity: 0 })] });
  assert.equal(handoff, undefined);
});

test("two lines may not share a handle, or the feedback for one would be ambiguous", () => {
  assert.equal(build({ lines: [mainLine(), mainLine()] }), undefined);
  assert.notEqual(build({ lines: [mainLine(), mainLine({ draftLineId: "draft-line-2" })] }), undefined);
});

test("the hand-over carries no audit identity of its own", () => {
  // Identity belongs to the delivery plan, which mints it once per delivery.
  // A hand-over that carried an `orderId` or an `eventId` would be inventing an
  // audit trail at composition time, before anything had been sent.
  const handoff = build();
  assert.ok(handoff !== undefined);
  assert.deepEqual(Object.keys(handoff.createOrder).sort(), ["channel", "currency", "scope", "tableId"]);
  assert.deepEqual(Object.keys(handoff.openOrder).sort(), ["scope", "tableId"]);
  for (const item of handoff.addItems) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ["draftLineId", "modifierGroups", "productId", "quantity", "scope"],
    );
  }
});

test("only the three Order mutations and the two operational reads are reachable", () => {
  assert.deepEqual(Object.values(MOBILE_API_PATHS).sort(), [
    "/api/v1/access/branch/context",
    "/api/v1/access/memberships",
    "/api/v1/catalog/menu",
    "/api/v1/dining/layout",
    "/api/v1/orders",
    "/api/v1/orders/active",
    "/api/v1/orders/items",
    "/api/v1/orders/open",
    "/api/v1/shifts/active",
  ]);
  // The whole write surface: create, add one line, open. No payment, cash,
  // refund or item-transition path is reachable from this app at all.
  assert.deepEqual(
    Object.values(MOBILE_API_PATHS).filter((endpoint) => endpoint.includes("orders")).sort(),
    ["/api/v1/orders", "/api/v1/orders/active", "/api/v1/orders/items", "/api/v1/orders/open"],
  );
  for (const endpoint of Object.values(MOBILE_API_PATHS)) {
    for (const forbidden of ["payments", "cash", "refund", "transition", "cancel"]) {
      assert.equal(endpoint.includes(forbidden), false, endpoint);
    }
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
