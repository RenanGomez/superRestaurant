import assert from "node:assert/strict";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { BranchScope, MembershipRoleCode } from "@super-restaurant/shared-types";

import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "../auth/authentication.js";
import type { MembershipDirectoryPort } from "../auth/membership-directory.js";
import type { DatabaseClientPort, DatabaseQueryResult, TransactionalDatabaseClientPort } from "../database.js";
import { RecipesController } from "./recipes.controller.js";
import { RecipeApplicationError, RecipesService } from "./recipes.service.js";

const principal = { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" };
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const otherRestaurantId = "9f8a5f0a-93ee-4a0b-9f0e-6a2a5f2a1234";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const productId = "a72573ec-6224-4857-bc4a-f3d1d07b6d83";
const recipeId = "9544c299-d25b-44ce-98ed-d30116610887";
const recipeV1Id = "4165567a-d09b-40d0-9c82-39a808967cab";
const itemId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const sugarId = "b98b5914-002d-42a0-a26b-2a0f954ddf1e";
const scope = { restaurantId, branchId } as unknown as BranchScope;

const validCommand = {
  restaurantId,
  productId,
  modifierId: null,
  notes: null,
  lines: [{ itemId, quantity: 600, unitCode: "g" }],
};

const readRows = Object.freeze([
  Object.freeze({
    recipe_id: recipeId,
    restaurant_id: restaurantId,
    product_id: productId,
    modifier_id: null,
    version: 2,
    active: true,
    notes: null,
    item_id: itemId,
    quantity: 600,
    unit_code: "g",
  }),
  Object.freeze({
    recipe_id: recipeId,
    restaurant_id: restaurantId,
    product_id: productId,
    modifier_id: null,
    version: 2,
    active: true,
    notes: null,
    item_id: sugarId,
    quantity: 200,
    unit_code: "ml",
  }),
]);

const listRows = Object.freeze([
  Object.freeze({
    recipe_id: recipeId,
    restaurant_id: restaurantId,
    product_id: productId,
    modifier_id: null,
    version: 2,
    active: true,
    notes: null,
    created_at: new Date("2026-11-26T12:00:00.000Z"),
  }),
  Object.freeze({
    recipe_id: recipeV1Id,
    restaurant_id: restaurantId,
    product_id: productId,
    modifier_id: null,
    version: 1,
    active: false,
    notes: "primera",
    created_at: new Date("2026-11-26T11:00:00.000Z"),
  }),
]);

const expectedVersion = Object.freeze({
  restaurantId,
  recipeId,
  productId,
  version: 2,
  lines: [
    { itemId, quantity: 600, unitCode: "g" },
    { itemId: sugarId, quantity: 200, unitCode: "ml" },
  ],
});

type Handler = (sql: string, parameters: readonly unknown[]) => readonly unknown[] | Promise<readonly unknown[]>;

class FakeDatabase implements TransactionalDatabaseClientPort {
  public readonly queries: { sql: string; parameters: readonly unknown[] }[] = [];

  public constructor(private readonly handler: Handler) {}

  public async query(sql: string, parameters: readonly unknown[]): Promise<DatabaseQueryResult> {
    this.queries.push({ sql, parameters });
    return { rows: [...await this.handler(sql, parameters)] };
  }

  public async transaction<Result>(operation: (database: DatabaseClientPort) => Promise<Result>): Promise<Result> {
    return operation(this);
  }
}

function defaultHandler(sql: string): readonly unknown[] {
  if (sql.includes("app_private.publish_inventory_recipe")) {
    return [{ result: { recipeId, version: 2 } }];
  }
  if (sql.includes("app_private.read_inventory_recipe")) return readRows;
  if (sql.includes("app_private.list_inventory_recipes")) return listRows;
  return [];
}

function code(expected: string) {
  return (error: unknown) => error instanceof RecipeApplicationError && error.code === expected;
}

function directoryFor(roles: readonly MembershipRoleCode[]): MembershipDirectoryPort {
  return {
    listActiveMemberships: async () => ({
      schemaVersion: 1,
      memberships: [{
        branchName: "Sucursal",
        restaurantName: "Restaurante",
        roles,
        scope,
      }],
    }),
  };
}

function serviceFor(options: {
  roles?: readonly MembershipRoleCode[];
  handler?: Handler;
} = {}): { service: RecipesService; database: FakeDatabase } {
  const roles = options.roles ?? (["manager"] as const);
  const database = new FakeDatabase(options.handler ?? defaultHandler);
  const service = new RecipesService(directoryFor(roles), database);
  return { service, database };
}

test("publishRecipe: validates with the shared parser and calls the publisher with the actor and payload", async () => {
  const { service, database } = serviceFor();
  const version = await service.publishRecipe(principal, validCommand);

  // The response is built from the command that just committed, not from a second read.
  assert.deepEqual(version, {
    restaurantId,
    recipeId,
    productId,
    version: 2,
    lines: [{ itemId, quantity: 600, unitCode: "g" }],
  });

  const publish = database.queries.find((query) => query.sql.includes("publish_inventory_recipe"));
  assert.deepEqual(publish?.parameters.slice(0, 2), [principal.actorId, restaurantId]);
  assert.deepEqual(JSON.parse(String(publish?.parameters[2])), {
    productId,
    modifierId: null,
    notes: null,
    lines: [{ itemId, quantity: 600, unitCode: "g" }],
  });
  assert.equal(database.queries.some((query) => query.sql.includes("read_inventory_recipe")), false);
});

test("publishRecipe: invalid payloads are request errors and never reach the database", async () => {
  const { service, database } = serviceFor();
  const invalidPayloads: unknown[] = [
    {},
    { ...validCommand, lines: [] },
    { ...validCommand, productId: "not-a-uuid" },
    { ...validCommand, lines: [{ itemId, quantity: 0, unitCode: "g" }] },
    { ...validCommand, recipeId },
  ];
  for (const payload of invalidPayloads) {
    await assert.rejects(service.publishRecipe(principal, payload), code("request"));
  }
  assert.equal(database.queries.length, 0);
});

test("publishRecipe: a role without catalog.manage is denied before any query", async () => {
  const { service, database } = serviceFor({ roles: ["cashier"] });
  await assert.rejects(service.publishRecipe(principal, validCommand), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("publishRecipe: a restaurant outside the actor's memberships is denied", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.publishRecipe(principal, { ...validCommand, restaurantId: otherRestaurantId }),
    code("authorization"),
  );
  assert.equal(database.queries.length, 0);
});

test("publishRecipe: SQLSTATEs map to request, conflict, authorization and unavailable", async () => {
  const cases: readonly (readonly [string, string])[] = [
    ["22000", "request"],
    ["23514", "request"],
    ["23503", "conflict"],
    ["42501", "authorization"],
  ];
  for (const [state, expected] of cases) {
    const handler: Handler = () => {
      throw Object.assign(new Error("sql failure"), { code: state });
    };
    const { service } = serviceFor({ handler });
    await assert.rejects(service.publishRecipe(principal, validCommand), code(expected));
  }

  const outage: Handler = () => {
    throw new Error("connection reset");
  };
  const { service } = serviceFor({ handler: outage });
  await assert.rejects(service.publishRecipe(principal, validCommand), code("unavailable"));
});

test("listRecipes: calls the restaurant-scoped listing with the actor and product", async () => {
  const { service, database } = serviceFor();
  const result = await service.listRecipes(principal, { restaurantId, productId });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.restaurantId, restaurantId);
  assert.equal(result.productId, productId);
  assert.deepEqual(result.recipes, [
    {
      recipeId,
      restaurantId,
      productId,
      modifierId: null,
      version: 2,
      active: true,
      notes: null,
      createdAt: "2026-11-26T12:00:00.000Z",
    },
    {
      recipeId: recipeV1Id,
      restaurantId,
      productId,
      modifierId: null,
      version: 1,
      active: false,
      notes: "primera",
      createdAt: "2026-11-26T11:00:00.000Z",
    },
  ]);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, productId, false]);
  assert.equal(database.queries[0]?.sql.includes("app_private.list_inventory_recipes"), true);
});

