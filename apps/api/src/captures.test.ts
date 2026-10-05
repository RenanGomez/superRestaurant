import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { parseCaptureWorkTrayRequestV2, parseRenewCaptureLeaseCommandV1, parseAutosaveCaptureDraftCommandV1, parseCaptureDeliveryInstructionSuggestionsRequestV1, parseCaptureWorkspaceRequestV1, parseCaptureWorkspaceRequestV2, parseCaptureWorkspaceRequestV3, parseCaptureWorkTrayRequestV1, parseCloseCaptureNoSaleCommandV1, parseConfirmCaptureDraftCommandV2, parseCreateCaptureDraftCommandV1, parseHoldCaptureDraftCommandV1, parseReplaceCaptureSelectionPlanCommandV1, parseRequestCaptureDeliveryQuoteCommandV1, parseSetCaptureCustomerCommandV1, parseSetCaptureDeliveryInstructionsCommandV1, parseSetCaptureFulfillmentCommandV1, parseSetCapturePaymentIntentCommandV1, parseTakeoverCaptureDraftCommandV1, parseTransferCaptureDraftCommandV1, type MembershipRoleCode, type MenuCatalogV1 } from "@super-restaurant/shared-types";

import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "./auth/authentication.js";
import type { CaptureOrderMaterialization } from "./capture-repeat-order-plan.js";
import { CAPTURE_ASSIGNMENT_DIRECTORY_PORT, CAPTURE_ATTENTION_PORT, CAPTURE_CONFIRMATION_PORT, CAPTURE_CREATION_PORT, CAPTURE_CUSTOMER_PORT, CAPTURE_DELIVERY_INSTRUCTIONS_PORT, CAPTURE_DELIVERY_QUOTE_COMPUTATION_PORT, CAPTURE_DELIVERY_QUOTE_PORT, CAPTURE_FULFILLMENT_PORT, CAPTURE_NO_SALE_PORT, CAPTURE_PAYMENT_INTENT_PORT, CAPTURE_SELECTION_PLAN_PORT, CAPTURE_TRAY_PORT, CaptureAssignmentDirectoryService, CaptureConfirmationService, CaptureCustomerService, CaptureDeliveryInstructionsService, CaptureDeliveryQuoteInvalidError, CaptureDeliveryQuoteService, CapturePaymentIntentInsufficientError, CapturePaymentIntentNoLinesError, CapturePaymentIntentService, CapturePaymentIntentStaleError, CapturePaymentIntentUnpricedError, CaptureFulfillmentService, CaptureLeaseTakenError, CaptureApplicationError, CaptureAttentionService, CaptureNoSaleService, CaptureSelectionPlanService, CaptureService, CaptureTrayService, PostgresCaptureCreator, type CaptureCreationPort, type CaptureConfirmationPort, type CaptureCustomerPort, type CaptureAttentionPort, type CaptureDeliveryQuoteComputationPort, type CaptureDeliveryQuoteEnvelopeV1, type CaptureDeliveryQuotePort, type CaptureNoSalePort, type CapturePaymentIntentPort, type CaptureSelectionPlanPort } from "./captures.js";
import { CapturesController } from "./captures.controller.js";
import { MENU_CATALOG_PORT } from "./menu-catalog.js";

const principal = { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" };
const command = parseCreateCaptureDraftCommandV1({
  schemaVersion: 1, expectedVersion: 0, sourceChannel: "phone", fulfillmentChannel: null,
  captureDraftId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  scope: { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" },
  eventId: "a409ec59-9f5e-496d-a45d-b83a46b49674", idempotencyKey: "c483b6e7-e102-4cc5-a887-d30712c85e52",
  deviceId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4", occurredAt: "2026-09-16T12:00:00.000Z",
});
assert.ok(command);
const validCommand = command;
const record = {
  schemaVersion: 1,
  detail: { schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    folio: `C-${validCommand.captureDraftId}`, sourceChannel: "phone", fulfillmentChannel: null,
    status: "draft", attentionStatus: "claimed", ownerMembershipId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
    version: 1, updatedAt: "2026-09-16T12:00:01.000Z", attentionLeaseId: validCommand.deviceId,
    attentionLeaseExpiresAt: "2026-09-16T12:05:01.000Z", confirmedOrderId: null,
    customerSnapshotRef: null, fulfillmentSnapshotRef: null },
  recoveryPolicy: { schemaVersion: 1, autoRenewSelected: false, recoveryExpiresAt: "2026-10-16T12:00:01.000Z" },
};
function serviceFor(creator: CaptureCreationPort, roles: readonly ("cashier" | "viewer")[] = ["cashier"]) {
  return new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles, scope: validCommand.scope }),
  }), creator, {
    probeConfirmation: async () => { throw new Error("must not probe confirmation"); },
    readRepeatOrderPlan: async () => { throw new Error("must not read repeat order plan"); },
    readSelectionPlan: async () => { throw new Error("must not read selection plan"); },
    confirmDraft: async () => { throw new Error("must not confirm"); },
  }, { read: async () => { throw new Error("must not read catalog"); },
    save: async () => { throw new Error("must not save a catalog"); } });
}
function code(expected: string) {
  return (error: unknown) => error instanceof CaptureApplicationError && error.code === expected;
}
const mutationCommand = {
  schemaVersion: 1, expectedVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
  eventId: validCommand.eventId, deviceId: validCommand.deviceId, idempotencyKey: validCommand.idempotencyKey,
  occurredAt: validCommand.occurredAt,
};
const holdCommand = { ...mutationCommand, attentionLeaseId: validCommand.deviceId };
const heldRecord = { ...record, detail: { ...record.detail, version: 2, attentionStatus: "held",
  ownerMembershipId: null, attentionLeaseId: null, attentionLeaseExpiresAt: null } };
const targetMembershipId = "2f99dfcb-e7b1-4ab0-95a4-40ad0f9a7227";
const rotatedLeaseId = "874216e9-e709-4f00-aa45-62f4cbc334a8";
const transferCommand = parseTransferCaptureDraftCommandV1({ ...holdCommand, targetMembershipId });
assert.ok(transferCommand);
const transferredRecord = { ...record, detail: { ...record.detail, version: 2,
  ownerMembershipId: targetMembershipId, attentionLeaseId: rotatedLeaseId,
  attentionLeaseExpiresAt: "2026-09-16T12:05:02.000Z" } };
const takeoverCommand = parseTakeoverCaptureDraftCommandV1({ ...mutationCommand,
  reason: "Operador ausente durante el servicio" });
assert.ok(takeoverCommand);
const takenOverRecord = { ...record, detail: { ...record.detail, version: 2,
  ownerMembershipId: targetMembershipId, attentionLeaseId: rotatedLeaseId,
  attentionLeaseExpiresAt: "2026-09-16T12:05:02.000Z" } };
const preferenceCommand = { ...holdCommand, autoRenewSelected: true };
const preferenceRecord = { ...record, detail: { ...record.detail, version: 2 },
  recoveryPolicy: { ...record.recoveryPolicy, autoRenewSelected: true } };
const customerCommand = { ...holdCommand, schemaVersion: 1 as const, customerId: validCommand.captureDraftId,
  contactId: validCommand.eventId, expectedCustomerVersion: 1 };
const customerRecord = { ...record, detail: { ...record.detail, version: 2, customerSnapshotRef: validCommand.idempotencyKey } };
const fulfillmentCommand = { ...holdCommand, schemaVersion: 1 as const, customerSnapshotRef: validCommand.idempotencyKey,
  addressId: validCommand.captureDraftId, expectedAddressVersion: 1 };
const fulfillmentRecord = { ...record, detail: { ...record.detail, version: 2,
  customerSnapshotRef: validCommand.idempotencyKey, fulfillmentSnapshotRef: validCommand.eventId } };
const autosaveCommand = parseAutosaveCaptureDraftCommandV1({ ...mutationCommand, expectedVersion: 2,
  attentionLeaseId: validCommand.deviceId, sourceChannel: "whatsapp_manual", fulfillmentChannel: "delivery",
  customerSnapshotRef: validCommand.idempotencyKey, fulfillmentSnapshotRef: validCommand.eventId });
assert.ok(autosaveCommand);
const autosaveRecord = { ...fulfillmentRecord, detail: { ...fulfillmentRecord.detail, version: 3,
  sourceChannel: "whatsapp_manual", fulfillmentChannel: "delivery" } };
const workspaceRequest = parseCaptureWorkspaceRequestV1({ schemaVersion: 1, scope: validCommand.scope,
  captureDraftId: validCommand.captureDraftId });
assert.ok(workspaceRequest);
const workspace = { schemaVersion: 1 as const, detail: fulfillmentRecord.detail,
  customerSnapshot: { schemaVersion: 1 as const, snapshotRef: validCommand.idempotencyKey,
    customerId: validCommand.captureDraftId, contactId: validCommand.eventId, displayName: "Nombre congelado",
    phoneDisplayValue: "+52 662 000 0000", phoneNormalizedValue: "+526620000000" },
  fulfillmentSnapshot: { schemaVersion: 1 as const, snapshotRef: validCommand.eventId,
    customerSnapshotRef: validCommand.idempotencyKey, customerId: validCommand.captureDraftId,
    addressId: validCommand.deviceId, label: "Casa", streetLine: "Acacia 84", unit: null, neighborhood: "Centro",
    locality: "Hermosillo", region: "Sonora", countryCode: "MX", postalCode: "83000", referencesText: null,
    legacyAddressInstructions: null, latitudeE6: null, longitudeE6: null, validatedAt: validCommand.occurredAt } };
function customerFor(port: CaptureCustomerPort, allowed = true) {
  return new CaptureCustomerService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: allowed ? ["cashier"] : ["viewer"], scope: validCommand.scope }),
  }), port);
}

test("capture customer validates selection, removal, replay and authorization before persistence", async () => {
  const calls: unknown[] = [];
  const service = customerFor({ setCustomer: async (actor, input) => {
    calls.push({ actor, input }); return { status: "replayed", record: customerRecord };
  } });
  assert.deepEqual(await service.setCustomer(principal, customerCommand),
    { schemaVersion: 1, detail: customerRecord.detail, replayed: true });
  assert.deepEqual(calls, [{ actor: principal.actorId, input: customerCommand }]);
  const removal = { ...customerCommand, customerId: null, contactId: null, expectedCustomerVersion: null };
  assert.equal((await customerFor({ setCustomer: async () => ({ status: "applied", record: preferenceRecord }) })
    .setCustomer(principal, removal)).detail.customerSnapshotRef, null);
  const noCall = { setCustomer: async () => { throw new Error("must not call"); } };
  for (const invalid of [{ ...customerCommand, contactId: null }, { ...customerCommand, customerSnapshotRef: validCommand.deviceId },
    { ...customerCommand, expectedVersion: Number.MAX_SAFE_INTEGER }, { ...customerCommand, expectedCustomerVersion: 0 }]) {
    await assert.rejects(customerFor(noCall).setCustomer(principal, invalid), code("request"));
  }
  await assert.rejects(customerFor(noCall, false).setCustomer(principal, customerCommand), code("authorization"));
  await assert.rejects(customerFor(noCall).setCustomer(principal, { ...customerCommand,
    scope: { ...validCommand.scope, branchId: validCommand.deviceId } }), code("authorization"));
});

test("capture fulfillment validates selected party, address and adapter binding", async () => {
  const calls: unknown[] = [];
  const service = new CaptureFulfillmentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), { setFulfillment: async (actor, input) => { calls.push({ actor, input }); return { status: "applied", record: fulfillmentRecord }; } });
  assert.deepEqual(await service.setFulfillment(principal, fulfillmentCommand),
    { schemaVersion: 1, detail: fulfillmentRecord.detail, replayed: false });
  assert.deepEqual(calls, [{ actor: principal.actorId, input: parseSetCaptureFulfillmentCommandV1(fulfillmentCommand) }]);
  const removal = { ...fulfillmentCommand, addressId: null, expectedAddressVersion: null };
  const removedRecord = { ...fulfillmentRecord, detail: { ...fulfillmentRecord.detail, fulfillmentSnapshotRef: null } };
  assert.equal((await new CaptureFulfillmentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), { setFulfillment: async () => ({ status: "applied", record: removedRecord }) }).setFulfillment(principal, removal))
    .detail.fulfillmentSnapshotRef, null);
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    assert.equal(sql, "select app_private.set_capture_fulfillment($1::uuid, $2::jsonb) as result");
    assert.deepEqual(parameters, [principal.actorId, JSON.stringify(parseSetCaptureFulfillmentCommandV1(fulfillmentCommand))]);
    return { rows: [{ result: { status: "applied", record: fulfillmentRecord } }] };
  } });
  assert.deepEqual(await adapter.setFulfillment(principal.actorId, fulfillmentCommand), { status: "applied", record: fulfillmentRecord });
});

test("capture customer checks result scope, lease, version and opaque reference", async () => {
  for (const [status, expected] of [["denied", "authorization"], ["conflict", "conflict"], ["rejected", "request"]]) {
    await assert.rejects(customerFor({ setCustomer: async () => ({ status }) }).setCustomer(principal, customerCommand), code(expected!));
  }
  for (const detail of [{ ...customerRecord.detail, version: 3 }, { ...customerRecord.detail, customerSnapshotRef: null },
    { ...customerRecord.detail, captureDraftId: validCommand.deviceId }, { ...customerRecord.detail, attentionLeaseId: validCommand.eventId },
    { ...customerRecord.detail, fulfillmentSnapshotRef: validCommand.deviceId },
    { ...customerRecord.detail, scope: { ...validCommand.scope, restaurantId: validCommand.deviceId } }]) {
    await assert.rejects(customerFor({ setCustomer: async () => ({ status: "applied", record: { ...customerRecord, detail } }) })
      .setCustomer(principal, customerCommand), code("unavailable"));
  }
  await assert.rejects(customerFor({ setCustomer: async () => { throw new Error("secret"); } })
    .setCustomer(principal, customerCommand), code("unavailable"));
});

test("capture customer adapter binds validated identifiers", async () => {
  const calls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: { status: "conflict" } }] };
  } });
  assert.deepEqual(await adapter.setCustomer(principal.actorId, customerCommand), { status: "conflict" });
  assert.deepEqual(calls, [{ sql: "select app_private.set_capture_customer($1::uuid, $2::jsonb) as result",
    parameters: [principal.actorId, JSON.stringify(parseSetCaptureCustomerCommandV1(customerCommand))] }]);
  await assert.rejects(adapter.setCustomer("forged", customerCommand), code("request"));
  assert.equal(calls.length, 1);
});
function attentionFor(port: CaptureAttentionPort, roles: readonly MembershipRoleCode[] = ["cashier"]) {
  return new CaptureAttentionService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles, scope: validCommand.scope }),
  }), port);
}

test("capture attention authorizes and validates exact version, ownership shape and replay", async () => {
  const calls: unknown[] = [];
  const service = attentionFor({ mutateAttention: async (actor, operation, command) => {
    calls.push({ actor, operation, command }); return { status: "applied", record: heldRecord };
  } });
  assert.deepEqual(await service.mutateAttention(principal, "capture.held", holdCommand),
    { schemaVersion: 1, detail: heldRecord.detail, replayed: false });
  assert.deepEqual(calls, [{ actor: principal.actorId, operation: "capture.held", command: holdCommand }]);
  for (const operation of ["capture.claimed", "capture.resumed"] as const) {
    const response = await attentionFor({ mutateAttention: async () => ({ status: "replayed", record: {
      ...record, detail: { ...record.detail, version: 2 },
    } }) }).mutateAttention(principal, operation, mutationCommand);
    assert.equal(response.replayed, true);
    assert.equal(response.detail.attentionStatus, "claimed");
  }
  const transferred = await attentionFor({ mutateAttention: async (actor, operation, received) => {
    assert.deepEqual({ actor, operation, received }, {
      actor: principal.actorId, operation: "capture.transferred", received: transferCommand,
    });
    return { status: "applied", record: transferredRecord };
  } }, ["supervisor"]).mutateAttention(principal, "capture.transferred", transferCommand);
  assert.equal(transferred.detail.ownerMembershipId, targetMembershipId);
  const takenOver = await attentionFor({ mutateAttention: async (actor, operation, received) => {
    assert.deepEqual({ actor, operation, received }, {
      actor: principal.actorId, operation: "capture.taken_over", received: takeoverCommand,
    });
    return { status: "replayed", record: takenOverRecord };
  } }, ["supervisor"]).mutateAttention(principal, "capture.taken_over", takeoverCommand);
  assert.equal(takenOver.replayed, true);
});

