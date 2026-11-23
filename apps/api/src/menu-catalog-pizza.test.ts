import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope, type SaveMenuCatalogCommandV1 } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import { MenuCatalogApplicationError, MenuCatalogService, type MenuCatalogPort } from "./menu-catalog.js";
import { pizzaCatalogIssues, toDomainMenuCatalog, toDomainPizzaConfig } from "./menu-catalog-domain.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const scope = parseBranchScope({
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
});
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;

const PRODUCT = "9544c299-d25b-44ce-98ed-d30116610887";
const BASE_GROUP = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const EXTRA_GROUP = "a409ec59-9f5e-496d-a45d-b83a46b49675";
const VEGGIES_GROUP = "a409ec59-9f5e-496d-a45d-b83a46b49676";
const HAM = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const CHEESE = "c483b6e7-e102-4cc5-a887-d30712c85e53";
const BACON = "c483b6e7-e102-4cc5-a887-d30712c85e54";
const STRANGER = "c483b6e7-e102-4cc5-a887-d30712c85e99";

function group(groupId: string, name: string, optionId: string) {
  return {
    groupId,
    productId: PRODUCT,
    name,
    active: true,
    displayOrder: 0,
    minimumQuantity: 0,
    maximumQuantity: 4,
    options: [{ optionId, name, unitPriceMinor: 1_500, active: true, maximumQuantity: 2 }],
  };
}

