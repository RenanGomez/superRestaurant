import assert from "node:assert/strict";
import test from "node:test";

import { Test } from "@nestjs/testing";

import { AppModule } from "./app.module.js";
import { AUTH_PRINCIPAL_VERIFIER } from "./auth/authentication.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const actorId = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";

test("Nest wiring keeps health public and all other routes authenticated by default", async () => {
  const databaseCalls: { parameters: readonly unknown[]; sql: string }[] = [];
  let directoryFailure = false;
  let directoryRows: readonly unknown[] = [];
  let membershipRoles: readonly string[] = ["manager"];
  let diningZoneWrites = 0;
  let diningTableWrites = 0;
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      databaseCalls.push({ parameters: [...parameters], sql });
      if (sql.includes("list_active_branch_memberships")) {
        if (directoryFailure) throw new Error("database unavailable");
        return { rows: directoryRows };
      }
      if (sql.includes("create_dining_zone")) {
        diningZoneWrites += 1;
        return {
          rows: [{
            status: "created",
            schema_version: 1,
            restaurant_id: parameters[1],
            branch_id: parameters[2],
            zone_id: parameters[3],
            zone_name: parameters[8],
            zone_version: "1",
            created_at: new Date("2026-08-31T17:00:01.000Z"),
            created_by: parameters[0],
          }],
        };
      }
      if (sql.includes("list_dining_layout")) {
        return { rows: [{ layout: { schemaVersion: 1, scope: { restaurantId: parameters[1], branchId: parameters[2] }, zones: [] } }] };
      }
      if (sql.includes("create_dining_table")) {
        diningTableWrites += 1;
        return { rows: [{ status: "created", schema_version: 1, restaurant_id: parameters[1], branch_id: parameters[2],
          table_id: parameters[3], zone_id: parameters[4], table_name: parameters[9], capacity: parameters[10],
          shape: parameters[11], layout_x: parameters[12], layout_y: parameters[13], layout_width: parameters[14],
          layout_height: parameters[15], table_version: "1", updated_at: new Date("2026-09-01T18:00:01.000Z"), updated_by: parameters[0] }] };
      }
      return {
        rows: parameters[2] === branchId
          ? [{ branch_id: branchId, restaurant_id: restaurantId, roles: membershipRoles }]
          : [],
      };
    },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AUTH_PRINCIPAL_VERIFIER)
    .useValue({ verifyAccessToken: async () => Object.freeze({ actorId }) })
    .overrideProvider(DATABASE_CLIENT)
    .useValue(database)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  try {
    app.setGlobalPrefix("api/v1");
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();

    const healthResponse = await fetch(`${url}/api/v1/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "ok" });

    const sessionResponse = await fetch(`${url}/api/v1/session`);
    assert.equal(sessionResponse.status, 401);
    assert.deepEqual(await sessionResponse.json(), {
      code: "AUTHENTICATION_REQUIRED",
    });

    const authenticatedSessionResponse = await fetch(`${url}/api/v1/session`, {
      headers: { authorization: "Bearer valid-smoke-access-token" },
    });
    assert.equal(authenticatedSessionResponse.status, 200);
    assert.equal(authenticatedSessionResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await authenticatedSessionResponse.json(), { actorId });

    const unauthenticatedDirectoryResponse = await fetch(`${url}/api/v1/access/memberships`);
    assert.equal(unauthenticatedDirectoryResponse.status, 401);
    assert.deepEqual(await unauthenticatedDirectoryResponse.json(), { code: "AUTHENTICATION_REQUIRED" });

    const emptyDirectoryResponse = await fetch(`${url}/api/v1/access/memberships`, {
      headers: { authorization: "Bearer valid-smoke-access-token" },
    });
    assert.equal(emptyDirectoryResponse.status, 200);
    assert.equal(emptyDirectoryResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await emptyDirectoryResponse.json(), { memberships: [], schemaVersion: 1 });

    const secondBranchId = "b98b5914-002d-42a0-a26b-2a0f954ddf1e";
    directoryRows = [
      {
        branch_id: branchId,
        branch_name: "Sucursal Norte",
        restaurant_id: restaurantId,
        restaurant_name: "Restaurante Centro",
        roles: ["manager", "waiter"],
      },
      {
        branch_id: secondBranchId,
        branch_name: "Sucursal Sur",
        restaurant_id: restaurantId,
        restaurant_name: "Restaurante Centro",
        roles: ["viewer"],
      },
    ];
    const directoryResponse = await fetch(`${url}/api/v1/access/memberships`, {
      headers: { authorization: "Bearer valid-smoke-access-token" },
    });
    assert.equal(directoryResponse.status, 200);
    assert.deepEqual(await directoryResponse.json(), {
      memberships: [
        {
          branchName: "Sucursal Norte",
          restaurantName: "Restaurante Centro",
          roles: ["manager", "waiter"],
          scope: { branchId, restaurantId },
        },
        {
          branchName: "Sucursal Sur",
          restaurantName: "Restaurante Centro",
          roles: ["viewer"],
          scope: { branchId: secondBranchId, restaurantId },
        },
      ],
      schemaVersion: 1,
    });
    const directoryCall = databaseCalls.find((call) => call.sql.includes("list_active_branch_memberships"));
    assert.deepEqual(directoryCall?.parameters, [actorId]);

    directoryFailure = true;
    const unavailableDirectoryResponse = await fetch(`${url}/api/v1/access/memberships`, {
      headers: { authorization: "Bearer valid-smoke-access-token" },
    });
    assert.equal(unavailableDirectoryResponse.status, 503);
    assert.deepEqual(await unavailableDirectoryResponse.json(), { code: "MEMBERSHIP_DIRECTORY_UNAVAILABLE" });
    directoryFailure = false;

    const authorizedResponse = await fetch(`${url}/api/v1/access/branch`, {
      body: JSON.stringify({ restaurantId, branchId }),
      headers: { authorization: "Bearer valid-smoke-access-token", "content-type": "application/json" },
      method: "POST",
    });
    const authorizedBody = await authorizedResponse.json();
    assert.equal(authorizedResponse.status, 200, JSON.stringify({ authorizedBody, databaseCalls }));
    assert.equal(authorizedResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(authorizedBody, { branchId, restaurantId, roles: ["manager"] });

    const otherBranchResponse = await fetch(`${url}/api/v1/access/branch`, {
      body: JSON.stringify({ restaurantId, branchId: "b98b5914-002d-42a0-a26b-2a0f954ddf1e" }),
      headers: { authorization: "Bearer valid-smoke-access-token", "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(otherBranchResponse.status, 403);
    assert.deepEqual(await otherBranchResponse.json(), { code: "SCOPE_AUTHORIZATION_REJECTED" });

    const zoneCommand = {
      schemaVersion: 1,
      scope: { restaurantId, branchId },
      zoneId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
      eventId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
      idempotencyKey: "c483b6e7-e102-4cc5-a887-d30712c85e52",
      deviceId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
      occurredAt: "2026-08-31T17:00:00.000Z",
      name: "Terraza",
    };
    const unauthenticatedZoneResponse = await fetch(`${url}/api/v1/dining/zones`, {
      body: JSON.stringify(zoneCommand),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(unauthenticatedZoneResponse.status, 401);
    assert.deepEqual(await unauthenticatedZoneResponse.json(), { code: "AUTHENTICATION_REQUIRED" });

    const createdZoneResponse = await fetch(`${url}/api/v1/dining/zones`, {
      body: JSON.stringify(zoneCommand),
      headers: { authorization: "Bearer valid-smoke-access-token", "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(createdZoneResponse.status, 201);
    assert.equal(createdZoneResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await createdZoneResponse.json(), {
      schemaVersion: 1,
      scope: { restaurantId, branchId },
      zoneId: zoneCommand.zoneId,
      name: zoneCommand.name,
      version: 1,
      createdAt: "2026-08-31T17:00:01.000Z",
      createdBy: actorId,
      replayed: false,
    });
    assert.equal(diningZoneWrites, 1);

    membershipRoles = ["manager"];
    const layoutResponse = await fetch(`${url}/api/v1/dining/layout?restaurantId=${restaurantId}&branchId=${branchId}`, {
      headers: { authorization: "Bearer valid-smoke-access-token" },
    });
    assert.equal(layoutResponse.status, 200);
    assert.equal(layoutResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await layoutResponse.json(), { schemaVersion: 1, scope: { restaurantId, branchId }, zones: [] });

    const tableCommand = {
      schemaVersion: 1, scope: { restaurantId, branchId }, tableId: "9544c299-d25b-44ce-98ed-d30116610887",
      zoneId: zoneCommand.zoneId, eventId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
      idempotencyKey: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", deviceId: "88d34b74-6afe-4a3c-acb9-9fc8ed902c91",
      occurredAt: "2026-09-01T18:00:00.000Z", name: "Mesa 1", capacity: 4, shape: "round",
      layout: { x: 2, y: 3, width: 4, height: 4 },
    };
    const tableResponse = await fetch(`${url}/api/v1/dining/tables`, {
      body: JSON.stringify(tableCommand),
      headers: { authorization: "Bearer valid-smoke-access-token", "content-type": "application/json" }, method: "POST",
    });
    assert.equal(tableResponse.status, 201);
    assert.equal(tableResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await tableResponse.json(), { schemaVersion: 1, scope: { restaurantId, branchId },
      tableId: tableCommand.tableId, zoneId: tableCommand.zoneId, name: tableCommand.name, capacity: 4, shape: "round",
      layout: tableCommand.layout, version: 1, updatedAt: "2026-09-01T18:00:01.000Z", updatedBy: actorId, replayed: false });
    assert.equal(diningTableWrites, 1);

    membershipRoles = ["viewer"];
    const forbiddenTableResponse = await fetch(`${url}/api/v1/dining/tables`, {
      body: JSON.stringify({ ...tableCommand, tableId: "4165567a-d09b-40d0-9c82-39a808967cab" }),
      headers: { authorization: "Bearer valid-smoke-access-token", "content-type": "application/json" }, method: "POST",
    });
    assert.equal(forbiddenTableResponse.status, 403);
    assert.deepEqual(await forbiddenTableResponse.json(), { code: "ACTION_NOT_AUTHORIZED" });
    assert.equal(diningTableWrites, 1);

    membershipRoles = ["viewer"];
    const forbiddenZoneResponse = await fetch(`${url}/api/v1/dining/zones`, {
      body: JSON.stringify({ ...zoneCommand, zoneId: "4e42eea6-a374-47f1-9419-1adf7079c51d" }),
      headers: { authorization: "Bearer valid-smoke-access-token", "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(forbiddenZoneResponse.status, 403);
    assert.deepEqual(await forbiddenZoneResponse.json(), { code: "ACTION_NOT_AUTHORIZED" });
    assert.equal(diningZoneWrites, 1);
  } finally {
    await app.close();
  }
});
