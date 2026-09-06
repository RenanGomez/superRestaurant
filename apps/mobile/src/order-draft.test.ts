import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDiningLayoutV1 } from "@super-restaurant/shared-types";

import {
  DRAFT_MAX_GROUPS,
  DRAFT_MAX_QUANTITY,
  DRAFT_MIN_QUANTITY,
  activeProductGroups,
  composerIssues,
  draftLineIssues,
  initialOrderDraftState,
  isOrderableProduct,
  orderDraftFailureMessage,
  orderableCategories,
  orderableGroups,
  orderableProducts,
  reduceOrderDraft,
  remainingOptionCapacity,
  selectedGroupQuantity,
  selectedOptionQuantity,
  type OrderDraftEvent,
  type OrderDraftState,
} from "./order-draft.js";
import {
  FIXTURE_CATEGORY_DRINKS,
  FIXTURE_CATEGORY_RETIRED,
  FIXTURE_CATEGORY_STARTERS,
  FIXTURE_GROUP_DONENESS,
  FIXTURE_GROUP_EXTRAS,
  FIXTURE_GROUP_RETIRED,
  FIXTURE_OPTION_BACON,
  FIXTURE_OPTION_CHEESE,
  FIXTURE_OPTION_RARE,
  FIXTURE_OPTION_WELL_DONE,
  FIXTURE_PRODUCT_DRINK,
  FIXTURE_PRODUCT_MAIN,
  FIXTURE_PRODUCT_RETIRED,
  FIXTURE_TABLE_BAR,
  FIXTURE_TABLE_LONG_NAME,
  FIXTURE_ZONE,
  FIXTURE_ZONE_BAR,
  bulkGroupId,
  orderEntryCatalog,
  orderEntryCatalogWithBulkGroups,
  orderEntryLayoutBody,
  scopeA,
} from "./test-fixtures.js";

const catalog = orderEntryCatalog(scopeA);
const TABLE = FIXTURE_TABLE_LONG_NAME;
const ZONE = FIXTURE_ZONE;
/** An id the catalog never publishes, to model a catalog that changed. */
const UNKNOWN_GROUP = "a16bafb7-358b-459e-b0d2-5610ae1e7031";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function apply(state: OrderDraftState, ...events: readonly OrderDraftEvent[]): OrderDraftState {
  return events.reduce(reduceOrderDraft, state);
}

/** A table selected and one complete line composed: the common starting point. */
function withOneLine(): OrderDraftState {
  return apply(
    initialOrderDraftState,
    { tableId: TABLE, type: "tableSelected", zoneId: ZONE },
    { productId: FIXTURE_PRODUCT_MAIN, type: "productOpened" },
    { quantity: 2, type: "composerQuantitySet" },
    { groupId: FIXTURE_GROUP_DONENESS, optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1, type: "composerOptionSet" },
    { type: "composerCommitted" },
  );
}

test("the order-entry fixtures satisfy the shared contracts, not just this app", () => {
  // Both fixtures back the visual harness as well, so a body the shared parser
  // would refuse must fail here rather than only in a browser.
  const layout = parseDiningLayoutV1(orderEntryLayoutBody(scopeA));
  assert.ok(layout !== undefined);
  assert.deepEqual(layout.zones.map((zone) => zone.tables.length), [2, 1]);
  assert.equal(catalog.currency, "XTS");
  assert.equal(catalog.products.length, 3);
});

test("nothing is composed until a table is selected", () => {
  const ignored = apply(
    initialOrderDraftState,
    { productId: FIXTURE_PRODUCT_MAIN, type: "productOpened" },
    { type: "composerCommitted" },
    { type: "submissionStarted" },
  );
  assert.equal(ignored, initialOrderDraftState);
  assert.equal(ignored.lines.length, 0);
});

test("selecting a table opens an empty draft and re-selecting it changes nothing", () => {
  const selected = apply(initialOrderDraftState, { tableId: TABLE, type: "tableSelected", zoneId: ZONE });
  assert.equal(selected.tableId, TABLE);
  assert.equal(selected.zoneId, ZONE);
  assert.equal(selected.lines.length, 0);
  assert.equal(selected.composer, undefined);

  const drafted = withOneLine();
  // A double tap on the table already open must not silently drop the draft.
  const again = reduceOrderDraft(drafted, { tableId: TABLE, type: "tableSelected", zoneId: ZONE });
  assert.equal(again, drafted);
  assert.equal(again.lines.length, 1);
});

