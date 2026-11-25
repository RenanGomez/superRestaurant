import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { parseSyncEnvelopeV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal, parseBearerAuthorization } from "../auth/authentication.js";
import type { TransactionalDatabaseClientPort } from "../database.js";
import { SyncDeviceService } from "./sync-device.service.js";
import { SyncMergeExecutor } from "./sync-merge-executor.js";

const actor = "33333333-3333-4333-8333-333333333333";
const restaurantId = "44444444-4444-4444-8444-444444444444";
const branchId = "55555555-5555-4555-8555-555555555555";
const deviceId = "22222222-2222-4222-8222-222222222222";
const scope = { restaurantId, branchId };
const body = { deviceId, scope };

interface QueryCall {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

function serviceWith(
  query: (sql: string, parameters: readonly unknown[]) => Promise<{ readonly rows: readonly unknown[] }>,
  calls: QueryCall[] = [],
): SyncDeviceService {
  const database: TransactionalDatabaseClientPort = {
    query: async () => { throw new Error("unexpected pool query"); },
    transaction: (operation) => operation({
      query: async (sql, parameters) => {
        calls.push({ sql, parameters });
        return query(sql, parameters);
      },
    }),
  };
  return new SyncDeviceService(database);
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  if (typeof response !== "object" || response === null) return undefined;
  const code = (response as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

test("registra el dispositivo en el alcance autenticado", async () => {
  const calls: QueryCall[] = [];
  const service = serviceWith(async () => ({ rows: [{ registered: true }] }), calls);

  assert.deepEqual(await service.register(actor, body), { status: "active" });
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.sql ?? "", /app_private\.sync_register_device/u);
  assert.deepEqual(calls[0]?.parameters, [actor, restaurantId, branchId, deviceId]);
});

test("un alcance ajeno se rechaza con SYNC_SCOPE_FORBIDDEN", async () => {
  const service = serviceWith(async () => ({ rows: [{ registered: false }] }));
  await assert.rejects(
    service.register(actor, body),
    (error: unknown) => error instanceof ForbiddenException && codeOf(error) === "SYNC_SCOPE_FORBIDDEN",
  );
});

test("cuerpos inválidos no llegan a la base", async () => {
  const calls: QueryCall[] = [];
  const service = serviceWith(async () => ({ rows: [{ registered: true }] }), calls);
  const invalid: readonly unknown[] = [
    null,
    [],
    {},
    { ...body, extra: true },
    { scope },
    { deviceId: "not-a-uuid", scope },
    { deviceId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", scope },
    { deviceId, scope: { restaurantId } },
  ];
  for (const input of invalid) {
    await assert.rejects(
      service.register(actor, input),
      (error: unknown) => error instanceof BadRequestException && codeOf(error) === "SYNC_REQUEST_INVALID",
    );
  }
  assert.deepEqual(calls, []);
});

test("los SQLSTATE de la función se mapean a códigos estables", async () => {
  const forbidden = serviceWith(async () => { throw Object.assign(new Error("denied"), { code: "42501" }); });
  await assert.rejects(
    forbidden.register(actor, body),
    (error: unknown) => error instanceof ForbiddenException && codeOf(error) === "SYNC_SCOPE_FORBIDDEN",
  );

  const invalid = serviceWith(async () => { throw Object.assign(new Error("bad uuid"), { code: "22P02" }); });
  await assert.rejects(
    invalid.register(actor, body),
    (error: unknown) => error instanceof BadRequestException && codeOf(error) === "SYNC_DEVICE_INVALID",
  );
});

test("tras registrar, el ejecutor deja de rechazar el dispositivo como DEVICE_REVOKED", async () => {
  const registered = new Set<string>();
  const database: TransactionalDatabaseClientPort = {
    query: async () => { throw new Error("unexpected pool query"); },
    transaction: (operation) => operation({
      query: async (sql, parameters) => {
        if (sql.startsWith("SET LOCAL")) return { rows: [] };
        if (sql.includes("sync_register_device")) {
          registered.add(String(parameters[3]));
          return { rows: [{ registered: true }] };
        }
        if (sql.includes("sync_authorized")) {
          return { rows: [{ authorized: true, allowed: true, device: registered.has(String(parameters[3])) ? "active" : "unknown" }] };
        }
        if (sql.includes("sync_record_event")) {
          const candidate = JSON.parse(String(parameters[2])) as { readonly code: string };
          return { rows: [{ result: { status: "recorded", result: candidate } }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    }),
  };
  const executor = new SyncMergeExecutor(database, { verifyAccessToken: async () => ({ actorId: actor }) });
  const event = parseSyncEnvelopeV1({
    eventId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "device-registration", deviceId,
    actorId: actor, restaurantId, branchId, entityType: "Payment", entityId: "66666666-6666-4666-8666-666666666666",
    operation: "create", schemaVersion: "1", localSequence: 1, baseVersion: null,
    occurredAt: "2026-11-23T00:00:00.000Z", receivedAt: null, payload: { amountMinor: 1 }, retryCount: 0, localState: "pending",
  });
  assert.ok(event);
  assert.equal((await executor.execute("token", event))?.code, "DEVICE_REVOKED");

  const service = new SyncDeviceService(database);
  assert.deepEqual(await service.register(actor, body), { status: "active" });
  assert.equal((await executor.execute("token", event))?.code, "UNSUPPORTED_ENTITY");
});

test("sin principal autenticado o sin bearer el registro no procede", () => {
  assert.throws(
    () => getAuthenticatedPrincipal({ headers: {} }),
    (error: unknown) => error instanceof UnauthorizedException,
  );
  assert.equal(parseBearerAuthorization(undefined), undefined);
  const token = "a".repeat(20);
  assert.equal(parseBearerAuthorization(`Bearer ${token}`), token);
});