test("capture attention rejects invalid commands and unauthorized roles before SQL", async () => {
  let calls = 0;
  const port = { mutateAttention: async () => { calls++; return {}; } };
  for (const input of [mutationCommand, { ...holdCommand, expectedVersion: 0 },
    { ...holdCommand, expectedVersion: Number.MAX_SAFE_INTEGER }, { ...holdCommand, actorId: principal.actorId }]) {
    await assert.rejects(attentionFor(port).mutateAttention(principal, "capture.held", input), code("request"));
  }
  await assert.rejects(attentionFor(port).mutateAttention(principal, "capture.claimed", holdCommand), code("request"));
  await assert.rejects(attentionFor(port, ["supervisor"]).mutateAttention(principal, "capture.taken_over", mutationCommand), code("request"));
  await assert.rejects(attentionFor(port, ["supervisor"]).mutateAttention(principal, "capture.taken_over", {
    ...takeoverCommand, reason: " ",
  }), code("request"));
  await assert.rejects(attentionFor(port, ["supervisor"]).mutateAttention(principal, "capture.taken_over", {
    ...takeoverCommand, targetMembershipId,
  }), code("request"));
  await assert.rejects(attentionFor(port).mutateAttention(principal, "capture.transferred", transferCommand), code("authorization"));
  await assert.rejects(attentionFor(port).mutateAttention(principal, "capture.taken_over", takeoverCommand), code("authorization"));
  await assert.rejects(attentionFor(port, ["viewer"]).mutateAttention(principal, "capture.claimed", mutationCommand), code("authorization"));
  await assert.rejects(attentionFor(port).mutateAttention(principal, "capture.claimed", {
    ...mutationCommand, scope: { ...validCommand.scope, branchId: validCommand.deviceId },
  }), code("authorization"));
  assert.equal(calls, 0);
});

test("capture attention sanitizes failures and rejects wrong status, scope or result version", async () => {
  for (const [status, expected] of [["denied", "authorization"], ["conflict", "conflict"], ["rejected", "request"]]) {
    await assert.rejects(attentionFor({ mutateAttention: async () => ({ status }) }).mutateAttention(principal, "capture.held", holdCommand), code(expected!));
  }
  for (const stored of [record, { ...heldRecord, detail: { ...heldRecord.detail, version: 3 } },
    { ...heldRecord, detail: { ...heldRecord.detail, captureDraftId: validCommand.deviceId } },
    { ...heldRecord, detail: { ...heldRecord.detail, scope: { ...validCommand.scope, restaurantId: validCommand.deviceId } } }]) {
    await assert.rejects(attentionFor({ mutateAttention: async () => ({ status: "applied", record: stored }) })
      .mutateAttention(principal, "capture.held", holdCommand), code("unavailable"));
  }
  await assert.rejects(attentionFor({ mutateAttention: async () => { throw new Error("secret-password"); } })
    .mutateAttention(principal, "capture.claimed", mutationCommand), code("unavailable"));
  await assert.rejects(attentionFor({ mutateAttention: async () => ({ status: "applied", record: {
    ...transferredRecord, detail: { ...transferredRecord.detail, ownerMembershipId: validCommand.eventId },
  } }) }, ["supervisor"]).mutateAttention(principal, "capture.transferred", transferCommand), code("unavailable"));
});

test("capture attention adapter validates and parameterizes operation instead of constructing SQL", async () => {
  const calls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: { status: "conflict" } }] };
  } });
  const parsed = { ...holdCommand, schemaVersion: 1 as const };
  assert.deepEqual(await adapter.mutateAttention(principal.actorId, "capture.held", parsed), { status: "conflict" });
  assert.deepEqual(calls, [{ sql: "select app_private.mutate_capture_attention($1::uuid, $2::text, $3::jsonb) as result",
    parameters: [principal.actorId, "capture.held", JSON.stringify(parseHoldCaptureDraftCommandV1(parsed))] }]);
  assert.deepEqual(await adapter.mutateAttention(principal.actorId, "capture.transferred", transferCommand), { status: "conflict" });
  assert.deepEqual(await adapter.mutateAttention(principal.actorId, "capture.taken_over", takeoverCommand), { status: "conflict" });
  assert.deepEqual(calls.slice(1), [
    { sql: "select app_private.mutate_capture_assignment($1::uuid, $2::text, $3::jsonb) as result",
      parameters: [principal.actorId, "capture.transferred", JSON.stringify(parseTransferCaptureDraftCommandV1(transferCommand))] },
    { sql: "select app_private.mutate_capture_assignment($1::uuid, $2::text, $3::jsonb) as result",
      parameters: [principal.actorId, "capture.taken_over", JSON.stringify(parseTakeoverCaptureDraftCommandV1(takeoverCommand))] },
  ]);
  await assert.rejects(adapter.mutateAttention(principal.actorId, "capture.destroyed" as never, parsed), code("request"));
  assert.equal(calls.length, 3);
});

test("capture recovery preference validates explicit selection, lease, policy and replay", async () => {
  const response = await attentionFor({ mutateAttention: async (actor, operation, command) => {
    assert.equal(actor, principal.actorId);
    assert.equal(operation, "capture.recovery_preference_changed");
    assert.deepEqual(command, preferenceCommand);
    return { status: "replayed", record: preferenceRecord };
  } }).setRecoveryPreference(principal, preferenceCommand);
  assert.equal(response.replayed, true);
  assert.equal(response.recoveryPolicy.autoRenewSelected, true);
  assert.equal(response.detail.attentionLeaseId, holdCommand.attentionLeaseId);
  for (const invalid of [{ ...preferenceCommand, autoRenewSelected: "true" },
    { ...preferenceCommand, recoveryExpiresAt: record.recoveryPolicy.recoveryExpiresAt }]) {
    await assert.rejects(attentionFor({ mutateAttention: async () => { throw new Error("must not call"); } })
      .setRecoveryPreference(principal, invalid), code("request"));
  }
  await assert.rejects(attentionFor({ mutateAttention: async () => ({ status: "applied", record: { ...preferenceRecord,
    recoveryPolicy: { ...preferenceRecord.recoveryPolicy, autoRenewSelected: false },
  } }) }).setRecoveryPreference(principal, preferenceCommand), code("unavailable"));
});

test("capture create authorizes verified actor, validates response and preserves replay snapshot", async () => {
  const calls: unknown[] = [];
  const result = await serviceFor({ createDraft: async (actor, received) => {
    calls.push({ actor, received }); return { status: "applied", record };
  } }).createDraft(principal, validCommand);
  assert.deepEqual(calls, [{ actor: principal.actorId, received: validCommand }]);
  assert.deepEqual(result, { schemaVersion: 1, detail: record.detail, replayed: false });
  assert.ok(Object.isFrozen(result.detail));
  const replay = await serviceFor({ createDraft: async () => ({ status: "replayed", record }) }).createDraft(principal, validCommand);
  assert.deepEqual(replay.detail, result.detail);
  assert.equal(replay.replayed, true);
});

test("capture create rejects malformed, hostile and storage-incompatible commands before persistence", async () => {
  let calls = 0;
  const creator = { createDraft: async () => { calls++; return { status: "applied", record }; } };
  for (const input of [{ ...validCommand, actorId: principal.actorId }, { ...validCommand, expectedVersion: 1 },
    { ...validCommand, captureDraftId: "opaque-domain-id" }, { ...validCommand, sourceChannel: "unknown" },
    new Proxy(validCommand, { getOwnPropertyDescriptor: () => { throw new Error("trap"); } })]) {
    await assert.rejects(serviceFor(creator).createDraft(principal, input), code("request"));
  }
  await assert.rejects(serviceFor(creator, ["viewer"]).createDraft(principal, validCommand), code("authorization"));
  assert.equal(calls, 0);
});

test("capture create sanitizes database failures and maps revalidation or conflicts", async () => {
  for (const [status, expected] of [["denied", "authorization"], ["conflict", "conflict"], ["rejected", "request"]]) {
    await assert.rejects(serviceFor({ createDraft: async () => ({ status }) }).createDraft(principal, validCommand), code(expected!));
  }
  await assert.rejects(serviceFor({ createDraft: async () => { throw new Error("server-password"); } }).createDraft(principal, validCommand), code("unavailable"));
});

test("capture create rejects incompatible, foreign, accessor and proxy persistence envelopes", async () => {
  const accessor = { status: "applied" };
  Object.defineProperty(accessor, "record", { enumerable: true, get: () => { throw new Error("do not execute"); } });
  for (const raw of [accessor, new Proxy({ status: "applied", record }, {}), { status: "applied", record, extra: true },
    { status: "denied", record }, { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } },
    { status: "applied", record: { ...record, detail: { ...record.detail, captureDraftId: validCommand.deviceId } } },
    { status: "applied", record: { ...record, detail: { ...record.detail, scope: { ...validCommand.scope, branchId: validCommand.deviceId } } } },
    { status: "applied", record: { ...record, recoveryPolicy: { ...record.recoveryPolicy, autoRenewSelected: true } } }]) {
    await assert.rejects(serviceFor({ createDraft: async () => raw }).createDraft(principal, validCommand), code("unavailable"));
  }
});

test("capture PostgreSQL adapter binds actor and detached JSON without dynamic SQL", async () => {
  const calls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: { status: "applied", record } }] };
  } });
  assert.deepEqual(await adapter.createDraft(principal.actorId, validCommand), { status: "applied", record });
  assert.deepEqual(calls, [{ sql: "select app_private.create_capture_draft($1::uuid, $2::jsonb) as result",
    parameters: [principal.actorId, JSON.stringify(validCommand)] }]);
  await assert.rejects(adapter.createDraft("forged-actor", validCommand), code("request"));
  assert.equal(calls.length, 1);
  for (const rows of [[], [{ result: {}, extra: true }], [{ result: {} }, { result: {} }]]) {
    await assert.rejects(new PostgresCaptureCreator({ query: async () => ({ rows }) }).createDraft(principal.actorId, validCommand), code("unavailable"));
  }
});

test("capture autosave requires authorization and binds lease, CAS, snapshots and exact replay", async () => {
  const calls: unknown[] = [];
  const service = serviceFor({ createDraft: async () => ({}), autosaveDraft: async (actor, input) => {
    calls.push({ actor, input }); return { status: "replayed", record: autosaveRecord };
  } });
  const replay = await service.autosaveDraft(principal, autosaveCommand);
  assert.equal(replay.replayed, true);
  assert.equal(replay.detail.version, autosaveCommand.expectedVersion + 1);
  assert.deepEqual(calls, [{ actor: principal.actorId, input: autosaveCommand }]);
  for (const [status, expected] of [["denied", "authorization"], ["conflict", "conflict"], ["rejected", "request"]]) {
    await assert.rejects(serviceFor({ createDraft: async () => ({}), autosaveDraft: async () => ({ status }) })
      .autosaveDraft(principal, autosaveCommand), code(expected!));
  }
  await assert.rejects(serviceFor({ createDraft: async () => ({}), autosaveDraft: async () => ({ status: "applied",
    record: { ...autosaveRecord, detail: { ...autosaveRecord.detail, version: 4 } } }) })
    .autosaveDraft(principal, autosaveCommand), code("unavailable"));
  await assert.rejects(serviceFor({ createDraft: async () => ({}), autosaveDraft: async () => ({}) }, ["viewer"])
    .autosaveDraft(principal, autosaveCommand), code("authorization"));
});

test("capture workspace reads only linked immutable snapshots after fresh capture and customer authorization", async () => {
  const calls: unknown[] = [];
  const service = serviceFor({ createDraft: async () => ({}), readWorkspace: async (actor, input) => {
    calls.push({ actor, input }); return workspace;
  } });
  const result = await service.readWorkspace(principal, workspaceRequest);
  assert.equal(result.customerSnapshot?.displayName, "Nombre congelado");
  assert.equal(result.fulfillmentSnapshot?.streetLine, "Acacia 84");
  assert.deepEqual(calls, [{ actor: principal.actorId, input: workspaceRequest }]);
  await assert.rejects(serviceFor({ createDraft: async () => ({}), readWorkspace: async () => ({ status: "missing" }) })
    .readWorkspace(principal, workspaceRequest), code("missing"));
  let authorizationChecks = 0;
  const revokedBetweenChecks = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => authorizationChecks++ === 0 ? { roles: ["cashier"], scope: validCommand.scope } : undefined,
  }), { createDraft: async () => ({}), readWorkspace: async () => { throw new Error("must not read"); } }, {
    probeConfirmation: async () => { throw new Error("must not probe confirmation"); },
    readRepeatOrderPlan: async () => { throw new Error("must not read repeat order plan"); },
    readSelectionPlan: async () => { throw new Error("must not read selection plan"); },
    confirmDraft: async () => { throw new Error("must not confirm"); },
  }, { read: async () => { throw new Error("must not read catalog"); },
    save: async () => { throw new Error("must not save a catalog"); } });
  await assert.rejects(revokedBetweenChecks.readWorkspace(principal, workspaceRequest), code("authorization"));
  assert.equal(authorizationChecks, 2);
  await assert.rejects(serviceFor({ createDraft: async () => ({}), readWorkspace: async () => ({ ...workspace,
    detail: { ...workspace.detail, scope: { ...workspace.detail.scope, branchId: validCommand.deviceId } } }) })
    .readWorkspace(principal, workspaceRequest), code("unavailable"));
});

test("capture delivery instructions stay lease-bound, idempotent and outside Address", async () => {
  const deliveryCommand = parseSetCaptureDeliveryInstructionsCommandV1({
    ...mutationCommand,
    expectedVersion: 2,
    attentionLeaseId: validCommand.deviceId,
    deliveryInstructions: "Portón lateral",
  });
  assert.ok(deliveryCommand);
  const calls: unknown[] = [];
  const service = new CaptureDeliveryInstructionsService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), { listDeliveryInstructionSuggestions: async () => ({ status: "missing" }), setDeliveryInstructions: async (actor, input) => {
    calls.push({ actor, input });
    return { status: "replayed", record: autosaveRecord, deliveryInstructions: "Portón lateral" };
  } });
  assert.deepEqual(await service.setDeliveryInstructions(principal, deliveryCommand), {
    schemaVersion: 1, replayed: true, detail: autosaveRecord.detail, deliveryInstructions: "Portón lateral",
  });
  assert.deepEqual(calls, [{ actor: principal.actorId, input: deliveryCommand }]);
  await assert.rejects(service.setDeliveryInstructions(principal, { ...deliveryCommand, instructions: "forged" }), code("request"));
  await assert.rejects(new CaptureDeliveryInstructionsService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["viewer"], scope: validCommand.scope }),
  }), { listDeliveryInstructionSuggestions: async () => { throw new Error("must not read"); },
    setDeliveryInstructions: async () => { throw new Error("must not persist"); } })
    .setDeliveryInstructions(principal, deliveryCommand), code("authorization"));

  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    assert.equal(sql, "select app_private.set_capture_delivery_instructions($1::uuid, $2::jsonb) as result");
    assert.deepEqual(parameters, [principal.actorId, JSON.stringify(deliveryCommand)]);
    return { rows: [{ result: { status: "applied", record: autosaveRecord, deliveryInstructions: "Portón lateral" } }] };
  } });
  assert.deepEqual(await adapter.setDeliveryInstructions(principal.actorId, deliveryCommand), {
    status: "applied", record: autosaveRecord, deliveryInstructions: "Portón lateral",
  });

  const requestV2 = parseCaptureWorkspaceRequestV2({ schemaVersion: 2, scope: validCommand.scope,
    captureDraftId: validCommand.captureDraftId });
  assert.ok(requestV2);
  const workspaceV2 = { ...workspace, schemaVersion: 2 as const,
    detail: { ...workspace.detail, schemaVersion: 2 as const, deliveryInstructions: "Portón lateral" } };
  const workspaceAdapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    assert.equal(sql, "select app_private.read_capture_workspace_v2($1::uuid, $2::jsonb) as result");
    assert.deepEqual(parameters, [principal.actorId, JSON.stringify(requestV2)]);
    return { rows: [{ result: workspaceV2 }] };
  } });
  assert.deepEqual(await workspaceAdapter.readWorkspaceV2(principal.actorId, requestV2), workspaceV2);

  const requestV3 = parseCaptureWorkspaceRequestV3({ schemaVersion: 3, scope: validCommand.scope,
    captureDraftId: validCommand.captureDraftId });
  assert.ok(requestV3);
  const repeatOrderPlan = { schemaVersion: 1 as const, customerId: workspace.customerSnapshot.customerId,
    sourceOrderId: validCommand.deviceId, catalogVersion: validCommand.eventId,
    appliedCaptureVersion: 3, lineCount: 2 };
  const workspaceV3 = { ...workspaceV2, schemaVersion: 3 as const, repeatOrderPlan };
  const workspaceV3Adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    assert.equal(sql, "select app_private.read_capture_workspace_v3($1::uuid, $2::jsonb) as result");
    assert.deepEqual(parameters, [principal.actorId, JSON.stringify(requestV3)]);
    return { rows: [{ result: workspaceV3 }] };
  } });
  assert.deepEqual(await workspaceV3Adapter.readWorkspaceV3(principal.actorId, requestV3), workspaceV3);
  assert.deepEqual(await serviceFor({ createDraft: async () => ({}), readWorkspaceV3: async () => workspaceV3 })
    .readWorkspace(principal, requestV3), workspaceV3);
});