test("changing to another table drops the previous table's draft", () => {
  const moved = reduceOrderDraft(withOneLine(), {
    tableId: FIXTURE_TABLE_BAR,
    type: "tableSelected",
    zoneId: FIXTURE_ZONE_BAR,
  });
  assert.equal(moved.tableId, FIXTURE_TABLE_BAR);
  assert.equal(moved.lines.length, 0);
  assert.equal(moved.nextLineSerial, 1);
});

test("leaving to the tables plan discards the whole draft", () => {
  assert.deepEqual(reduceOrderDraft(withOneLine(), { type: "tableReleased" }), initialOrderDraftState);
});

test("a product, its modifiers and an integer quantity become one line", () => {
  const state = withOneLine();
  assert.equal(state.lines.length, 1);
  const [line] = state.lines;
  assert.ok(line !== undefined);
  assert.equal(line.productId, FIXTURE_PRODUCT_MAIN);
  assert.equal(line.quantity, 2);
  assert.deepEqual(line.modifierGroups, [{
    groupId: FIXTURE_GROUP_DONENESS,
    selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }],
  }]);
  assert.equal(state.composer, undefined);
});

test("a draft line handle is deliberately not a UUID, so it cannot pass as an orderItemId", () => {
  const [line] = withOneLine().lines;
  assert.ok(line !== undefined);
  assert.equal(line.draftLineId, "draft-line-1");
  assert.equal(UUID_PATTERN.test(line.draftLineId), false);
});

test("a double tap on a finished composition adds one line, not two", () => {
  const once = withOneLine();
  const twice = reduceOrderDraft(once, { type: "composerCommitted" });
  assert.equal(twice, once);
  assert.equal(twice.lines.length, 1);
});

test("quantities outside the integer range the contract accepts are refused", () => {
  const open = apply(
    initialOrderDraftState,
    { tableId: TABLE, type: "tableSelected", zoneId: ZONE },
    { productId: FIXTURE_PRODUCT_MAIN, type: "productOpened" },
  );
  for (const quantity of [0, -1, 1.5, Number.NaN, DRAFT_MAX_QUANTITY + 1]) {
    assert.equal(reduceOrderDraft(open, { quantity, type: "composerQuantitySet" }), open, String(quantity));
  }
  assert.equal(reduceOrderDraft(open, { quantity: DRAFT_MAX_QUANTITY, type: "composerQuantitySet" })
    .composer?.quantity, DRAFT_MAX_QUANTITY);
});

test("two rapid taps on a stepper count twice, because a step is relative", () => {
  const open = apply(
    initialOrderDraftState,
    { tableId: TABLE, type: "tableSelected", zoneId: ZONE },
    { productId: FIXTURE_PRODUCT_MAIN, type: "productOpened" },
  );
  // Both taps are drawn from the same render, so both send the same delta.
  const stepped = apply(
    open,
    { delta: 1, type: "composerQuantityStepped" },
    { delta: 1, type: "composerQuantityStepped" },
  );
  assert.equal(stepped.composer?.quantity, 3);

  // Steps saturate at the bounds instead of leaving the contract's range.
  const floored = apply(stepped, ...Array.from({ length: 10 }, () => ({ delta: -1, type: "composerQuantityStepped" } as const)));
  assert.equal(floored.composer?.quantity, DRAFT_MIN_QUANTITY);
});

test("an option step never exceeds the bound the catalog published for it", () => {
  const open = apply(
    initialOrderDraftState,
    { tableId: TABLE, type: "tableSelected", zoneId: ZONE },
    { productId: FIXTURE_PRODUCT_MAIN, type: "productOpened" },
  );
  const step = { delta: 1, groupId: FIXTURE_GROUP_EXTRAS, maximum: 2, optionId: FIXTURE_OPTION_CHEESE, type: "composerOptionStepped" } as const;
  const twice = apply(open, step, step);
  assert.equal(selectedOptionQuantity(twice.composer?.modifierGroups ?? [], FIXTURE_GROUP_EXTRAS, FIXTURE_OPTION_CHEESE), 2);

  // A third tap that raced the disabled state cannot push past the bound.
  const thrice = reduceOrderDraft(twice, step);
  assert.equal(thrice, twice);

  // Stepping back to zero removes the option, and the group with it.
  const cleared = apply(
    twice,
    { ...step, delta: -1 },
    { ...step, delta: -1 },
    { ...step, delta: -1 },
  );
  assert.deepEqual(cleared.composer?.modifierGroups, []);
});

