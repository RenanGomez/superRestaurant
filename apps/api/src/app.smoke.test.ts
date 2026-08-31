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
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      databaseCalls.push({ parameters: [...parameters], sql });
      if (sql.includes("list_active_branch_memberships")) {
        if (directoryFailure) throw new Error("database unavailable");
        return { rows: directoryRows };
      }
      return {
        rows: parameters[2] === branchId
          ? [{ branch_id: branchId, restaurant_id: restaurantId, roles: ["manager"] }]
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
  } finally {
    await app.close();
  }
});
