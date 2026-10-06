import {
  parseCaptureDraftDetailV2,
  parseCaptureDeliveryInstructionSuggestionsRequestV1,
  parseCaptureDeliveryInstructionSuggestionsV1,
  parseCaptureWorkspaceRequestV2,
  parseCaptureWorkspaceV2,
  parseConfirmCaptureDraftCommandV2,
  parseCustomerAddressFieldsV2,
  parseOrderFulfillmentSnapshotV1,
  parseOrderFulfillmentSnapshotV1OrV2,
  parseOrderFulfillmentSnapshotV2,
  parseSetCaptureDeliveryInstructionsCommandV1,
  parseSetCaptureDeliveryInstructionsResultV1,
} from "./index.js";

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const id = "abcdef01-2345-4678-9abc-0123456789ab";
const command = {
  attentionLeaseId: id,
  captureDraftId: id,
  deliveryInstructions: "Tocar dos veces; no dejar con vigilancia",
  deviceId: id,
  eventId: id,
  expectedVersion: 4,
  idempotencyKey: id,
  occurredAt: "2026-09-22T12:00:00.000Z",
  schemaVersion: 1,
  scope: { branchId: id, restaurantId: id },
};

const parsedCommand = parseSetCaptureDeliveryInstructionsCommandV1(command);
expect(parsedCommand !== undefined && Object.isFrozen(parsedCommand) && Object.isFrozen(parsedCommand.scope),
  "Capture instructions command parses detached and frozen");
expect(parseSetCaptureDeliveryInstructionsCommandV1({ ...command, deliveryInstructions: null }) !== undefined,
  "Capture instructions may be explicitly cleared");
expect(parseSetCaptureDeliveryInstructionsCommandV1({ ...command, deliveryInstructions: " x" }) === undefined,
  "instructions cannot be silently trimmed");
expect(parseSetCaptureDeliveryInstructionsCommandV1({ ...command, deliveryInstructions: "x".repeat(501) }) === undefined,
  "instructions are bounded");
expect(parseSetCaptureDeliveryInstructionsCommandV1({ ...command, expectedVersion: 0 }) === undefined,
  "Capture instructions use positive CAS versions");
expect(parseSetCaptureDeliveryInstructionsCommandV1({ ...command, addressId: id }) === undefined,
  "Capture instructions command cannot make Address authoritative");

let invoked = false;
const accessor = { ...command };
Object.defineProperty(accessor, "deliveryInstructions", {
  enumerable: true,
  get: () => {
    invoked = true;
    return "private";
  },
});
expect(parseSetCaptureDeliveryInstructionsCommandV1(accessor) === undefined && !invoked,
  "Capture instructions parser does not invoke accessors");

const detailV1 = {
  schemaVersion: 1,
  scope: command.scope,
  captureDraftId: id,
  folio: "CAP-0001",
  sourceChannel: "phone",
  fulfillmentChannel: "delivery",
  status: "draft",
  attentionStatus: "claimed",
  ownerMembershipId: id,
  version: 5,
  updatedAt: command.occurredAt,
  attentionLeaseId: id,
  attentionLeaseExpiresAt: "2026-09-22T12:05:00.000Z",
  confirmedOrderId: null,
  customerSnapshotRef: id,
  fulfillmentSnapshotRef: id,
};
expect(parseSetCaptureDeliveryInstructionsResultV1({
  schemaVersion: 1,
  replayed: true,
  detail: detailV1,
  deliveryInstructions: command.deliveryInstructions,
})?.replayed === true, "specific result keeps the existing V1 journal detail and the D4 value beside it");

const suggestionRequest = { schemaVersion: 1, scope: command.scope, captureDraftId: id };
expect(parseCaptureDeliveryInstructionSuggestionsRequestV1(suggestionRequest) !== undefined,
  "instruction history is requested through a Capture, never a caller supplied Customer id");
expect(parseCaptureDeliveryInstructionSuggestionsRequestV1({ ...suggestionRequest, customerId: id }) === undefined,
  "instruction history rejects a parallel Customer selector");
const suggestions = parseCaptureDeliveryInstructionSuggestionsV1({
  schemaVersion: 1,
  captureDraftId: id,
  items: [
    { deliveryInstructions: "Portón lateral", lastUsedAt: "2026-09-22T12:00:00.000Z", usageCount: 2 },
    { deliveryInstructions: "Tocar dos veces", lastUsedAt: "2026-09-21T12:00:00.000Z", usageCount: 1 },
  ],
});
expect(suggestions !== undefined && Object.isFrozen(suggestions.items) && Object.isFrozen(suggestions.items[0]),
  "at most five ordered, detached suggestions cross the trust boundary");