test("setting an option to zero removes it, and the empty group disappears", () => {
  const state = apply(
    initialOrderDraftState,
    { tableId: TABLE, type: "tableSelected", zoneId: ZONE },
    { productId: FIXTURE_PRODUCT_MAIN, type: "productOpened" },
    { groupId: FIXTURE_GROUP_EXTRAS, optionId: FIXTURE_OPTION_CHEESE, quantity: 2, type: "composerOptionSet" },
    { groupId: FIXTURE_GROUP_EXTRAS, optionId: FIXTURE_OPTION_BACON, quantity: 1, type: "composerOptionSet" },
  );
  assert.equal(selectedGroupQuantity(state.composer?.modifierGroups ?? [], FIXTURE_GROUP_EXTRAS), 3);

  const cleared = apply(
    state,
    { groupId: FIXTURE_GROUP_EXTRAS, optionId: FIXTURE_OPTION_CHEESE, quantity: 0, type: "composerOptionSet" },
    { groupId: FIXTURE_GROUP_EXTRAS, optionId: FIXTURE_OPTION_BACON, quantity: 0, type: "composerOptionSet" },
  );
  assert.deepEqual(cleared.composer?.modifierGroups, []);
  assert.equal(selectedOptionQuantity(cleared.composer?.modifierGroups ?? [], FIXTURE_GROUP_EXTRAS, FIXTURE_OPTION_CHEESE), 0);
});

test("editing a line replaces it in place and keeps its handle and position", () => {
  const two = apply(
    withOneLine(),
    { productId: FIXTURE_PRODUCT_DRINK, type: "productOpened" },
    { type: "composerCommitted" },
  );
  assert.deepEqual(two.lines.map((line) => line.draftLineId), ["draft-line-1", "draft-line-2"]);

  const edited = apply(
    two,
    { draftLineId: "draft-line-1", type: "lineEditRequested" },
    { quantity: 5, type: "composerQuantitySet" },
    { type: "composerCommitted" },
  );
  assert.deepEqual(edited.lines.map((line) => line.draftLineId), ["draft-line-1", "draft-line-2"]);
  assert.equal(edited.lines[0]?.quantity, 5);
  assert.equal(edited.lines.length, 2);
  assert.equal(edited.nextLineSerial, 3);
});

test("removing a line drops it, and removing the line being edited closes the composer", () => {
  const editing = apply(withOneLine(), { draftLineId: "draft-line-1", type: "lineEditRequested" });
  assert.equal(editing.composer?.replacingLineId, "draft-line-1");

  const removed = reduceOrderDraft(editing, { draftLineId: "draft-line-1", type: "lineRemoved" });
  assert.equal(removed.lines.length, 0);
  assert.equal(removed.composer, undefined);
  assert.equal(reduceOrderDraft(removed, { draftLineId: "draft-line-1", type: "lineRemoved" }), removed);
});

test("discarding always passes through an in-screen confirmation", () => {
  const drafted = withOneLine();
  // Nothing is discarded by the request itself.
  const asked = reduceOrderDraft(drafted, { intent: "discardDraft", type: "confirmationRequested" });
  assert.equal(asked.pendingConfirmation, "discardDraft");
  assert.equal(asked.lines.length, 1);

  const kept = reduceOrderDraft(asked, { type: "confirmationCancelled" });
  assert.equal(kept.pendingConfirmation, undefined);
  assert.equal(kept.lines.length, 1);

  const discarded = reduceOrderDraft(asked, { type: "confirmationConfirmed" });
  assert.equal(discarded.lines.length, 0);
  assert.equal(discarded.pendingConfirmation, undefined);
  // Discarding the draft is not leaving the table.
  assert.equal(discarded.tableId, TABLE);
  assert.equal(discarded.zoneId, ZONE);

  // Confirming without asking first does nothing, and an empty draft has
  // nothing to confirm about.
  assert.equal(reduceOrderDraft(drafted, { type: "confirmationConfirmed" }), drafted);
  assert.equal(reduceOrderDraft(discarded, { intent: "discardDraft", type: "confirmationRequested" }), discarded);
});