test("capture delivery instruction suggestions are Capture-derived, Branch-scoped and opt-in", async () => {
  const request = parseCaptureDeliveryInstructionSuggestionsRequestV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
  });
  assert.ok(request);
  const history = { schemaVersion: 1 as const, captureDraftId: validCommand.captureDraftId, items: [
    { deliveryInstructions: "Portón lateral", lastUsedAt: "2026-09-22T12:00:00.000Z", usageCount: 2 },
  ] };
  const calls: unknown[] = [];
  const service = new CaptureDeliveryInstructionsService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), {
    setDeliveryInstructions: async () => { throw new Error("read must not mutate"); },
    listDeliveryInstructionSuggestions: async (actorId, input) => {
      calls.push({ actorId, input });
      return history;
    },
  });
  assert.deepEqual(await service.listSuggestions(principal, request), history);
  assert.deepEqual(calls, [{ actorId: principal.actorId, input: request }]);
  await assert.rejects(service.listSuggestions(principal, { ...request, customerId: validCommand.deviceId }), code("request"));
  await assert.rejects(new CaptureDeliveryInstructionsService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["viewer"], scope: validCommand.scope }),
  }), {
    setDeliveryInstructions: async () => { throw new Error("must not mutate"); },
    listDeliveryInstructionSuggestions: async () => { throw new Error("must not read"); },
  }).listSuggestions(principal, request), code("authorization"));

  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    assert.equal(sql, "select app_private.list_capture_delivery_instruction_suggestions($1::uuid, $2::jsonb) as result");
    assert.deepEqual(parameters, [principal.actorId, JSON.stringify(request)]);
    return { rows: [{ result: history }] };
  } });
  assert.deepEqual(await adapter.listDeliveryInstructionSuggestions(principal.actorId, request), history);
});

test("capture continuity adapter parameterizes autosave and workspace reads", async () => {
  const calls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: sql.includes("autosave") ? { status: "applied", record: autosaveRecord } : workspace }] };
  } });
  assert.deepEqual(await adapter.autosaveDraft(principal.actorId, autosaveCommand), { status: "applied", record: autosaveRecord });
  assert.deepEqual(await adapter.readWorkspace(principal.actorId, workspaceRequest), workspace);
  assert.deepEqual(calls, [
    { sql: "select app_private.autosave_capture_draft($1::uuid, $2::jsonb) as result",
      parameters: [principal.actorId, JSON.stringify(autosaveCommand)] },
    { sql: "select app_private.read_capture_workspace($1::uuid, $2::jsonb) as result",
      parameters: [principal.actorId, JSON.stringify(workspaceRequest)] },
  ]);
});

test("capture confirmation probes replay and delegates one atomic persistence command", async () => {
  const confirmCommand = parseConfirmCaptureDraftCommandV2({
    ...mutationCommand,
    schemaVersion: 2,
    expectedVersion: 2,
    attentionLeaseId: validCommand.deviceId,
    orderId: validCommand.deviceId,
    shiftId: record.detail.ownerMembershipId,
    tableId: null,
    currency: "MXN",
    timeZone: "America/Hermosillo",
  });
  assert.ok(confirmCommand);
  const workspaceV4 = { ...workspace, schemaVersion: 4 as const,
    detail: { ...fulfillmentRecord.detail, schemaVersion: 2 as const, fulfillmentChannel: "delivery" as const,
      deliveryInstructions: "Portón lateral" }, repeatOrderPlan: null, selectionPlan: null };
  const confirmedRecord = { ...autosaveRecord, detail: { ...autosaveRecord.detail, status: "confirmed",
    attentionStatus: "unclaimed", ownerMembershipId: null, attentionLeaseId: null,
    attentionLeaseExpiresAt: null, confirmedOrderId: confirmCommand.orderId } };
  let persisted: { actorId: string; command: unknown; materialization: CaptureOrderMaterialization } | undefined;
  const service = new CaptureConfirmationService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), {
    createDraft: async () => ({}), readWorkspaceV4: async () => workspaceV4,
    readWorkspaceV5: async () => ({
      schemaVersion: 5, detail: workspaceV4.detail, customerSnapshot: workspaceV4.customerSnapshot,
      fulfillmentSnapshot: workspaceV4.fulfillmentSnapshot, repeatOrderPlan: null, selectionPlan: null,
      deliveryQuote: null, paymentIntent: null, paymentIntentAppliedCaptureVersion: null,
      paymentIntentBasisFingerprint: null,
    }),
  }, {
    probeConfirmation: async () => ({ status: "pending" }),
    readRepeatOrderPlan: async () => { throw new Error("must not read a repeat plan"); },
    readSelectionPlan: async () => { throw new Error("must not read a selection plan"); },
    confirmDraft: async (actorId, parsed, materialization) => {
      persisted = { actorId, command: parsed, materialization };
      return { status: "applied", record: confirmedRecord };
    },
  }, { read: async () => { throw new Error("must not read a catalog"); },
    save: async () => { throw new Error("must not save a catalog"); } });
  const result = await service.confirm(principal, confirmCommand);
  assert.equal(result.detail.confirmedOrderId, confirmCommand.orderId);
  assert.equal(persisted?.actorId, principal.actorId);
  assert.deepEqual(persisted?.command, confirmCommand);
  assert.equal(persisted?.materialization.order.channel, "delivery");
  assert.equal(persisted?.materialization.auditEvents[0]?.operation, "order.created");

  let queryCount = 0;
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    queryCount += 1;
    assert.equal(sql, queryCount === 1
      ? "select app_private.confirm_capture_draft_v3($1::uuid, $2::jsonb, null::jsonb, null::jsonb) as result"
      : "select app_private.confirm_capture_draft_v3($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb) as result");
    assert.equal(parameters[0], principal.actorId);
    assert.equal(parameters[1], JSON.stringify(confirmCommand));
    if (queryCount === 1) return { rows: [{ result: { status: "pending" } }] };
    assert.equal(JSON.parse(String(parameters[2])).channel, "delivery");
    assert.equal(JSON.parse(String(parameters[3]))[0].operation, "order.created");
    return { rows: [{ result: { status: "applied", record: confirmedRecord } }] };
  } });
  assert.deepEqual(await adapter.probeConfirmation(principal.actorId, confirmCommand), { status: "pending" });
  assert.deepEqual(await adapter.confirmDraft(principal.actorId, confirmCommand, persisted!.materialization), {
    status: "applied", record: confirmedRecord,
  });
  await assert.rejects(service.confirm(principal, { ...confirmCommand, tableId: validCommand.captureDraftId }), code("conflict"));
});

test("H10: a conflict with a delivery-quote reason maps to CaptureDeliveryQuoteInvalidError, not a generic conflict", async () => {
  const confirmCommand = parseConfirmCaptureDraftCommandV2({
    ...mutationCommand,
    schemaVersion: 2,
    expectedVersion: 2,
    attentionLeaseId: validCommand.deviceId,
    orderId: validCommand.deviceId,
    shiftId: record.detail.ownerMembershipId,
    tableId: null,
    currency: "MXN",
    timeZone: "America/Hermosillo",
  });
  assert.ok(confirmCommand);
  const workspaceV4 = { ...workspace, schemaVersion: 4 as const,
    detail: { ...fulfillmentRecord.detail, schemaVersion: 2 as const, fulfillmentChannel: "delivery" as const,
      deliveryInstructions: "Portón lateral" }, repeatOrderPlan: null, selectionPlan: null };
  for (const reason of ["delivery_quote_missing", "delivery_quote_expired", "delivery_quote_not_covered"] as const) {
    const service = new CaptureConfirmationService(new MembershipAuthorizationService({
      findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
    }), {
      createDraft: async () => ({}), readWorkspaceV4: async () => workspaceV4,
      // H29: confirm now fails closed (unavailable) if this V5 re-price read itself fails, so a
      // capture port exercising confirm's SQL-conflict paths must supply a benign, no-intent V5
      // read here (never exercised for pricing in this test) rather than omitting it.
      readWorkspaceV5: async () => ({
        schemaVersion: 5, detail: workspaceV4.detail, customerSnapshot: workspaceV4.customerSnapshot,
        fulfillmentSnapshot: workspaceV4.fulfillmentSnapshot, repeatOrderPlan: null, selectionPlan: null,
        deliveryQuote: null, paymentIntent: null, paymentIntentAppliedCaptureVersion: null,
        paymentIntentBasisFingerprint: null,
      }),
    }, {
      probeConfirmation: async () => ({ status: "pending" }),
      readRepeatOrderPlan: async () => { throw new Error("must not read a repeat plan"); },
      readSelectionPlan: async () => { throw new Error("must not read a selection plan"); },
      confirmDraft: async () => ({ status: "conflict", reason }),
    }, { read: async () => { throw new Error("must not read a catalog"); },
      save: async () => { throw new Error("must not save a catalog"); } });
    await assert.rejects(
      service.confirm(principal, confirmCommand),
      (error: unknown) => error instanceof CaptureDeliveryQuoteInvalidError && error.reason === reason,
    );
  }
});

test("H20: confirm refuses a payment intent with no pricing basis at all, exactly like a stale one", async () => {
  // Both plans cleared/absent and non-delivery: buildCapturePaymentProjectionForWorkspace can't
  // even establish a currency, so the read reports paymentProjection: null, not status "stale" --
  // but it is exactly as unconfirmable (SQL's own payment_intent_stale check, H16, would refuse
  // it too), so confirm's pre-check must block it rather than let it fall through as "nothing to
  // check".
  const confirmCommand = parseConfirmCaptureDraftCommandV2({
    ...mutationCommand,
    schemaVersion: 2,
    expectedVersion: 2,
    attentionLeaseId: validCommand.deviceId,
    orderId: validCommand.deviceId,
    shiftId: record.detail.ownerMembershipId,
    tableId: null,
    currency: "MXN",
    timeZone: "America/Hermosillo",
  });
  assert.ok(confirmCommand);
  const workspaceV4 = { ...workspace, schemaVersion: 4 as const,
    detail: { ...fulfillmentRecord.detail, schemaVersion: 2 as const, fulfillmentChannel: "counter" as const,
      customerSnapshotRef: null, fulfillmentSnapshotRef: null, deliveryInstructions: null },
    customerSnapshot: null, fulfillmentSnapshot: null, repeatOrderPlan: null, selectionPlan: null };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV4: async () => workspaceV4,
    readWorkspaceV5: async () => ({
      schemaVersion: 5,
      detail: workspaceV4.detail,
      customerSnapshot: null,
      fulfillmentSnapshot: null,
      repeatOrderPlan: null,
      selectionPlan: null,
      deliveryQuote: null,
      paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 9_000, tipMinor: 0 },
      paymentIntentAppliedCaptureVersion: 2,
      paymentIntentBasisFingerprint: "0".repeat(64),
    }),
  };
  const service = new CaptureConfirmationService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures, {
    probeConfirmation: async () => ({ status: "pending" }),
    readRepeatOrderPlan: async () => { throw new Error("must not read a repeat plan"); },
    readSelectionPlan: async () => { throw new Error("must not read a selection plan"); },
    confirmDraft: async () => { throw new Error("must not attempt a doomed confirm"); },
  }, { read: async () => { throw new Error("must not read a catalog"); },
    save: async () => { throw new Error("must not save a catalog"); } });
  await assert.rejects(
    service.confirm(principal, confirmCommand),
    (error: unknown) => error instanceof CapturePaymentIntentStaleError,
  );
});

test("H29: confirm fails closed as unavailable when the re-pricing V5 read itself fails, never SQL", async () => {
  // SQL's own CAS only compares versions, never recomputes the basis (a catalog price change
  // can't be caught there) -- this re-read is the only place that happens. If it fails outright,
  // confirm must never silently skip the check and call SQL with a possibly-insufficient intent.
  const confirmCommand = parseConfirmCaptureDraftCommandV2({
    ...mutationCommand,
    schemaVersion: 2,
    expectedVersion: 2,
    attentionLeaseId: validCommand.deviceId,
    orderId: validCommand.deviceId,
    shiftId: record.detail.ownerMembershipId,
    tableId: null,
    currency: "MXN",
    timeZone: "America/Hermosillo",
  });
  assert.ok(confirmCommand);
  const workspaceV4 = { ...workspace, schemaVersion: 4 as const,
    detail: { ...fulfillmentRecord.detail, schemaVersion: 2 as const, fulfillmentChannel: "counter" as const,
      customerSnapshotRef: null, fulfillmentSnapshotRef: null, deliveryInstructions: null },
    customerSnapshot: null, fulfillmentSnapshot: null, repeatOrderPlan: null, selectionPlan: null };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV4: async () => workspaceV4,
    readWorkspaceV5: async () => { throw new Error("simulated transient failure"); },
  };
  const service = new CaptureConfirmationService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures, {
    probeConfirmation: async () => ({ status: "pending" }),
    readRepeatOrderPlan: async () => { throw new Error("must not read a repeat plan"); },
    readSelectionPlan: async () => { throw new Error("must not read a selection plan"); },
    confirmDraft: async () => { throw new Error("must not attempt a doomed confirm"); },
  }, { read: async () => { throw new Error("must not read a catalog"); },
    save: async () => { throw new Error("must not save a catalog"); } });
  await assert.rejects(service.confirm(principal, confirmCommand), code("unavailable"));
});

const selectionCatalog: MenuCatalogV1 = {
  catalogVersion: "47f7f293-b155-42b9-bdc7-f9be3846f44e",
  currency: "MXN",
  replayed: false,
  updatedAt: "2026-09-24T11:59:00.000Z",
  updatedBy: principal.actorId,
  version: 3,
  categories: [{ categoryId: "a409ec59-9f5e-496d-a45d-b83a46b49674", name: "Comida", active: true, displayOrder: 0 }],
  products: [{
    productId: "ec5e7c30-edac-4b79-bf8c-e363b041c59f",
    categoryId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
    name: "Tacos vigentes", sku: "TACO-1", active: true, displayOrder: 0,
    stationId: "hot", unit: "piece", unitPriceMinor: 4_500, tax: null, imagePath: null,
  }],
  modifierGroups: [],
};
const selectionPlanCommand = parseReplaceCaptureSelectionPlanCommandV1({
  schemaVersion: 1,
  scope: validCommand.scope,
  captureDraftId: validCommand.captureDraftId,
  expectedVersion: 1,
  attentionLeaseId: validCommand.deviceId,
  eventId: "0438d8ac-a86d-4f5b-8b26-1a35f9d82a39",
  idempotencyKey: "0e22dfd1-9064-4fa8-86da-8fcce41fe821",
  deviceId: validCommand.deviceId,
  occurredAt: "2026-09-24T12:00:00.000Z",
  plan: {
    schemaVersion: 1,
    catalogVersion: selectionCatalog.catalogVersion,
    lines: [{
      lineId: "60a26e69-3ea6-4ef8-8a2b-ad43ba0a0da1",
      productId: selectionCatalog.products[0]!.productId,
      variantId: null,
      quantity: 2,
      modifierGroups: [],
      note: null,
    }],
  },
});
assert.ok(selectionPlanCommand);

const noConfirmationPort: CaptureConfirmationPort = {
  probeConfirmation: async () => { throw new Error("must not probe confirmation"); },
  readRepeatOrderPlan: async () => { throw new Error("must not read repeat order plan"); },
  readSelectionPlan: async () => { throw new Error("must not read selection plan"); },
  confirmDraft: async () => { throw new Error("must not confirm"); },
};

test("capture selection plan prices every line against the live catalog before persisting", async () => {
  const workspaceV4Record = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 2, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
  };
  let persistedCommand: unknown;
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "pending" }),
    replaceSelectionPlan: async (actorId, submittedCommand) => {
      assert.equal(actorId, principal.actorId);
      persistedCommand = submittedCommand;
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => workspaceV4Record,
  };
  const storedPlanConfirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({ status: "ok", plan: selectionPlanCommand.plan, appliedCaptureVersion: 2 }),
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, storedPlanConfirmation);
  const result = await service.replace(principal, selectionPlanCommand);
  assert.deepEqual(persistedCommand, selectionPlanCommand);
  assert.equal(result.selectionPlan?.lineCount, 1);
  assert.equal(result.selectionProjection?.subtotalMinor, 9_000);
  assert.equal(result.selectionProjection?.lines[0]?.productName, "Tacos vigentes");
  assert.equal(result.selectionProjection?.lines[0]?.unitPriceMinor, 4_500);

  await assert.rejects(new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, {
    read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: { ...selectionCatalog, catalogVersion: validCommand.deviceId } }),
    save: async () => { throw new Error("must not save a catalog"); },
  }, noConfirmationPort).replace(principal, selectionPlanCommand), code("conflict"));

  await assert.rejects(new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["viewer"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => { throw new Error("must not read"); },
    save: async () => { throw new Error("must not save"); } }, noConfirmationPort).replace(principal, selectionPlanCommand), code("authorization"));

  const variantCommand = parseReplaceCaptureSelectionPlanCommandV1({
    ...selectionPlanCommand,
    plan: { ...selectionPlanCommand.plan, lines: [{ ...selectionPlanCommand.plan.lines[0]!, variantId: selectionCatalog.products[0]!.productId }] },
  });
  assert.ok(variantCommand);
  await assert.rejects(new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, noConfirmationPort).replace(principal, variantCommand), code("conflict"));
});

