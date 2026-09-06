import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createOrderDeliveryTracker } from "./order-delivery.js";
import type { OrderDraftFailure, OrderDraftLine } from "./order-draft.js";
import {
  buildOrderDraftHandoff,
  type OrderDraftHandoffV1,
  type OrderDraftIntegration,
} from "./order-intents.js";
import {
  FIXTURE_GROUP_DONENESS,
  FIXTURE_OPTION_WELL_DONE,
  FIXTURE_PRODUCT_MAIN,
  FIXTURE_TABLE_LONG_NAME,
  orderEntryCatalog,
  scopeA,
  scopeB,
} from "./test-fixtures.js";

const CONTEXT_A = "operator-a|restaurant-a|branch-a|shift-a";
const CONTEXT_B = "operator-b|restaurant-b|branch-b|shift-b";

const lines: readonly OrderDraftLine[] = Object.freeze([Object.freeze({
  draftLineId: "draft-line-1",
  modifierGroups: Object.freeze([Object.freeze({
    groupId: FIXTURE_GROUP_DONENESS,
    selections: Object.freeze([Object.freeze({ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 })]),
  })]),
  productId: FIXTURE_PRODUCT_MAIN,
  quantity: 1,
})]);

function handoff(scope = scopeA): OrderDraftHandoffV1 {
  const built = buildOrderDraftHandoff({
    catalog: orderEntryCatalog(scope),
    lines,
    scope,
    tableId: FIXTURE_TABLE_LONG_NAME,
  });
  if (built === undefined) throw new Error("FIXTURE_HANDOFF_INVALID");
  return built;
}

/** Records what a delivery did, so each test can assert on both halves. */
function recorder(): {
  readonly onSettle: (failure: OrderDraftFailure | undefined) => void;
  readonly onStart: () => void;
  readonly settled: readonly (OrderDraftFailure | undefined)[];
  readonly starts: () => number;
} {
  const settled: (OrderDraftFailure | undefined)[] = [];
  let starts = 0;
  return {
    onSettle: (failure) => { settled.push(failure); },
    onStart: () => { starts += 1; },
    settled,
    starts: () => starts,
  };
}

/** An integration whose single outcome the test controls by hand. */
function deferred(): OrderDraftIntegration & {
  readonly calls: () => number;
  readonly reject: (error: unknown) => void;
  readonly resolve: (failure: OrderDraftFailure | undefined) => void;
} {
  let settle: ((failure: OrderDraftFailure | undefined) => void) | undefined;
  let fail: ((error: unknown) => void) | undefined;
  let calls = 0;
  return {
    calls: () => calls,
    deliver: (): Promise<OrderDraftFailure | undefined> => {
      calls += 1;
      return new Promise((resolvePromise, rejectPromise) => {
        settle = resolvePromise;
        fail = rejectPromise;
      });
    },
    reject: (error) => { fail?.(error); },
    resolve: (failure) => { settle?.(failure); },
  };
}

/** Lets every already-queued promise callback run before asserting. */
async function drain(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

test("an accepted delivery starts once and reports exactly one outcome", async () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  const integration = deferred();

  assert.equal(tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration,
    onSettle: record.onSettle,
    onStart: record.onStart,
  }), true);
  assert.equal(record.starts(), 1);
  assert.equal(integration.calls(), 1);
  assert.deepEqual(record.settled, []);

  integration.resolve(undefined);
  await drain();
  assert.deepEqual(record.settled, [undefined]);
});

test("a second tap in the same context is refused outright, not merely ignored later", async () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  const integration = deferred();
  const run = (): boolean => tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration,
    onSettle: record.onSettle,
    onStart: record.onStart,
  });

  assert.equal(run(), true);
  assert.equal(run(), false);
  assert.equal(run(), false);
  // The integration was called once: nothing was delivered twice.
  assert.equal(integration.calls(), 1);
  assert.equal(record.starts(), 1);

  integration.resolve(undefined);
  await drain();
  assert.deepEqual(record.settled, [undefined]);
});

test("a hung delivery never blocks a later branch, shift or operator", () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  // This integration never settles, at all, ever.
  const hung: OrderDraftIntegration = { deliver: () => new Promise<never>(() => undefined) };

  assert.equal(tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration: hung,
    onSettle: record.onSettle,
    onStart: record.onStart,
  }), true);

  // The same context stays blocked while its own delivery is genuinely pending.
  assert.equal(tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration: hung,
    onSettle: record.onSettle,
    onStart: record.onStart,
  }), false);

  // A different context is not the hung delivery's hostage.
  const later = deferred();
  assert.equal(tracker.run({
    build: () => handoff(scopeB),
    context: CONTEXT_B,
    integration: later,
    onSettle: record.onSettle,
    onStart: record.onStart,
  }), true);
  assert.equal(later.calls(), 1);
  assert.equal(record.starts(), 2);
});

