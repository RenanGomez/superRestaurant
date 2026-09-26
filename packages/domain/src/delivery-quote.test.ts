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

test("quoteDelivery keeps the promise window, horizon, and cutoff exact in UTC across the America/Chicago fall-back DST transition", () => {
  // 2026-11-01 America/Chicago fall-back: 01:59:59 CDT (UTC-5) is immediately
  // followed by 01:00:00 CST (UTC-6) — local wall-clock time repeats/goes
  // backward across 07:00 UTC. All quote arithmetic here is done on UTC
  // instants, never on local wall-clock time, so it must be unaffected.
  const quotedAtBeforeTransition = "2026-11-01T06:59:00.000Z"; // 01:59:00 CDT
  const asapQuote = quoteDelivery(baseInput({
    timeZone: "America/Chicago",
    quotedAt: quotedAtBeforeTransition,
  }));
  assert.equal(asapQuote.promiseStart, "2026-11-01T06:59:00.000Z");
  // 07:14:00Z is 01:14:00 CST local — apparently "earlier" than the 01:59
  // CDT quotedAt on a naive wall-clock reading, proving the 15-minute
  // window is computed on the UTC instant, not local time.
  assert.equal(asapQuote.promiseEnd, "2026-11-01T07:14:00.000Z");
  assert.equal(
    Date.parse(asapQuote.promiseEnd) - Date.parse(asapQuote.promiseStart),
    15 * 60 * 1000,
  );

  // A scheduled window whose cutoff span crosses the same transition: the
  // quote is requested at 01:45 CDT and scheduled for exactly 30 minutes
  // later in UTC (07:15Z), which reads as 01:15 CST — nominally "before"
  // quotedAt's local clock, yet the cutoff must still be satisfied because
  // it is measured on UTC instants.
  const quotedAtAcrossCutoff = "2026-11-01T06:45:00.000Z"; // 01:45:00 CDT
  const scheduledAcrossTransition = "2026-11-01T07:15:00.000Z"; // 01:15:00 CST
  const scheduledQuote = quoteDelivery(baseInput({
    timeZone: "America/Chicago",
    quotedAt: quotedAtAcrossCutoff,
    scheduledFor: scheduledAcrossTransition,
  }));
  assert.equal(scheduledQuote.promiseStart, scheduledAcrossTransition);
  assert.equal(
    Date.parse(scheduledQuote.promiseStart) - Date.parse(quotedAtAcrossCutoff),
    30 * 60 * 1000,
  );
  assert.equal(
    Date.parse(scheduledQuote.promiseEnd) - Date.parse(scheduledQuote.promiseStart),
    15 * 60 * 1000,
  );

  // A schedule exactly 7 days out whose span crosses the same transition
  // must still be accepted: the horizon is measured in UTC milliseconds,
  // not in local calendar days, so the one-hour fall-back does not shift it.
  const quotedAtBeforeHorizon = "2026-10-25T06:59:00.000Z";
  const scheduledAtHorizonAcrossDst = "2026-11-01T06:59:00.000Z";
  const horizonQuote = quoteDelivery(baseInput({
    timeZone: "America/Chicago",
    quotedAt: quotedAtBeforeHorizon,
    scheduledFor: scheduledAtHorizonAcrossDst,
  }));
  assert.equal(horizonQuote.promiseStart, scheduledAtHorizonAcrossDst);
  assert.equal(
    Date.parse(horizonQuote.promiseStart) - Date.parse(quotedAtBeforeHorizon),
    7 * 24 * 60 * 60 * 1000,
  );

  // One millisecond past the 7-day horizon must still be rejected even
  // though the span crosses the DST transition.
  assert.throws(
    () => quoteDelivery(baseInput({
      timeZone: "America/Chicago",
      quotedAt: quotedAtBeforeHorizon,
      scheduledFor: "2026-11-01T06:59:00.001Z",
    })),
    DeliveryScheduleExceedsHorizonError,
  );
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
