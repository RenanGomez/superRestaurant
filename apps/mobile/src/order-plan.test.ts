import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  parseAddOrderItemCommandV1,
  parseCreateOrderCommandV2,
  parseOpenOrderCommandV1,
} from "@super-restaurant/shared-types";

import type { OrderDraftLine } from "./order-draft.js";
import { buildOrderDeliveryPlan, type OrderDeliveryPlanV1 } from "./order-plan.js";
import {
  FIXTURE_GROUP_DONENESS,
  FIXTURE_OPTION_WELL_DONE,
  FIXTURE_PRODUCT_MAIN,
  FIXTURE_SHIFT,
  FIXTURE_TABLE,
  FIXTURE_TIME_ZONE,
  orderEntryCatalog,
  scopeA,
} from "./test-fixtures.js";

const DEVICE_ID = "d0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-06T18:30:45.123Z");

function line(overrides: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return Object.freeze({
    draftLineId: "draft-line-1",
    modifierGroups: Object.freeze([Object.freeze({
      groupId: FIXTURE_GROUP_DONENESS,
      selections: Object.freeze([Object.freeze({ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 })]),
    })]),
    productId: FIXTURE_PRODUCT_MAIN,
    quantity: 1,
    ...overrides,
  });
}

/** A generator whose values the test chose, so the plan's identities are readable. */
function generator(prefix = "e"): (() => string) & { readonly calls: () => number } {
  let calls = 0;
  const next = (): string => {
    calls += 1;
    return `${prefix}0000000-0000-4000-8000-${calls.toString(16).padStart(12, "0")}`;
  };
  return Object.assign(next, { calls: (): number => calls });
}

function build(overrides: Partial<Parameters<typeof buildOrderDeliveryPlan>[0]> = {}): OrderDeliveryPlanV1 | undefined {
  return buildOrderDeliveryPlan({
    catalog: orderEntryCatalog(scopeA),
    deviceId: DEVICE_ID,
    lines: [line()],
    now: NOW,
    randomUuid: generator(),
    scope: scopeA,
    shiftId: FIXTURE_SHIFT,
    tableId: FIXTURE_TABLE,
    timeZone: FIXTURE_TIME_ZONE,
    ...overrides,
  });
}

test("one plan carries one identity per mutation, all distinct", () => {
  const plan = build({ lines: [line(), line({ draftLineId: "draft-line-2", quantity: 3 })] });
  assert.ok(plan !== undefined);

  const identities = [
    plan.orderId,
    plan.createOrder.eventId,
    plan.createOrder.idempotencyKey,
    plan.openOrder.eventId,
    plan.openOrder.idempotencyKey,
    ...plan.addItems.flatMap((item) => [item.orderItemId, item.eventId, item.idempotencyKey]),
  ];
  assert.equal(new Set(identities).size, identities.length, "an identity was reused inside one plan");
  assert.equal(identities.length, 11, "two lines: order, create, open and three ids per line");

  // The context the server needs, none of it decided here except the ids.
  assert.equal(plan.timeZone, FIXTURE_TIME_ZONE);
  assert.equal(plan.shiftId, FIXTURE_SHIFT);
  assert.equal(plan.deviceId, DEVICE_ID);
  assert.equal(plan.currency, orderEntryCatalog(scopeA).currency);
  assert.equal(plan.channel, "table");
  assert.equal(plan.occurredAt, "2026-09-06T18:30:45.123Z");
  assert.deepEqual(plan.addItems.map((item) => item.draftLineId), ["draft-line-1", "draft-line-2"]);
  assert.equal(plan.addItems[1]?.quantity, 3);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.addItems), true);
});