test("leaving to the tables plan with a draft is confirmed, and says so before anything is lost", () => {
  const drafted = withOneLine();
  const asked = reduceOrderDraft(drafted, { intent: "leaveTable", type: "confirmationRequested" });
  // The request alone loses nothing: the table and the line are still there.
  assert.equal(asked.pendingConfirmation, "leaveTable");
  assert.equal(asked.tableId, TABLE);
  assert.equal(asked.lines.length, 1);

  // Cancelling the exit keeps the operator exactly where they were.
  const stayed = reduceOrderDraft(asked, { type: "confirmationCancelled" });
  assert.equal(stayed.tableId, TABLE);
  assert.equal(stayed.lines.length, 1);
  assert.equal(stayed.pendingConfirmation, undefined);

  // Only the confirmation leaves, and leaving really releases the table.
  assert.deepEqual(reduceOrderDraft(asked, { type: "confirmationConfirmed" }), initialOrderDraftState);

  // A double tap on "volver a mesas" asks once; it does not confirm itself.
  const twice = reduceOrderDraft(asked, { intent: "leaveTable", type: "confirmationRequested" });
  assert.equal(twice, asked);
  assert.equal(twice.tableId, TABLE);
  assert.equal(twice.lines.length, 1);
});

test("the two destinations are never confused: each confirmation resolves its own", () => {
  const drafted = withOneLine();
  // Answering "sí" to «descartar y seguir aquí» keeps the table.
  const staying = apply(
    drafted,
    { intent: "discardDraft", type: "confirmationRequested" },
    { type: "confirmationConfirmed" },
  );
  assert.equal(staying.tableId, TABLE);
  assert.equal(staying.lines.length, 0);

  // Answering "sí" to «descartar y volver a mesas» releases it.
  const leaving = apply(
    drafted,
    { intent: "leaveTable", type: "confirmationRequested" },
    { type: "confirmationConfirmed" },
  );
  assert.equal(leaving.tableId, undefined);

  // Re-asking with the other intent replaces the question, and the answer
  // follows the question actually on screen — never the earlier one.
  const switched = apply(
    drafted,
    { intent: "discardDraft", type: "confirmationRequested" },
    { intent: "leaveTable", type: "confirmationRequested" },
  );
  assert.equal(switched.pendingConfirmation, "leaveTable");
  assert.equal(reduceOrderDraft(switched, { type: "confirmationConfirmed" }).tableId, undefined);
});

test("an unconfirmed composition is content too: leaving it behind is confirmed", () => {
  // No committed line, but a product is being configured. Walking out of that
  // silently is the same loss as walking out of a line.
  const composing = apply(
    initialOrderDraftState,
    { tableId: TABLE, type: "tableSelected", zoneId: ZONE },
    { productId: FIXTURE_PRODUCT_MAIN, type: "productOpened" },
  );
  assert.equal(composing.lines.length, 0);
  const asked = reduceOrderDraft(composing, { intent: "leaveTable", type: "confirmationRequested" });
  assert.equal(asked.pendingConfirmation, "leaveTable");
  assert.equal(asked.tableId, TABLE);
  assert.equal(reduceOrderDraft(asked, { type: "confirmationConfirmed" }).tableId, undefined);
});

test("a truly empty draft leaves for the tables plan without a confirmation", () => {
  const empty = apply(initialOrderDraftState, { tableId: TABLE, type: "tableSelected", zoneId: ZONE });
  const left = reduceOrderDraft(empty, { intent: "leaveTable", type: "confirmationRequested" });
  assert.deepEqual(left, initialOrderDraftState);
  assert.equal(left.pendingConfirmation, undefined);
  // And a second tap on an already-released table still changes nothing.
  assert.deepEqual(reduceOrderDraft(left, { intent: "leaveTable", type: "confirmationRequested" }), left);
});