test("a late outcome from an abandoned context cannot touch the draft composed after it", async () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  const stale = deferred();

  tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration: stale,
    onSettle: record.onSettle,
    onStart: record.onStart,
  });
  // Signing out, changing branch or changing shift abandons what is in flight.
  tracker.abandon();

  stale.resolve(undefined);
  await drain();
  assert.deepEqual(record.settled, [], "an abandoned attempt reported an outcome");

  // And its late rejection is just as silent.
  const other = deferred();
  tracker.run({
    build: () => handoff(scopeB),
    context: CONTEXT_B,
    integration: other,
    onSettle: record.onSettle,
    onStart: record.onStart,
  });
  tracker.abandon();
  other.reject(new Error("LATE"));
  await drain();
  assert.deepEqual(record.settled, []);
});

test("a superseded attempt's outcome is dropped in favour of the current one", async () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  const first = deferred();
  const second = deferred();

  tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration: first,
    onSettle: record.onSettle,
    onStart: record.onStart,
  });
  tracker.abandon();
  tracker.run({
    build: () => handoff(scopeB),
    context: CONTEXT_B,
    integration: second,
    onSettle: record.onSettle,
    onStart: record.onStart,
  });

  // The old attempt lands last, and still loses.
  second.resolve("conflict");
  await drain();
  first.resolve(undefined);
  await drain();
  assert.deepEqual(record.settled, ["conflict"]);
});

test("a rejected delivery reports a failure instead of an unhandled rejection", async () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  const integration = deferred();
  const unhandled: unknown[] = [];
  const capture = (error: unknown): void => { unhandled.push(error); };
  process.on("unhandledRejection", capture);
  try {
    tracker.run({
      build: () => handoff(),
      context: CONTEXT_A,
      integration,
      onSettle: record.onSettle,
      onStart: record.onStart,
    });
    integration.reject(new Error("TRANSPORT"));
    await drain();
  } finally {
    process.off("unhandledRejection", capture);
  }
  assert.deepEqual(record.settled, ["unavailable"]);
  assert.deepEqual(unhandled, []);
});

test("an integration that throws synchronously leaves no stuck delivery", async () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  // Not an async function: this really throws before any promise exists.
  const throwing: OrderDraftIntegration = {
    deliver: (): Promise<OrderDraftFailure | undefined> => { throw new Error("SYNCHRONOUS"); },
  };

  assert.equal(tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration: throwing,
    onSettle: record.onSettle,
    onStart: record.onStart,
  }), true);
  // It failed, and it failed immediately — no `sending` left behind.
  assert.deepEqual(record.settled, ["unavailable"]);

  // The context is free again, so the operator can retry in place.
  const retry = deferred();
  assert.equal(tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration: retry,
    onSettle: record.onSettle,
    onStart: record.onStart,
  }), true);
  retry.resolve(undefined);
  await drain();
  assert.deepEqual(record.settled, ["unavailable", undefined]);
});

test("an integration that returns a plain value instead of a promise is contained", async () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  const notAPromise = {
    deliver: (): Promise<OrderDraftFailure | undefined> =>
      "conflict" as unknown as Promise<OrderDraftFailure | undefined>,
  };

  tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration: notAPromise,
    onSettle: record.onSettle,
    onStart: record.onStart,
  });
  await drain();
  assert.deepEqual(record.settled, ["conflict"]);
});

test("a draft the catalog refuses fails closed as stale, and is never delivered", () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  const integration = deferred();

  assert.equal(tracker.run({
    build: () => undefined,
    context: CONTEXT_A,
    integration,
    onSettle: record.onSettle,
    onStart: record.onStart,
  }), true);
  assert.deepEqual(record.settled, ["stale"]);
  assert.equal(integration.calls(), 0, "a stale draft reached the integration");
  // Failing closed also releases the context, so a corrected draft can be sent.
  assert.equal(tracker.run({
    build: () => handoff(),
    context: CONTEXT_A,
    integration,
    onSettle: record.onSettle,
    onStart: record.onStart,
  }), true);
  assert.equal(integration.calls(), 1);
});

test("a build that throws is contained too, and still delivers nothing", () => {
  const tracker = createOrderDeliveryTracker();
  const record = recorder();
  const integration = deferred();

  tracker.run({
    build: (): OrderDraftHandoffV1 => { throw new Error("BUILD"); },
    context: CONTEXT_A,
    integration,
    onSettle: record.onSettle,
    onStart: record.onStart,
  });
  assert.deepEqual(record.settled, ["unavailable"]);
  assert.equal(integration.calls(), 0);
});

test("the delivery tracker performs no request and names no endpoint", () => {
  const source = readFileSync(path.join(process.cwd(), "src", "order-delivery.ts"), "utf8");
  for (const forbidden of ["fetch(", "/api/", "XMLHttpRequest", "WebSocket", "MOBILE_API_PATHS"]) {
    assert.equal(source.includes(forbidden), false, `order-delivery.ts contains ${forbidden}`);
  }
});