test("listRecipes: includeInactive accepts the query-string boolean and defaults to active only", async () => {
  const { service, database } = serviceFor();
  await service.listRecipes(principal, { restaurantId, productId, includeInactive: "true" });
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, productId, true]);

  const second = serviceFor();
  await second.service.listRecipes(principal, { restaurantId, productId });
  assert.deepEqual(second.database.queries[0]?.parameters, [principal.actorId, restaurantId, productId, false]);

  await assert.rejects(
    service.listRecipes(principal, { restaurantId, productId, includeInactive: "maybe" }),
    code("request"),
  );
});

test("listRecipes: a foreign restaurant is rejected before touching the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.listRecipes(principal, { restaurantId: otherRestaurantId, productId }),
    code("authorization"),
  );
  assert.equal(database.queries.length, 0);
});

test("readRecipeById: returns the published version with its lines", async () => {
  const { service, database } = serviceFor();
  const version = await service.readRecipeById(principal, recipeId, { restaurantId });
  assert.deepEqual(version, expectedVersion);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, recipeId]);
  assert.equal(database.queries[0]?.sql.includes("app_private.read_inventory_recipe"), true);
});

test("readRecipeById: an unknown id is missing, never a silent empty recipe", async () => {
  const handler: Handler = (sql) => (sql.includes("read_inventory_recipe") ? [] : defaultHandler(sql));
  const { service } = serviceFor({ handler });
  await assert.rejects(service.readRecipeById(principal, recipeId, { restaurantId }), code("missing"));
});