test("removing the last line closes a confirmation left open over nothing", () => {
  const asked = reduceOrderDraft(withOneLine(), { intent: "leaveTable", type: "confirmationRequested" });
  const emptied = reduceOrderDraft(asked, { draftLineId: "draft-line-1", type: "lineRemoved" });
  assert.equal(emptied.lines.length, 0);
  assert.equal(emptied.pendingConfirmation, undefined);
  assert.equal(emptied.tableId, TABLE);
});

test("a context change — branch, shift, operator or sign-out — drops the draft entirely", () => {
  const asked = reduceOrderDraft(withOneLine(), { intent: "discardDraft", type: "confirmationRequested" });
  assert.deepEqual(reduceOrderDraft(asked, { type: "contextReleased" }), initialOrderDraftState);
});

test("the hand-over is idempotent and freezes the draft while it runs", () => {
  const sending = reduceOrderDraft(withOneLine(), { type: "submissionStarted" });
  assert.equal(sending.submission.status, "sending");

  // A double tap does not start a second hand-over.
  assert.equal(reduceOrderDraft(sending, { type: "submissionStarted" }), sending);
  // Nothing about the draft may change while it is in flight.
  for (const event of [
    { draftLineId: "draft-line-1", type: "lineRemoved" },
    { draftLineId: "draft-line-1", type: "lineEditRequested" },
    { productId: FIXTURE_PRODUCT_DRINK, type: "productOpened" },
    { intent: "discardDraft", type: "confirmationRequested" },
    { intent: "leaveTable", type: "confirmationRequested" },
  ] as const satisfies readonly OrderDraftEvent[]) {
    assert.equal(reduceOrderDraft(sending, event), sending, event.type);
  }

  assert.equal(reduceOrderDraft(sending, { type: "submissionSucceeded" }).submission.status, "sent");
  const failed = reduceOrderDraft(sending, { failure: "conflict", type: "submissionFailed" });
  assert.equal(failed.submission.status, "failed");
  assert.equal(failed.submission.failure, "conflict");
  // The draft survives a failure so it can be corrected and offered again.
  assert.equal(failed.lines.length, 1);
});

test("an empty draft and an open composer are not offerable", () => {
  const empty = apply(initialOrderDraftState, { tableId: TABLE, type: "tableSelected", zoneId: ZONE });
  assert.equal(reduceOrderDraft(empty, { type: "submissionStarted" }), empty);

  const composing = reduceOrderDraft(withOneLine(), { productId: FIXTURE_PRODUCT_DRINK, type: "productOpened" });
  assert.equal(reduceOrderDraft(composing, { type: "submissionStarted" }), composing);
});

test("a result that belongs to no hand-over is ignored", () => {
  const drafted = withOneLine();
  assert.equal(reduceOrderDraft(drafted, { type: "submissionSucceeded" }), drafted);
  assert.equal(reduceOrderDraft(drafted, { failure: "network", type: "submissionFailed" }), drafted);
});

test("accepted lines leave the draft, so nothing accepted can be offered twice", () => {
  const sent = apply(withOneLine(), { type: "submissionStarted" }, { type: "submissionSucceeded" });
  assert.equal(sent.submission.status, "sent");
  assert.equal(sent.lines.length, 0);
  // The table and the success notice stay; only the delivered lines are gone.
  assert.equal(sent.tableId, TABLE);
  assert.equal(sent.zoneId, ZONE);

  // A second tap on the primary action has nothing left to offer.
  assert.equal(reduceOrderDraft(sent, { type: "submissionStarted" }), sent);
  // Editing or removing what was accepted is not possible either: it is gone.
  assert.equal(reduceOrderDraft(sent, { draftLineId: "draft-line-1", type: "lineEditRequested" }), sent);
  assert.equal(reduceOrderDraft(sent, { draftLineId: "draft-line-1", type: "lineRemoved" }), sent);
});