const halvesProductId = "ec5e7c30-edac-4b79-bf8c-e363b041c59f";
const halvesVariantId = "7b2e3d4f-5061-4b72-9c83-a4b5c6d7e8f9";
const halvesFlavorGroup = "8c3f4e50-6172-4c83-8d94-b5c6d7e8f900";
const halvesExtraGroup = "8c3f4e50-6172-4c83-8d94-b5c6d7e8f901";
const halvesFlavorA = "9d405f61-7283-4d94-9ea5-c6d7e8f90a10";
const halvesFlavorB = "9d405f61-7283-4d94-9ea5-c6d7e8f90a11";
const halvesFlavorOff = "9d405f61-7283-4d94-9ea5-c6d7e8f90a12";
const halvesExtra = "9d405f61-7283-4d94-9ea5-c6d7e8f90a13";
const halvesCatalog: MenuCatalogV1 = {
  ...selectionCatalog,
  modifierGroups: [
    {
      active: true, displayOrder: 0, groupId: halvesFlavorGroup, maximumQuantity: 2, minimumQuantity: 0, name: "Sabor", productId: halvesProductId,
      options: [
        { active: true, imagePath: null, maximumQuantity: null, name: "Pepperoni", optionId: halvesFlavorA, unitPriceMinor: 0 },
        { active: true, imagePath: null, maximumQuantity: null, name: "Hawaiana", optionId: halvesFlavorB, unitPriceMinor: 17_000 },
        { active: false, imagePath: null, maximumQuantity: null, name: "Agotada", optionId: halvesFlavorOff, unitPriceMinor: 19_000 },
      ],
    },
    {
      active: true, displayOrder: 1, groupId: halvesExtraGroup, maximumQuantity: 5, minimumQuantity: 0, name: "Extras", productId: halvesProductId,
      options: [{ active: true, imagePath: null, maximumQuantity: null, name: "Queso extra", optionId: halvesExtra, unitPriceMinor: 2_501 }],
    },
  ],
  products: [{
    ...selectionCatalog.products[0]!,
    variants: [{
      active: true, displayOrder: 0, name: "Grande", sku: null, unitPriceMinor: 15_000, variantId: halvesVariantId,
      fraction: { enabled: true, excludableIngredientIds: ["cebolla"], extraGroupId: halvesExtraGroup, flavorGroupId: halvesFlavorGroup },
    }],
  }],
};

function halvesPlanCommand(flavorB: string, extrasA: string[] = [], excludedA: string[] = []) {
  const command = parseReplaceCaptureSelectionPlanCommandV1({
    ...selectionPlanCommand!,
    plan: {
      ...selectionPlanCommand!.plan,
      lines: [{
        ...selectionPlanCommand!.plan.lines[0]!,
        quantity: 2,
        variantId: halvesVariantId,
        fraction: {
          geometry: "halves",
          slots: [
            { excludedIngredientIds: excludedA, extraOptionIds: extrasA, flavorOptionId: halvesFlavorA, fraction: "half-a" },
            { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: flavorB, fraction: "half-b" },
          ],
        },
      }],
    },
  });
  assert.ok(command);
  return command;
}

test("capture selection plan prices a halves line at the greater flavor plus half-priced extras, or answers 409", async () => {
  const workspaceRecord = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 2, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion, appliedCaptureVersion: 2, lineCount: 1 },
  };
  let persisted = 0;
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "pending" }),
    replaceSelectionPlan: async () => {
      persisted += 1;
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => workspaceRecord,
  };
  const serviceFor = (command: ReturnType<typeof halvesPlanCommand>) => new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, {
    read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: halvesCatalog }),
    save: async () => { throw new Error("must not save a catalog"); },
  }, { ...noConfirmationPort, readSelectionPlan: async () => ({ status: "ok", plan: command.plan, appliedCaptureVersion: 2 }) });

  const priced = halvesPlanCommand(halvesFlavorB, [halvesExtra], ["cebolla"]);
  const result = await serviceFor(priced).replace(principal, priced);
  const line = result.selectionProjection?.lines[0];
  // greater half 17_000 + one extra on half A at 50 % rounded up (2_501 -> 1_251) = 18_251 per unit.
  assert.equal(line?.unitPriceMinor, 17_000);
  assert.equal(line?.lineTotalMinor, 2 * (17_000 + 1_251));
  assert.equal(result.selectionProjection?.subtotalMinor, 2 * (17_000 + 1_251));
  assert.deepEqual(line?.halves?.map((half) => [half.fraction, half.flavorName, half.amountMinor, half.extras, half.exclusions]), [
    ["half-a", "Pepperoni", 15_000, ["Queso extra"], ["cebolla"]],
    ["half-b", "Hawaiana", 17_000, [], []],
  ]);
  assert.deepEqual(line?.modifiers, []);
  assert.equal(persisted, 1);

  for (const bad of [halvesPlanCommand(halvesFlavorOff), halvesPlanCommand(halvesExtra), halvesPlanCommand(halvesFlavorB, [], ["jamon"])]) {
    await assert.rejects(serviceFor(bad).replace(principal, bad), code("conflict"));
  }
  assert.equal(persisted, 1);
});

test("capture selection plan applied write accepts a follow-up read whose version advanced further still", async () => {
  // The write's own result proves the draft reached expectedVersion+1 (version 2); a second
  // connection then advances the draft to version 4 (an unrelated mutation) before the
  // separate readWorkspaceV4 call following this write observes it. The response must still
  // be 200 with the fresher version, never unavailable for failing an exact-match comparison.
  const advancedAfterWriteRecord = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 4, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
  };
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "pending" }),
    replaceSelectionPlan: async () => ({ status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } }),
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => advancedAfterWriteRecord,
  };
  const storedPlanConfirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({ status: "ok", plan: selectionPlanCommand.plan, appliedCaptureVersion: 2 }),
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, storedPlanConfirmation);
  const result = await service.replace(principal, selectionPlanCommand);
  assert.equal(result.detail.version, 4);
  assert.equal(result.selectionPlan?.lineCount, 1);
  assert.equal(result.selectionProjection?.subtotalMinor, 9_000);

  // But the write's OWN result never lies: if it claims a version other than expectedVersion+1,
  // that is not a race to tolerate, it is an inconsistent write result.
  await assert.rejects(new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), {
    probeReplaceSelectionPlan: async () => ({ status: "pending" }),
    replaceSelectionPlan: async () => ({ status: "applied", record: { ...record, detail: { ...record.detail, version: 3 } } }),
  }, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, noConfirmationPort)
    .replace(principal, selectionPlanCommand), code("unavailable"));

  // And a follow-up read that is STALE (behind the write's own proven version) is still rejected.
  await assert.rejects(new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => ({ ...advancedAfterWriteRecord, detail: { ...advancedAfterWriteRecord.detail, version: 1 } }),
  }, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, noConfirmationPort)
    .replace(principal, selectionPlanCommand), code("unavailable"));
});

test("capture selection plan with zero lines is treated as no plan, never priced or persisted with an empty line array", async () => {
  const emptyCommand = parseReplaceCaptureSelectionPlanCommandV1({
    ...selectionPlanCommand,
    plan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion, lines: [] },
  });
  assert.ok(emptyCommand);
  const noPlanWorkspaceV4Record = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 2, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: null,
  };
  let persistedPlan: unknown;
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "pending" }),
    replaceSelectionPlan: async (_actorId, submittedCommand) => {
      persistedPlan = submittedCommand.plan;
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => noPlanWorkspaceV4Record,
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, {
    read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); },
  }, noConfirmationPort);
  const result = await service.replace(principal, emptyCommand);
  assert.deepEqual(persistedPlan, { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion, lines: [] });
  assert.equal(result.selectionPlan, null);
  assert.equal(result.selectionProjection, null);
});

test("capture selection plan with a line note prices and persists it, carrying the note into the projection", async () => {
  const notedCommand = parseReplaceCaptureSelectionPlanCommandV1({
    ...selectionPlanCommand,
    plan: { ...selectionPlanCommand.plan, lines: [{ ...selectionPlanCommand.plan.lines[0]!, note: "Sin cilantro" }] },
  });
  assert.ok(notedCommand);
  const workspaceV4Record = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 2, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
  };
  let persistedCommand: unknown;
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "pending" }),
    replaceSelectionPlan: async (_actorId, submittedCommand) => {
      persistedCommand = submittedCommand;
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => workspaceV4Record,
  };
  const storedPlanConfirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({ status: "ok", plan: notedCommand.plan, appliedCaptureVersion: 2 }),
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, storedPlanConfirmation);
  const result = await service.replace(principal, notedCommand);
  assert.deepEqual(persistedCommand, notedCommand);
  assert.equal(result.selectionProjection?.lines[0]?.note, "Sin cilantro");
});

test("capture selection plan replay returns the stored result even after a later, unrelated mutation", async () => {
  const advancedWorkspaceV4Record = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    // The draft moved to version 5 through some other mutation after this idempotency key was
    // first applied at version 2; the replay must not be rejected for failing to match version 2.
    detail: { ...record.detail, schemaVersion: 2 as const, version: 5, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
  };
  const persistence: CaptureSelectionPlanPort = {
    // The probe alone recognizes the replay; the real write must never be attempted for it.
    probeReplaceSelectionPlan: async () => ({ status: "replayed", record: advancedWorkspaceV4Record.detail }),
    replaceSelectionPlan: async () => { throw new Error("must not attempt a real write for a replay"); },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => advancedWorkspaceV4Record,
  };
  // On replay, the projection must come from whatever is actually stored, never from the
  // client-echoed command; this stub proves it by returning a *different* (still-consistent)
  // line than selectionPlanCommand's, and asserting the response reflects THIS one.
  const storedReplayPlan = {
    schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
    lines: [{
      lineId: "0d3f6d0d-7d9a-4f8e-9b1a-1e6c8f9a2b3c",
      productId: selectionCatalog.products[0]!.productId,
      variantId: null, quantity: 3, modifierGroups: [], note: null,
    }],
  };
  const confirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({ status: "ok", plan: storedReplayPlan, appliedCaptureVersion: 2 }),
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, confirmation);
  const result = await service.replace(principal, selectionPlanCommand);
  assert.equal(result.detail.version, 5);
  assert.equal(result.selectionPlan?.lineCount, 1);
  // Priced from storedReplayPlan's quantity 3, not selectionPlanCommand's quantity 2.
  assert.equal(result.selectionProjection?.subtotalMinor, 13_500);
  assert.equal(result.selectionProjection?.lines[0]?.quantity, 3);
});

test("capture selection plan replay never 503s, even when the catalog changed since the original apply", async () => {
  const replayedRecord = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 2, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
  };
  const persistence: CaptureSelectionPlanPort = {
    // The probe answers purely from the idempotency key: it must never even attempt to read
    // the catalog or price the plan, so a changed/unpublished catalog cannot reject a replay.
    probeReplaceSelectionPlan: async () => ({ status: "replayed", record: replayedRecord.detail }),
    replaceSelectionPlan: async () => { throw new Error("must not attempt a real write for a replay"); },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => replayedRecord,
  };
  const confirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({
      status: "ok",
      plan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion, lines: [{
        lineId: "60a26e69-3ea6-4ef8-8a2b-ad43ba0a0da1", productId: selectionCatalog.products[0]!.productId,
        variantId: null, quantity: 2, modifierGroups: [], note: null,
      }] },
      appliedCaptureVersion: 2,
    }),
  };
  // The live catalog has since republished under a different catalogVersion (the stored plan's
  // catalog no longer exists) -- this must yield selectionProjection: null, never a rejection.
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, {
    read: async () => ({
      schemaVersion: 1, scope: validCommand.scope,
      catalog: { ...selectionCatalog, catalogVersion: validCommand.deviceId, products: [] },
    }),
    save: async () => { throw new Error("must not save a catalog"); },
  }, confirmation);
  const result = await service.replace(principal, selectionPlanCommand);
  assert.equal(result.detail.version, 2);
  assert.equal(result.selectionPlan?.lineCount, 1);
  assert.equal(result.selectionProjection, null);
});

test("capture selection plan projection is null when the live catalog moved to a different catalogVersion, even with the same product ids", async () => {
  // The stored plan was priced against catalogVersion A; a republish moved the head to
  // catalogVersion B with the SAME product id but a DIFFERENT unitPriceMinor. Pricing against B
  // anyway would silently return the wrong price under A's identity -- it must instead be null.
  const republishedCatalog: MenuCatalogV1 = {
    ...selectionCatalog,
    catalogVersion: "5b6a1e3a-df1a-4a34-9a52-9a9a6a2c9b10",
    products: [{ ...selectionCatalog.products[0]!, unitPriceMinor: 9_900 }],
  };
  const replayedRecord = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 2, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
  };
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "replayed", record: replayedRecord.detail }),
    replaceSelectionPlan: async () => { throw new Error("must not attempt a real write for a replay"); },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => replayedRecord,
  };
  const confirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({ status: "ok", plan: selectionPlanCommand.plan, appliedCaptureVersion: 2 }),
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, {
    read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: republishedCatalog }),
    save: async () => { throw new Error("must not save a catalog"); },
  }, confirmation);
  const result = await service.replace(principal, selectionPlanCommand);
  assert.equal(result.selectionPlan?.lineCount, 1);
  assert.equal(result.selectionProjection, null);
});

test("capture selection plan applied write projects whatever is actually stored, not the submitted command", async () => {
  // Between the write committing and the follow-up workspace read, a second write races in and
  // wins: the stored plan now has quantity 5, not this command's quantity 2. The projection in
  // the response must reflect the STORED plan, never a stale echo of the just-submitted one.
  const racedWorkspaceV4Record = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 3, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 3, lineCount: 1 },
  };
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "pending" }),
    replaceSelectionPlan: async () => ({ status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } }),
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => racedWorkspaceV4Record,
  };
  const racedStoredPlan = {
    schemaVersion: 1 as const, catalogVersion: selectionCatalog.catalogVersion,
    lines: [{
      lineId: "6c7a2c23-6f6a-4f1a-9c3e-8a2b5e9f7d40", productId: selectionCatalog.products[0]!.productId,
      variantId: null, quantity: 5, modifierGroups: [], note: null,
    }],
  };
  const confirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({ status: "ok", plan: racedStoredPlan, appliedCaptureVersion: 3 }),
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, confirmation);
  const result = await service.replace(principal, selectionPlanCommand);
  assert.equal(result.selectionPlan?.lineCount, 1);
  // 5 * 4_500, not selectionPlanCommand's quantity 2.
  assert.equal(result.selectionProjection?.subtotalMinor, 22_500);
  assert.equal(result.selectionProjection?.lines[0]?.quantity, 5);
});

test("capture selection plan replace responds CaptureWorkspaceV5 and marks an existing payment intent stale", async () => {
  // H1: selection-plan must respond V5 (not V4) so the web rehydration -- which only ever parses
  // V5 -- stops rejecting it as unavailable; and since the lines just changed, any previously
  // fixed payment intent's paymentProjection must recompute to "stale" here too, exactly like
  // every other capture mutation's response.
  const v5Record = {
    schemaVersion: 5,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 2, fulfillmentChannel: "counter" as const,
      deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
    deliveryQuote: null,
    paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 100_000, tipMinor: 0 },
    paymentIntentAppliedCaptureVersion: 1,
    paymentIntentBasisFingerprint: "a".repeat(64),
  };
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "pending" }),
    replaceSelectionPlan: async () => ({ status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } }),
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => v5Record,
  };
  const storedPlanConfirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({ status: "ok", plan: selectionPlanCommand.plan, appliedCaptureVersion: 2 }),
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, storedPlanConfirmation);
  const result = await service.replace(principal, selectionPlanCommand);
  assert.equal(result.schemaVersion, 5);
  assert.equal(result.selectionPlan?.lineCount, 1);
  assert.equal(result.paymentIntent?.method, "cash");
  assert.equal(result.paymentProjection?.status, "stale");
});

test("capture selection plan projection is null when the plan read has an appliedCaptureVersion different from the workspace summary", async () => {
  // Same catalogVersion, same lineCount as the workspace's selectionPlan summary -- but a THIRD
  // write raced in between readWorkspaceV4 and readSelectionPlan, replacing the row with another
  // plan that happens to share both. appliedCaptureVersion is the only proof it is the SAME row;
  // a mismatch there must yield null, never price whatever this unrelated plan turns out to be.
  const workspaceV4Record = {
    schemaVersion: 5,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
    detail: { ...record.detail, schemaVersion: 2 as const, version: 2, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
  };
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => ({ status: "replayed", record: workspaceV4Record.detail }),
    replaceSelectionPlan: async () => { throw new Error("must not attempt a real write for a replay"); },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => workspaceV4Record,
  };
  const confirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    // Same catalogVersion, same lineCount as the summary -- but appliedCaptureVersion is 4, not 2.
    readSelectionPlan: async () => ({ status: "ok", plan: selectionPlanCommand.plan, appliedCaptureVersion: 4 }),
  };
  const service = new CaptureSelectionPlanService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, { read: async () => ({ schemaVersion: 1, scope: validCommand.scope, catalog: selectionCatalog }),
    save: async () => { throw new Error("must not save a catalog"); } }, confirmation);
  const result = await service.replace(principal, selectionPlanCommand);
  assert.equal(result.selectionPlan?.lineCount, 1);
  assert.equal(result.selectionProjection, null);
});

