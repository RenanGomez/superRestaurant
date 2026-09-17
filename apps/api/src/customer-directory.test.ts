import assert from "node:assert/strict";
import test from "node:test";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "./auth/authentication.js";
import { CustomerDirectoryController } from "./customer-directory.controller.js";
import { CUSTOMER_DIRECTORY_READER_PORT, CUSTOMER_DIRECTORY_WRITER_PORT } from "./customer-directory.js";
import { parseBranchScope } from "@super-restaurant/shared-types";
import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { CustomerDirectoryApplicationError, CustomerDirectoryQueryService, CustomerDirectoryService, PostgresCustomerDirectoryReader, PostgresCustomerDirectoryWriter,
  type CustomerDirectoryReaderPort, type CustomerDirectoryWriterPort } from "./customer-directory.js";
import type { DatabaseClientPort } from "./database.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const customerId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const addressId = "e74df54b-30a7-449b-a23f-c4ca6f93bda4";
const contactId = "9544c299-d25b-44ce-98ed-d30116610887";
const actorId = "a72573ec-6224-4857-bc4a-f3d1d07b6d83";
const deviceId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const eventId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const idempotencyKey = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const occurredAt = "2026-09-16T18:00:00.000Z";
const scope = parseBranchScope({ restaurantId, branchId })!;
const principal: AuthenticatedPrincipal = Object.freeze({ actorId });
const common = { schemaVersion: 1 as const, scope, customerId, expectedVersion: 0, eventId, deviceId, idempotencyKey, occurredAt };
const profileCommand = { ...common, displayName: "Ana", phones: [{ contactId, label: "Casa", displayValue: "+52 (642) 123-4567" }] };
const address = { label: "Casa", streetLine: "Uno 10", unit: null, neighborhood: null, locality: "Navojoa",
  region: "Sonora", countryCode: "MX", postalCode: null, references: null, instructions: null,
  coordinates: { latitudeE6: 27_000_000, longitudeE6: -109_000_000 } };
const profileRecord = { schemaVersion: 1, restaurantId, customerId, displayName: "Ana",
  phones: [{ ...profileCommand.phones[0]!, normalizedValue: "+526421234567" }], version: 1,
  createdAt: occurredAt, updatedAt: occurredAt, deletedAt: null };
const addressRecord = { schemaVersion: 1, restaurantId, customerId, addressId, address, validation: null,
  version: 1, createdAt: occurredAt, updatedAt: occurredAt, deletedAt: null };
const missingRead = async (): Promise<unknown> => ({ status: "missing" });

