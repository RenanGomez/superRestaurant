import assert from "node:assert/strict";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { parseAutosaveCaptureDraftCommandV1, parseCaptureDeliveryInstructionSuggestionsRequestV1, parseCaptureWorkspaceRequestV1, parseCaptureWorkspaceRequestV2, parseCaptureWorkspaceRequestV3, parseCaptureWorkTrayRequestV1, parseCloseCaptureNoSaleCommandV1, parseConfirmCaptureDraftCommandV2, parseCreateCaptureDraftCommandV1, parseHoldCaptureDraftCommandV1, parseReplaceCaptureSelectionPlanCommandV1, parseSetCaptureCustomerCommandV1, parseSetCaptureDeliveryInstructionsCommandV1, parseSetCaptureFulfillmentCommandV1, parseTakeoverCaptureDraftCommandV1, parseTransferCaptureDraftCommandV1, type MembershipRoleCode, type MenuCatalogV1 } from "@super-restaurant/shared-types";

import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "./auth/authentication.js";
import type { CaptureOrderMaterialization } from "./capture-repeat-order-plan.js";
import { CAPTURE_ASSIGNMENT_DIRECTORY_PORT, CAPTURE_ATTENTION_PORT, CAPTURE_CONFIRMATION_PORT, CAPTURE_CREATION_PORT, CAPTURE_CUSTOMER_PORT, CAPTURE_DELIVERY_INSTRUCTIONS_PORT, CAPTURE_DELIVERY_QUOTE_COMPUTATION_PORT, CAPTURE_DELIVERY_QUOTE_PORT, CAPTURE_FULFILLMENT_PORT, CAPTURE_NO_SALE_PORT, CAPTURE_PAYMENT_INTENT_PORT, CAPTURE_SELECTION_PLAN_PORT, CAPTURE_TRAY_PORT, CaptureAssignmentDirectoryService, CaptureConfirmationService, CaptureCustomerService, CaptureDeliveryInstructionsService, CaptureDeliveryQuoteService, CapturePaymentIntentService, CaptureFulfillmentService, CaptureApplicationError, CaptureAttentionService, CaptureNoSaleService, CaptureSelectionPlanService, CaptureService, CaptureTrayService, PostgresCaptureCreator, type CaptureCustomerPort, type CaptureAttentionPort, type CaptureCreationPort, type CaptureConfirmationPort, type CaptureNoSalePort, type CaptureSelectionPlanPort } from "./captures.js";
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
  }), { createDraft: async () => ({}), readWorkspaceV4: async () => workspaceV4 }, {
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
    stationId: "hot", unit: "piece", unitPriceMinor: 4_500, tax: null,
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
    schemaVersion: 4,
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
    readWorkspaceV4: async () => workspaceV4Record,
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

test("capture selection plan applied write accepts a follow-up read whose version advanced further still", async () => {
  // The write's own result proves the draft reached expectedVersion+1 (version 2); a second
  // connection then advances the draft to version 4 (an unrelated mutation) before the
  // separate readWorkspaceV4 call following this write observes it. The response must still
  // be 200 with the fresher version, never unavailable for failing an exact-match comparison.
  const advancedAfterWriteRecord = {
    schemaVersion: 4,
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
    readWorkspaceV4: async () => advancedAfterWriteRecord,
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
    readWorkspaceV4: async () => ({ ...advancedAfterWriteRecord, detail: { ...advancedAfterWriteRecord.detail, version: 1 } }),
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
    schemaVersion: 4,
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
    readWorkspaceV4: async () => noPlanWorkspaceV4Record,
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
    schemaVersion: 4,
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
    readWorkspaceV4: async () => workspaceV4Record,
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
    schemaVersion: 4,
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
    readWorkspaceV4: async () => advancedWorkspaceV4Record,
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
    schemaVersion: 4,
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
    readWorkspaceV4: async () => replayedRecord,
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
    schemaVersion: 4,
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
    readWorkspaceV4: async () => replayedRecord,
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
    schemaVersion: 4,
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
    readWorkspaceV4: async () => racedWorkspaceV4Record,
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

test("capture selection plan projection is null when the plan read has an appliedCaptureVersion different from the workspace summary", async () => {
  // Same catalogVersion, same lineCount as the workspace's selectionPlan summary -- but a THIRD
  // write raced in between readWorkspaceV4 and readSelectionPlan, replacing the row with another
  // plan that happens to share both. appliedCaptureVersion is the only proof it is the SAME row;
  // a mismatch there must yield null, never price whatever this unrelated plan turns out to be.
  const workspaceV4Record = {
    schemaVersion: 4,
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
    readWorkspaceV4: async () => workspaceV4Record,
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
  }), { list: async () => ({ schemaVersion: 1, items: [summary] }) });
  assert.equal((await service.list(principal, request)).items.length, 1);
  await assert.rejects(service.list(principal, { ...request, limit: 51 }), code("request"));
  await assert.rejects(new CaptureTrayService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["viewer"], scope: validCommand.scope }),
  }), { list: async () => ({}) }).list(principal, request), code("authorization"));
  await assert.rejects(new CaptureTrayService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
  }), { list: async () => ({ schemaVersion: 1, items: [{ ...summary, scope: { ...summary.scope, branchId: validCommand.deviceId } }] }) })
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