const trayCatalogUnused = { read: async () => { throw new Error("must not read a catalog"); },
  save: async () => { throw new Error("must not save a catalog"); } };
test("capture tray authorizes, binds scope and rejects hostile persistence", async () => {
  const request = parseCaptureWorkTrayRequestV1({ schemaVersion: 1, scope: validCommand.scope, limit: 20 });
  assert.ok(request);
  const summary = {
    schemaVersion: 1 as const,
    scope: record.detail.scope,
    captureDraftId: record.detail.captureDraftId,
    folio: record.detail.folio,
    sourceChannel: record.detail.sourceChannel,
    fulfillmentChannel: record.detail.fulfillmentChannel,
    status: record.detail.status,
    attentionStatus: record.detail.attentionStatus,
    ownerMembershipId: record.detail.ownerMembershipId,
    version: record.detail.version,
    updatedAt: record.detail.updatedAt,
  };
  const service = new CaptureTrayService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), { list: async () => ({ schemaVersion: 1, items: [summary] }) }, trayCatalogUnused);
  assert.equal((await service.list(principal, request)).items.length, 1);
  await assert.rejects(service.list(principal, { ...request, limit: 51 }), code("request"));
  await assert.rejects(new CaptureTrayService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["viewer"], scope: validCommand.scope }),
  }), { list: async () => ({}) }, trayCatalogUnused).list(principal, request), code("authorization"));
  await assert.rejects(new CaptureTrayService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), { list: async () => ({ schemaVersion: 1, items: [{ ...summary, scope: { ...summary.scope, branchId: validCommand.deviceId } }] }) }, trayCatalogUnused)
    .list(principal, request), code("unavailable"));
  const calls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: { schemaVersion: 1, items: [summary] } }] };
  } });
  assert.deepEqual(await adapter.list(principal.actorId, request), { schemaVersion: 1, items: [summary] });
  assert.deepEqual(calls, [{ sql: "select app_private.list_capture_work_tray($1::uuid, $2::jsonb) as result",
    parameters: [principal.actorId, JSON.stringify(request)] }]);
  await assert.rejects(adapter.list("forged-actor", request), code("request"));
  assert.equal(calls.length, 1);
});

const trayV2Scope = validCommand.scope;
const trayV2Raw = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, scope: trayV2Scope, captureDraftId: record.detail.captureDraftId, folio: record.detail.folio,
  sourceChannel: "phone", fulfillmentChannel: "pickup", status: "draft", attentionStatus: "claimed",
  ownerMembershipId: record.detail.ownerMembershipId, version: 2, updatedAt: "2026-10-03T12:00:00.000Z",
  attentionLeaseExpiresAt: "2026-10-03T12:05:00.000Z",
  customer: { displayName: "Ana Perez", phone: "+52 662 123 4567" },
  selectionPlan: selectionPlanCommand.plan, ...extra,
});
const trayV2Request = { schemaVersion: 2, scope: trayV2Scope, limit: 20 };
const stubAuth = (roles: readonly string[]) => ({
  authorizeBranch: async () => ({ principal, roles }),
}) as unknown as MembershipAuthorizationService;
const liveCatalog = { read: async () => ({ schemaVersion: 1 as const, scope: trayV2Scope, catalog: selectionCatalog }),
  save: async () => { throw new Error("must not save a catalog"); } };

test("capture tray V2 adds customer and a server-priced total, reducing PII and money by role", async () => {
  const port = { list: async () => ({}), listV2: async () => ({ schemaVersion: 2, items: [
    trayV2Raw(), trayV2Raw({ captureDraftId: validCommand.deviceId, selectionPlan: null, customer: null })] }) };
  const full = await new CaptureTrayService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: trayV2Scope }),
  }), port, liveCatalog).list(principal, trayV2Request);
  assert.equal(full.schemaVersion, 2);
  const [priced, unpriced] = full.items as readonly { totalMinor: number | null; currency: string | null; customer: unknown }[];
  assert.equal(priced!.totalMinor, 9_000);
  assert.equal(priced!.currency, "MXN");
  assert.deepEqual(priced!.customer, { displayName: "Ana Perez", phone: "+52 662 123 4567" });
  assert.equal(unpriced!.totalMinor, null);
  assert.equal(unpriced!.customer, null);
  // Without customers.read the customer is withheld by the server, the total stays.
  const noPii = await new CaptureTrayService(stubAuth(["viewer"]), port, liveCatalog).list(principal, trayV2Request);
  assert.equal((noPii.items[0] as unknown as { customer: unknown }).customer, null);
  assert.equal((noPii.items[0] as unknown as { totalMinor: number }).totalMinor, 9_000);
  // Without catalog.read the catalog is never read and no total is returned.
  const noMoney = await new CaptureTrayService(stubAuth(["kitchen"]), port, trayCatalogUnused).list(principal, trayV2Request);
  assert.equal((noMoney.items[0] as unknown as { totalMinor: unknown }).totalMinor, null);
  assert.equal((noMoney.items[0] as unknown as { customer: unknown }).customer, null);
  // Stale catalogVersion -> null total, never a failure.
  const stale = await new CaptureTrayService(stubAuth(["cashier"]), port, { ...liveCatalog,
    read: async () => ({ schemaVersion: 1 as const, scope: trayV2Scope, catalog: { ...selectionCatalog, catalogVersion: validCommand.deviceId } }) })
    .list(principal, trayV2Request);
  assert.equal((stale.items[0] as unknown as { totalMinor: unknown }).totalMinor, null);
  // A V1 request keeps using the V1 reader.
  let v1Calls = 0;
  await new CaptureTrayService(stubAuth(["cashier"]), { list: async () => { v1Calls++; return { schemaVersion: 1, items: [] }; },
    listV2: async () => { throw new Error("must not use V2"); } }, trayCatalogUnused)
    .list(principal, { schemaVersion: 1, scope: trayV2Scope, limit: 20 });
  assert.equal(v1Calls, 1);
});

test("capture tray V2 rejects hostile persistence and binds the branch scope", async () => {
  const build = (raw: unknown, withV2 = true) => new CaptureTrayService(stubAuth(["cashier"]),
    withV2 ? { list: async () => ({}), listV2: async () => raw } : { list: async () => ({}) }, liveCatalog);
  await assert.rejects(build({}, false).list(principal, trayV2Request), code("unavailable"));
  await assert.rejects(build({ status: "denied" }).list(principal, trayV2Request), code("authorization"));
  await assert.rejects(build({ schemaVersion: 2, items: [trayV2Raw({ scope: { ...trayV2Scope, branchId: validCommand.deviceId } })] })
    .list(principal, trayV2Request), code("unavailable"));
  await assert.rejects(build({ schemaVersion: 2, items: [trayV2Raw({ leaseId: validCommand.deviceId })] })
    .list(principal, trayV2Request), code("unavailable"));
  await assert.rejects(build({ schemaVersion: 2, items: [trayV2Raw({ status: "confirmed" })] })
    .list(principal, trayV2Request), code("unavailable"));
  const calls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: { schemaVersion: 2, items: [] } }] };
  } });
  const parsed = parseCaptureWorkTrayRequestV2(trayV2Request);
  assert.ok(parsed);
  await adapter.listV2(principal.actorId, parsed);
  assert.deepEqual(calls, [{ sql: "select app_private.list_capture_work_tray_v2($1::uuid, $2::jsonb) as result",
    parameters: [principal.actorId, JSON.stringify(parsed)] }]);
  await assert.rejects(adapter.listV2("forged-actor", parsed), code("request"));
});

test("capture lease renewal is scoped, idempotent and reports a lease taken by another station", async () => {
  const leaseCommand = { schemaVersion: 1, scope: trayV2Scope, captureDraftId: validCommand.captureDraftId,
    attentionLeaseId: validCommand.deviceId };
  const renewed = { schemaVersion: 1, captureDraftId: validCommand.captureDraftId, attentionLeaseId: validCommand.deviceId,
    attentionLeaseExpiresAt: "2026-10-03T12:10:00.000Z", version: 2 };
  let outcome: unknown = { status: "applied", record: renewed };
  const calls: unknown[] = [];
  const service = (roles: readonly MembershipRoleCode[]) => new CaptureAttentionService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles, scope: trayV2Scope }),
  }), { mutateAttention: async () => { throw new Error("must not mutate"); },
    renewLease: async (actor: string, command: unknown) => { calls.push({ actor, command }); return outcome; } });
  assert.deepEqual(await service(["cashier"]).renewLease(principal, leaseCommand), renewed);
  assert.deepEqual(await service(["cashier"]).renewLease(principal, leaseCommand), renewed);
  assert.equal(calls.length, 2);
  outcome = { status: "conflict", reason: "taken" };
  await assert.rejects(service(["cashier"]).renewLease(principal, leaseCommand), (error) => error instanceof CaptureLeaseTakenError);
  outcome = { status: "conflict", reason: "not_active" };
  await assert.rejects(service(["cashier"]).renewLease(principal, leaseCommand), code("conflict"));
  outcome = { status: "denied" };
  await assert.rejects(service(["cashier"]).renewLease(principal, leaseCommand), code("authorization"));
  outcome = { status: "missing" };
  await assert.rejects(service(["cashier"]).renewLease(principal, leaseCommand), code("missing"));
  outcome = { status: "applied", record: { ...renewed, attentionLeaseId: validCommand.eventId } };
  await assert.rejects(service(["cashier"]).renewLease(principal, leaseCommand), code("unavailable"));
  const before = calls.length;
  await assert.rejects(service(["viewer"]).renewLease(principal, leaseCommand), code("authorization"));
  await assert.rejects(service(["cashier"]).renewLease(principal, { ...leaseCommand, expectedVersion: 1 }), code("request"));
  assert.equal(calls.length, before);
  const sqlCalls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    sqlCalls.push({ sql, parameters }); return { rows: [{ result: { status: "denied" } }] };
  } });
  const parsedCommand = parseRenewCaptureLeaseCommandV1(leaseCommand);
  assert.ok(parsedCommand);
  await adapter.renewLease(principal.actorId, parsedCommand);
  assert.deepEqual(sqlCalls, [{ sql: "select app_private.renew_capture_lease($1::uuid, $2::jsonb) as result",
    parameters: [principal.actorId, JSON.stringify(parsedCommand)] }]);
});

test("capture assignment directory is privileged, exact-scope and parameterized", async () => {
  const request = { schemaVersion: 1 as const, scope: validCommand.scope };
  const directory = { schemaVersion: 1 as const, scope: validCommand.scope, candidates: [{
    schemaVersion: 1 as const, membershipId: targetMembershipId, displayLabel: "caja@example.com",
    roles: ["cashier" as const],
  }] };
  const service = new CaptureAssignmentDirectoryService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["supervisor"], scope: validCommand.scope }),
  }), { listAssignmentCandidates: async () => directory });
  assert.equal((await service.list(principal, request)).candidates[0]?.membershipId, targetMembershipId);
  await assert.rejects(service.list(principal, { ...request, actorId: principal.actorId }), code("request"));
  await assert.rejects(new CaptureAssignmentDirectoryService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), { listAssignmentCandidates: async () => directory }).list(principal, request), code("authorization"));
  await assert.rejects(new CaptureAssignmentDirectoryService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["supervisor"], scope: validCommand.scope }),
  }), { listAssignmentCandidates: async () => ({ ...directory, scope: { ...directory.scope,
    branchId: validCommand.deviceId } }) }).list(principal, request), code("unavailable"));
  const calls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: directory }] };
  } });
  assert.deepEqual(await adapter.listAssignmentCandidates(principal.actorId, request), directory);
  assert.deepEqual(calls, [{ sql: "select app_private.list_capture_assignment_candidates($1::uuid, $2::jsonb) as result",
    parameters: [principal.actorId, JSON.stringify(request)] }]);
});

