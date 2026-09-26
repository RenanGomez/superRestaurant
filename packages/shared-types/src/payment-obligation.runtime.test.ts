import {
  parsePaymentObligationProjectionV1,
  parseProjectPaymentObligationRequestV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const request = {
  ambiguousAmountMinor: 0,
  capturedAmountMinor: 2_500,
  currency: "MXN",
  orderTotalMinor: 12_500,
  pendingAmountMinor: 0,
  schemaVersion: 1,
} as const;

const parsedRequest = parseProjectPaymentObligationRequestV1(request);
expect(parsedRequest !== undefined && Object.isFrozen(parsedRequest), "request parses frozen");
for (const invalid of [
  { ...request, capturedAmountMinor: 12_501 },
  { ...request, ambiguousAmountMinor: -1 },
  { ...request, currency: "mxn" },
  { ...request, pendingAmountMinor: Number.MAX_SAFE_INTEGER, ambiguousAmountMinor: 1 },
  { ...request, extra: true },
]) expect(parseProjectPaymentObligationRequestV1(invalid) === undefined, "request rejects invalid financial facts");

const projection = {
  ...request,
  collectibleAmountMinor: 10_000,
  overexposureAmountMinor: 0,
  paymentStatus: "partially_paid",
  remainingBalanceMinor: 10_000,
  unresolvedExposureMinor: 0,
} as const;
expect(parsePaymentObligationProjectionV1(projection) !== undefined, "consistent projection parses");

const pendingProjection = {
  ...request,
  collectibleAmountMinor: null,
  overexposureAmountMinor: 0,
  paymentStatus: "pending",
  pendingAmountMinor: 4_000,
  remainingBalanceMinor: 10_000,
  unresolvedExposureMinor: 4_000,
} as const;
expect(parsePaymentObligationProjectionV1(pendingProjection) !== undefined, "pending exposure blocks collection");

for (const invalid of [
  { ...projection, collectibleAmountMinor: null },
  { ...projection, paymentStatus: "paid" },
  { ...projection, remainingBalanceMinor: 9_999 },
  { ...pendingProjection, unresolvedExposureMinor: 3_999 },
  { ...pendingProjection, extra: true },
]) expect(parsePaymentObligationProjectionV1(invalid) === undefined, "projection rejects inconsistent facts");

const accessor = Object.defineProperty({ ...request }, "currency", { get: () => "MXN", enumerable: true });
expect(parseProjectPaymentObligationRequestV1(accessor) === undefined, "accessor is not invoked");
expect(parseProjectPaymentObligationRequestV1(Object.assign(Object.create({}), request)) === undefined, "prototype rejected");
expect(parseProjectPaymentObligationRequestV1(new Proxy(request, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "hostile proxy fails closed");