expect(parseCaptureDeliveryInstructionSuggestionsV1({
  schemaVersion: 1, captureDraftId: id,
  items: Array.from({ length: 6 }, (_, index) => ({
    deliveryInstructions: `Indicacion ${index}`, lastUsedAt: "2026-09-22T12:00:00.000Z", usageCount: 1,
  })),
}) === undefined, "suggestion history is capped at five");
expect(parseCaptureDeliveryInstructionSuggestionsV1({
  schemaVersion: 1, captureDraftId: id,
  items: [
    { deliveryInstructions: "Repetida", lastUsedAt: "2026-09-22T12:00:00.000Z", usageCount: 1 },
    { deliveryInstructions: "Repetida", lastUsedAt: "2026-09-21T12:00:00.000Z", usageCount: 1 },
  ],
}) === undefined, "suggestions reject duplicate instruction values");

const detailV2 = { ...detailV1, schemaVersion: 2, deliveryInstructions: command.deliveryInstructions };
expect(parseCaptureDraftDetailV2(detailV2)?.deliveryInstructions === command.deliveryInstructions,
  "Detail V2 exposes the current Capture-owned value");
expect(parseCaptureDraftDetailV2({ ...detailV2, instructions: "legacy" }) === undefined,
  "Detail V2 rejects the ambiguous instructions name");
expect(parseCaptureWorkspaceRequestV2({ schemaVersion: 2, scope: command.scope, captureDraftId: id }) !== undefined,
  "Workspace V2 request is explicit and scope-bound");

const partySnapshot = {
  schemaVersion: 1,
  snapshotRef: id,
  customerId: id,
  contactId: id,
  displayName: "Cliente histórico",
  phoneDisplayValue: "+52 555 000 0000",
  phoneNormalizedValue: "+525550000000",
};
const fulfillmentSnapshot = {
  schemaVersion: 1,
  snapshotRef: id,
  customerSnapshotRef: id,
  customerId: id,
  addressId: id,
  label: "Casa",
  streetLine: "Acacia 84",
  unit: null,
  neighborhood: "Centro",
  locality: "Hermosillo",
  region: "Sonora",
  countryCode: "MX",
  postalCode: "83000",
  referencesText: "Portón azul",
  legacyAddressInstructions: "Dato importado; no autoaplicar",
  latitudeE6: null,
  longitudeE6: null,
  validatedAt: command.occurredAt,
};
const workspaceV2 = parseCaptureWorkspaceV2({
  schemaVersion: 2,
  detail: detailV2,
  customerSnapshot: partySnapshot,
  fulfillmentSnapshot,
});
expect(workspaceV2 !== undefined && Object.isFrozen(workspaceV2.detail),
  "Workspace V2 links Capture detail with its immutable party and fulfillment snapshots");

const orderSnapshot = {
  schemaVersion: 1,
  orderId: id,
  captureDraftId: id,
  captureVersion: 5,
  fulfillmentChannel: "delivery",
  tableId: null,
  partySnapshot,
  fulfillmentSnapshot,
  deliveryInstructions: command.deliveryInstructions,
  frozenAt: "2026-09-22T12:01:00.000Z",
};
const parsedOrderSnapshot = parseOrderFulfillmentSnapshotV1(orderSnapshot);
expect(parsedOrderSnapshot !== undefined && Object.isFrozen(parsedOrderSnapshot),
  "Order receives immutable party, fulfillment and Capture instructions snapshots");
expect(parseOrderFulfillmentSnapshotV1({ ...orderSnapshot, addressId: id }) === undefined,
  "Order snapshot never accepts mutable Address as a parallel instruction source");
expect(parseOrderFulfillmentSnapshotV1({ ...orderSnapshot, captureVersion: 0 }) === undefined,
  "Order snapshot identifies an exact positive Capture version");
expect(parseOrderFulfillmentSnapshotV1({ ...orderSnapshot, fulfillmentChannel: "pickup" }) === undefined,
  "non-delivery Order cannot inherit delivery instructions or an Address snapshot");