test("capture HTTP boundary enforces auth and translates request, replay, denial, conflict and failure safely", async () => {
  let authorizationRoles: readonly MembershipRoleCode[] = ["cashier"];
  let customerOutcome: unknown = { status: "applied", record: customerRecord };
  let fulfillmentOutcome: unknown = { status: "applied", record: fulfillmentRecord };
  let calls = 0;
  let outcome: unknown = { status: "applied", record };
  let autosaveOutcome: unknown = { status: "applied", record: autosaveRecord };
  let workspaceOutcome: unknown = workspace;
  let continuityFail = false;
  let fail = false;
  let attentionOutcome: unknown = { status: "applied", record: heldRecord };
  const module = await Test.createTestingModule({ controllers: [CapturesController], providers: [
    CaptureService,
    CaptureAttentionService,
    CaptureCustomerService,
    CaptureFulfillmentService,
    CaptureDeliveryInstructionsService,
    CaptureConfirmationService,
    CaptureSelectionPlanService,
    CaptureDeliveryQuoteService,
    CapturePaymentIntentService,
    CaptureTrayService,
    CaptureAssignmentDirectoryService,
    CaptureNoSaleService,
    { provide: CAPTURE_DELIVERY_QUOTE_PORT, useValue: {
      setCaptureDeliveryQuote: async () => { throw new Error("must not set delivery quote"); } } },
    { provide: CAPTURE_DELIVERY_QUOTE_COMPUTATION_PORT, useValue: {
      quoteForCapture: async () => { throw new Error("must not quote for capture"); } } },
    { provide: CAPTURE_PAYMENT_INTENT_PORT, useValue: {
      setCapturePaymentIntent: async () => { throw new Error("must not set payment intent"); } } },
    { provide: CAPTURE_NO_SALE_PORT, useValue: { closeNoSale: async () => { throw new Error("must not close no-sale"); } } },
    { provide: CAPTURE_CUSTOMER_PORT, useValue: { setCustomer: async () => customerOutcome } },
    { provide: CAPTURE_FULFILLMENT_PORT, useValue: { setFulfillment: async () => fulfillmentOutcome } },
    { provide: CAPTURE_DELIVERY_INSTRUCTIONS_PORT, useValue: {
      listDeliveryInstructionSuggestions: async () => ({ schemaVersion: 1,
        captureDraftId: validCommand.captureDraftId, items: [] }),
      setDeliveryInstructions: async () => ({
      status: "applied", record: autosaveRecord, deliveryInstructions: "Portón lateral",
    }) } },
    { provide: CAPTURE_CONFIRMATION_PORT, useValue: {
      probeConfirmation: async () => ({ status: "conflict" }),
      readRepeatOrderPlan: async () => ({ status: "missing" }),
      readSelectionPlan: async () => ({ status: "missing" }),
      confirmDraft: async () => ({ status: "conflict" }),
    } },
    { provide: CAPTURE_SELECTION_PLAN_PORT, useValue: {
      replaceSelectionPlan: async () => ({ status: "conflict" }),
    } },
    { provide: MENU_CATALOG_PORT, useValue: {
      read: async () => "forbidden",
      save: async () => ({ status: "forbidden" }),
    } },
    { provide: CAPTURE_TRAY_PORT, useValue: { list: async () => ({ schemaVersion: 1, items: [] }) } },
    { provide: CAPTURE_ASSIGNMENT_DIRECTORY_PORT, useValue: { listAssignmentCandidates: async () => ({
      schemaVersion: 1, scope: validCommand.scope, candidates: [{ schemaVersion: 1,
        membershipId: targetMembershipId, displayLabel: "caja@example.com", roles: ["cashier"] }],
    }) } },
    { provide: MembershipAuthorizationService, useValue: new MembershipAuthorizationService({
      findActiveMembership: async () => ({ roles: authorizationRoles, scope: validCommand.scope }),
    }) },
    { provide: CAPTURE_CREATION_PORT, useValue: { createDraft: async (actor: string) => {
      assert.equal(actor, principal.actorId); calls++; if (fail) throw new Error("server-password"); return outcome;
    }, autosaveDraft: async () => { if (continuityFail) throw new Error("private"); return autosaveOutcome; },
    readWorkspace: async () => { if (continuityFail) throw new Error("private"); return workspaceOutcome; } } },
    { provide: CAPTURE_ATTENTION_PORT, useValue: { mutateAttention: async (actor: string) => {
      assert.equal(actor, principal.actorId); return attentionOutcome;
    } } },
    { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
  ] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/api/v1/captures`;
  const send = (body: unknown, authenticated = true) => fetch(url, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer test-capture-access-token" } : {}) } });
  try {
    assert.equal((await send(validCommand, false)).status, 401);
    assert.equal((await send({ ...validCommand, actorId: principal.actorId })).status, 400);
    assert.equal(calls, 0);
    const created = await send(validCommand);
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await created.json(), { schemaVersion: 1, detail: record.detail, replayed: false });
    const trayUrl = `${url}/tray`;
    const trayRequest = { schemaVersion: 1, scope: validCommand.scope, limit: 20 };
    assert.equal((await fetch(trayUrl, { method: "POST" })).status, 401);
    assert.equal((await fetch(trayUrl, { method: "POST", body: JSON.stringify({ ...trayRequest, limit: 51 }),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 400);
    const trayResponse = await fetch(trayUrl, { method: "POST", body: JSON.stringify(trayRequest),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } });
    assert.equal(trayResponse.status, 200);
    assert.equal(trayResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await trayResponse.json(), { schemaVersion: 1, items: [] });
    const autosaveUrl = `${url}/autosave`;
    assert.equal((await fetch(autosaveUrl, { method: "POST" })).status, 401);
    assert.equal((await fetch(autosaveUrl, { method: "POST", body: JSON.stringify({ ...autosaveCommand, actorId: principal.actorId }),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 400);
    const autosaved = await fetch(autosaveUrl, { method: "POST", body: JSON.stringify(autosaveCommand),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } });
    assert.equal(autosaved.status, 200);
    assert.equal(autosaved.headers.get("cache-control"), "private, no-store");
    assert.equal((await autosaved.json() as { detail: { version: number } }).detail.version, 3);
    for (const [status, http] of [["conflict", 409], ["denied", 403], ["rejected", 400]] as const) {
      autosaveOutcome = { status };
      assert.equal((await fetch(autosaveUrl, { method: "POST", body: JSON.stringify(autosaveCommand),
        headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, http);
    }
    continuityFail = true;
    assert.equal((await fetch(autosaveUrl, { method: "POST", body: JSON.stringify(autosaveCommand),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 503);
    continuityFail = false;
    autosaveOutcome = { status: "applied", record: autosaveRecord };
    const workspaceUrl = `${url}/workspace`;
    assert.equal((await fetch(workspaceUrl, { method: "POST" })).status, 401);
    assert.equal((await fetch(workspaceUrl, { method: "POST", body: JSON.stringify({ ...workspaceRequest, extra: true }),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 400);
    const workspaceResponse = await fetch(workspaceUrl, { method: "POST", body: JSON.stringify(workspaceRequest),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } });
    assert.equal(workspaceResponse.status, 200);
    assert.equal(workspaceResponse.headers.get("cache-control"), "private, no-store");
    assert.equal((await workspaceResponse.json() as { customerSnapshot: { displayName: string } }).customerSnapshot.displayName, "Nombre congelado");
    workspaceOutcome = { status: "missing" };
    assert.equal((await fetch(workspaceUrl, { method: "POST", body: JSON.stringify(workspaceRequest),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 404);
    workspaceOutcome = { status: "denied" };
    assert.equal((await fetch(workspaceUrl, { method: "POST", body: JSON.stringify(workspaceRequest),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 403);
    workspaceOutcome = workspace;
    const suggestionsUrl = `${url}/delivery-instruction-suggestions`;
    const suggestionsRequest = { schemaVersion: 1, scope: validCommand.scope,
      captureDraftId: validCommand.captureDraftId };
    assert.equal((await fetch(suggestionsUrl, { method: "POST" })).status, 401);
    assert.equal((await fetch(suggestionsUrl, { method: "POST",
      body: JSON.stringify({ ...suggestionsRequest, customerId: validCommand.deviceId }),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 400);
    const suggestionsResponse = await fetch(suggestionsUrl, { method: "POST", body: JSON.stringify(suggestionsRequest),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } });
    assert.equal(suggestionsResponse.status, 200);
    assert.equal(suggestionsResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await suggestionsResponse.json(), { schemaVersion: 1,
      captureDraftId: validCommand.captureDraftId, items: [] });
    for (const route of ["hold", "claim", "resume"]) {
      attentionOutcome = { status: "applied", record: route === "hold" ? heldRecord : { ...record, detail: { ...record.detail, version: 2 } } };
      const body = route === "hold" ? holdCommand : mutationCommand;
      const response = await fetch(`${url}/${route}`, { method: "POST", body: JSON.stringify(body),
        headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal((await response.json() as { detail: { version: number } }).detail.version, 2);
      assert.equal((await fetch(`${url}/${route}`, { method: "POST" })).status, 401);
    }
    authorizationRoles = ["supervisor"];
    const assignmentDirectoryUrl = `${url}/assignment-candidates`;
    const assignmentDirectoryResponse = await fetch(assignmentDirectoryUrl, { method: "POST",
      body: JSON.stringify({ schemaVersion: 1, scope: validCommand.scope }),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } });
    assert.equal(assignmentDirectoryResponse.status, 200);
    assert.equal(assignmentDirectoryResponse.headers.get("cache-control"), "private, no-store");
    assert.equal((await assignmentDirectoryResponse.json() as { candidates: unknown[] }).candidates.length, 1);
    assert.equal((await fetch(assignmentDirectoryUrl, { method: "POST",
      body: JSON.stringify({ schemaVersion: 1, scope: validCommand.scope, actorId: principal.actorId }),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 400);
    for (const [route, body, assignmentRecord] of [["transfer", transferCommand, transferredRecord],
      ["takeover", takeoverCommand, takenOverRecord]] as const) {
      attentionOutcome = { status: "applied", record: assignmentRecord };
      const response = await fetch(`${url}/${route}`, { method: "POST", body: JSON.stringify(body),
        headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal((await response.json() as { detail: { version: number } }).detail.version, 2);
      assert.equal((await fetch(`${url}/${route}`, { method: "POST" })).status, 401);
    }
    assert.equal((await fetch(`${url}/takeover`, { method: "POST", body: JSON.stringify({ ...takeoverCommand, reason: "" }),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 400);
    authorizationRoles = ["cashier"];
    assert.equal((await fetch(`${url}/transfer`, { method: "POST", body: JSON.stringify(transferCommand),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } })).status, 403);
    attentionOutcome = { status: "applied", record: preferenceRecord };
    const preference = await fetch(`${url}/recovery-preference`, { method: "POST", body: JSON.stringify(preferenceCommand),
      headers: { authorization: "Bearer test-capture-access-token", "content-type": "application/json" } });
    assert.equal(preference.status, 200);
    assert.equal(preference.headers.get("cache-control"), "private, no-store");
    assert.equal((await preference.json() as { recoveryPolicy: { autoRenewSelected: boolean } }).recoveryPolicy.autoRenewSelected, true);
    const sendCustomer = (body: unknown, authenticated = true) => fetch(`${url}/customer`, { method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer test-capture-access-token" } : {}) } });
    assert.equal((await sendCustomer(customerCommand, false)).status, 401);
    assert.equal((await sendCustomer({ ...customerCommand, displayName: "forged" })).status, 400);
    const selected = await sendCustomer(customerCommand);
    assert.equal(selected.status, 200);
    assert.equal(selected.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await selected.json(), { schemaVersion: 1, detail: customerRecord.detail, replayed: false });
    customerOutcome = { status: "replayed", record: customerRecord };
    assert.equal((await (await sendCustomer(customerCommand)).json() as { replayed: boolean }).replayed, true);
    for (const [status, http, errorCode] of [["conflict", 409, "CAPTURE_CONFLICT"], ["denied", 403, "ACTION_NOT_AUTHORIZED"], ["rejected", 400, "CAPTURE_REQUEST_REJECTED"]] as const) {
      customerOutcome = { status };
      const response = await sendCustomer(customerCommand);
      assert.equal(response.status, http);
      assert.deepEqual(await response.json(), { code: errorCode });
    }
    customerOutcome = {};
    assert.equal((await sendCustomer(customerCommand)).status, 503);
    const sendFulfillment = (body: unknown, authenticated = true) => fetch(`${url}/fulfillment`, { method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer test-capture-access-token" } : {}) } });
    assert.equal((await sendFulfillment(fulfillmentCommand, false)).status, 401);
    assert.equal((await sendFulfillment({ ...fulfillmentCommand, streetLine: "forged" })).status, 400);
    const fulfilled = await sendFulfillment(fulfillmentCommand);
    assert.equal(fulfilled.status, 200);
    assert.equal(fulfilled.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await fulfilled.json(), { schemaVersion: 1, detail: fulfillmentRecord.detail, replayed: false });
    fulfillmentOutcome = { status: "conflict" };
    assert.equal((await sendFulfillment(fulfillmentCommand)).status, 409);
    outcome = { status: "replayed", record };
    assert.equal((await (await send(validCommand)).json() as { replayed: boolean }).replayed, true);
    for (const [status, http, errorCode] of [["conflict", 409, "CAPTURE_CONFLICT"], ["denied", 403, "ACTION_NOT_AUTHORIZED"], ["rejected", 400, "CAPTURE_REQUEST_REJECTED"]] as const) {
      outcome = { status };
      const response = await send(validCommand);
      assert.equal(response.status, http);
      assert.deepEqual(await response.json(), { code: errorCode });
    }
    fail = true;
    const failure = await send(validCommand);
    assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { code: "CAPTURE_UNAVAILABLE" });
  } finally { await app.close(); }
});

const noSaleCommand = { ...holdCommand, reason: "Cliente desistió antes de ordenar" };
const noSaleRecord = { ...record, detail: { ...record.detail, version: 2, status: "no_sale" as const,
  attentionStatus: "unclaimed" as const, ownerMembershipId: null, attentionLeaseId: null,
  attentionLeaseExpiresAt: null } };
function noSaleFor(port: CaptureNoSalePort, roles: readonly MembershipRoleCode[] = ["cashier"]) {
  return new CaptureNoSaleService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles, scope: validCommand.scope }),
  }), port);
}

test("capture no-sale authorizes, validates the terminal transition and preserves replay", async () => {
  const calls: unknown[] = [];
  const service = noSaleFor({ closeNoSale: async (actor, received) => {
    calls.push({ actor, received }); return { status: "applied", record: noSaleRecord };
  } });
  assert.deepEqual(await service.closeNoSale(principal, noSaleCommand),
    { schemaVersion: 1, detail: noSaleRecord.detail, replayed: false });
  assert.deepEqual(calls, [{ actor: principal.actorId, received: noSaleCommand }]);
  const replayed = await noSaleFor({ closeNoSale: async () => ({ status: "replayed", record: noSaleRecord }) })
    .closeNoSale(principal, noSaleCommand);
  assert.equal(replayed.replayed, true);
});

test("capture no-sale rejects invalid commands and unauthorized roles before SQL", async () => {
  let calls = 0;
  const port = { closeNoSale: async () => { calls++; return {}; } };
  for (const input of [mutationCommand, { ...noSaleCommand, reason: " " }, { ...noSaleCommand, reason: "" },
    { ...noSaleCommand, expectedVersion: Number.MAX_SAFE_INTEGER }, { ...noSaleCommand, actorId: principal.actorId }]) {
    await assert.rejects(noSaleFor(port).closeNoSale(principal, input), code("request"));
  }
  await assert.rejects(noSaleFor(port, ["viewer"]).closeNoSale(principal, noSaleCommand), code("authorization"));
  await assert.rejects(noSaleFor(port).closeNoSale(principal, {
    ...noSaleCommand, scope: { ...validCommand.scope, branchId: validCommand.deviceId },
  }), code("authorization"));
  assert.equal(calls, 0);
});

test("capture no-sale sanitizes failures and rejects wrong status, scope or result version", async () => {
  for (const [status, expected] of [["denied", "authorization"], ["conflict", "conflict"], ["rejected", "request"]] as const) {
    await assert.rejects(noSaleFor({ closeNoSale: async () => ({ status }) }).closeNoSale(principal, noSaleCommand), code(expected));
  }
  for (const stored of [record, { ...noSaleRecord, detail: { ...noSaleRecord.detail, version: 3 } },
    { ...noSaleRecord, detail: { ...noSaleRecord.detail, status: "draft" as const } },
    { ...noSaleRecord, detail: { ...noSaleRecord.detail, attentionStatus: "claimed" as const } }]) {
    await assert.rejects(noSaleFor({ closeNoSale: async () => ({ status: "applied", record: stored }) })
      .closeNoSale(principal, noSaleCommand), code("unavailable"));
  }
  await assert.rejects(noSaleFor({ closeNoSale: async () => { throw new Error("secret-password"); } })
    .closeNoSale(principal, noSaleCommand), code("unavailable"));
});

test("capture no-sale adapter validates and parameterizes the command instead of constructing SQL", async () => {
  const calls: unknown[] = [];
  const adapter = new PostgresCaptureCreator({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: { status: "conflict" } }] };
  } });
  const parsed = { ...noSaleCommand, schemaVersion: 1 as const };
  assert.deepEqual(await adapter.closeNoSale(principal.actorId, parsed), { status: "conflict" });
  assert.deepEqual(calls, [{ sql: "select app_private.close_capture_no_sale($1::uuid, $2::jsonb) as result",
    parameters: [principal.actorId, JSON.stringify(parseCloseCaptureNoSaleCommandV1(parsed))] }]);
  await assert.rejects(adapter.closeNoSale("forged", parsed), code("request"));
  assert.equal(calls.length, 1);
});

test("capture no-sale HTTP route authorizes, validates and translates every outcome", async () => {
  let outcome: unknown = { status: "applied", record: noSaleRecord };
  const module = await Test.createTestingModule({ controllers: [CapturesController], providers: [
    CaptureService, CaptureAttentionService, CaptureCustomerService, CaptureFulfillmentService,
    CaptureDeliveryInstructionsService, CaptureConfirmationService, CaptureSelectionPlanService,
    CaptureDeliveryQuoteService, CapturePaymentIntentService,
    CaptureTrayService, CaptureAssignmentDirectoryService, CaptureNoSaleService,
    { provide: CAPTURE_DELIVERY_QUOTE_PORT, useValue: {
      setCaptureDeliveryQuote: async () => { throw new Error("must not set delivery quote"); } } },
    { provide: CAPTURE_DELIVERY_QUOTE_COMPUTATION_PORT, useValue: {
      quoteForCapture: async () => { throw new Error("must not quote for capture"); } } },
    { provide: CAPTURE_PAYMENT_INTENT_PORT, useValue: {
      setCapturePaymentIntent: async () => { throw new Error("must not set payment intent"); } } },
    { provide: CAPTURE_CREATION_PORT, useValue: { createDraft: async () => { throw new Error("must not create"); } } },
    { provide: CAPTURE_ATTENTION_PORT, useValue: { mutateAttention: async () => { throw new Error("must not mutate attention"); } } },
    { provide: CAPTURE_CUSTOMER_PORT, useValue: { setCustomer: async () => { throw new Error("must not set customer"); } } },
    { provide: CAPTURE_FULFILLMENT_PORT, useValue: { setFulfillment: async () => { throw new Error("must not set fulfillment"); } } },
    { provide: CAPTURE_DELIVERY_INSTRUCTIONS_PORT, useValue: {
      listDeliveryInstructionSuggestions: async () => { throw new Error("must not list suggestions"); },
      setDeliveryInstructions: async () => { throw new Error("must not set delivery instructions"); } } },
    { provide: CAPTURE_CONFIRMATION_PORT, useValue: {
      probeConfirmation: async () => { throw new Error("must not probe confirmation"); },
      readRepeatOrderPlan: async () => { throw new Error("must not read repeat order plan"); },
      readSelectionPlan: async () => { throw new Error("must not read selection plan"); },
      confirmDraft: async () => { throw new Error("must not confirm"); } } },
    { provide: CAPTURE_SELECTION_PLAN_PORT, useValue: {
      replaceSelectionPlan: async () => { throw new Error("must not replace selection plan"); },
      probeReplaceSelectionPlan: async () => { throw new Error("must not probe selection plan"); } } },
    { provide: CAPTURE_TRAY_PORT, useValue: { list: async () => { throw new Error("must not list tray"); } } },
    { provide: CAPTURE_ASSIGNMENT_DIRECTORY_PORT, useValue: {
      listAssignmentCandidates: async () => { throw new Error("must not list assignment candidates"); } } },
    { provide: MENU_CATALOG_PORT, useValue: {
      read: async () => { throw new Error("must not read catalog"); },
      save: async () => { throw new Error("must not save a catalog"); } } },
    { provide: CAPTURE_NO_SALE_PORT, useValue: { closeNoSale: async (actor: string) => {
      assert.equal(actor, principal.actorId); return outcome;
    } } },
    { provide: MembershipAuthorizationService, useValue: new MembershipAuthorizationService({
      findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
    }) },
    { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
  ] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/api/v1/captures/no-sale`;
  const send = (body: unknown, authenticated = true) => fetch(url, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer test-capture-access-token" } : {}) } });
  try {
    assert.equal((await send(noSaleCommand, false)).status, 401);
    assert.equal((await send({ ...noSaleCommand, reason: " " })).status, 400);
    const response = await send(noSaleCommand);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { schemaVersion: 1, detail: noSaleRecord.detail, replayed: false });
    for (const [status, http, errorCode] of [["conflict", 409, "CAPTURE_CONFLICT"], ["denied", 403, "ACTION_NOT_AUTHORIZED"],
      ["rejected", 400, "CAPTURE_REQUEST_REJECTED"]] as const) {
      outcome = { status };
      const failed = await send(noSaleCommand);
      assert.equal(failed.status, http);
      assert.deepEqual(await failed.json(), { code: errorCode });
    }
    outcome = {};
    assert.equal((await send(noSaleCommand)).status, 503);
  } finally { await app.close(); }
});

const deliveryQuoteFixture = {
  schemaVersion: 1 as const,
  quoteId: "11111111-1111-4111-8111-111111111111",
  restaurantId: validCommand.scope.restaurantId,
  branchId: validCommand.scope.branchId,
  captureDraftId: validCommand.captureDraftId,
  addressSnapshotRef: "22222222-2222-4222-8222-222222222222",
  address: { postalCode: "83000", locality: "Hermosillo" },
  currency: "MXN",
  timeZone: "America/Hermosillo",
  quotedAt: "2026-09-24T12:00:00.000Z",
  scheduledFor: null,
  version: 1,
  coverageStatus: "covered" as const,
  zoneId: "33333333-3333-4333-8333-333333333333",
  feeMinor: 3_000,
  promiseStart: "2026-09-24T12:00:00.000Z",
  promiseEnd: "2026-09-24T12:15:00.000Z",
  expiresAt: "2026-09-24T12:00:00.000Z",
  override: null,
};

function makeCaptureV5Fixture(overrides: {
  readonly fulfillmentChannel: "dine_in" | "counter" | "pickup" | "delivery";
  readonly deliveryQuote: unknown;
  readonly paymentIntent: unknown;
  readonly paymentIntentAppliedCaptureVersion: number | null;
  readonly paymentIntentBasisFingerprint: string | null;
  readonly version: number;
}) {
  return {
    schemaVersion: 5,
    detail: { ...record.detail, schemaVersion: 2 as const, version: overrides.version,
      fulfillmentChannel: overrides.fulfillmentChannel, deliveryInstructions: null },
    customerSnapshot: null,
    fulfillmentSnapshot: null,
    repeatOrderPlan: null,
    selectionPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      appliedCaptureVersion: 2, lineCount: 1 },
    deliveryQuote: overrides.deliveryQuote,
    paymentIntent: overrides.paymentIntent,
    paymentIntentAppliedCaptureVersion: overrides.paymentIntentAppliedCaptureVersion,
    paymentIntentBasisFingerprint: overrides.paymentIntentBasisFingerprint,
  };
}

const paymentCatalogPort = {
  read: async () => ({ schemaVersion: 1 as const, scope: validCommand.scope, catalog: selectionCatalog }),
  save: async () => { throw new Error("must not save a catalog"); },
};
const paymentSelectionConfirmation: CaptureConfirmationPort = {
  ...noConfirmationPort,
  readSelectionPlan: async () => ({ status: "ok", plan: selectionPlanCommand.plan, appliedCaptureVersion: 2 }),
};

test("capture delivery quote recomputes from live zones, freezes it and reports it back in workspace V5", async () => {
  let persistedEnvelope: CaptureDeliveryQuoteEnvelopeV1 | undefined;
  const deliveryQuotePersistence: CaptureDeliveryQuotePort = {
    probeSetDeliveryQuote: async () => ({ status: "pending" }),
    setCaptureDeliveryQuote: async (actorId, envelope) => {
      assert.equal(actorId, principal.actorId);
      persistedEnvelope = envelope;
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const computation: CaptureDeliveryQuoteComputationPort = {
    quoteForCapture: async (suppliedPrincipal, input) => {
      assert.equal(suppliedPrincipal.actorId, principal.actorId);
      assert.deepEqual(input, {
        schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId, scheduledFor: null,
      });
      return deliveryQuoteFixture;
    },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "delivery", deliveryQuote: deliveryQuoteFixture, paymentIntent: null,
      paymentIntentAppliedCaptureVersion: null, paymentIntentBasisFingerprint: null, version: 2,
    }),
  };
  const service = new CaptureDeliveryQuoteService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), deliveryQuotePersistence, captures, paymentSelectionConfirmation, paymentCatalogPort, computation);
  const quoteCommand = parseRequestCaptureDeliveryQuoteCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "66666666-6666-4666-8666-666666666666", idempotencyKey: "77777777-7777-4777-8777-777777777777",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z", scheduledFor: null,
  });
  assert.ok(quoteCommand);
  const result = await service.requestQuote(principal, quoteCommand);
  assert.equal(persistedEnvelope?.expectedVersion, 1);
  assert.equal(persistedEnvelope?.attentionLeaseId, validCommand.deviceId);
  assert.equal(result.deliveryQuote?.feeMinor, 3_000);
  assert.equal(result.selectionProjection?.subtotalMinor, 9_000);
  assert.equal(result.paymentProjection, null);

  await assert.rejects(new CaptureDeliveryQuoteService(new MembershipAuthorizationService({
    findActiveMembership: async () => undefined,
  }), deliveryQuotePersistence, captures, paymentSelectionConfirmation, paymentCatalogPort, computation)
    .requestQuote(principal, quoteCommand), code("authorization"));
});