test("customer HTTP boundary authenticates every route and sanitizes persistence outcomes", async () => {
  let active = true;
  let calls = 0;
  let profileOutcome: unknown = { status: "applied", record: profileRecord };
  let fail = false;
  const authorization = new MembershipAuthorizationService({ findActiveMembership: async () => active ? { roles: ["cashier"], scope } : undefined });
  const module = await Test.createTestingModule({ controllers: [CustomerDirectoryController], providers: [
    CustomerDirectoryService, CustomerDirectoryQueryService,
    { provide: MembershipAuthorizationService, useValue: authorization },
    { provide: CUSTOMER_DIRECTORY_WRITER_PORT, useValue: {
      saveProfile: async (actor: string) => { assert.equal(actor, actorId); calls++; if (fail) throw new Error("private phone/password"); return profileOutcome; },
      saveAddress: async () => ({ status: "applied", record: addressRecord }),
      validateAddress: async () => ({ status: "applied", record: { ...addressRecord, version: 2,
        validation: { branchId, actorId, deviceId, eventId, validatedAt: occurredAt } } }),
    } },
    { provide: CUSTOMER_DIRECTORY_READER_PORT, useValue: {
      search: async () => ({ status: "ok", result: { schemaVersion: 1, scope, candidates: [], nextCursor: null } }),
      read: missingRead,
    } },
    { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
  ] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/api/v1/customers`;
  const send = (route: string, body: unknown, authenticated = true) => fetch(`${url}/${route}`, {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer customer-http-fixture-token" } : {}) },
  });
  try {
    const routes = ["profile", "address", "address/validate", "search", "detail"];
    for (const route of routes) {
      assert.equal((await send(route, {}, false)).status, 401);
      assert.equal((await send(route, {})).status, 400);
    }
    assert.equal(calls, 0);
    const saved = await send("profile", profileCommand);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await saved.json(), { schemaVersion: 1, record: profileRecord, replayed: false });
    profileOutcome = { status: "replayed", record: profileRecord };
    assert.equal((await (await send("profile", profileCommand)).json() as { replayed: boolean }).replayed, true);
    for (const [route, body, expected] of [
      ["address", { ...common, addressId, address }, 200],
      ["address/validate", { ...common, addressId, expectedVersion: 1 }, 200],
      ["search", { schemaVersion: 1, scope, mode: "name", query: "Ana", limit: 20, cursor: null }, 200],
      ["detail", { schemaVersion: 1, scope, customerId }, 404],
    ] as const) {
      const response = await send(route, body);
      assert.equal(response.status, expected);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.equal((await send("profile", { ...profileCommand, actorId })).status, 400);
    active = false;
    const beforeDenied = calls;
    assert.equal((await send("profile", profileCommand)).status, 403);
    assert.equal(calls, beforeDenied);
    active = true;
    for (const [outcome, status, code] of [
      [{ status: "conflict" }, 409, "CUSTOMER_CONFLICT"],
      [{ status: "denied" }, 403, "ACTION_NOT_AUTHORIZED"],
      [{ status: "applied", record: {} }, 503, "CUSTOMER_UNAVAILABLE"],
    ] as const) {
      profileOutcome = outcome;
      const response = await send("profile", profileCommand);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { code });
    }
    fail = true;
    const response = await send("profile", profileCommand);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "CUSTOMER_UNAVAILABLE" });
  } finally { await app.close(); }
});

function harness(outcomes: Partial<Record<keyof CustomerDirectoryWriterPort, unknown>> = {}, failProfile = false) {
  const calls: Array<{ kind: string; actorId: string; command: unknown }> = [];
  let active = true;
  const authorization = new MembershipAuthorizationService({
    findActiveMembership: async () => active ? { roles: ["waiter"], scope } : undefined,
  });
  const writer: CustomerDirectoryWriterPort = {
    saveProfile: async (receivedActor, command) => { calls.push({ kind: "profile", actorId: receivedActor, command }); if (failProfile) throw new Error("private database detail"); return outcomes.saveProfile ?? { status: "applied", record: profileRecord }; },
    saveAddress: async (receivedActor, command) => { calls.push({ kind: "address", actorId: receivedActor, command }); return outcomes.saveAddress ?? { status: "applied", record: addressRecord }; },
    validateAddress: async (receivedActor, command) => { calls.push({ kind: "validate", actorId: receivedActor, command }); return outcomes.validateAddress ?? { status: "applied", record: {
      ...addressRecord, version: 2, validation: { branchId, eventId, actorId, deviceId, validatedAt: occurredAt },
    } }; },
  };
  return { service: new CustomerDirectoryService(authorization, writer), calls, revoke: () => { active = false; } };
}

test("profile save authorizes the exact branch and validates server-derived normalized contacts", async () => {
  const { service, calls } = harness();
  const result = await service.saveProfile(principal, profileCommand);
  assert.deepEqual(result, { schemaVersion: 1, record: profileRecord, replayed: false });
  assert.deepEqual(calls, [{ kind: "profile", actorId, command: profileCommand }]);
  assert.ok(Object.isFrozen(result.record.phones[0]));
  const replay = harness({ saveProfile: { status: "replayed", record: profileRecord } });
  assert.equal((await replay.service.saveProfile(principal, profileCommand)).replayed, true);
});

test("profile save distinguishes create/update and rejects incompatible returned facts", async () => {
  const updateCommand = { ...profileCommand, expectedVersion: 1 };
  const updated = { ...profileRecord, version: 2 };
  assert.equal((await harness({ saveProfile: { status: "applied", record: updated } }).service.saveProfile(principal, updateCommand)).record.version, 2);
  for (const record of [{ ...profileRecord, restaurantId: branchId }, { ...profileRecord, customerId: branchId },
    { ...profileRecord, version: 2 }, { ...profileRecord, displayName: "Other" },
    { ...profileRecord, phones: [{ ...profileRecord.phones[0]!, normalizedValue: "private" }] }]) {
    await assert.rejects(harness({ saveProfile: { status: "applied", record } }).service.saveProfile(principal, profileCommand),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
  }
});

test("address save requires exact detached fields and cleared validation", async () => {
  const command = { ...common, addressId, address };
  const { service, calls } = harness();
  const result = await service.saveAddress(principal, command);
  assert.deepEqual(result.record.address, address);
  assert.equal(result.record.validation, null);
  assert.equal(calls[0]?.kind, "address");
  for (const record of [{ ...addressRecord, addressId: contactId }, { ...addressRecord, validation: {
    branchId, eventId, actorId, deviceId, validatedAt: occurredAt,
  } }, { ...addressRecord, address: { ...address, label: "Other" } }]) {
    await assert.rejects(harness({ saveAddress: { status: "applied", record } }).service.saveAddress(principal, command),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
  }
});

test("address validation binds actor, branch, event, device and next version", async () => {
  const command = { ...common, expectedVersion: 1, addressId };
  const result = await harness().service.validateAddress(principal, command);
  assert.deepEqual(result.record.validation, { branchId, eventId, actorId, deviceId, validatedAt: occurredAt });
  for (const validation of [null, { branchId: contactId, eventId, actorId, deviceId, validatedAt: occurredAt },
    { branchId, eventId: contactId, actorId, deviceId, validatedAt: occurredAt },
    { branchId, eventId, actorId: contactId, deviceId, validatedAt: occurredAt }]) {
    const record = { ...addressRecord, version: 2, validation };
    await assert.rejects(harness({ validateAddress: { status: "applied", record } }).service.validateAddress(principal, command),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
  }
});

test("commands and authorization fail before writer; writer outcomes remain sanitized", async () => {
  const target = harness();
  await assert.rejects(target.service.saveProfile(principal, { ...profileCommand, actorId }),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "request");
  assert.equal(target.calls.length, 0);
  target.revoke();
  await assert.rejects(target.service.saveProfile(principal, profileCommand),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "authorization");
  assert.equal(target.calls.length, 0);
  for (const [outcome, code] of [[{ status: "conflict" }, "conflict"], [{ status: "denied" }, "authorization"],
    [{ status: "applied", record: profileRecord, extra: true }, "unavailable"], [new Proxy({}, {}), "unavailable"]] as const) {
    await assert.rejects(harness({ saveProfile: outcome }).service.saveProfile(principal, profileCommand),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === code);
  }
  const failure = harness({}, true);
  await assert.rejects(failure.service.saveProfile(principal, profileCommand),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.message === "CUSTOMER_DIRECTORY_UNAVAILABLE");
});

test("PostgreSQL adapter binds actor, fixed operation and canonical command without dynamic SQL", async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const result = { status: "applied", record: profileRecord };
  const database: DatabaseClientPort = { query: async (sql, parameters) => { calls.push({ sql, parameters }); return { rows: [{ result }] }; } };
  const adapter = new PostgresCustomerDirectoryWriter(database);
  assert.equal(await adapter.saveProfile(actorId, profileCommand), result);
  const addressCommand = { ...common, addressId, address };
  await adapter.saveAddress(actorId, addressCommand);
  await adapter.validateAddress(actorId, { ...common, expectedVersion: 1, addressId });
  assert.deepEqual(calls.map(call => call.sql), Array(3).fill(
    "select app_private.mutate_customer_directory($1::uuid, $2::text, $3::jsonb) as result"));
  assert.deepEqual(calls.map(call => call.parameters[1]), ["customer.profile_saved", "customer.address_saved", "customer.address_validated"]);
  assert.equal(calls.every(call => call.parameters[0] === actorId && typeof call.parameters[2] === "string"), true);
  assert.deepEqual(JSON.parse(calls[0]!.parameters[2] as string), profileCommand);

  await assert.rejects(adapter.saveProfile("bad", profileCommand), (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "request");
  await assert.rejects(adapter.saveProfile(actorId, { ...profileCommand, actorId } as never),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "request");
  for (const rows of [[], [{ result }, { result }], [{ other: result }], [new Proxy({ result }, {})]]) {
    const invalid = new PostgresCustomerDirectoryWriter({ query: async () => ({ rows }) });
    await assert.rejects(invalid.saveProfile(actorId, profileCommand),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
  }
});

test("directory search authorizes branch context, bounds results and preserves explicit candidates", async () => {
  const query = { schemaVersion: 1 as const, scope, mode: "phone" as const, query: "+52 (642) 123-4567", limit: 2, cursor: null };
  const candidate = { customerId, displayName: "Ana", phones: profileRecord.phones.map(phone => ({
    contactId: phone.contactId, label: phone.label, displayValue: phone.displayValue,
  })), addresses: [{ addressId, label: "Casa",
    streetLine: "Uno 10", neighborhood: null, locality: "Navojoa", version: 2, validatedForRequestedBranch: true }],
  version: 1, updatedAt: occurredAt };
  const calls: unknown[] = [];
  const authorization = new MembershipAuthorizationService({ findActiveMembership: async () => ({ roles: ["cashier"], scope }) });
  const reader: CustomerDirectoryReaderPort = { read: missingRead, search: async (receivedActor, receivedQuery) => {
    calls.push({ receivedActor, receivedQuery });
    return { status: "ok", result: { schemaVersion: 1, scope, candidates: [candidate], nextCursor: null } };
  } };
  const service = new CustomerDirectoryQueryService(authorization, reader);
  const result = await service.search(principal, query);
  assert.equal(result.candidates[0]?.customerId, customerId);
  assert.equal(result.candidates[0]?.addresses[0]?.validatedForRequestedBranch, true);
  assert.deepEqual(calls, [{ receivedActor: actorId, receivedQuery: query }]);
  assert.ok(Object.isFrozen(result.candidates[0]?.addresses));
  await assert.rejects(service.search(principal, { ...query, cursor: { updatedAt: occurredAt, customerId } }),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
  const precedingCursor = { updatedAt: "2026-09-17T18:00:00.000Z", customerId };
  assert.equal((await service.search(principal, { ...query, cursor: precedingCursor })).candidates.length, 1);

  await assert.rejects(service.search(principal, { ...query, actorId }),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "request");
  const foreign = new CustomerDirectoryQueryService(authorization, { read: missingRead, search: async () => ({ status: "ok", result: { schemaVersion: 1,
    scope: parseBranchScope({ restaurantId, branchId: addressId })!, candidates: [candidate], nextCursor: null } }) });
  await assert.rejects(foreign.search(principal, query),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
  const overLimit = new CustomerDirectoryQueryService(authorization, { read: missingRead, search: async () => ({ status: "ok", result: { schemaVersion: 1,
    scope, candidates: [candidate, { ...candidate, customerId: contactId }], nextCursor: {
      updatedAt: occurredAt, customerId: contactId,
    } } }) });
  await assert.rejects(overLimit.search(principal, { ...query, limit: 1 }),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
});

test("directory search rechecks membership and sanitizes reader failures", async () => {
  const query = { schemaVersion: 1 as const, scope, mode: "name" as const, query: "Ana", limit: 20, cursor: null };
  let active = false;
  const authorization = new MembershipAuthorizationService({ findActiveMembership: async () => active ? { roles: ["waiter"], scope } : undefined });
  let calls = 0;
  const reader: CustomerDirectoryReaderPort = { read: missingRead, search: async () => { calls += 1; throw new Error("private query detail"); } };
  const service = new CustomerDirectoryQueryService(authorization, reader);
  await assert.rejects(service.search(principal, query),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "authorization");
  assert.equal(calls, 0);
  active = true;
  await assert.rejects(service.search(principal, query),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.message === "CUSTOMER_DIRECTORY_UNAVAILABLE");
  assert.equal(calls, 1);
  for (const [outcome, code] of [[{ status: "denied" }, "authorization"], [{ status: "rejected" }, "unavailable"],
    [{ status: "ok", result: {}, extra: true }, "unavailable"]] as const) {
    const target = new CustomerDirectoryQueryService(new MembershipAuthorizationService({
      findActiveMembership: async () => ({ roles: ["waiter"], scope }),
    }), { read: missingRead, search: async () => outcome });
    await assert.rejects(target.search(principal, query),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === code);
  }
});

test("PostgreSQL search adapter uses one fixed private query and rejects ambiguous rows", async () => {
  const query = { schemaVersion: 1 as const, scope, mode: "address" as const, query: "Navojoa", limit: 20, cursor: null };
  const outcome = { status: "ok", result: { schemaVersion: 1, scope, candidates: [], nextCursor: null } };
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const adapter = new PostgresCustomerDirectoryReader({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: outcome }] };
  } });
  assert.equal(await adapter.search(actorId, query), outcome);
  assert.deepEqual(calls, [{ sql: "select app_private.search_customer_directory($1::uuid, $2::jsonb) as result",
    parameters: [actorId, JSON.stringify(query)] }]);
  await assert.rejects(adapter.search("bad", query), (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "request");
  await assert.rejects(adapter.search(actorId, { ...query, actorId } as never),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "request");
  for (const rows of [[], [{ result: outcome }, { result: outcome }], [{ other: outcome }], [new Proxy({ result: outcome }, {})]]) {
    await assert.rejects(new PostgresCustomerDirectoryReader({ query: async () => ({ rows }) }).search(actorId, query),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
  }
});

test("directory detail authorizes exact scope and returns one explicit identity without private keys", async () => {
  const query = { schemaVersion: 1 as const, scope, customerId };
  const detail = { schemaVersion: 1, scope, customer: { customerId, displayName: "Ana",
    phones: profileCommand.phones, version: 1, updatedAt: occurredAt }, addresses: [{ addressId, address,
    version: 1, updatedAt: occurredAt, validatedForRequestedBranch: false }], addressesTruncated: false };
  const calls: unknown[] = [];
  const authorization = new MembershipAuthorizationService({ findActiveMembership: async () => ({ roles: ["cashier"], scope }) });
  const reader: CustomerDirectoryReaderPort = { search: async () => ({ status: "rejected" }),
    read: async (receivedActor, receivedQuery) => { calls.push({ receivedActor, receivedQuery }); return { status: "ok", result: detail }; } };
  const service = new CustomerDirectoryQueryService(authorization, reader);
  const result = await service.read(principal, query);
  assert.equal(result.customer.customerId, customerId);
  assert.equal(result.addresses[0]?.address.instructions, null);
  assert.deepEqual(calls, [{ receivedActor: actorId, receivedQuery: query }]);
  assert.ok(Object.isFrozen(result.addresses[0]?.address));

  await assert.rejects(service.read(principal, { ...query, actorId }),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "request");
  for (const [outcome, code] of [[{ status: "missing" }, "not_found"], [{ status: "denied" }, "authorization"],
    [{ status: "rejected" }, "unavailable"], [{ status: "ok", result: { ...detail,
      customer: { ...detail.customer, customerId: contactId } } }, "unavailable"]] as const) {
    const target = new CustomerDirectoryQueryService(authorization, { search: async () => ({ status: "rejected" }), read: async () => outcome });
    await assert.rejects(target.read(principal, query),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === code);
  }
});

test("PostgreSQL detail adapter uses one fixed private query and rejects ambiguous rows", async () => {
  const query = { schemaVersion: 1 as const, scope, customerId };
  const outcome = { status: "missing" };
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const adapter = new PostgresCustomerDirectoryReader({ query: async (sql, parameters) => {
    calls.push({ sql, parameters }); return { rows: [{ result: outcome }] };
  } });
  assert.equal(await adapter.read(actorId, query), outcome);
  assert.deepEqual(calls, [{ sql: "select app_private.read_customer_directory($1::uuid, $2::jsonb) as result",
    parameters: [actorId, JSON.stringify(query)] }]);
  await assert.rejects(adapter.read("bad", query),
    (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "request");
  for (const rows of [[], [{ result: outcome }, { result: outcome }], [{ other: outcome }], [new Proxy({ result: outcome }, {})]]) {
    await assert.rejects(new PostgresCustomerDirectoryReader({ query: async () => ({ rows }) }).read(actorId, query),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "unavailable");
  }
});
