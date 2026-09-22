import assert from "node:assert/strict";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { parseAutosaveCaptureDraftCommandV1, parseCaptureWorkspaceRequestV1, parseCaptureWorkTrayRequestV1, parseCreateCaptureDraftCommandV1, parseHoldCaptureDraftCommandV1, parseSetCaptureCustomerCommandV1, parseSetCaptureFulfillmentCommandV1 } from "@super-restaurant/shared-types";

import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "./auth/authentication.js";
import { CAPTURE_ATTENTION_PORT, CAPTURE_CREATION_PORT, CAPTURE_CUSTOMER_PORT, CAPTURE_FULFILLMENT_PORT, CAPTURE_TRAY_PORT, CaptureCustomerService, CaptureFulfillmentService, CaptureApplicationError, CaptureAttentionService, CaptureService, CaptureTrayService, PostgresCaptureCreator, type CaptureCustomerPort, type CaptureAttentionPort, type CaptureCreationPort } from "./captures.js";
import { CapturesController } from "./captures.controller.js";

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
  }), creator);
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
function attentionFor(port: CaptureAttentionPort, allowed = true) {
  return new CaptureAttentionService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: allowed ? ["cashier"] : ["viewer"], scope: validCommand.scope }),
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
});

test("capture attention rejects invalid commands and unauthorized roles before SQL", async () => {
  let calls = 0;
  const port = { mutateAttention: async () => { calls++; return {}; } };
  for (const input of [mutationCommand, { ...holdCommand, expectedVersion: 0 },
    { ...holdCommand, expectedVersion: Number.MAX_SAFE_INTEGER }, { ...holdCommand, actorId: principal.actorId }]) {
    await assert.rejects(attentionFor(port).mutateAttention(principal, "capture.held", input), code("request"));
  }
  await assert.rejects(attentionFor(port).mutateAttention(principal, "capture.claimed", holdCommand), code("request"));
  await assert.rejects(attentionFor(port).mutateAttention(principal, "capture.taken_over" as never, mutationCommand), code("request"));
  await assert.rejects(attentionFor(port, false).mutateAttention(principal, "capture.claimed", mutationCommand), code("authorization"));
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
  await assert.rejects(adapter.mutateAttention(principal.actorId, "capture.taken_over" as never, parsed), code("request"));
  assert.equal(calls.length, 1);
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
  }), { createDraft: async () => ({}), readWorkspace: async () => { throw new Error("must not read"); } });
  await assert.rejects(revokedBetweenChecks.readWorkspace(principal, workspaceRequest), code("authorization"));
  assert.equal(authorizationChecks, 2);
  await assert.rejects(serviceFor({ createDraft: async () => ({}), readWorkspace: async () => ({ ...workspace,
    detail: { ...workspace.detail, scope: { ...workspace.detail.scope, branchId: validCommand.deviceId } } }) })
    .readWorkspace(principal, workspaceRequest), code("unavailable"));
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

test("capture HTTP boundary enforces auth and translates request, replay, denial, conflict and failure safely", async () => {
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
    CaptureTrayService,
    { provide: CAPTURE_CUSTOMER_PORT, useValue: { setCustomer: async () => customerOutcome } },
    { provide: CAPTURE_FULFILLMENT_PORT, useValue: { setFulfillment: async () => fulfillmentOutcome } },
    { provide: CAPTURE_TRAY_PORT, useValue: { list: async () => ({ schemaVersion: 1, items: [] }) } },
    { provide: MembershipAuthorizationService, useValue: new MembershipAuthorizationService({
      findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
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
