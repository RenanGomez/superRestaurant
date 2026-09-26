import {
  parsePaymentIntentQuoteV1,
  parseQuotePaymentIntentRequestV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const request = {
  capturedAmountMinor: 2_500,
  currency: "MXN",
  method: "cash",
  orderTotalMinor: 12_500,
  plannedAmountMinor: 10_000,
  schemaVersion: 1,
  tenderedAmountMinor: 20_000,
  timing: "on_fulfillment",
} as const;

const parsedRequest = parseQuotePaymentIntentRequestV1(request);
expect(parsedRequest !== undefined && Object.isFrozen(parsedRequest), "request parses frozen");
expect(parseQuotePaymentIntentRequestV1({ ...request, method: "transfer", tenderedAmountMinor: 20_000 }) === undefined,
  "non-cash request rejects tendered amount");
expect(parseQuotePaymentIntentRequestV1({ ...request, currency: "mxn" }) === undefined, "currency is strict ISO uppercase");
expect(parseQuotePaymentIntentRequestV1({ ...request, plannedAmountMinor: 10_001 }) === undefined, "plan cannot exceed balance");
expect(parseQuotePaymentIntentRequestV1({ ...request, tenderedAmountMinor: 9_999 }) === undefined, "cash tender covers plan");

const quote = {
  ...request,
  changeDueMinor: 10_000,
  remainingAfterPlanMinor: 0,
  remainingBeforePlanMinor: 10_000,
};
expect(parsePaymentIntentQuoteV1(quote) !== undefined, "consistent quote parses");
for (const invalid of [
  { ...quote, changeDueMinor: 9_999 },
  { ...quote, remainingBeforePlanMinor: 9_999 },
  { ...quote, remainingAfterPlanMinor: 1 },
  { ...quote, extra: true },
  { ...quote, plannedAmountMinor: Number.MAX_SAFE_INTEGER },
]) expect(parsePaymentIntentQuoteV1(invalid) === undefined, "quote rejects inconsistent or unsafe facts");

const accessor = Object.defineProperty({ ...request }, "method", { get: () => "cash", enumerable: true });
expect(parseQuotePaymentIntentRequestV1(accessor) === undefined, "accessor is not invoked");
expect(parseQuotePaymentIntentRequestV1(Object.assign(Object.create({}), request)) === undefined, "prototype rejected");
expect(parseQuotePaymentIntentRequestV1(new Proxy(request, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "hostile proxy fails closed");