test("every command built from a plan is exactly what the shared parsers accept", () => {
  const plan = build();
  assert.ok(plan !== undefined);
  const scope = { branchId: plan.scope.branchId, restaurantId: plan.scope.restaurantId };

  const create = parseCreateOrderCommandV2({
    channel: plan.channel,
    currency: plan.currency,
    deviceId: plan.deviceId,
    eventId: plan.createOrder.eventId,
    idempotencyKey: plan.createOrder.idempotencyKey,
    occurredAt: plan.occurredAt,
    orderId: plan.orderId,
    schemaVersion: 2,
    scope,
    shiftId: plan.shiftId,
    tableId: plan.tableId,
    timeZone: plan.timeZone,
  });
  assert.ok(create !== undefined, "the v2 create command must parse");
  assert.equal(create.shiftId, FIXTURE_SHIFT);

  const item = plan.addItems[0];
  assert.ok(item !== undefined);
  const add = parseAddOrderItemCommandV1({
    deviceId: plan.deviceId,
    eventId: item.eventId,
    expectedVersion: 1,
    idempotencyKey: item.idempotencyKey,
    modifierGroups: item.modifierGroups,
    occurredAt: plan.occurredAt,
    orderId: plan.orderId,
    orderItemId: item.orderItemId,
    productId: item.productId,
    quantity: item.quantity,
    schemaVersion: 1,
    scope,
  });
  assert.ok(add !== undefined, "the add-item command must parse");

  const open = parseOpenOrderCommandV1({
    deviceId: plan.deviceId,
    eventId: plan.openOrder.eventId,
    expectedVersion: 2,
    idempotencyKey: plan.openOrder.idempotencyKey,
    occurredAt: plan.occurredAt,
    orderId: plan.orderId,
    schemaVersion: 1,
    scope,
  });
  assert.ok(open !== undefined, "the open command must parse");
});

test("two deliveries never share an identity", () => {
  // One generator across both, which is how the real app sees it: the entropy
  // source is the platform's, and each delivery draws new values from it.
  const randomUuid = generator();
  const first = build({ randomUuid });
  const second = build({ randomUuid });
  assert.ok(first !== undefined && second !== undefined);

  assert.notEqual(first.orderId, second.orderId);
  assert.notEqual(first.createOrder.idempotencyKey, second.createOrder.idempotencyKey);
  assert.notEqual(first.openOrder.eventId, second.openOrder.eventId);
  assert.notEqual(first.addItems[0]?.orderItemId, second.addItems[0]?.orderItemId);
});

test("a draft the published catalog no longer accepts yields no plan at all", () => {
  assert.equal(build({ lines: [] }), undefined, "an empty draft");
  assert.equal(build({ lines: [line({ quantity: 0 })] }), undefined, "a quantity the command refuses");
  assert.equal(build({ lines: [line({ quantity: 1_001 })] }), undefined, "a quantity past the maximum");
  assert.equal(build({ lines: [line({ modifierGroups: [] })] }), undefined, "a required group left unselected");
  assert.equal(build({ lines: [line(), line()] }), undefined, "two lines sharing a handle");
  assert.equal(
    build({ lines: [line({ productId: FIXTURE_TABLE })] }),
    undefined,
    "a product the catalog does not publish",
  );
});

test("identity and context are required, never defaulted", () => {
  assert.equal(build({ deviceId: "dispositivo-1" }), undefined, "a deviceId that is not a UUID");
  assert.equal(build({ shiftId: "turno-1" }), undefined, "a shiftId that is not a UUID");
  assert.equal(build({ tableId: "mesa-1" }), undefined, "a tableId that is not a UUID");
  assert.equal(build({ timeZone: "" }), undefined, "an empty zone");
  assert.equal(build({ timeZone: "Marte/Olimpo" }), undefined, "a zone this runtime cannot resolve");
  assert.equal(build({ timeZone: " America/Hermosillo" }), undefined, "an untrimmed zone");
  assert.equal(build({ now: Number.NaN }), undefined, "an instant that is not a number");
  assert.equal(build({ now: 1.5 }), undefined, "an instant that is not whole milliseconds");
});

test("a generator that repeats or throws produces no plan", () => {
  assert.equal(
    build({ randomUuid: () => "e0000000-0000-4000-8000-000000000001" }),
    undefined,
    "a generator that repeats one value",
  );
  assert.equal(
    build({ randomUuid: () => { throw new Error("NO_ENTROPY"); } }),
    undefined,
    "a generator that throws",
  );
  assert.equal(build({ randomUuid: () => "no-es-un-uuid" }), undefined, "a generator that is not one");
});

test("the plan performs no request, names no endpoint and stores nothing", () => {
  const source = readFileSync(path.join(process.cwd(), "src", "order-plan.ts"), "utf8");
  const code = source
    .split(/\r?\n/u)
    .filter((candidate) => !/^\s*(?:\/\/|\*|\/\*)/u.test(candidate))
    .join("\n");
  for (const forbidden of ["fetch(", "/api/", "SecureStore", "setItem", "accessToken", "console."]) {
    assert.equal(code.includes(forbidden), false, `order-plan.ts contains ${forbidden}`);
  }
  // No money is computed here: the plan carries the catalog's currency and
  // nothing derived from a price.
  for (const forbidden of ["amountMinor", "total", "tax", "discount", "tip"]) {
    assert.equal(code.includes(forbidden), false, `order-plan.ts computes ${forbidden}`);
  }
});
