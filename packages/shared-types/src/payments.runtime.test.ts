import {
  parseCashRegisterSummaryV1,
  parseCashRegisterOperationalReportV1,
  parseCashRegisterReportQueryV1,
  parseCloseCashRegisterCommandV1,
  parseCollectPaymentCommandV1,
  parseCheckoutOrderQueryV1,
  parseCheckoutOrderSummaryV1,
  parseOpenCashRegisterCommandV1,
  parsePaymentCollectionSummaryV1,
} from "./payments.js";

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const scope = Object.freeze({
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
});
const audit = Object.freeze({
  deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
  eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  idempotencyKey: "financial-test-1",
  occurredAt: "2026-09-03T20:00:00.000Z",
});
const cashRegisterSessionId = "99d1c697-3cc6-4dd8-a7e3-caf06d061212";
const registerId = "b995b036-09cc-446c-a557-44ab369e1931";
const shiftId = "39c3ad75-84de-40d7-b3a5-d42aca764453";
const orderId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";
const paymentId = "4353c301-dbeb-4e83-9730-87cb72cb97f7";

const open = {
  ...audit, cashRegisterSessionId, currency: "MXN", openingFloatMinor: 50_000,
  registerId, schemaVersion: 1, scope, shiftId,
};
const opened = parseOpenCashRegisterCommandV1(open);
expect(opened !== undefined && Object.isFrozen(opened), "open command parses and freezes");

const cash = parseCollectPaymentCommandV1({
  ...audit, amountMinor: 12_500, cardManualEvidence: null, cashRegisterExpectedVersion: 1,
  cashRegisterSessionId, localSequence: 7, method: "cash", orderExpectedVersion: 4,
  orderId, paymentId, schemaVersion: 1, scope,
});
expect(cash !== undefined && cash.cardManualEvidence === null, "cash command parses without card evidence");

const closed = parseCloseCashRegisterCommandV1({
  ...audit, cashRegisterExpectedVersion: 2, cashRegisterSessionId,
  countedClosingBalanceMinor: 62_500, reason: null, schemaVersion: 1, scope,
});
expect(closed !== undefined, "close command parses");

const cardCommand = {
  ...audit, amountMinor: 12_500, cashRegisterExpectedVersion: 1, cashRegisterSessionId,
  localSequence: 7, method: "card_manual", orderExpectedVersion: 4, orderId, paymentId,
  schemaVersion: 1, scope,
  cardManualEvidence: {
    externalConfirmed: true, provider: "Proveedor configurado", terminalId: "terminal-front-1", reference: "AUTH-123",
  },
};
const card = parseCollectPaymentCommandV1(cardCommand);
expect(card !== undefined && Object.isFrozen(card.cardManualEvidence), "manual card evidence parses and freezes");
expect(parseCollectPaymentCommandV1({ ...cardCommand, cardManualEvidence: null }) === undefined, "manual card requires evidence");
expect(parseCollectPaymentCommandV1({ ...cardCommand, method: "cash" }) === undefined, "cash rejects card evidence");
expect(parseCollectPaymentCommandV1({
  ...cardCommand,
  cardManualEvidence: { ...cardCommand.cardManualEvidence, pan: "4111111111111111" },
}) === undefined, "card evidence rejects PAN");
expect(parseCollectPaymentCommandV1({ ...cardCommand, cvv: "123" }) === undefined, "command rejects CVV");
expect(parseCollectPaymentCommandV1({ ...cardCommand, method: "card_terminal" }) === undefined, "integrated card is out of scope");

expect(parseOpenCashRegisterCommandV1({ ...open, openingFloatMinor: 1.5 }) === undefined, "fractional money fails");
expect(parseOpenCashRegisterCommandV1({ ...open, currency: "mxn" }) === undefined, "lowercase currency fails");
expect(parseOpenCashRegisterCommandV1({ ...open, scope: { ...scope, branchId: "bad" } }) === undefined, "malformed scope fails");
const hostile = { ...open };
Object.defineProperty(hostile, "currency", { enumerable: true, get: () => "MXN" });
expect(parseOpenCashRegisterCommandV1(hostile) === undefined, "accessor fails closed");

const register = {
  cashRegisterSessionId, cashierId: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  closedAt: null, countedClosingBalanceMinor: null, currency: "MXN", differenceMinor: null,
  expectedCashBalanceMinor: 50_000, openedAt: audit.occurredAt, openingFloatMinor: 50_000,
  registerId, replayed: false, schemaVersion: 1, scope, shiftId, status: "open", version: 1,
};
expect(parseCashRegisterSummaryV1(register) !== undefined, "open summary parses");
expect(parseCashRegisterSummaryV1({ ...register, status: "closed" }) === undefined, "closed summary requires closure fields");

const payment = {
  amountMinor: 12_500, cashRegisterSessionId, cashRegisterVersion: 2, currency: "MXN",
  method: "cash", orderId, orderStatus: "paid", orderVersion: 5, paymentId,
  paymentState: "captured", remainingBalanceMinor: 1, replayed: false, schemaVersion: 1, scope,
};
expect(parsePaymentCollectionSummaryV1(payment) === undefined, "paid summary rejects remaining balance");
expect(parsePaymentCollectionSummaryV1({ ...payment, remainingBalanceMinor: 0 }) !== undefined, "paid summary parses at zero balance");

const reportQuery = { cashRegisterSessionId, deviceId: audit.deviceId, registerId, schemaVersion: 1, scope };
expect(parseCashRegisterReportQueryV1(reportQuery) !== undefined, "cash-register report query parses");
expect(parseCashRegisterReportQueryV1({ ...reportQuery, extra: true }) === undefined, "cash-register report query rejects extras");
const operationalReport = {
  cardManualCapturedMinor: 2_500, cashCapturedMinor: 10_000, nextLocalSequence: 8, paymentCount: 2,
  register, schemaVersion: 1, scope, totalCapturedMinor: 12_500,
};
expect(parseCashRegisterOperationalReportV1(operationalReport) !== undefined, "operational cash-register report parses");
expect(parseCashRegisterOperationalReportV1({ ...operationalReport, totalCapturedMinor: 12_499 }) === undefined, "tender totals must balance");

const checkoutQuery = { cashRegisterSessionId, deviceId: audit.deviceId, orderId, registerId, schemaVersion: 1, scope };
expect(parseCheckoutOrderQueryV1(checkoutQuery) !== undefined, "checkout query parses");
const checkout = {
  capturedAmountMinor: 2_500, cashRegisterSessionId, cashRegisterVersion: 2, currency: "MXN",
  nextLocalSequence: 8, orderId, orderStatus: "partially_paid", orderTotalMinor: 12_500,
  orderVersion: 4, remainingBalanceMinor: 10_000, schemaVersion: 1, scope,
};
expect(parseCheckoutOrderSummaryV1(checkout) !== undefined, "checkout summary parses");
expect(parseCheckoutOrderSummaryV1({ ...checkout, remainingBalanceMinor: 9_999 }) === undefined, "checkout balance must reconcile");
expect(parseCheckoutOrderSummaryV1({ ...checkout, orderStatus: "open" }) === undefined, "open order cannot report prior captures");