test("readRecipeById: an invalid id or a missing restaurant scope is a request error", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.readRecipeById(principal, "not-a-uuid", { restaurantId }), code("request"));
  await assert.rejects(service.readRecipeById(principal, recipeId, {}), code("request"));
  assert.equal(database.queries.length, 0);
});

test("readRecipeById: a reader without catalog.read is denied", async () => {
  const { service, database } = serviceFor({ roles: ["kitchen"] });
  await assert.rejects(service.readRecipeById(principal, recipeId, { restaurantId }), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("HTTP contract: 401, 201 no-store, 400 on invalid ids and 200 on the version list", async () => {
  const { service } = serviceFor();
  const module = await Test.createTestingModule({
    controllers: [RecipesController],
    providers: [
      { provide: RecipesService, useValue: service },
      { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/api/v1/inventory/recipes`;
  const authorization = { authorization: "Bearer inventory-fixture-token" };
  try {
    const unauthenticated = await fetch(`${url}?restaurantId=${restaurantId}&productId=${productId}`);
    assert.equal(unauthenticated.status, 401);

    const published = await fetch(url, {
      method: "POST",
      body: JSON.stringify(validCommand),
      headers: { "content-type": "application/json", ...authorization },
    });
    assert.equal(published.status, 201);
    assert.equal(published.headers.get("cache-control"), "private, no-store");
    const publishedBody = await published.json() as { recipeId: string; version: number };
    assert.equal(publishedBody.recipeId, recipeId);
    assert.equal(publishedBody.version, 2);

    const listed = await fetch(`${url}?restaurantId=${restaurantId}&productId=${productId}`, { headers: authorization });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json() as { recipes: readonly { version: number }[] };
    assert.deepEqual(listedBody.recipes.map((recipe) => recipe.version), [2, 1]);

    const invalid = await fetch(`${url}/not-a-uuid?restaurantId=${restaurantId}`, { headers: authorization });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { code: "INVENTORY_REQUEST_INVALID" });
  } finally {
    await app.close();
  }
});