test("H4: the delivery-quote envelope hashed for idempotency carries scheduledFor, not just the address", async () => {
  // Two requests with the SAME idempotencyKey but a DIFFERENT scheduledFor must never be treated
  // as the same logical write: quoteForCapture computes a different promise/coverage for each, so
  // the probe/write's own SQL fingerprint (hashed over the full envelope) must diverge too. This
  // asserts the API always forwards scheduledFor into the probed/persisted envelope, which is what
  // makes that SQL-side divergence possible in the first place.
  const probedEnvelopes: (CaptureDeliveryQuoteEnvelopeV1 | undefined)[] = [];
  const persistedEnvelopes: (CaptureDeliveryQuoteEnvelopeV1 | undefined)[] = [];
  const deliveryQuotePersistence: CaptureDeliveryQuotePort = {
    probeSetDeliveryQuote: async (actorId, envelope) => { probedEnvelopes.push(envelope); return { status: "pending" }; },
    setCaptureDeliveryQuote: async (actorId, envelope) => {
      persistedEnvelopes.push(envelope);
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const computation: CaptureDeliveryQuoteComputationPort = {
    quoteForCapture: async () => deliveryQuoteFixture,
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "delivery", deliveryQuote: deliveryQuoteFixture, paymentIntent: null,
      paymentIntentAppliedCaptureVersion: null, paymentIntentBasisFingerprint: null, version: 2,
    }),
  };
  const service = new CaptureDeliveryQuoteService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), deliveryQuotePersistence, captures, paymentSelectionConfirmation, paymentCatalogPort, computation);
  const sameIdempotencyKey = "14141414-1414-4414-8414-141414141414";
  const asapCommand = parseRequestCaptureDeliveryQuoteCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "15151515-1515-4515-8515-151515151515", idempotencyKey: sameIdempotencyKey,
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z", scheduledFor: null,
  });
  assert.ok(asapCommand);
  await service.requestQuote(principal, asapCommand);
  const scheduledCommand = parseRequestCaptureDeliveryQuoteCommandV1({
    ...asapCommand, scheduledFor: "2026-09-24T18:00:00.000Z",
  });
  assert.ok(scheduledCommand);
  await service.requestQuote(principal, scheduledCommand);
  assert.deepEqual(probedEnvelopes.map((envelope) => envelope?.scheduledFor), [null, "2026-09-24T18:00:00.000Z"]);
  assert.deepEqual(persistedEnvelopes.map((envelope) => envelope?.scheduledFor), [null, "2026-09-24T18:00:00.000Z"]);
});

test("payment intent totals exclude the delivery fee outside delivery, and apply with exact change", async () => {
  let capturedBasis = "";
  let reads = 0;
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => {
      reads += 1;
      if (reads === 1) {
        return makeCaptureV5Fixture({ fulfillmentChannel: "counter", deliveryQuote: null, paymentIntent: null,
          paymentIntentAppliedCaptureVersion: null, paymentIntentBasisFingerprint: null, version: 1 });
      }
      return makeCaptureV5Fixture({
        fulfillmentChannel: "counter", deliveryQuote: null,
        paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 9_000, tipMinor: 500 },
        paymentIntentAppliedCaptureVersion: 2, paymentIntentBasisFingerprint: capturedBasis, version: 2,
      });
    },
  };
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "pending" }),
    setCapturePaymentIntent: async (actorId, envelope, basisFingerprint) => {
      assert.equal(actorId, principal.actorId);
      assert.equal((envelope as { basisFingerprint?: unknown }).basisFingerprint, undefined);
      capturedBasis = basisFingerprint;
      assert.match(capturedBasis, /^[0-9a-f]{64}$/u);
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, paymentSelectionConfirmation, paymentCatalogPort);
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "88888888-8888-4888-8888-888888888888", idempotencyKey: "99999999-9999-4999-8999-999999999999",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 9_000, tipMinor: 500,
  });
  assert.ok(intentCommand);
  const result = await service.setPaymentIntent(principal, intentCommand);
  assert.equal(result.paymentProjection?.itemsSubtotalMinor, 9_000);
  assert.equal(result.paymentProjection?.deliveryFeeMinor, 0);
  assert.equal(result.paymentProjection?.orderTotalMinor, 9_000);
  assert.equal(result.paymentProjection?.changeDueMinor, 0);
  assert.equal(result.paymentProjection?.status, "ready");
});

test("payment intent totals include the frozen delivery fee for a delivery capture", async () => {
  let capturedBasis = "";
  let reads = 0;
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => {
      reads += 1;
      if (reads === 1) {
        return makeCaptureV5Fixture({ fulfillmentChannel: "delivery", deliveryQuote: deliveryQuoteFixture,
          paymentIntent: null, paymentIntentAppliedCaptureVersion: null, paymentIntentBasisFingerprint: null, version: 1 });
      }
      return makeCaptureV5Fixture({
        fulfillmentChannel: "delivery", deliveryQuote: deliveryQuoteFixture,
        paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 20_000, tipMinor: 0 },
        paymentIntentAppliedCaptureVersion: 2, paymentIntentBasisFingerprint: capturedBasis, version: 2,
      });
    },
  };
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "pending" }),
    setCapturePaymentIntent: async (actorId, envelope, basisFingerprint) => {
      capturedBasis = basisFingerprint;
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, paymentSelectionConfirmation, paymentCatalogPort);
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 20_000, tipMinor: 0,
  });
  assert.ok(intentCommand);
  const result = await service.setPaymentIntent(principal, intentCommand);
  // 9_000 (items) + 3_000 (frozen fee) = 12_000; tendered 20_000 -> change 8_000, tip never enters either.
  assert.equal(result.paymentProjection?.orderTotalMinor, 12_000);
  assert.equal(result.paymentProjection?.changeDueMinor, 8_000);
  assert.equal(result.paymentProjection?.status, "ready");
});

test("H3: re-quoting with the identical fee but a different quoteId still reports the payment intent stale", async () => {
  // A re-quote for the same address/zone can land on an IDENTICAL feeMinor while
  // set_capture_delivery_quote's own CAS on applied_capture_version already treats it as a
  // distinct quote. The basis must include the quote's own identity, not just the fee, so a read
  // here agrees with what SQL would reject as stale at confirm time.
  let capturedBasis = "";
  let reads = 0;
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => {
      reads += 1;
      if (reads === 1) {
        return makeCaptureV5Fixture({ fulfillmentChannel: "delivery", deliveryQuote: deliveryQuoteFixture,
          paymentIntent: null, paymentIntentAppliedCaptureVersion: null, paymentIntentBasisFingerprint: null, version: 1 });
      }
      return makeCaptureV5Fixture({
        fulfillmentChannel: "delivery", deliveryQuote: deliveryQuoteFixture,
        paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 20_000, tipMinor: 0 },
        paymentIntentAppliedCaptureVersion: 2, paymentIntentBasisFingerprint: capturedBasis, version: 2,
      });
    },
  };
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "pending" }),
    setCapturePaymentIntent: async (actorId, envelope, basisFingerprint) => {
      capturedBasis = basisFingerprint;
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, paymentSelectionConfirmation, paymentCatalogPort);
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "12121212-1212-4212-8212-121212121212", idempotencyKey: "13131313-1313-4313-8313-131313131313",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 20_000, tipMinor: 0,
  });
  assert.ok(intentCommand);
  const applied = await service.setPaymentIntent(principal, intentCommand);
  assert.equal(applied.paymentProjection?.status, "ready");

  // Same feeMinor (3_000), same everything else, but a DIFFERENT quoteId -- as a genuine re-quote
  // for the same zone would produce.
  const requotedFixture = { ...deliveryQuoteFixture, quoteId: "44444444-4444-4444-8444-444444444444" };
  const readService = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "delivery", deliveryQuote: requotedFixture,
      paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 20_000, tipMinor: 0 },
      paymentIntentAppliedCaptureVersion: 2, paymentIntentBasisFingerprint: capturedBasis, version: 3,
    }),
  }, paymentSelectionConfirmation, paymentCatalogPort);
  const workspaceRequest = { schemaVersion: 5, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId };
  const workspace = await readService.readWorkspace(principal, workspaceRequest) as { paymentProjection?: { status?: string } };
  assert.equal(workspace.paymentProjection?.status, "stale");
});

test("payment intent rejects an insufficient cash tender with a typed 409 before touching SQL", async () => {
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "counter", deliveryQuote: null, paymentIntent: null,
      paymentIntentAppliedCaptureVersion: null, paymentIntentBasisFingerprint: null, version: 1,
    }),
  };
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "pending" }),
    setCapturePaymentIntent: async () => { throw new Error("must not persist an insufficient intent"); },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, paymentSelectionConfirmation, paymentCatalogPort);
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 1_000, tipMinor: 0,
  });
  assert.ok(intentCommand);
  await assert.rejects(service.setPaymentIntent(principal, intentCommand),
    (error: unknown) => error instanceof CapturePaymentIntentInsufficientError);
});

test("payment intent projection is stale once the lines change after the intent's basis was fixed", async () => {
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "counter", deliveryQuote: null,
      paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 9_000, tipMinor: 0 },
      paymentIntentAppliedCaptureVersion: 2, paymentIntentBasisFingerprint: "0".repeat(64), version: 3,
    }),
  };
  const service = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures, paymentSelectionConfirmation, paymentCatalogPort);
  const workspaceRequest = { schemaVersion: 5, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId };
  const workspace = await service.readWorkspace(principal, workspaceRequest) as { paymentProjection?: { status?: string } };
  // The stored fingerprint ("0"x64) can never match the live one derived from the actual stored
  // plan/fee/currency, exactly as if the lines had changed after the intent was fixed.
  assert.equal(workspace.paymentProjection?.status, "stale");
});

test("H19: changing the fulfillment channel after the intent was fixed reports the projection stale, same lines and all", async () => {
  // The exact live fingerprint for fulfillmentChannel "counter" (timing "now"): one line,
  // qty 2 @ 4_500 = 9_000, no delivery fee/quote, matching selectionPlanCommand/selectionCatalog.
  const counterFingerprint = createHash("sha256").update(JSON.stringify({
    catalogVersion: selectionCatalog.catalogVersion, currency: "MXN", deliveryFeeMinor: 0,
    fulfillmentChannel: "counter",
    lines: [{
      id: selectionPlanCommand!.plan.lines[0]!.lineId, modifierGroups: [],
      note: null, productId: selectionCatalog.products[0]!.productId, quantity: 2,
    }],
    quoteId: null, timing: "now",
  })).digest("hex");
  const captures = (fulfillmentChannel: "counter" | "pickup"): CaptureCreationPort => ({
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel, deliveryQuote: null,
      paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 9_000, tipMinor: 0 },
      paymentIntentAppliedCaptureVersion: 2, paymentIntentBasisFingerprint: counterFingerprint, version: 3,
    }),
  });
  const counterService = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures("counter"), paymentSelectionConfirmation, paymentCatalogPort);
  const workspaceRequest = { schemaVersion: 5, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId };
  const counterWorkspace = await counterService.readWorkspace(principal, workspaceRequest) as {
    paymentProjection?: { status?: string };
  };
  assert.equal(counterWorkspace.paymentProjection?.status, "ready");

  // Same stored fingerprint, same lines/tender -- only the fulfillment channel changed
  // (counter -> pickup, exactly H19's scenario), which changes the derived timing that the
  // basis is priced against. Before H19 this fingerprint would still match and read "ready".
  const pickupService = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures("pickup"), paymentSelectionConfirmation, paymentCatalogPort);
  const pickupWorkspace = await pickupService.readWorkspace(principal, workspaceRequest) as {
    paymentProjection?: { status?: string };
  };
  assert.equal(pickupWorkspace.paymentProjection?.status, "stale");
});

