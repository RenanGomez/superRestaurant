import {
  parseAutosaveCaptureDraftCommandV1,
  parseCaptureDraftDetailV1,
  parseCaptureDraftSummaryV1,
  parseCaptureWorkTrayRequestV1,
  parseCaptureWorkTrayResultV1,
  parseCaptureWorkspaceRequestV1,
  parseCaptureWorkspaceV1,
  parseCaptureMutationResultV1,
  parseClaimCaptureDraftCommandV1,
  parseCloseCaptureNoSaleCommandV1,
  parseConfirmCaptureDraftCommandV1,
  parseCreateCaptureDraftCommandV1,
  parseHoldCaptureDraftCommandV1,
  parseSetCaptureRecoveryPreferenceCommandV1,
  parseSetCaptureCustomerCommandV1,
  parseSetCaptureFulfillmentCommandV1,
  parseCaptureRecoveryPolicyV1,
  parseCaptureRecoveryPreferenceResultV1,
  parseResumeCaptureDraftCommandV1,
  parseTransferCaptureDraftCommandV1,
} from "./index.js";

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const scope = {
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
};
const common = {
  schemaVersion: 1,
  scope,
  captureDraftId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  idempotencyKey: "9544c299-d25b-44ce-98ed-d30116610887",
  deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
  occurredAt: "2026-09-15T18:00:00.000Z",
};
const expectedVersion = 3;
const attentionLeaseId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const targetMembershipId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const customerSnapshotRef = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const fulfillmentSnapshotRef = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const orderId = "7c3e9a20-5d61-4f84-a237-1b6d8e4c9052";

const create = { ...common, expectedVersion: 0, sourceChannel: "phone", fulfillmentChannel: null };
const parsedCreate = parseCreateCaptureDraftCommandV1(create);
expect(parsedCreate !== undefined && Object.isFrozen(parsedCreate) && Object.isFrozen(parsedCreate.scope), "create parses frozen");
expect(parseCreateCaptureDraftCommandV1({ ...create, expectedVersion: 1 }) === undefined, "create requires expectedVersion zero");
expect(parseCreateCaptureDraftCommandV1({ ...create, sourceChannel: "delivery" }) === undefined, "source and fulfillment remain distinct");
expect(parseCreateCaptureDraftCommandV1({ ...create, actorId: targetMembershipId }) === undefined, "client actor identity is forbidden");

const versioned = { ...common, expectedVersion };
const customerSelection = { ...versioned, attentionLeaseId, customerId: customerSnapshotRef,
  contactId: fulfillmentSnapshotRef, expectedCustomerVersion: 1 };
