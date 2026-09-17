import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module.js";
import { AccessTokenRejectedError, AUTH_PRINCIPAL_VERIFIER } from "../auth/authentication.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "../database.js";
import {
  CUSTOMER_DIRECTORY_READER_PORT, CUSTOMER_DIRECTORY_WRITER_PORT,
  PostgresCustomerDirectoryReader, PostgresCustomerDirectoryWriter,
} from "../customer-directory.js";
import type { SchemaVerificationSession } from "./schema-verification.js";

/** Real AppModule/guard/RBAC/SQL; controlled verifier, no Auth users or persistent writes.
 * Caller owns the sole PostgreSQL connection, BEGIN, app_api role and ROLLBACK/postcheck.
 */
export async function verifyCustomerDirectoryHttp(
  session: SchemaVerificationSession,
  database: DatabaseClientPort,
  fixture: { actorId: string; restaurantId: string; branchId: string; membershipId: string },
): Promise<void> {
  const { actorId, restaurantId, branchId, membershipId } = fixture;
  const token = `rollback-only-${randomUUID()}`;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_CLIENT).useValue(database)
    .overrideProvider(AUTH_PRINCIPAL_VERIFIER).useValue({ verifyAccessToken: async (value: string) => {
      if (value !== token) throw new AccessTokenRejectedError();
      return Object.freeze({ actorId });
    } }).compile();
  const app = module.createNestApplication({ logger: false });
  try {
    assert.equal(module.get(CUSTOMER_DIRECTORY_WRITER_PORT), module.get(PostgresCustomerDirectoryWriter));
    assert.equal(module.get(CUSTOMER_DIRECTORY_READER_PORT), module.get(PostgresCustomerDirectoryReader));
    app.setGlobalPrefix("api/v1");
    await app.listen(0, "127.0.0.1");
    const url = `${await app.getUrl()}/api/v1/customers`;
    const send = async (route: string, body: unknown, status: number, authorization: string | null = `Bearer ${token}`) => {
      const response = await fetch(`${url}/${route}`, { method: "POST", body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...(authorization === null ? {} : { authorization }) },
        signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, status);
      if (status !== 401) assert.equal(response.headers.get("cache-control"), "private, no-store");
      return await response.json() as Record<string, unknown>;
    };
    const scope = { restaurantId, branchId };
    const customerId = randomUUID(), addressId = randomUUID();
    const common = { schemaVersion: 1, scope, customerId, expectedVersion: 0,
      eventId: randomUUID(), deviceId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: new Date().toISOString() };
    const profile = { ...common, displayName: "HTTP rollback fixture",
      phones: [{ contactId: randomUUID(), label: "Casa", displayValue: "+52 (642) 987-6543" }] };
    const address = { label: "Casa", streetLine: "Dos 20", unit: null, neighborhood: null, locality: "Navojoa",
      region: null, countryCode: "MX", postalCode: null, references: null, instructions: null, coordinates: null };
    const addressCommand = { ...common, eventId: randomUUID(), idempotencyKey: randomUUID(), addressId, address };
    const validation = { ...common, expectedVersion: 1, eventId: randomUUID(), idempotencyKey: randomUUID(), addressId };
    const detail = { schemaVersion: 1, scope, customerId };
    const search = { schemaVersion: 1, scope, mode: "phone", query: "+52 642 987 6543", limit: 20, cursor: null };
    const cases = [["profile", profile], ["address", addressCommand], ["address/validate", validation],
      ["search", search], ["detail", detail]] as const;
    for (const [route, body] of cases) {
      await send(route, body, 401, null);
      await send(route, body, 401, "Bearer rejected-rollback-only-token");
      await send(route, {}, 400);
      await send(route, { ...body, scope: { restaurantId, branchId: randomUUID() } }, 403);
    }
    await send("profile", { ...profile, actorId }, 400);
    const saved = await send("profile", profile, 200);
    assert.equal((saved.record as { version: number }).version, 1);
    assert.equal(saved.replayed, false);
    assert.equal((await send("profile", profile, 200)).replayed, true);
    assert.deepEqual(await send("profile", { ...profile, displayName: "Divergent" }, 409), { code: "CUSTOMER_CONFLICT" });
    assert.equal((await send("address", addressCommand, 200)).replayed, false);
    await send("address/validate", validation, 200);
    const read = await send("detail", detail, 200);
    assert.equal((read.addresses as { validatedForRequestedBranch: boolean }[])[0]?.validatedForRequestedBranch, true);
    assert.equal((read.customer as { displayName: string }).displayName, profile.displayName);
    assert.equal(((await send("search", search, 200)).candidates as { customerId: string }[])[0]?.customerId, customerId);
    await send("detail", { ...detail, customerId: randomUUID() }, 404);
    // Role edits affect only the transaction's unique fixture membership.
    const setRole = async (role: string) => {
      await session.query("RESET ROLE");
      await session.query("update app.membership_role_grants set role_code=$2 where membership_id=$1", [membershipId, role]);
      await session.query("SET LOCAL ROLE app_api");
    };
    await setRole("viewer");
    for (const [route, body] of cases) await send(route, body, 403);
    await setRole("cashier");
    await send("detail", detail, 200);
    await session.query("RESET ROLE");
    await session.query("update app.memberships set revoked_at=clock_timestamp(), revoked_by=$2, revocation_reason='rollback-only HTTP revocation' where id=$1", [membershipId, actorId]);
    await session.query("SET LOCAL ROLE app_api");
    for (const [route, body] of cases) await send(route, body, 403);
    process.stdout.write(`${JSON.stringify({ stage: "customer_http", status: "ok", authVerifier: "controlled", persistenceRole: "app_api" })}\n`);
  } finally { await app.close(); }
}