test("H25: reading a workspace with priced lines but no payment intent yet still reports a payment basis", async () => {
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "counter", deliveryQuote: null, paymentIntent: null,
      paymentIntentAppliedCaptureVersion: null, paymentIntentBasisFingerprint: null, version: 1,
    }),
  };
  const service = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures, paymentSelectionConfirmation, paymentCatalogPort);
  const workspaceRequest = { schemaVersion: 5, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId };
  const workspace = await service.readWorkspace(principal, workspaceRequest) as {
    paymentIntent?: unknown; paymentProjection?: unknown;
    paymentBasis?: { currency?: string; itemsSubtotalMinor?: number; deliveryFeeMinor?: number; orderTotalMinor?: number };
  };
  assert.equal(workspace.paymentIntent, null);
  assert.equal(workspace.paymentProjection, null);
  // selectionPlanCommand/selectionCatalog: one line, qty 2 @ 4_500 = 9_000, no delivery fee outside delivery.
  assert.equal(workspace.paymentBasis?.currency, "MXN");
  assert.equal(workspace.paymentBasis?.itemsSubtotalMinor, 9_000);
  assert.equal(workspace.paymentBasis?.deliveryFeeMinor, 0);
  assert.equal(workspace.paymentBasis?.orderTotalMinor, 9_000);
});

test("H25: no priced lines and no delivery quote means no established currency, so the basis is null", async () => {
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => ({
      schemaVersion: 5,
      detail: { ...record.detail, schemaVersion: 2 as const, version: 1, fulfillmentChannel: "counter",
        deliveryInstructions: null },
      customerSnapshot: null,
      fulfillmentSnapshot: null,
      repeatOrderPlan: null,
      selectionPlan: null,
      deliveryQuote: null,
      paymentIntent: null,
      paymentIntentAppliedCaptureVersion: null,
      paymentIntentBasisFingerprint: null,
    }),
  };
  const service = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures, noConfirmationPort, paymentCatalogPort);
  const workspaceRequest = { schemaVersion: 5, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId };
  const workspace = await service.readWorkspace(principal, workspaceRequest) as { paymentBasis?: unknown };
  assert.equal(workspace.paymentBasis, null);
});

test("H8: reading a workspace whose selection plan cannot presently be priced never reports the payment intent ready", async () => {
  // Same shape of bug as H5, on the READ side: the stored basis fingerprint happens to still match
  // (catalogVersion "" + no lines + the frozen quote's identity, exactly what an unpriced plan
  // produces), so fingerprint comparison alone can't catch this -- itemsSubtotalMinor silently
  // becomes 0 and the delivery fee alone could look "ready" for a tender that only covers it.
  const deniedSelectionConfirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readSelectionPlan: async () => ({ status: "denied" }),
  };
  const matchingFingerprint = createHash("sha256").update(JSON.stringify({
    catalogVersion: "", currency: "MXN", deliveryFeeMinor: 3_000, lines: [], quoteId: deliveryQuoteFixture.quoteId,
  })).digest("hex");
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "delivery", deliveryQuote: deliveryQuoteFixture,
      paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 3_000, tipMinor: 0 },
      paymentIntentAppliedCaptureVersion: 2, paymentIntentBasisFingerprint: matchingFingerprint, version: 3,
    }),
  };
  const service = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures, deniedSelectionConfirmation, paymentCatalogPort);
  const workspaceRequest = { schemaVersion: 5, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId };
  const workspace = await service.readWorkspace(principal, workspaceRequest) as {
    selectionProjection?: unknown; paymentProjection?: { status?: string } | null;
  };
  assert.equal(workspace.selectionProjection, null);
  assert.equal(workspace.paymentProjection?.status, "stale");
});

test("payment intent replay returns the stored result without recomputing insufficiency", async () => {
  // H2: the probe alone recognizes the replay, purely from actor+scope+idempotencyKey+fingerprint
  // over the client's envelope; the service must never re-read the workspace to reprice a basis or
  // attempt the real write for it, so a retry is never turned into a spurious insufficient/conflict
  // by a since-changed basis.
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "counter", deliveryQuote: null,
      paymentIntent: { schemaVersion: 1, method: "cash", tenderedAmountMinor: 9_000, tipMinor: 0 },
      paymentIntentAppliedCaptureVersion: 2, paymentIntentBasisFingerprint: "ab".repeat(32), version: 2,
    }),
  };
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "replayed", record: { ...record, detail: { ...record.detail, version: 2 } } }),
    setCapturePaymentIntent: async () => { throw new Error("must not attempt a real write for a replay"); },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, paymentSelectionConfirmation, paymentCatalogPort);
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", idempotencyKey: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 9_000, tipMinor: 0,
  });
  assert.ok(intentCommand);
  const result = await service.setPaymentIntent(principal, intentCommand);
  assert.equal(result.paymentIntent?.tenderedAmountMinor, 9_000);
});

const taxExcludedCatalog: MenuCatalogV1 = {
  catalogVersion: "5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c5c",
  currency: "MXN",
  replayed: false,
  updatedAt: "2026-09-24T11:59:00.000Z",
  updatedBy: principal.actorId,
  version: 1,
  categories: [{ categoryId: "a409ec59-9f5e-496d-a45d-b83a46b49674", name: "Comida", active: true, displayOrder: 0 }],
  products: [{
    productId: "ec5e7c30-edac-4b79-bf8c-e363b041c59f",
    categoryId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
    name: "Pizza con IVA", sku: "PIZZA-1", active: true, displayOrder: 0,
    stationId: "hot", unit: "piece", unitPriceMinor: 10_000,
    imagePath: null,
    tax: { taxId: "mx-vat", name: "IVA", taxRuleVersion: "mx-v1", rateNumerator: 16, rateDenominator: 100, inclusion: "excluded" },
  }],
  modifierGroups: [],
};
const taxedSelectionPlanCommand = parseReplaceCaptureSelectionPlanCommandV1({
  schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
  expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
  eventId: "6c6c6c6c-6c6c-46c6-86c6-6c6c6c6c6c6c", idempotencyKey: "7d7d7d7d-7d7d-47d7-87d7-7d7d7d7d7d7d",
  deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
  plan: {
    schemaVersion: 1, catalogVersion: taxExcludedCatalog.catalogVersion,
    lines: [{
      lineId: "8e8e8e8e-8e8e-48e8-88e8-8e8e8e8e8e8e", productId: taxExcludedCatalog.products[0]!.productId,
      variantId: null, quantity: 1, modifierGroups: [], note: null,
    }],
  },
});
assert.ok(taxedSelectionPlanCommand);
const taxedSelectionConfirmation: CaptureConfirmationPort = {
  ...noConfirmationPort,
  readSelectionPlan: async () => ({ status: "ok", plan: taxedSelectionPlanCommand.plan, appliedCaptureVersion: 2 }),
};
const taxedCatalogPort = {
  read: async () => ({ schemaVersion: 1 as const, scope: validCommand.scope, catalog: taxExcludedCatalog }),
  save: async () => { throw new Error("must not save a catalog"); },
};

test("payment intent basis uses the tax-inclusive line total, not the tax-exclusive subtotal", async () => {
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => ({
      schemaVersion: 5,
      detail: { ...record.detail, schemaVersion: 2 as const, version: 1, fulfillmentChannel: "counter",
        deliveryInstructions: null },
      customerSnapshot: null,
      fulfillmentSnapshot: null,
      repeatOrderPlan: null,
      selectionPlan: { schemaVersion: 1, catalogVersion: taxExcludedCatalog.catalogVersion,
        appliedCaptureVersion: 2, lineCount: 1 },
      deliveryQuote: null,
      paymentIntent: null,
      paymentIntentAppliedCaptureVersion: null,
      paymentIntentBasisFingerprint: null,
    }),
  };
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "pending" }),
    setCapturePaymentIntent: async () => { throw new Error("must not persist an insufficient intent"); },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, taxedSelectionConfirmation, taxedCatalogPort);
  // Tendered exactly the tax-exclusive subtotal (10_000): sufficient only under the old,
  // incorrect basis. The tax-inclusive total is 11_600 (16% excluded), so this must be refused.
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "9f9f9f9f-9f9f-49f9-89f9-9f9f9f9f9f9f", idempotencyKey: "10101010-1010-4010-8010-101010101010",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 10_000, tipMinor: 0,
  });
  assert.ok(intentCommand);
  await assert.rejects(service.setPaymentIntent(principal, intentCommand),
    (error: unknown) => error instanceof CapturePaymentIntentInsufficientError);
});

const repeatCustomerId = "2f2f2f2f-2f2f-42f2-82f2-2f2f2f2f2f2f";
const repeatSourceOrderId = "3f3f3f3f-3f3f-43f3-83f3-3f3f3f3f3f3f";
const repeatOrderPlanLines = [
  { sourceOrderItemId: "4f4f4f4f-4f4f-44f4-84f4-4f4f4f4f4f4f", productId: selectionCatalog.products[0]!.productId,
    quantity: 1, modifierGroups: [] },
  { sourceOrderItemId: "5f5f5f5f-5f5f-45f5-85f5-5f5f5f5f5f5f", productId: selectionCatalog.products[0]!.productId,
    quantity: 1, modifierGroups: [] },
];
const repeatOrderPlanConfirmation: CaptureConfirmationPort = {
  ...noConfirmationPort,
  readRepeatOrderPlan: async () => ({
    status: "ok",
    plan: {
      schemaVersion: 1, customerId: repeatCustomerId, sourceOrderId: repeatSourceOrderId,
      catalogVersion: selectionCatalog.catalogVersion, lines: repeatOrderPlanLines,
    },
  }),
};
function makeRepeatCaptureV5Fixture(overrides: { readonly version: number }) {
  return {
    schemaVersion: 5,
    detail: { ...record.detail, schemaVersion: 2 as const, version: overrides.version,
      fulfillmentChannel: "counter", deliveryInstructions: null, customerSnapshotRef: validCommand.idempotencyKey },
    customerSnapshot: { schemaVersion: 1 as const, snapshotRef: validCommand.idempotencyKey,
      customerId: repeatCustomerId, contactId: validCommand.eventId, displayName: "Cliente repetido",
      phoneDisplayValue: "+52 662 000 0000", phoneNormalizedValue: "+526620000000" },
    fulfillmentSnapshot: null,
    repeatOrderPlan: { schemaVersion: 1, catalogVersion: selectionCatalog.catalogVersion,
      customerId: repeatCustomerId, sourceOrderId: repeatSourceOrderId, appliedCaptureVersion: 2, lineCount: 2 },
    selectionPlan: null,
    selectionProjection: null,
    deliveryQuote: null,
    paymentIntent: null,
    paymentIntentAppliedCaptureVersion: null,
    paymentIntentBasisFingerprint: null,
  };
}

test("H26: a repeat-order plan that currently cannot be priced reports no payment basis, never a 0 subtotal", async () => {
  const deniedRepeatConfirmation: CaptureConfirmationPort = {
    ...noConfirmationPort,
    readRepeatOrderPlan: async () => ({ status: "denied" }),
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeRepeatCaptureV5Fixture({ version: 1 }),
  };
  const service = new CaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), captures, deniedRepeatConfirmation, paymentCatalogPort);
  const workspaceRequest = { schemaVersion: 5, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId };
  const workspace = await service.readWorkspace(principal, workspaceRequest) as {
    paymentBasis?: unknown; paymentProjection?: unknown;
  };
  assert.equal(workspace.paymentBasis, null);
  assert.equal(workspace.paymentProjection, null);
});

test("payment intent basis prices a repeat-order plan's lines against the live catalog", async () => {
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeRepeatCaptureV5Fixture({ version: 1 }),
  };
  let persistedBasis = "";
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "pending" }),
    setCapturePaymentIntent: async (actorId, envelope, basisFingerprint) => {
      assert.equal(actorId, principal.actorId);
      persistedBasis = basisFingerprint;
      return { status: "applied", record: { ...record, detail: { ...record.detail, version: 2 } } };
    },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, repeatOrderPlanConfirmation, paymentCatalogPort);
  // Two lines at 4_500 each (no tax) = 9_000, exactly like the two-line selection-plan fixture.
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a", idempotencyKey: "7b7b7b7b-7b7b-47b7-87b7-7b7b7b7b7b7b",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 9_000, tipMinor: 0,
  });
  assert.ok(intentCommand);
  await service.setPaymentIntent(principal, intentCommand);
  assert.match(persistedBasis, /^[0-9a-f]{64}$/u);
});

test("H5: payment intent rejects a selection plan that could not be priced, instead of falling back to a 0 subtotal", async () => {
  // The stored selection plan is real (lineCount 1), but the live catalog has since republished
  // under a different catalogVersion: projectStoredSelectionPlan (the same best-effort projection
  // every read uses) can no longer price it, so selectionProjection comes back null. A naive basis
  // would silently accept ANY cash tender as covering an order with priced items.
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => makeCaptureV5Fixture({
      fulfillmentChannel: "counter", deliveryQuote: null, paymentIntent: null,
      paymentIntentAppliedCaptureVersion: null, paymentIntentBasisFingerprint: null, version: 1,
    }),
  };
  const republishedCatalogPort = {
    read: async () => ({
      schemaVersion: 1 as const, scope: validCommand.scope,
      catalog: { ...selectionCatalog, catalogVersion: validCommand.deviceId },
    }),
    save: async () => { throw new Error("must not save a catalog"); },
  };
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "pending" }),
    setCapturePaymentIntent: async () => { throw new Error("must not persist an unpriced intent"); },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, paymentSelectionConfirmation, republishedCatalogPort);
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "16161616-1616-4616-8616-161616161616", idempotencyKey: "17171717-1717-4717-8717-171717171717",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 1, tipMinor: 0,
  });
  assert.ok(intentCommand);
  await assert.rejects(service.setPaymentIntent(principal, intentCommand),
    (error: unknown) => error instanceof CapturePaymentIntentUnpricedError);
});

test("payment intent rejects a capture with no selection or repeat plan at all", async () => {
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => ({
      schemaVersion: 5,
      detail: { ...record.detail, schemaVersion: 2 as const, version: 1, fulfillmentChannel: "counter",
        deliveryInstructions: null },
      customerSnapshot: null,
      fulfillmentSnapshot: null,
      repeatOrderPlan: null,
      selectionPlan: null,
      selectionProjection: null,
      deliveryQuote: null,
      paymentIntent: null,
      paymentIntentAppliedCaptureVersion: null,
      paymentIntentBasisFingerprint: null,
    }),
  };
  const persistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => ({ status: "pending" }),
    setCapturePaymentIntent: async () => { throw new Error("must not persist a payment intent with no lines"); },
  };
  const service = new CapturePaymentIntentService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), persistence, captures, noConfirmationPort, paymentCatalogPort);
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "8c8c8c8c-8c8c-48c8-88c8-8c8c8c8c8c8c", idempotencyKey: "9d9d9d9d-9d9d-49d9-89d9-9d9d9d9d9d9d",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 1_000, tipMinor: 0,
  });
  assert.ok(intentCommand);
  await assert.rejects(service.setPaymentIntent(principal, intentCommand),
    (error: unknown) => error instanceof CapturePaymentIntentNoLinesError);
});

test("capture delivery quote and payment intent reject a foreign scope before touching any port", async () => {
  const deliveryQuotePersistence: CaptureDeliveryQuotePort = {
    probeSetDeliveryQuote: async () => { throw new Error("must not probe"); },
    setCaptureDeliveryQuote: async () => { throw new Error("must not persist"); },
  };
  const computation: CaptureDeliveryQuoteComputationPort = {
    quoteForCapture: async () => { throw new Error("must not quote"); },
  };
  const paymentPersistence: CapturePaymentIntentPort = {
    probeSetPaymentIntent: async () => { throw new Error("must not probe"); },
    setCapturePaymentIntent: async () => { throw new Error("must not persist"); },
  };
  const noReadCaptures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => { throw new Error("must not read a foreign scope"); },
  };
  const deniedAuthorization = new MembershipAuthorizationService({ findActiveMembership: async () => undefined });
  const deliveryQuoteService = new CaptureDeliveryQuoteService(
    deniedAuthorization, deliveryQuotePersistence, noReadCaptures, noConfirmationPort, paymentCatalogPort, computation,
  );
  const paymentIntentService = new CapturePaymentIntentService(
    deniedAuthorization, paymentPersistence, noReadCaptures, noConfirmationPort, paymentCatalogPort,
  );
  const quoteCommand = parseRequestCaptureDeliveryQuoteCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "12121212-1212-4212-8212-121212121212", idempotencyKey: "13131313-1313-4313-8313-131313131313",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z", scheduledFor: null,
  });
  assert.ok(quoteCommand);
  const intentCommand = parseSetCapturePaymentIntentCommandV1({
    schemaVersion: 1, scope: validCommand.scope, captureDraftId: validCommand.captureDraftId,
    expectedVersion: 1, attentionLeaseId: validCommand.deviceId,
    eventId: "14141414-1414-4414-8414-141414141414", idempotencyKey: "15151515-1515-4515-8515-151515151515",
    deviceId: validCommand.deviceId, occurredAt: "2026-09-24T12:00:00.000Z",
    method: "cash", tenderedAmountMinor: 1_000, tipMinor: 0,
  });
  assert.ok(intentCommand);
  await assert.rejects(deliveryQuoteService.requestQuote(principal, quoteCommand), code("authorization"));
  await assert.rejects(paymentIntentService.setPaymentIntent(principal, intentCommand), code("authorization"));
});
