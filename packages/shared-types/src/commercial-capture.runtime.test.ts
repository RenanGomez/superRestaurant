import {
  parseAutosaveCaptureDraftCommandV1,
  parseCaptureDraftDetailV1,
  parseCaptureDraftSummaryV1,
  parseCaptureMutationResultV1,
  parseClaimCaptureDraftCommandV1,
  parseCloseCaptureNoSaleCommandV1,
  parseConfirmCaptureDraftCommandV1,
  parseCreateCaptureDraftCommandV1,
  parseHoldCaptureDraftCommandV1,
  parseSetCaptureRecoveryPreferenceCommandV1,
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