const deliveryQuoteSnapshot = {
  schemaVersion: 1, quoteId: id, restaurantId: id, branchId: id, captureDraftId: id,
  addressSnapshotRef: id, address: { postalCode: "83000", locality: "Hermosillo" },
  currency: "MXN", timeZone: "America/Hermosillo", quotedAt: "2026-09-22T12:00:00.000Z",
  scheduledFor: null, version: 1, coverageStatus: "covered", zoneId: id, feeMinor: 3_000,
  promiseStart: "2026-09-22T12:30:00.000Z", promiseEnd: "2026-09-22T12:45:00.000Z",
  expiresAt: "2026-09-22T12:15:00.000Z", override: null,
};
const paymentIntentSnapshot = { schemaVersion: 1, method: "cash", tenderedAmountMinor: 20_000, tipMinor: 0 };
const orderSnapshotV2 = {
  ...orderSnapshot, schemaVersion: 2, deliveryQuote: deliveryQuoteSnapshot, paymentIntent: paymentIntentSnapshot,
};
const parsedOrderSnapshotV2 = parseOrderFulfillmentSnapshotV2(orderSnapshotV2);
expect(parsedOrderSnapshotV2 !== undefined && Object.isFrozen(parsedOrderSnapshotV2)
  && parsedOrderSnapshotV2.deliveryQuote?.feeMinor === 3_000 && parsedOrderSnapshotV2.paymentIntent?.method === "cash",
  "Order snapshot V2 additively carries the frozen delivery quote and payment intent");
expect(parseOrderFulfillmentSnapshotV2({ ...orderSnapshotV2, deliveryQuote: null, paymentIntent: null }) !== undefined,
  "Order snapshot V2 allows both new facts to be absent (no quote/no intent)");
expect(parseOrderFulfillmentSnapshotV2({
  ...orderSnapshotV2, fulfillmentChannel: "counter", tableId: null, fulfillmentSnapshot: null,
}) === undefined, "non-delivery Order snapshot V2 cannot carry a frozen delivery quote");
expect(parseOrderFulfillmentSnapshotV2(orderSnapshot) === undefined,
  "a bare V1 payload (missing deliveryQuote/paymentIntent) is not a valid V2 snapshot");
expect(parseOrderFulfillmentSnapshotV1(orderSnapshotV2) === undefined,
  "a V2 payload (extra keys) is not a valid V1 snapshot");
expect(parseOrderFulfillmentSnapshotV1OrV2(orderSnapshot)?.schemaVersion === 1,
  "the combined parser accepts a historical V1 snapshot");
expect(parseOrderFulfillmentSnapshotV1OrV2(orderSnapshotV2)?.schemaVersion === 2,
  "the combined parser accepts the additive V2 snapshot");

const confirmV2 = {
  attentionLeaseId: id,
  captureDraftId: id,
  deviceId: id,
  eventId: id,
  expectedVersion: 5,
  idempotencyKey: id,
  occurredAt: command.occurredAt,
  scope: command.scope,
  schemaVersion: 2,
  orderId: id,
  shiftId: id,
  tableId: null,
  currency: "MXN",
  timeZone: "America/Hermosillo",
};
expect(parseConfirmCaptureDraftCommandV2(confirmV2) !== undefined,
  "confirmation V2 carries Order facts while channel remains server-derived");
expect(parseConfirmCaptureDraftCommandV2({ ...confirmV2, channel: "delivery" }) === undefined,
  "confirmation V2 rejects client-derived channel");
expect(parseConfirmCaptureDraftCommandV2({ ...confirmV2, tableId: "bad" }) === undefined,
  "confirmation V2 validates nullable table identity");
expect(parseConfirmCaptureDraftCommandV2({ ...confirmV2, currency: "mxn" }) === undefined,
  "confirmation V2 requires ISO uppercase currency");

const addressV2 = {
  label: "Casa",
  streetLine: "Acacia 84",
  unit: null,
  neighborhood: "Centro",
  locality: "Hermosillo",
  region: "Sonora",
  countryCode: "MX",
  postalCode: "83000",
  references: "Portón azul",
  legacyAddressInstructions: "Dato importado; no autoaplicar",
  coordinates: null,
};
const parsedAddress = parseCustomerAddressFieldsV2(addressV2);
expect(parsedAddress !== undefined && parsedAddress.legacyAddressInstructions === addressV2.legacyAddressInstructions,
  "Address V2 exposes inherited text only as legacy history");
expect(parseCustomerAddressFieldsV2({ ...addressV2, instructions: "active" }) === undefined,
  "Address V2 rejects the active instructions field");
