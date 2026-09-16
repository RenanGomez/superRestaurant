import assert from "node:assert/strict";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { parseCreateCaptureDraftCommandV1, parseHoldCaptureDraftCommandV1 } from "@super-restaurant/shared-types";

import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "./auth/authentication.js";
import { CAPTURE_ATTENTION_PORT, CAPTURE_CREATION_PORT, CaptureApplicationError, CaptureAttentionService, CaptureService, PostgresCaptureCreator, type CaptureAttentionPort, type CaptureCreationPort } from "./captures.js";
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

test("capture HTTP boundary enforces auth and translates request, replay, denial, conflict and failure safely", async () => {
  let calls = 0;
  let outcome: unknown = { status: "applied", record };
  let fail = false;
  let attentionOutcome: unknown = { status: "applied", record: heldRecord };
  const module = await Test.createTestingModule({ controllers: [CapturesController], providers: [
    CaptureService,
    CaptureAttentionService,
    { provide: MembershipAuthorizationService, useValue: new MembershipAuthorizationService({
      findActiveMembership: async () => ({ roles: ["cashier"], scope: validCommand.scope }),
    }) },
    { provide: CAPTURE_CREATION_PORT, useValue: { createDraft: async (actor: string) => {
      assert.equal(actor, principal.actorId); calls++; if (fail) throw new Error("server-password"); return outcome;
    } } },
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
