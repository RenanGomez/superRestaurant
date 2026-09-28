import {
  parseCapturePaymentBasisV1,
  parseCapturePaymentIntentProjectionV1,
  parseCapturePaymentIntentV1,
  parseCaptureWorkspaceV5,
  parseRequestCaptureDeliveryQuoteCommandV1,
  parseSetCapturePaymentIntentCommandV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const intent = {
  method: "cash",
  schemaVersion: 1,
  tenderedAmountMinor: 20_000,
  tipMinor: 1_500,
} as const;

const parsedIntent = parseCapturePaymentIntentV1(intent);
expect(parsedIntent !== undefined && Object.isFrozen(parsedIntent), "intent parses frozen");
expect(parseCapturePaymentIntentV1({ ...intent, method: "transfer", tenderedAmountMinor: 20_000 }) === undefined,
  "non-cash intent rejects a tendered amount");
expect(parseCapturePaymentIntentV1({ ...intent, tenderedAmountMinor: null }) !== undefined,
  "cash intent may omit the tendered amount");
expect(parseCapturePaymentIntentV1({ ...intent, tipMinor: -1 }) === undefined, "tip cannot be negative");
expect(parseCapturePaymentIntentV1({ ...intent, extra: true }) === undefined, "intent rejects unknown keys");

const command = {
  attentionLeaseId: "11111111-1111-4111-8111-111111111111",
  captureDraftId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
  eventId: "44444444-4444-4444-8444-444444444444",
  expectedVersion: 2,
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  method: "cash",
  occurredAt: "2026-09-27T12:00:00.000Z",
  schemaVersion: 1,
  scope: {
    branchId: "66666666-6666-4666-8666-666666666666",
    restaurantId: "77777777-7777-4777-8777-777777777777",
  },
  tenderedAmountMinor: 20_000,
  tipMinor: 1_500,
} as const;

const parsedCommand = parseSetCapturePaymentIntentCommandV1(command);
expect(parsedCommand !== undefined && Object.isFrozen(parsedCommand), "command parses frozen");
expect(parseSetCapturePaymentIntentCommandV1({ ...command, method: "card_manual", tenderedAmountMinor: 1 }) === undefined,
  "command rejects a tendered amount for a non-cash method");
expect(parseSetCapturePaymentIntentCommandV1({ ...command, expectedVersion: 0 }) === undefined,
  "command requires a positive expected version");

const projection = {
  changeDueMinor: 10_000,
  currency: "MXN",
  deliveryFeeMinor: 3_000,
  itemsSubtotalMinor: 7_000,
  method: "cash",
  orderTotalMinor: 10_000,
  status: "ready",
  tenderedAmountMinor: 20_000,
  timing: "on_fulfillment",
  tipMinor: 1_500,
} as const;

expect(parseCapturePaymentIntentProjectionV1(projection) !== undefined, "consistent projection parses");
for (const invalid of [
  { ...projection, orderTotalMinor: 10_001 },
  { ...projection, changeDueMinor: 9_999 },
  { ...projection, status: "insufficient" },
  { ...projection, method: "transfer", tenderedAmountMinor: 20_000 },
  { ...projection, extra: true },
]) expect(parseCapturePaymentIntentProjectionV1(invalid) === undefined, "projection rejects inconsistent facts");

const insufficientProjection = {
  ...projection,
  changeDueMinor: null,
  status: "insufficient" as const,
  tenderedAmountMinor: 1_000,
};
expect(parseCapturePaymentIntentProjectionV1(insufficientProjection) !== undefined,
  "insufficient tender parses with no invented change");

const detail = {
  attentionLeaseExpiresAt: "2026-09-27T18:31:00.000Z",
  attentionLeaseId: command.attentionLeaseId,
  attentionStatus: "claimed",
  captureDraftId: command.captureDraftId,
  confirmedOrderId: null,
  customerSnapshotRef: null,
  deliveryInstructions: null,
  folio: "CAP-000042",
  fulfillmentChannel: "counter",
  fulfillmentSnapshotRef: null,
  ownerMembershipId: command.scope.branchId,
  schemaVersion: 2,
  scope: command.scope,
  sourceChannel: "phone",
  status: "draft",
  updatedAt: "2026-09-27T12:00:00.000Z",
  version: 2,
} as const;

const paymentBasis = {
  currency: "MXN",
  deliveryFeeMinor: 3_000,
  itemsSubtotalMinor: 7_000,
  orderTotalMinor: 10_000,
} as const;

expect(parseCapturePaymentBasisV1(paymentBasis) !== undefined, "H25: consistent payment basis parses");
expect(Object.isFrozen(parseCapturePaymentBasisV1(paymentBasis)), "H25: payment basis parses frozen");
for (const invalid of [
  { ...paymentBasis, orderTotalMinor: 10_001 },
  { ...paymentBasis, itemsSubtotalMinor: -1 },
  { ...paymentBasis, currency: "mxn" },
  { ...paymentBasis, extra: true },
]) expect(parseCapturePaymentBasisV1(invalid) === undefined, "H25: payment basis rejects inconsistent or malformed facts");

const workspaceBase = {
  customerSnapshot: null,
  deliveryQuote: null,
  detail,
  fulfillmentSnapshot: null,
  paymentBasis: null,
  repeatOrderPlan: null,
  selectionPlan: null,
  selectionProjection: null,
} as const;

const workspace = {
  ...workspaceBase,
  paymentIntent: intent,
  paymentProjection: projection,
  schemaVersion: 5,
} as const;

expect(parseCaptureWorkspaceV5({ ...workspace, paymentBasis }) !== undefined,
  "H25: workspace V5 parses with a payment basis alongside the intent/projection");
expect(parseCaptureWorkspaceV5({ ...workspaceBase, paymentIntent: null, paymentProjection: null, paymentBasis, schemaVersion: 5 }) !== undefined,
  "H25: workspace V5 parses with a payment basis and no intent at all");
expect(parseCaptureWorkspaceV5({ ...workspace, paymentBasis: { ...paymentBasis, orderTotalMinor: 1 } }) === undefined,
  "H25: workspace V5 rejects an internally inconsistent payment basis");

expect(parseCaptureWorkspaceV5(workspace) !== undefined, "workspace V5 parses with a consistent intent and projection");
expect(parseCaptureWorkspaceV5({ ...workspaceBase, paymentIntent: null, paymentProjection: null, schemaVersion: 5 }) !== undefined,
  "workspace V5 parses with no payment intent at all");
expect(parseCaptureWorkspaceV5({ ...workspaceBase, paymentIntent: null, paymentProjection: projection, schemaVersion: 5 }) === undefined,
  "workspace V5 rejects a projection without its intent");
expect(parseCaptureWorkspaceV5({
  ...workspaceBase,
  paymentIntent: intent,
  paymentProjection: { ...projection, method: "transfer", tenderedAmountMinor: null },
  schemaVersion: 5,
}) === undefined, "workspace V5 rejects a projection whose method diverges from the intent");
expect(parseCaptureWorkspaceV5({ ...workspace, schemaVersion: 4 }) === undefined, "workspace V5 requires its own schema version");

const deliveryQuoteCommand = {
  attentionLeaseId: command.attentionLeaseId,
  captureDraftId: command.captureDraftId,
  deviceId: command.deviceId,
  eventId: command.eventId,
  expectedVersion: command.expectedVersion,
  idempotencyKey: command.idempotencyKey,
  occurredAt: command.occurredAt,
  schemaVersion: 1,
  scheduledFor: null,
  scope: command.scope,
} as const;
const parsedDeliveryQuoteCommand = parseRequestCaptureDeliveryQuoteCommandV1(deliveryQuoteCommand);
expect(parsedDeliveryQuoteCommand !== undefined && Object.isFrozen(parsedDeliveryQuoteCommand),
  "delivery quote command parses frozen with no scheduledFor");
expect(parseRequestCaptureDeliveryQuoteCommandV1({ ...deliveryQuoteCommand, scheduledFor: "2026-09-28T12:00:00.000Z" }) !== undefined,
  "delivery quote command accepts an explicit scheduledFor");
expect(parseRequestCaptureDeliveryQuoteCommandV1({ ...deliveryQuoteCommand, scheduledFor: "not-a-date" }) === undefined,
  "delivery quote command rejects a malformed scheduledFor");
expect(parseRequestCaptureDeliveryQuoteCommandV1({ ...deliveryQuoteCommand, extra: true }) === undefined,
  "delivery quote command rejects unknown keys");
