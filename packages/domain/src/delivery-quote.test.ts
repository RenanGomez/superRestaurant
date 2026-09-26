import assert from "node:assert/strict";
import test from "node:test";

import { createDeliveryZone } from "./delivery-zone.js";
import { applyDeliveryQuoteOverride, quoteDelivery } from "./delivery-quote.js";
import {
  DeliveryOverrideAuthorizationRequiredError,
  DeliveryOverrideReasonRequiredError,
  DeliveryScheduleCutoffError,
  DeliveryScheduleExceedsHorizonError,
  DeliveryScheduleInPastError,
  InvalidDeliveryOverrideWindowError,
  InvalidDeliveryQuoteFieldError,
  InvalidDeliveryTimestampError,
} from "./errors.js";
import { Money } from "./money.js";

const RESTAURANT_ID = "restaurant-1";
const BRANCH_ID = "branch-1";
const ZONE = createDeliveryZone({
  zoneId: "zone-1",
  restaurantId: RESTAURANT_ID,
  branchId: BRANCH_ID,
  name: "Centro",
  feeMinor: new Money(2_500, "MXN"),
  postalCodes: ["06000"],
  localities: ["Centro Historico"],
});

function baseInput(overrides: Partial<Parameters<typeof quoteDelivery>[0]> = {}): Parameters<typeof quoteDelivery>[0] {
  return {
    quoteId: "quote-1",
    restaurantId: RESTAURANT_ID,
    branchId: BRANCH_ID,
    captureDraftId: "capture-1",
    addressSnapshotRef: "address-snapshot-1",
    address: { postalCode: "06000", locality: "Centro Historico" },
    zones: [ZONE],
    currency: "MXN",
    timeZone: "America/Mexico_City",
    quotedAt: "2026-09-26T18:00:00.000Z",
    scheduledFor: null,
    version: 1,
    ...overrides,
  };
}

test("quoteDelivery covers a matching address with a frozen 15-minute promise window", () => {
  const quote = quoteDelivery(baseInput());
  assert.equal(quote.coverageStatus, "covered");
  assert.equal(quote.zoneId, "zone-1");
  assert.deepEqual(quote.feeMinor, new Money(2_500, "MXN"));
  assert.equal(quote.promiseStart, "2026-09-26T18:00:00.000Z");
  assert.equal(quote.promiseEnd, "2026-09-26T18:15:00.000Z");
  assert.equal(quote.override, null);
  assert.equal(Object.isFrozen(quote), true);
});

test("quoteDelivery reports not_covered with a zero fee when no zone matches", () => {
  const quote = quoteDelivery(baseInput({ address: { postalCode: "99999", locality: "Nowhere" } }));
  assert.equal(quote.coverageStatus, "not_covered");
  assert.equal(quote.zoneId, null);
  assert.deepEqual(quote.feeMinor, new Money(0, "MXN"));
});

test("quoteDelivery is idempotent: identical input yields bit-identical output", () => {
  const first = quoteDelivery(baseInput());
  const second = quoteDelivery(baseInput());
  assert.deepEqual(first, second);
});

test("quoteDelivery accepts a scheduled order within the 7-day horizon and past the 30-minute cutoff", () => {
  const quote = quoteDelivery(baseInput({ scheduledFor: "2026-09-27T12:00:00.000Z" }));
  assert.equal(quote.promiseStart, "2026-09-27T12:00:00.000Z");
  assert.equal(quote.promiseEnd, "2026-09-27T12:15:00.000Z");
});

test("quoteDelivery rejects a scheduled window in the past", () => {
  assert.throws(
    () => quoteDelivery(baseInput({ scheduledFor: "2026-09-26T17:00:00.000Z" })),
    DeliveryScheduleInPastError,
  );
});

test("quoteDelivery rejects a scheduled window inside the 30-minute cutoff", () => {
  assert.throws(
    () => quoteDelivery(baseInput({ scheduledFor: "2026-09-26T18:10:00.000Z" })),
    DeliveryScheduleCutoffError,
  );
});

test("quoteDelivery rejects a scheduled window beyond the 7-day horizon", () => {
  assert.throws(
    () => quoteDelivery(baseInput({ scheduledFor: "2026-10-05T18:00:00.000Z" })),
    DeliveryScheduleExceedsHorizonError,
  );
});

test("quoteDelivery rejects malformed timestamps and unknown time zones", () => {
  assert.throws(() => quoteDelivery(baseInput({ quotedAt: "2026-09-26" })), InvalidDeliveryTimestampError);
  assert.throws(() => quoteDelivery(baseInput({ timeZone: "Nowhere/Imaginary" })), InvalidDeliveryQuoteFieldError);
});

test("quoteDelivery rejects a zone list scoped to a different restaurant or branch", () => {
  const foreignZone = createDeliveryZone({
    zoneId: "zone-2",
    restaurantId: "other-restaurant",
    branchId: BRANCH_ID,
    name: "Foreign",
    feeMinor: new Money(1_000, "MXN"),
    postalCodes: ["06000"],
    localities: [],
  });
  assert.throws(() => quoteDelivery(baseInput({ zones: [foreignZone] })), InvalidDeliveryQuoteFieldError);
});

test("applyDeliveryQuoteOverride requires a manager role and a non-empty reason", () => {
  const quote = quoteDelivery(baseInput());
  const overrideInput = {
    actorId: "actor-1",
    role: "manager",
    reason: "Rain surcharge waived for VIP customer",
    feeMinor: new Money(0, "MXN"),
    promiseStart: "2026-09-26T18:10:00.000Z",
    promiseEnd: "2026-09-26T18:40:00.000Z",
    overriddenAt: "2026-09-26T18:05:00.000Z",
  } as const;

  assert.throws(
    () => applyDeliveryQuoteOverride(quote, { ...overrideInput, role: "supervisor" }),
    DeliveryOverrideAuthorizationRequiredError,
  );
  assert.throws(
    () => applyDeliveryQuoteOverride(quote, { ...overrideInput, reason: "" }),
    DeliveryOverrideReasonRequiredError,
  );
  assert.throws(
    () => applyDeliveryQuoteOverride(quote, { ...overrideInput, promiseStart: overrideInput.promiseEnd, promiseEnd: overrideInput.promiseStart }),
    InvalidDeliveryOverrideWindowError,
  );

  const overridden = applyDeliveryQuoteOverride(quote, overrideInput);
  assert.equal(overridden.override?.reason, overrideInput.reason);
  assert.deepEqual(overridden.override?.feeMinor, new Money(0, "MXN"));
  // The original quoted facts are never mutated by an override.
  assert.deepEqual(overridden.feeMinor, new Money(2_500, "MXN"));
  assert.equal(overridden.promiseStart, quote.promiseStart);
  assert.equal(Object.isFrozen(overridden), true);
});