function catalog(pizza: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    scope,
    eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
    idempotencyKey: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
    deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
    occurredAt: "2026-11-20T22:00:00.000Z",
    expectedVersion: 0,
    catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
    currency: "MXN",
    categories: [{ categoryId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", name: "Pizzas", active: true, displayOrder: 0 }],
    products: [{
      productId: PRODUCT,
      categoryId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
      name: "Pizza",
      sku: null,
      active: true,
      displayOrder: 0,
      stationId: "kitchen",
      unit: "piece",
      unitPriceMinor: 10_000,
      tax: null,
      ...pizza,
    }],
    modifierGroups: [group(BASE_GROUP, "Ingredientes", HAM), group(VEGGIES_GROUP, "Vegetales", CHEESE), group(EXTRA_GROUP, "Extras", BACON)],
  } as unknown as SaveMenuCatalogCommandV1;
}

function serviceFor(saved: SaveMenuCatalogCommandV1[]): MenuCatalogService {
  const memberships: MembershipLookupPort = {
    findActiveMembership: async () => ({ roles: ["manager"], scope: validScope }),
  };
  const port: MenuCatalogPort = {
    read: async () => "forbidden",
    save: async (_actor, command) => {
      saved.push(command);
      return { status: "conflict" };
    },
  };
  return new MenuCatalogService(new MembershipAuthorizationService(memberships), port);
}

async function outcome(pizza: Record<string, unknown>): Promise<{ code: string; saved: number }> {
  const saved: SaveMenuCatalogCommandV1[] = [];
  try {
    await serviceFor(saved).save(principal, catalog(pizza));
    return { code: "ok", saved: saved.length };
  } catch (error) {
    return { code: error instanceof MenuCatalogApplicationError ? error.code : "other", saved: saved.length };
  }
}

const custom = { pizzaMode: "custom", baseGroupIds: [BASE_GROUP], freeIngredientCount: 2, extraOptionIds: [BACON] };
const twoBases = { pizzaMode: "custom", baseGroupIds: [BASE_GROUP, VEGGIES_GROUP], freeIngredientCount: 2 };

test("a valid custom pizza product reaches the port (conflict is the stub's answer, not a rejection)", async () => {
  assert.deepEqual(await outcome(custom), { code: "conflict", saved: 1 });
  assert.deepEqual(await outcome({ pizzaMode: "custom", baseGroupIds: [BASE_GROUP], freeIngredientCount: 0 }), { code: "conflict", saved: 1 });
  assert.deepEqual(await outcome({ pizzaMode: "custom", baseGroupIds: [BASE_GROUP], freeIngredientCount: 40 }), { code: "conflict", saved: 1 });
  assert.deepEqual(await outcome(twoBases), { code: "conflict", saved: 1 });
});

test("a specialty with a recipe from any base group is accepted; legacy products stay accepted", async () => {
  assert.deepEqual(await outcome({ pizzaMode: "specialty", baseGroupIds: [BASE_GROUP], defaultIngredientOptionIds: [HAM] }), { code: "conflict", saved: 1 });
  assert.deepEqual(await outcome({ pizzaMode: "specialty", baseGroupIds: [BASE_GROUP, VEGGIES_GROUP], defaultIngredientOptionIds: [CHEESE] }), { code: "conflict", saved: 1 });
  // The same group can be base and offer a loose extra; the role is decided by the list.
  assert.deepEqual(await outcome({ pizzaMode: "custom", baseGroupIds: [BASE_GROUP, VEGGIES_GROUP], freeIngredientCount: 1, extraOptionIds: [HAM] }), { code: "conflict", saved: 1 });
  assert.deepEqual(await outcome({}), { code: "conflict", saved: 1 });
});

test("invalid V2 combinations are rejected as request errors before save_menu_catalog", async () => {
  const rejected: Record<string, unknown>[] = [
    { pizzaMode: "specialty", freeIngredientCount: 2, baseGroupIds: [BASE_GROUP] },
    { pizzaMode: "custom", baseGroupIds: [BASE_GROUP], freeIngredientCount: 41 },
    { pizzaMode: "custom", baseGroupIds: [BASE_GROUP], freeIngredientCount: -1 },
    { pizzaMode: "custom", baseGroupIds: [BASE_GROUP], freeIngredientCount: 1.5 },
    { pizzaMode: "custom", baseGroupIds: [STRANGER], freeIngredientCount: 1 },
    { pizzaMode: "custom", freeIngredientCount: 1 },
    { pizzaMode: "specialty", baseGroupIds: [BASE_GROUP], defaultIngredientOptionIds: [STRANGER] },
    { pizzaMode: "specialty", baseGroupIds: [BASE_GROUP], defaultIngredientOptionIds: [CHEESE] },
    { pizzaMode: "custom", baseGroupIds: [BASE_GROUP], extraOptionIds: [STRANGER] },
    { pizzaMode: "custom", baseGroupIds: [BASE_GROUP], extraOptionIds: [HAM, HAM] },
    { pizzaMode: "wild", baseGroupIds: [BASE_GROUP] },
    { freeIngredientCount: 2 },
    { baseGroupIds: [BASE_GROUP] },
    { pizzaMode: "custom", baseGroupIds: [BASE_GROUP], baseGroupId: BASE_GROUP },
  ];
  for (const pizza of rejected) assert.deepEqual(await outcome(pizza), { code: "request", saved: 0 }, JSON.stringify(pizza));
});

test("the domain mapping carries the V2 fields and leaves legacy products untouched", () => {
  const command = catalog(custom);
  const domain = toDomainMenuCatalog({ ...command, version: 1, updatedAt: "2026-11-20T22:00:00.000Z", updatedBy: principal.actorId, replayed: false } as never, scope.restaurantId);
  const product = domain.products[0];
  assert.equal(product?.pizzaMode, "custom");
  assert.equal(product?.freeIngredientCount, 2);
  assert.deepEqual(product?.baseGroupIds, [BASE_GROUP]);
  assert.deepEqual(product?.extraOptionIds, [BACON]);
  assert.deepEqual(toDomainPizzaConfig({}), {});
});

test("pizzaCatalogIssues names each failing rule", () => {
  const view = (pizza: Record<string, unknown>) => pizzaCatalogIssues(catalog(pizza));
  assert.deepEqual(view(custom), []);
  assert.deepEqual(view(twoBases), []);
  assert.deepEqual(view({ pizzaMode: "specialty", freeIngredientCount: 1 }), [`specialty_ingredients_not_allowed:${PRODUCT}`]);
  assert.deepEqual(view({ pizzaMode: "custom", baseGroupIds: [STRANGER] }), [`base_group_not_in_catalog:${PRODUCT}`]);
  assert.deepEqual(view({ pizzaMode: "specialty", baseGroupIds: [BASE_GROUP, VEGGIES_GROUP], defaultIngredientOptionIds: [CHEESE] }), []);
  assert.deepEqual(view({ pizzaMode: "specialty", baseGroupIds: [BASE_GROUP], defaultIngredientOptionIds: [CHEESE] }), [`default_option_outside_base_group:${PRODUCT}`]);
  assert.deepEqual(view({ pizzaMode: "custom", baseGroupIds: [BASE_GROUP], extraOptionIds: [STRANGER] }), [`extra_option_not_in_catalog:${PRODUCT}`]);
  assert.deepEqual(view({ pizzaMode: "custom", baseGroupIds: [BASE_GROUP], extraOptionIds: [HAM] }), []);
});