test("a second local comanda for the same table carries only the lines composed after the acceptance", () => {
  const sent = apply(withOneLine(), { type: "submissionStarted" }, { type: "submissionSucceeded" });

  const second = apply(
    sent,
    { productId: FIXTURE_PRODUCT_DRINK, type: "productOpened" },
    { quantity: 1, type: "composerQuantitySet" },
    { type: "composerCommitted" },
  );
  assert.equal(second.lines.length, 1);
  assert.equal(second.lines[0]?.productId, FIXTURE_PRODUCT_DRINK);
  // Adding a line clears the previous outcome: this is a new, unsent comanda.
  assert.equal(second.submission.status, "idle");
  // The new line never reuses a handle the accepted comanda already carried.
  assert.notEqual(second.lines[0]?.draftLineId, "draft-line-1");

  const resent = reduceOrderDraft(second, { type: "submissionStarted" });
  assert.equal(resent.submission.status, "sending");
  assert.deepEqual(resent.lines.map((line) => line.productId), [FIXTURE_PRODUCT_DRINK]);
});

test("a handle is never reused after a discard either, so two comandas cannot collide", () => {
  const sent = apply(withOneLine(), { type: "submissionStarted" }, { type: "submissionSucceeded" });
  const discarded = apply(
    sent,
    { productId: FIXTURE_PRODUCT_DRINK, type: "productOpened" },
    { type: "composerCommitted" },
    { intent: "discardDraft", type: "confirmationRequested" },
    { type: "confirmationConfirmed" },
  );
  const next = apply(
    discarded,
    { productId: FIXTURE_PRODUCT_DRINK, type: "productOpened" },
    { type: "composerCommitted" },
  );
  assert.equal(next.lines.length, 1);
  assert.notEqual(next.lines[0]?.draftLineId, "draft-line-1");
  assert.notEqual(next.lines[0]?.draftLineId, "draft-line-2");
});

test("only what the catalog publishes as active is offered", () => {
  const categories = orderableCategories(catalog).map((category) => category.categoryId);
  assert.deepEqual(categories, [FIXTURE_CATEGORY_STARTERS, FIXTURE_CATEGORY_DRINKS]);
  assert.equal(categories.includes(FIXTURE_CATEGORY_RETIRED), false);

  const products = orderableProducts(catalog, FIXTURE_CATEGORY_STARTERS).map((product) => product.productId);
  assert.deepEqual(products, [FIXTURE_PRODUCT_MAIN]);
  assert.equal(products.includes(FIXTURE_PRODUCT_RETIRED), false);

  const groups = orderableGroups(catalog, FIXTURE_PRODUCT_MAIN);
  assert.deepEqual(groups.map((group) => group.groupId), [FIXTURE_GROUP_DONENESS, FIXTURE_GROUP_EXTRAS]);
  assert.deepEqual(groups[0]?.options.map((option) => option.optionId), [FIXTURE_OPTION_WELL_DONE]);
  assert.equal(groups[0]?.options.some((option) => option.optionId === FIXTURE_OPTION_RARE), false);
  assert.deepEqual(orderableGroups(catalog, FIXTURE_PRODUCT_DRINK), []);
});

test("presentation truncates the group list; validation never does", () => {
  const many = orderEntryCatalogWithBulkGroups(2_000, () => false);
  // The catalog may publish far more groups than one command can carry.
  assert.equal(activeProductGroups(many, FIXTURE_PRODUCT_MAIN).length, 2_000);
  // The screen shows a bounded slice, in catalog order, from the front.
  const shown = orderableGroups(many, FIXTURE_PRODUCT_MAIN);
  assert.equal(shown.length, DRAFT_MAX_GROUPS);
  assert.equal(shown[0]?.groupId, bulkGroupId(1));
  assert.equal(shown.at(-1)?.groupId, bulkGroupId(DRAFT_MAX_GROUPS));
  // With nothing required, an empty composition is offerable despite the size.
  assert.deepEqual(draftLineIssues(many, { modifierGroups: [], productId: FIXTURE_PRODUCT_MAIN, quantity: 1 }), []);
});

test("an inactive group is excluded from both the presentation list and the validation set", () => {
  // The retired group of the base fixture must not reappear through the
  // uncapped validation set: "uncapped" is not "unfiltered".
  assert.equal(activeProductGroups(catalog, FIXTURE_PRODUCT_MAIN).some((g) => g.groupId === FIXTURE_GROUP_RETIRED), false);
  assert.equal(orderableGroups(catalog, FIXTURE_PRODUCT_MAIN).some((g) => g.groupId === FIXTURE_GROUP_RETIRED), false);
  // Inactive options stay filtered out of the validation set too.
  const doneness = activeProductGroups(catalog, FIXTURE_PRODUCT_MAIN)
    .find((group) => group.groupId === FIXTURE_GROUP_DONENESS);
  assert.deepEqual(doneness?.options.map((option) => option.optionId), [FIXTURE_OPTION_WELL_DONE]);
});