expect(Object.isFrozen(parseSetCaptureCustomerCommandV1(customerSelection)), "customer selection parses frozen");
const fulfillmentSelection = { ...versioned, attentionLeaseId, customerSnapshotRef: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  addressId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", expectedAddressVersion: 1 };
expect(Object.isFrozen(parseSetCaptureFulfillmentCommandV1(fulfillmentSelection)), "fulfillment selection parses frozen");
expect(parseSetCaptureFulfillmentCommandV1({ ...fulfillmentSelection, addressId: null, expectedAddressVersion: null }) !== undefined,
  "fulfillment removal parses");
expect(parseSetCaptureFulfillmentCommandV1({ ...fulfillmentSelection, addressId: null }) === undefined,
  "fulfillment selection rejects partial address");
expect(parseSetCaptureCustomerCommandV1({ ...customerSelection, customerId: null, contactId: null,
  expectedCustomerVersion: null }) !== undefined, "explicit removal parses");
for (const invalid of [{ ...customerSelection, customerId: null }, { ...customerSelection, contactId: null },
  { ...customerSelection, expectedCustomerVersion: null }, { ...customerSelection, expectedCustomerVersion: 0 },
  { ...customerSelection, expectedCustomerVersion: 1.5 }, { ...customerSelection, customerSnapshotRef },
  { ...customerSelection, displayName: "Client-controlled snapshot" }, { ...customerSelection, attentionLeaseId: null }]) {
  expect(parseSetCaptureCustomerCommandV1(invalid) === undefined, "customer selection rejects partial identity or client facts");
}
const preference = { ...versioned, attentionLeaseId, autoRenewSelected: true };
expect(parseSetCaptureRecoveryPreferenceCommandV1(preference)?.autoRenewSelected === true, "explicit opt-in parses");
expect(parseSetCaptureRecoveryPreferenceCommandV1({ ...preference, autoRenewSelected: false })?.autoRenewSelected === false, "explicit opt-out parses");
expect(parseSetCaptureRecoveryPreferenceCommandV1({ ...preference, autoRenewSelected: "true" }) === undefined, "preference is a strict boolean");
expect(parseSetCaptureRecoveryPreferenceCommandV1({ ...preference, recoveryExpiresAt: common.occurredAt }) === undefined, "client cannot dictate expiry");
expect(parseSetCaptureRecoveryPreferenceCommandV1({ ...preference, expectedVersion: 0 }) === undefined, "preference requires persisted version");
const policy = { schemaVersion: 1, autoRenewSelected: true, recoveryExpiresAt: "2026-10-15T18:00:00.000Z" };
expect(Object.isFrozen(parseCaptureRecoveryPolicyV1(policy)), "recovery policy is immutable");
expect(parseCaptureRecoveryPolicyV1({ ...policy, recoveryExpiresAt: "2026-02-30T18:00:00.000Z" }) === undefined, "invalid recovery deadline rejected");
const hostilePreference = { ...preference };
Object.defineProperty(hostilePreference, "autoRenewSelected", { enumerable: true, get: () => { throw new Error("must not execute"); } });
expect(parseSetCaptureRecoveryPreferenceCommandV1(hostilePreference) === undefined, "preference getter fails closed");
const autosave = {
  ...versioned,
  attentionLeaseId,
  sourceChannel: "whatsapp_manual",
  fulfillmentChannel: "pickup",
  customerSnapshotRef,
  fulfillmentSnapshotRef: null,
};
const parsedAutosave = parseAutosaveCaptureDraftCommandV1(autosave);
expect(parsedAutosave !== undefined && parsedAutosave.customerSnapshotRef === customerSnapshotRef, "autosave parses opaque snapshot refs");
expect(parseAutosaveCaptureDraftCommandV1({ ...autosave, expectedVersion: 0 }) === undefined, "autosave requires a positive version");
expect(parseAutosaveCaptureDraftCommandV1({ ...autosave, customer: { name: "PII" } }) === undefined, "autosave rejects embedded PII");
expect(parseAutosaveCaptureDraftCommandV1({ ...autosave, fulfillmentSnapshotRef, fulfillmentChannel: "pickup" }) === undefined,
  "autosave cannot carry a delivery snapshot into another fulfillment channel");
expect(parseAutosaveCaptureDraftCommandV1({ ...autosave, fulfillmentSnapshotRef, customerSnapshotRef: null,
  fulfillmentChannel: "delivery" }) === undefined, "autosave fulfillment snapshot requires its party snapshot");

expect(parseHoldCaptureDraftCommandV1({ ...versioned, attentionLeaseId }) !== undefined, "hold parses");
expect(parseClaimCaptureDraftCommandV1(versioned) !== undefined, "claim parses without client actor");
expect(parseResumeCaptureDraftCommandV1(versioned) !== undefined, "resume parses without a stale lease");
expect(parseTransferCaptureDraftCommandV1({ ...versioned, attentionLeaseId, targetMembershipId }) !== undefined, "transfer targets a membership");
expect(parseConfirmCaptureDraftCommandV1({ ...versioned, attentionLeaseId, orderId }) !== undefined, "confirm binds the resulting order id");
expect(parseCloseCaptureNoSaleCommandV1({ ...versioned, attentionLeaseId, reason: "Cliente no respondió" }) !== undefined, "no-sale requires a bounded reason");
expect(parseCloseCaptureNoSaleCommandV1({ ...versioned, attentionLeaseId, reason: " " }) === undefined, "no-sale rejects blank reason");

const summary = {
  schemaVersion: 1,
  scope,
  captureDraftId: common.captureDraftId,
  folio: "CAP-000042",
  sourceChannel: "phone",
  fulfillmentChannel: "delivery",
  status: "draft",
  attentionStatus: "claimed",
  ownerMembershipId: targetMembershipId,
  version: expectedVersion,
  updatedAt: "2026-09-15T18:01:00.000Z",
};
const parsedSummary = parseCaptureDraftSummaryV1(summary);
expect(parseCaptureWorkTrayRequestV1({ schemaVersion: 1, scope, limit: 20 }) !== undefined, "tray request accepted");
expect(parseCaptureWorkTrayRequestV1({ schemaVersion: 1, scope, limit: 51 }) === undefined, "tray request limit bounded");
const tray = parseCaptureWorkTrayResultV1({ schemaVersion: 1, items: [summary] });
expect(tray?.items.length === 1 && Object.isFrozen(tray.items), "tray result accepted and frozen");
expect(parseCaptureWorkTrayResultV1({ schemaVersion: 1, items: [{ ...summary, scope: { ...scope, branchId: common.captureDraftId } }] }) !== undefined,
  "tray parser validates shape while service binds scope");
expect(parseCaptureWorkTrayResultV1({ schemaVersion: 1, items: [summary], cursor: null }) === undefined, "tray result exact keys");
expect(parseCaptureDraftSummaryV1({ ...summary, status: "confirmed" }) === undefined, "confirmed capture has released attention");
expect(parseCaptureDraftSummaryV1({ ...summary, status: "no_sale" }) === undefined, "no-sale capture has released attention");
expect(parseCaptureDraftSummaryV1({ ...summary, status: "confirmed", attentionStatus: "unclaimed", ownerMembershipId: null, fulfillmentChannel: null }) === undefined, "confirmed capture needs fulfillment");
expect(parsedSummary !== undefined && Object.isFrozen(parsedSummary.scope), "minimal summary parses frozen");
expect(parseCaptureDraftSummaryV1({ ...summary, attentionStatus: "unclaimed", ownerMembershipId: targetMembershipId }) === undefined, "unclaimed summary has no owner");

const detail = {
  ...summary,
  attentionLeaseId,
  attentionLeaseExpiresAt: "2026-09-15T18:31:00.000Z",
  customerSnapshotRef,
  fulfillmentSnapshotRef,
  confirmedOrderId: null,
};
expect(parseCaptureDraftDetailV1(detail) !== undefined, "minimal detail parses opaque references");
expect(parseCaptureDraftDetailV1({ ...detail, status: "confirmed", confirmedOrderId: null }) === undefined, "confirmed detail requires an order");
expect(parseCaptureDraftDetailV1({ ...detail, attentionStatus: "held", attentionLeaseId }) === undefined, "only claimed detail exposes a lease");
expect(parseCaptureDraftDetailV1({ ...detail, attentionStatus: "held", ownerMembershipId: null, attentionLeaseId: null, attentionLeaseExpiresAt: null }) !== undefined, "held detail releases lease and owner");
expect(parseCaptureMutationResultV1({ schemaVersion: 1, replayed: false, detail }) !== undefined, "mutation result exposes replay flag");
expect(parseCaptureWorkspaceRequestV1({ schemaVersion: 1, scope, captureDraftId: common.captureDraftId }) !== undefined,
  "workspace request binds capture and scope");
const customerSnapshot = { schemaVersion: 1, snapshotRef: customerSnapshotRef, customerId: common.eventId,
  contactId: common.deviceId, displayName: "Cliente histórico", phoneDisplayValue: "+52 555 000 0000",
  phoneNormalizedValue: "+525550000000" };
const fulfillmentSnapshot = { schemaVersion: 1, snapshotRef: fulfillmentSnapshotRef,
  customerSnapshotRef, customerId: common.eventId, addressId: orderId, label: "Casa", streetLine: "Acacia 84",
  unit: null, neighborhood: "Centro", locality: "Hermosillo", region: "Sonora", countryCode: "MX",
  postalCode: "83000", referencesText: "Portón azul", legacyAddressInstructions: null, latitudeE6: null, longitudeE6: null,
  validatedAt: "2026-09-15T18:00:00.000Z" };
const workspace = parseCaptureWorkspaceV1({ schemaVersion: 1, detail, customerSnapshot, fulfillmentSnapshot });
expect(workspace !== undefined && Object.isFrozen(workspace.customerSnapshot) && Object.isFrozen(workspace.fulfillmentSnapshot),
  "workspace rehydrates immutable snapshots linked to capture refs");
expect(parseCaptureWorkspaceV1({ schemaVersion: 1, detail, customerSnapshot: { ...customerSnapshot,
  displayName: "Current mutable name", snapshotRef: orderId }, fulfillmentSnapshot }) === undefined,
  "workspace rejects a party snapshot not linked by the capture");
expect(parseCaptureWorkspaceV1({ schemaVersion: 1, detail, customerSnapshot,
  fulfillmentSnapshot: { ...fulfillmentSnapshot, customerSnapshotRef: orderId } }) === undefined,
  "workspace rejects fulfillment linked to another party snapshot");
const preferenceResult = { schemaVersion: 1, replayed: false, detail,
  recoveryPolicy: { schemaVersion: 1, autoRenewSelected: true, recoveryExpiresAt: "2026-10-16T12:00:00.000Z" } };
expect(parseCaptureRecoveryPreferenceResultV1(preferenceResult) !== undefined, "preference result includes explicit selected policy");
expect(parseCaptureMutationResultV1(preferenceResult) === undefined, "prior mutation shape remains exact");
for (const invalid of [{ ...preferenceResult, extra: true }, { ...preferenceResult, recoveryPolicy: null },
  { ...preferenceResult, recoveryPolicy: { ...preferenceResult.recoveryPolicy, autoRenewSelected: "yes" } }]) {
  expect(parseCaptureRecoveryPreferenceResultV1(invalid) === undefined, "preference result rejects extra or malformed policy");
}

for (const invalid of [
  { ...create, eventId: "not-a-uuid" },
  { ...create, occurredAt: "2026-09-15" },
  { ...create, extra: true },
  Object.assign(Object.create({}), create),
]) {
  expect(parseCreateCaptureDraftCommandV1(invalid) === undefined, "create rejects invalid UUID, timestamp, extra keys, and prototype");
}

const accessor = { ...create };
Object.defineProperty(accessor, "sourceChannel", { enumerable: true, get: () => { throw new Error("must not run"); } });
expect(parseCreateCaptureDraftCommandV1(accessor) === undefined, "accessor fails without invocation");
expect(parseCreateCaptureDraftCommandV1(new Proxy(create, { ownKeys: () => { throw new Error("hostile"); } })) === undefined, "proxy fails closed");
