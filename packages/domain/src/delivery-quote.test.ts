import assert from "node:assert/strict";
import test from "node:test";

import { createDeliveryZone } from "./delivery-zone.js";
import { applyDeliveryManualFee, deliveryQuoteEffectiveFeeMinor, quoteDelivery } from "./delivery-quote.js";
import {
  DeliveryManualFeeAuthorizationRequiredError,
  DeliveryManualFeeNotCoveredError,
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
  settlementIds: [],
});

function baseFacts(overrides: Partial<Parameters<typeof quoteDelivery>[0]["address"]> = {}): Parameters<typeof quoteDelivery>[0]["address"] {
  return { settlementId: null, neighborhood: null, postalCode: "06000", locality: "Centro Historico", ...overrides };
}

function baseInput(overrides: Partial<Parameters<typeof quoteDelivery>[0]> = {}): Parameters<typeof quoteDelivery>[0] {
  return {
    quoteId: "quote-1",
    restaurantId: RESTAURANT_ID,
    branchId: BRANCH_ID,
    captureDraftId: "capture-1",
    addressSnapshotRef: "address-snapshot-1",
    address: baseFacts(),
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
  assert.equal(quote.promiseStart, "2026-09-26T18:30:00.000Z");
  assert.equal(quote.promiseEnd, "2026-09-26T18:45:00.000Z");
  assert.equal(quote.expiresAt, "2026-09-26T18:15:00.000Z");
  assert.equal(quote.override, null);
  assert.equal(Object.isFrozen(quote), true);
});

test("quoteDelivery reports not_covered with a zero fee when no zone matches", () => {
  const quote = quoteDelivery(baseInput({ address: baseFacts({ postalCode: "99999", locality: "Nowhere" }) }));
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
  // Programada: expira cuando inicia la ventana prometida (política promise_start).
  assert.equal(quote.expiresAt, quote.promiseStart);
});

test("quoteDelivery ASAP: vigente 14 minutos después de quotedAt y vencida a los 16", () => {
  const quote = quoteDelivery(baseInput());
  const quotedAtMs = Date.parse(quote.quotedAt);
  const expiresAtMs = Date.parse(quote.expiresAt);
  assert.equal(expiresAtMs - quotedAtMs, 15 * 60 * 1000);
  assert.equal(quotedAtMs + 14 * 60 * 1000 < expiresAtMs, true);
  assert.equal(quotedAtMs + 16 * 60 * 1000 <= expiresAtMs, false);
  assert.equal(Date.parse(quote.promiseStart) - quotedAtMs, 30 * 60 * 1000);
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
  assert.equal(asapQuote.promiseStart, "2026-11-01T07:29:00.000Z");
  // 07:14:00Z is 01:14:00 CST local — apparently "earlier" than the 01:59
  // CDT quotedAt on a naive wall-clock reading, proving the 15-minute
  // window is computed on the UTC instant, not local time.
  assert.equal(asapQuote.promiseEnd, "2026-11-01T07:44:00.000Z");
  assert.equal(asapQuote.expiresAt, "2026-11-01T07:14:00.000Z");
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
    settlementIds: [],
  });
  assert.throws(() => quoteDelivery(baseInput({ zones: [foreignZone] })), InvalidDeliveryQuoteFieldError);
});

test("applyDeliveryManualFee rejects a covered quote", () => {
  const covered = quoteDelivery(baseInput({ address: { settlementId: "settlement-1", neighborhood: null, postalCode: null, locality: null },
    zones: [createDeliveryZone({
      zoneId: "zone-settlement", restaurantId: RESTAURANT_ID, branchId: BRANCH_ID, name: "Colonia",
      feeMinor: new Money(2_500, "MXN"), postalCodes: [], localities: [], settlementIds: ["settlement-1"],
    })] }));
  assert.equal(covered.coverageStatus, "covered");
  assert.throws(
    () => applyDeliveryManualFee(covered, {
      eventId: "event-1", actorId: "actor-1", role: "supervisor", reason: "Fuera de zona",
      feeMinor: new Money(3_000, "MXN"), overriddenAt: "2026-09-26T18:05:00.000Z",
    }),
    DeliveryManualFeeNotCoveredError,
  );
});

test("applyDeliveryManualFee requires an owner/admin/manager/supervisor role and a non-empty reason", () => {
  const quote = quoteDelivery(baseInput({ address: baseFacts({ postalCode: "99999", locality: "Nowhere" }) }));
  assert.equal(quote.coverageStatus, "not_covered");
  const input = {
    eventId: "event-1",
    actorId: "actor-1",
    role: "supervisor",
    reason: "Colonia fuera del catálogo",
    feeMinor: new Money(3_000, "MXN"),
    promiseStart: "2026-09-26T18:10:00.000Z",
    promiseEnd: "2026-09-26T18:40:00.000Z",
    overriddenAt: "2026-09-26T18:05:00.000Z",
  } as const;

  for (const role of ["cashier", "waiter", "kitchen", ""]) {
    assert.throws(
      () => applyDeliveryManualFee(quote, { ...input, role }),
      DeliveryManualFeeAuthorizationRequiredError,
    );
  }
  assert.throws(
    () => applyDeliveryManualFee(quote, { ...input, reason: "" }),
    DeliveryOverrideReasonRequiredError,
  );
  assert.throws(
    () => applyDeliveryManualFee(quote, { ...input, promiseStart: input.promiseEnd, promiseEnd: input.promiseStart }),
    InvalidDeliveryOverrideWindowError,
  );

  for (const role of ["owner", "admin", "manager", "supervisor"] as const) {
    const overridden = applyDeliveryManualFee(quote, { ...input, role });
    assert.equal(overridden.override?.kind, "manual_fee");
    assert.equal(overridden.override?.role, role);
    assert.equal(overridden.override?.reason, input.reason);
    assert.equal(overridden.override?.overriddenAt, input.overriddenAt);
    assert.equal(overridden.override?.promiseStart, input.promiseStart);
    // The original quoted facts are never mutated by the authorization.
    assert.deepEqual(overridden.feeMinor, new Money(0, "MXN"));
    assert.notEqual(overridden.promiseStart, input.promiseStart);
    assert.equal(Object.isFrozen(overridden), true);
    assert.equal(Object.isFrozen(overridden.override), true);
  }
});

test("deliveryQuoteEffectiveFeeMinor prefers the authorized override and falls back to the zone fee", () => {
  const notCovered = quoteDelivery(baseInput({ address: baseFacts({ postalCode: "99999", locality: "Nowhere" }) }));
  const authorized = applyDeliveryManualFee(notCovered, {
    eventId: "event-1", actorId: "actor-1", role: "supervisor", reason: "Fuera de zona",
    feeMinor: new Money(3_000, "MXN"), overriddenAt: "2026-09-26T18:05:00.000Z",
  });
  assert.deepEqual(deliveryQuoteEffectiveFeeMinor(authorized), new Money(3_000, "MXN"));
  assert.deepEqual(deliveryQuoteEffectiveFeeMinor(notCovered), new Money(0, "MXN"));

  const covered = quoteDelivery(baseInput());
  assert.deepEqual(deliveryQuoteEffectiveFeeMinor(covered), new Money(2_500, "MXN"));
});

