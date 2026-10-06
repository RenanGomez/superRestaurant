import {
  parseDeliveryQuoteRequestV1,
  parseDeliveryQuoteV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const baseRequest = {
  schemaVersion: 1,
  quoteId: "11111111-1111-4111-8111-111111111111",
  restaurantId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
  captureDraftId: "44444444-4444-4444-8444-444444444444",
  addressSnapshotRef: "55555555-5555-4555-8555-555555555555",
  address: { postalCode: "06000", locality: "Centro Historico" },
  currency: "MXN",
  timeZone: "America/Mexico_City",
  quotedAt: "2026-09-26T18:00:00.000Z",
  scheduledFor: null,
  version: 1,
} as const;

const parsedRequest = parseDeliveryQuoteRequestV1(baseRequest);
expect(parsedRequest !== undefined && Object.isFrozen(parsedRequest), "valid request parses frozen");

for (const invalid of [
  { ...baseRequest, extra: true },
  { ...baseRequest, schemaVersion: 2 },
  { ...baseRequest, quoteId: "not-a-uuid" },
  { ...baseRequest, currency: "mxn" },
  { ...baseRequest, currency: "MX" },
  { ...baseRequest, timeZone: "Nowhere/Imaginary" },
  { ...baseRequest, quotedAt: "2026-09-26" },
  { ...baseRequest, quotedAt: "2026-09-26T18:00:00.000000Z" },
  { ...baseRequest, version: 0 },
  { ...baseRequest, version: 1.5 },
  { ...baseRequest, address: { postalCode: "06000" } },
  { ...baseRequest, address: { postalCode: "", locality: "Centro" } },
  // Scheduled inside the 30-minute cutoff.
  { ...baseRequest, scheduledFor: "2026-09-26T18:10:00.000Z" },
  // Scheduled in the past.
  { ...baseRequest, scheduledFor: "2026-09-26T17:00:00.000Z" },
  // Scheduled beyond the 7-day horizon.
  { ...baseRequest, scheduledFor: "2026-10-05T18:00:00.000Z" },
]) expect(parseDeliveryQuoteRequestV1(invalid) === undefined, `request rejects invalid facts: ${JSON.stringify(invalid)}`);

const accessor = Object.defineProperty({ ...baseRequest }, "quoteId", {
  get: () => baseRequest.quoteId,
  enumerable: true,
});
expect(parseDeliveryQuoteRequestV1(accessor) === undefined, "accessor is not invoked");
expect(parseDeliveryQuoteRequestV1(Object.assign(Object.create({}), baseRequest)) === undefined, "prototype rejected");
expect(
  parseDeliveryQuoteRequestV1(new Proxy(baseRequest, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "hostile proxy fails closed",
);

const coveredQuote = {
  ...baseRequest,
  coverageStatus: "covered",
  zoneId: "66666666-6666-4666-8666-666666666666",
  feeMinor: 2_500,
  promiseStart: "2026-09-26T18:30:00.000Z",
  promiseEnd: "2026-09-26T18:45:00.000Z",
  expiresAt: "2026-09-26T18:15:00.000Z",
  override: null,
} as const;
const parsedCoveredQuote = parseDeliveryQuoteV1(coveredQuote);
expect(parsedCoveredQuote !== undefined, "a covered quote with a consistent 15-minute window parses");
expect(parsedCoveredQuote !== undefined && Object.isFrozen(parsedCoveredQuote), "quote is frozen");

const notCoveredQuote = {
  ...baseRequest,
  coverageStatus: "not_covered",
  zoneId: null,
  feeMinor: 0,
  promiseStart: "2026-09-26T18:30:00.000Z",
  promiseEnd: "2026-09-26T18:45:00.000Z",
  expiresAt: "2026-09-26T18:15:00.000Z",
  override: null,
} as const;
expect(parseDeliveryQuoteV1(notCoveredQuote) !== undefined, "a not_covered quote with a null zone and zero fee parses");

for (const invalid of [
  { ...coveredQuote, extra: true },
  // not_covered must carry a null zoneId and a zero fee.
  { ...notCoveredQuote, zoneId: coveredQuote.zoneId },
  { ...notCoveredQuote, feeMinor: 1 },
  // covered must carry a non-null zoneId.
  { ...coveredQuote, zoneId: null },
  // the promise window must be exactly 15 minutes.
  { ...coveredQuote, promiseEnd: "2026-09-26T18:50:00.000Z" },
  { ...coveredQuote, promiseEnd: "2026-09-26T18:40:00.000Z" },
  // ASAP expiresAt must equal quotedAt + 15 minutes (not promiseStart, not quotedAt).
  { ...coveredQuote, expiresAt: "2026-09-26T18:30:00.000Z" },
  { ...coveredQuote, expiresAt: "2026-09-26T18:00:00.000Z" },
  // promiseStart must equal quotedAt + 30 minutes for an ASAP (unscheduled) quote.
  { ...coveredQuote, promiseStart: "2026-09-26T19:00:00.000Z", promiseEnd: "2026-09-26T19:15:00.000Z" },
  { ...coveredQuote, feeMinor: -1 },
  { ...coveredQuote, feeMinor: 1.5 },
]) expect(parseDeliveryQuoteV1(invalid) === undefined, `quote rejects inconsistent facts: ${JSON.stringify(invalid)}`);

// A scheduled quote's promise window must start at the requested schedule, not at quotedAt.
const scheduledQuote = {
  ...coveredQuote,
  scheduledFor: "2026-09-27T12:00:00.000Z",
  promiseStart: "2026-09-27T12:00:00.000Z",
  promiseEnd: "2026-09-27T12:15:00.000Z",
  expiresAt: "2026-09-27T12:00:00.000Z",
} as const;
expect(parseDeliveryQuoteV1(scheduledQuote) !== undefined, "a scheduled quote's window starts at the requested schedule");
expect(
  parseDeliveryQuoteV1({ ...scheduledQuote, promiseStart: baseRequest.quotedAt, promiseEnd: "2026-09-26T18:15:00.000Z", expiresAt: baseRequest.quotedAt }) === undefined,
  "a scheduled quote cannot fall back to the quotedAt window",
);

const overriddenQuote = {
  ...coveredQuote,
  override: {
    actorId: "77777777-7777-4777-8777-777777777777",
    role: "manager",
    reason: "Rain surcharge waived for VIP customer",
    feeMinor: 0,
    promiseStart: "2026-09-26T18:10:00.000Z",
    promiseEnd: "2026-09-26T18:40:00.000Z",
    overriddenAt: "2026-09-26T18:05:00.000Z",
  },
} as const;
const parsedOverriddenQuote = parseDeliveryQuoteV1(overriddenQuote);
expect(parsedOverriddenQuote !== undefined, "an overridden quote with a manager role and reason parses");
expect(
  parsedOverriddenQuote !== undefined && Object.isFrozen(parsedOverriddenQuote.override),
  "override is frozen",
);
// The override never alters the original quoted fee/window facts.
expect(
  parsedOverriddenQuote !== undefined && parsedOverriddenQuote.feeMinor === coveredQuote.feeMinor
  && parsedOverriddenQuote.promiseStart === coveredQuote.promiseStart,
  "override leaves the original quoted facts untouched",
);

for (const invalidOverride of [
  { ...overriddenQuote.override, role: "supervisor" },
  { ...overriddenQuote.override, reason: "" },
  { ...overriddenQuote.override, reason: "   " },
  { ...overriddenQuote.override, promiseStart: overriddenQuote.override.promiseEnd, promiseEnd: overriddenQuote.override.promiseStart },
  { ...overriddenQuote.override, feeMinor: -1 },
  { ...overriddenQuote.override, extra: true },
]) expect(
  parseDeliveryQuoteV1({ ...coveredQuote, override: invalidOverride }) === undefined,
  `quote rejects an invalid override: ${JSON.stringify(invalidOverride)}`,
);

const quoteAccessor = Object.defineProperty({ ...coveredQuote }, "feeMinor", { get: () => 2_500, enumerable: true });
expect(parseDeliveryQuoteV1(quoteAccessor) === undefined, "quote accessor is not invoked");
expect(parseDeliveryQuoteV1(Object.assign(Object.create({}), coveredQuote)) === undefined, "quote prototype rejected");
expect(
  parseDeliveryQuoteV1(new Proxy(coveredQuote, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "quote hostile proxy fails closed",
);

// Idempotency: parsing the same valid input twice yields bit-exact frozen output.
const firstParse = parseDeliveryQuoteV1(coveredQuote);
const secondParse = parseDeliveryQuoteV1(coveredQuote);
expect(
  firstParse !== undefined && secondParse !== undefined && JSON.stringify(firstParse) === JSON.stringify(secondParse),
  "repeated parsing of the same valid input is idempotent",
);

// America/Chicago fall-back DST transition (2026-11-01: 01:59:59 CDT is
// immediately followed by 01:00:00 CST at 07:00Z). The parser re-derives the
// promise window purely from UTC instants (toMillis on the ISO strings), so
// it must accept a quote whose window straddles the transition, exactly as
// packages/domain/src/delivery-quote.test.ts asserts for the domain quote.
const dstAsapRequest = {
  ...baseRequest,
  timeZone: "America/Chicago",
  quotedAt: "2026-11-01T06:59:00.000Z", // 01:59:00 CDT
} as const;
expect(parseDeliveryQuoteRequestV1(dstAsapRequest) !== undefined, "a request quoted right before the DST fall-back parses");

const dstAsapQuote = {
  ...dstAsapRequest,
  coverageStatus: "covered",
  zoneId: coveredQuote.zoneId,
  feeMinor: coveredQuote.feeMinor,
  promiseStart: "2026-11-01T07:29:00.000Z",
  // 07:14:00Z (expiresAt) reads as 01:14:00 CST local, nominally "before" the 01:59 CDT
  // quotedAt on a naive wall-clock comparison — proof the window is
  // validated on the UTC instant, not local time.
  promiseEnd: "2026-11-01T07:44:00.000Z",
  expiresAt: "2026-11-01T07:14:00.000Z",
  override: null,
} as const;
expect(
  parseDeliveryQuoteV1(dstAsapQuote) !== undefined,
  "a quote whose 15-minute window straddles the America/Chicago fall-back parses",
);

// A scheduled quote whose window start is exactly 30 minutes (the cutoff)
// after quotedAt, also straddling the same transition.
const dstScheduledQuote = {
  ...dstAsapQuote,
  quotedAt: "2026-11-01T06:45:00.000Z", // 01:45:00 CDT
  scheduledFor: "2026-11-01T07:15:00.000Z", // 01:15:00 CST — 30 minutes later in UTC
  promiseStart: "2026-11-01T07:15:00.000Z",
  promiseEnd: "2026-11-01T07:30:00.000Z",
  expiresAt: "2026-11-01T07:15:00.000Z",
} as const;
expect(
  parseDeliveryQuoteV1(dstScheduledQuote) !== undefined,
  "a scheduled quote whose cutoff span straddles the America/Chicago fall-back parses",
);
