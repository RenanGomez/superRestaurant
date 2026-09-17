import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseBranchScope } from "@super-restaurant/shared-types";
import { MembershipAuthorizationService } from "../auth/membership-authorization.js";
import { PostgresMembershipLookup } from "../auth/postgres-membership-lookup.js";
import { CustomerDirectoryApplicationError, CustomerDirectoryQueryService, CustomerDirectoryService,
  PostgresCustomerDirectoryReader, PostgresCustomerDirectoryWriter } from "../customer-directory.js";
import type { DatabaseClientPort } from "../database.js";
import type { SchemaVerificationSession } from "./schema-verification.js";
import { verifyCustomerDirectoryHttp } from "./customer-directory-http-verification.js";

/** Caller owns BEGIN/ROLLBACK and postcheck. No second connection or persistent fixture. */
export async function verifyCustomerDirectoryAdapters(session: SchemaVerificationSession, http = false): Promise<void> {
  let queryIndex = 0;
  const database: DatabaseClientPort = { query: async (sql, parameters) => {
    queryIndex += 1;
    try { return await session.query(sql, parameters); } catch (error: unknown) {
      process.stdout.write(`${JSON.stringify({ stage: "customer_adapter_query", status: "failed", queryIndex })}\n`);
      throw error;
    }
  } };
  const actors = await database.query("select id::text as id from auth.users where deleted_at is null order by id limit 1", []);
  const actorId = (actors.rows[0] as { id?: unknown } | undefined)?.id;
  if (typeof actorId !== "string") throw new Error("CUSTOMER_ADAPTER_ACTOR_REQUIRED");
  const restaurantId = randomUUID(), branchId = randomUUID(), membershipId = randomUUID();
  const scope = parseBranchScope({ restaurantId, branchId });
  if (scope === undefined) throw new Error("CUSTOMER_ADAPTER_SCOPE_REJECTED");
  await database.query("insert into app.restaurants(id,name,time_zone) values($1,'rollback-only customer adapter','America/Hermosillo')", [restaurantId]);
  await database.query("insert into app.branches(id,restaurant_id,name) values($1,$2,'rollback-only customer adapter')", [branchId, restaurantId]);
  await database.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values($1,$2,$3,$4,$2)", [membershipId, actorId, restaurantId, branchId]);
  await database.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values($1,'cashier',$2)", [membershipId, actorId]);
  const authorization = new MembershipAuthorizationService(new PostgresMembershipLookup(database));
  const service = new CustomerDirectoryService(authorization, new PostgresCustomerDirectoryWriter(database));
  const queries = new CustomerDirectoryQueryService(authorization, new PostgresCustomerDirectoryReader(database));
  const principal = { actorId };
  const customerId = randomUUID(), addressId = randomUUID();
  const common = { schemaVersion: 1 as const, scope, customerId, expectedVersion: 0,
    eventId: randomUUID(), deviceId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: new Date().toISOString() };
  const profile = { ...common, displayName: "Adapter fixture", phones: [{ contactId: randomUUID(), label: "Casa", displayValue: "+52 (642) 123-4567" }] };
  // Explicitly authorized, rollback-only PG17 membership change. The caller's
  // baseline/postcheck audits require ADMIN true, INHERIT false and SET false.
  await session.query(`DO $guard$ BEGIN
    IF current_user <> 'postgres' OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
      JOIN pg_catalog.pg_roles u ON u.oid = m.member
      WHERE r.rolname = 'app_api' AND u.rolname = 'postgres'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
    ) THEN RAISE EXCEPTION 'CUSTOMER_ADAPTER_MEMBERSHIP_REJECTED'; END IF;
  END $guard$`);
  await session.query("GRANT app_api TO postgres WITH SET TRUE");
  await session.query("SET LOCAL ROLE app_api");
  try {
    assert.equal((await service.saveProfile(principal, profile)).record.version, 1);
    assert.equal((await service.saveProfile(principal, profile)).replayed, true);
    await assert.rejects(service.saveProfile(principal, { ...profile, displayName: "Divergent" }),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "conflict");
    const address = { label: "Casa", streetLine: "Uno 10", unit: null, neighborhood: null, locality: "Navojoa",
      region: null, countryCode: "MX", postalCode: null, references: null, instructions: null, coordinates: null };
    const addressCommand = { ...common, eventId: randomUUID(), idempotencyKey: randomUUID(), addressId, address };
    assert.equal((await service.saveAddress(principal, addressCommand)).record.validation, null);
    const validation = { ...common, expectedVersion: 1, eventId: randomUUID(), idempotencyKey: randomUUID(), addressId };
    assert.equal((await service.validateAddress(principal, validation)).record.validation?.branchId, branchId);
    const detail = await queries.read(principal, { schemaVersion: 1, scope, customerId });
    assert.equal(detail.addresses[0]?.validatedForRequestedBranch, true);
    const search = await queries.search(principal, { schemaVersion: 1, scope, mode: "phone", query: "+52 642 123 4567", limit: 20, cursor: null });
    assert.equal(search.candidates[0]?.customerId, customerId);
    await assert.rejects(queries.read(principal, { schemaVersion: 1, scope, customerId: randomUUID() }),
      (error: unknown) => error instanceof CustomerDirectoryApplicationError && error.code === "not_found");
    if (http) await verifyCustomerDirectoryHttp(session, database, { actorId, restaurantId, branchId, membershipId });
  } finally {
    await session.query("RESET ROLE");
    await session.query("GRANT app_api TO postgres WITH SET FALSE");
  }
}