test("a product is orderable only while its category is published and active", () => {
  assert.equal(isOrderableProduct(catalog, FIXTURE_PRODUCT_MAIN), true);
  assert.equal(isOrderableProduct(catalog, FIXTURE_PRODUCT_RETIRED), false, "inactive product");
  assert.equal(isOrderableProduct(catalog, UNKNOWN_GROUP), false, "unknown product");
});

test("the bounds the catalog publishes are what the interface may offer", () => {
  const groups = orderableGroups(catalog, FIXTURE_PRODUCT_MAIN);

  const empty = { modifierGroups: [], productId: FIXTURE_PRODUCT_MAIN, quantity: 1, replacingLineId: undefined };
  assert.deepEqual(composerIssues(groups, empty), ["«Término» requiere al menos 1."]);

  const chosen = {
    ...empty,
    modifierGroups: [{
      groupId: FIXTURE_GROUP_DONENESS,
      selections: [{ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 }],
    }],
  };
  assert.deepEqual(composerIssues(groups, chosen), []);

  const tooMany = {
    ...chosen,
    modifierGroups: [
      ...chosen.modifierGroups,
      {
        groupId: FIXTURE_GROUP_EXTRAS,
        selections: [{ optionId: FIXTURE_OPTION_CHEESE, quantity: 4 }],
      },
    ],
  };
  assert.deepEqual(composerIssues(groups, tooMany), [
    "«Extras» admite como máximo 3.",
    "«Queso extra» admite como máximo 2.",
  ]);

  const unknownGroup = {
    ...chosen,
    modifierGroups: [...chosen.modifierGroups, { groupId: UNKNOWN_GROUP, selections: [] }],
  };
  assert.ok(composerIssues(groups, unknownGroup)
    .includes("El catálogo cambió: vuelve a elegir los modificadores de este producto."));

  const badQuantity = { ...chosen, quantity: 0 };
  assert.ok(composerIssues(groups, badQuantity).some((issue) => issue.startsWith("La cantidad")));
});

test("remaining capacity respects the group cap, the option cap and the contract cap", () => {
  const groups = orderableGroups(catalog, FIXTURE_PRODUCT_MAIN);
  const extras = groups[1];
  assert.ok(extras !== undefined);
  const cheese = extras.options[0];
  const bacon = extras.options[1];
  assert.ok(cheese !== undefined && bacon !== undefined);

  assert.equal(remainingOptionCapacity(extras, cheese, []), 2);
  assert.equal(remainingOptionCapacity(extras, bacon, []), 3);
  const twoCheese = [{ groupId: FIXTURE_GROUP_EXTRAS, selections: [{ optionId: FIXTURE_OPTION_CHEESE, quantity: 2 }] }];
  assert.equal(remainingOptionCapacity(extras, cheese, twoCheese), 0);
  assert.equal(remainingOptionCapacity(extras, bacon, twoCheese), 1);
});

test("every failure the composer can report has an operational message", () => {
  for (const failure of ["authorization", "conflict", "network", "notConnected", "protocol", "stale", "unavailable"] as const) {
    const message = orderDraftFailureMessage(failure);
    assert.ok(message.length > 20, failure);
    assert.equal(message.includes("undefined"), false, failure);
  }
  assert.match(orderDraftFailureMessage("notConnected"), /todavía no está conectado/u);
});

test("the draft state never touches money: no amount or currency is read at all", () => {
  // Comments are stripped first: the module documents what it refuses to do,
  // and that prose must not be mistaken for the behaviour being checked.
  const source = readFileSync(path.join(process.cwd(), "src", "order-draft.ts"), "utf8")
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/\/\/.*/gu, "");
  for (const forbidden of ["unitPriceMinor", "amountMinor", "PriceMinor", "currency", "Currency", "MXN", "formatMinorAmount"]) {
    assert.equal(source.includes(forbidden), false, `order-draft.ts references ${forbidden}`);
  }
});
