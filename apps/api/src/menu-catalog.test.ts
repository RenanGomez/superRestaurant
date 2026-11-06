import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ORDER_ITEM_MODIFIER_GROUPS,
  parseBranchScope,
  parseMenuCatalogStateV1,
  parseSaveMenuCatalogCommandV1,
  type MenuCatalogStateV1,
  type SaveMenuCatalogCommandV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DatabaseClientPort } from "./database.js";
import {
  MenuCatalogApplicationError,
  MenuCatalogService,
  PostgresMenuCatalogAdapter,
  type MenuCatalogPort,
} from "./menu-catalog.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const scope = parseBranchScope({
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
});
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;

const command = parseSaveMenuCatalogCommandV1({
  schemaVersion: 1,
  scope,
  eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  idempotencyKey: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
  occurredAt: "2026-09-02T22:00:00.000Z",
  expectedVersion: 0,
  catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  currency: "MXN",
  categories: [{ categoryId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", name: "Alimentos", active: true, displayOrder: 0 }],
  products: [{
    productId: "9544c299-d25b-44ce-98ed-d30116610887",
    categoryId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
    name: "Hamburguesa",
    sku: "HAM-001",
    active: true,
    displayOrder: 0,
    stationId: "kitchen",
    unit: "piece",
    unitPriceMinor: 12_500,
    tax: null,
  }],
  modifierGroups: [{
    groupId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
    productId: "9544c299-d25b-44ce-98ed-d30116610887",
    name: "Extras",
    active: true,
    displayOrder: 0,
    minimumQuantity: 0,
    maximumQuantity: 2,
    options: [{
      optionId: "c483b6e7-e102-4cc5-a887-d30712c85e52",
      name: "Queso",
      unitPriceMinor: 1_500,
      active: true,
      maximumQuantity: 2,
    }],
  }],
});
if (command === undefined) throw new Error("TEST_COMMAND_INVALID");

const populatedState = stateFor(command, false);
const emptyState = parseMenuCatalogStateV1({ schemaVersion: 1, scope, catalog: null });
if (emptyState === undefined) throw new Error("TEST_EMPTY_STATE_INVALID");

test("menu catalog authorizes reads and atomic saves with distinct permissions", async () => {
  const calls: string[] = [];
  const port: MenuCatalogPort = {
    read: async () => { calls.push("read"); return populatedState; },
    save: async () => { calls.push("save"); return { state: populatedState, status: "saved" }; },
  };
  const manager = serviceFor(["manager"], port);
  assert.deepEqual(await manager.read(principal, validScope), populatedState);
  assert.deepEqual(await manager.save(principal, command), populatedState);
  const viewer = serviceFor(["viewer"], port);
  assert.deepEqual(await viewer.read(principal, validScope), populatedState);
  await assertCode(viewer.save(principal, command), "authorization");
  assert.deepEqual(calls, ["read", "save", "read"]);
});

test("menu catalog rejects malformed requests and maps conflict, forbidden, and failures", async () => {
  const conflict = serviceFor(["manager"], {
    read: async () => "forbidden",
    save: async () => ({ status: "conflict" }),
  });
  await assertCode(conflict.read(principal, validScope), "authorization");
  await assertCode(conflict.save(principal, { ...command, expectedVersion: -1 }), "request");
  await assertCode(conflict.save(principal, command), "conflict");
  const unavailable = serviceFor(["manager"], {
    read: async () => { throw new Error("native secret"); },
    save: async () => { throw new Error("native secret"); },
  });
  await assertCode(unavailable.read(principal, validScope), "unavailable");
  await assertCode(unavailable.save(principal, command), "unavailable");
});

test("menu publication rejects a product no order-item command can represent", async () => {
  let saveCalled = false;
  const service = serviceFor(["manager"], {
    read: async () => populatedState,
    save: async () => {
      saveCalled = true;
      return { state: populatedState, status: "saved" };
    },
  });
  const template = command.modifierGroups[0];
  if (template === undefined) throw new Error("TEST_GROUP_TEMPLATE_MISSING");
  const impossibleCatalog = {
    ...command,
    modifierGroups: Array.from({ length: MAX_ORDER_ITEM_MODIFIER_GROUPS + 1 }, (_, index) => ({
      ...template,
      displayOrder: index,
      groupId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      minimumQuantity: 1,
      options: template.options.map((option, optionIndex) => ({
        ...option,
        optionId: `30000000-0000-4000-8000-${String(index * 10 + optionIndex + 1).padStart(12, "0")}`,
      })),
    })),
  };

  await assertCode(service.save(principal, impossibleCatalog), "request");
  assert.equal(saveCalled, false);
});

test("menu PostgreSQL adapter binds scope and canonical catalog payload", async () => {
  const calls: { readonly parameters: readonly unknown[]; readonly sql: string }[] = [];
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      return sql.includes("get_menu_catalog")
        ? { rows: [{ state: populatedState }] }
        : { rows: [{ status: "saved", state: populatedState }] };
    },
  };
  const adapter = new PostgresMenuCatalogAdapter(database);
  assert.deepEqual(await adapter.read(principal.actorId, validScope), populatedState);
  assert.deepEqual(await adapter.save(principal.actorId, command), { status: "saved", state: populatedState });
  assert.equal(calls[0]?.sql, "select app_private.get_menu_catalog($1::uuid, $2::uuid, $3::uuid) as state");
  assert.deepEqual(calls[0]?.parameters, [principal.actorId, validScope.restaurantId, validScope.branchId]);
  assert.equal(calls[1]?.parameters.length, 11);
  assert.deepEqual(JSON.parse(String(calls[1]?.parameters[10])), {
    categories: command.categories,
    modifierGroups: command.modifierGroups,
    products: command.products,
    sizePresets: [],
  });
});

test("menu PostgreSQL adapter fails closed for ambiguous or mismatched rows", async () => {
  for (const rows of [
    [],
    [{ state: populatedState }, { state: populatedState }],
    [{ state: populatedState, extra: true }],
    [{ state: { ...populatedState, scope: { ...validScope, branchId: "72371a5f-2056-448d-9ddb-14ab6664a4e8" } } }],
  ]) {
    await assert.rejects(
      new PostgresMenuCatalogAdapter({ query: async () => ({ rows }) }).read(principal.actorId, validScope),
      MenuCatalogApplicationError,
    );
  }
  assert.equal(
    await new PostgresMenuCatalogAdapter({ query: async () => ({ rows: [{ state: null }] }) }).read(principal.actorId, validScope),
    "forbidden",
  );

  const wrongCatalog = stateFor({ ...command, catalogVersion: "72371a5f-2056-448d-9ddb-14ab6664a4e8" }, false);
  await assert.rejects(
    new PostgresMenuCatalogAdapter({ query: async () => ({ rows: [{ status: "saved", state: wrongCatalog }] }) }).save(principal.actorId, command),
    MenuCatalogApplicationError,
  );
});

test("menu catalog carries category appearance and the adapter detects divergence on replay", async () => {
  const categoryId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
  const imagePath = `${validScope.restaurantId}/categories/${categoryId}/0123456789abcdef0123456789abcdef.webp`;
  const styled = parseSaveMenuCatalogCommandV1({
    ...command,
    categories: [{ categoryId, name: "Alimentos", active: true, displayOrder: 0, color: "mint", imagePath }],
  });
  if (styled === undefined) throw new Error("TEST_STYLED_COMMAND_INVALID");
  assert.equal(styled.categories[0]?.color, "mint");
  assert.equal(command.categories[0]?.color, null);
  assert.equal(command.categories[0]?.imagePath, null);
  const ok: DatabaseClientPort = { query: async () => ({ rows: [{ status: "replayed", state: stateFor(styled, true) }] }) };
  assert.equal((await new PostgresMenuCatalogAdapter(ok).save(principal.actorId, styled)).status, "replayed");
  for (const divergent of [
    { ...styled.categories[0]!, color: "sky" as const },
    { ...styled.categories[0]!, imagePath: null },
  ]) {
    const other = stateFor({ ...styled, categories: [divergent] }, true);
    await assert.rejects(
      new PostgresMenuCatalogAdapter({ query: async () => ({ rows: [{ status: "replayed", state: other }] }) }).save(principal.actorId, styled),
      MenuCatalogApplicationError,
    );
  }
});

test("menu service accepts an empty first catalog and preserves exact branch scope", async () => {
  const service = serviceFor(["manager"], {
    read: async (_actorId, receivedScope) => {
      assert.deepEqual(receivedScope, validScope);
      return emptyState;
    },
    save: async () => ({ state: populatedState, status: "saved" }),
  });
  assert.deepEqual(await service.read(principal, validScope), emptyState);
});

function stateFor(input: SaveMenuCatalogCommandV1, replayed: boolean): MenuCatalogStateV1 {
  const state = parseMenuCatalogStateV1({
    schemaVersion: 1,
    scope: input.scope,
    catalog: {
      catalogVersion: input.catalogVersion,
      currency: input.currency,
      categories: input.categories,
      products: input.products,
      modifierGroups: input.modifierGroups,
      ...(input.sizePresets === undefined ? {} : { sizePresets: input.sizePresets }),
      version: input.expectedVersion + 1,
      updatedAt: "2026-09-02T22:00:01.000Z",
      updatedBy: principal.actorId,
      replayed,
    },
  });
  if (state === undefined) throw new Error("TEST_STATE_INVALID");
  return state;
}

function serviceFor(roles: readonly ("manager" | "viewer")[], port: MenuCatalogPort): MenuCatalogService {
  const memberships: MembershipLookupPort = {
    findActiveMembership: async () => ({ roles, scope: validScope }),
  };
  return new MenuCatalogService(new MembershipAuthorizationService(memberships), port);
}

async function assertCode(promise: Promise<unknown>, code: MenuCatalogApplicationError["code"]): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === code,
  );
}

const sizedProducts = [{
  ...command.products[0]!,
  variants: [
    { variantId: "6a1d2c3e-4f50-4a61-8b72-93a4b5c6d7e8", name: "Chica", sku: null, unitPriceMinor: 9_000, active: true, displayOrder: 0 },
    { variantId: "7b2e3d4f-5061-4b72-9c83-a4b5c6d7e8f9", name: "Grande", sku: "HAM-G", unitPriceMinor: 15_000, active: true, displayOrder: 1 },
  ],
}];

test("menu catalog carries product variants through the PostgreSQL adapter's real { status, state } row", async () => {
  const sized = parseSaveMenuCatalogCommandV1({ ...command, products: sizedProducts });
  if (sized === undefined) throw new Error("TEST_SIZED_COMMAND_INVALID");
  assert.equal(sized.products[0]?.variants?.length, 2);
  const sizedState = stateFor(sized, false);
  let payload: unknown;
  const database: DatabaseClientPort = {
    query: async (_sql, parameters) => {
      payload = JSON.parse(String(parameters[10]));
      return { rows: [{ status: "saved", state: sizedState }] };
    },
  };
  const result = await new PostgresMenuCatalogAdapter(database).save(principal.actorId, sized);
  assert.equal(result.status, "saved");
  const products = (payload as { products: { variants: { name: string; unitPriceMinor: number }[] }[] }).products;
  assert.deepEqual(products[0]?.variants.map(({ name, unitPriceMinor }) => [name, unitPriceMinor]), [["Chica", 9_000], ["Grande", 15_000]]);
  assert.equal(sizedState.catalog?.products[0]?.variants?.[1]?.sku, "HAM-G");
  // A row whose variants differ from the command is ambiguous and fails closed.
  const tampered = stateFor(parseSaveMenuCatalogCommandV1({
    ...command,
    products: [{ ...sizedProducts[0]!, variants: [{ ...sizedProducts[0]!.variants[0]!, unitPriceMinor: 1 }] }],
  })!, false);
  const mismatching: DatabaseClientPort = { query: async () => ({ rows: [{ status: "saved", state: tampered }] }) };
  await assert.rejects(new PostgresMenuCatalogAdapter(mismatching).save(principal.actorId, sized));
});

test("menu publication rejects duplicate size names and negative size prices before reaching SQL", async () => {
  let saved = 0;
  const port: MenuCatalogPort = { read: async () => "forbidden", save: async () => { saved += 1; return { status: "conflict" }; } };
  const service = serviceFor(["manager"], port);
  const dup = { ...command, products: [{ ...sizedProducts[0]!, variants: [
    sizedProducts[0]!.variants[0]!, { ...sizedProducts[0]!.variants[1]!, name: "chica" },
  ] }] };
  await assert.rejects(service.save(principal, dup), (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === "request");
  const negative = { ...command, products: [{ ...sizedProducts[0]!, variants: [{ ...sizedProducts[0]!.variants[0]!, unitPriceMinor: -1 }] }] };
  await assert.rejects(service.save(principal, negative), (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === "request");
  assert.equal(saved, 0);
});

const productFraction = {
  enabled: true,
  excludableIngredientIds: ["cebolla"],
  extraGroupId: null,
  flavorGroupId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
  lockedIngredientOptionIds: [],
};

test("menu catalog carries a product-level half-and-half setup through the PostgreSQL adapter", async () => {
  const withFraction = parseSaveMenuCatalogCommandV1({ ...command, products: [{ ...command.products[0]!, fraction: productFraction }] });
  if (withFraction === undefined) throw new Error("TEST_PRODUCT_FRACTION_COMMAND_INVALID");
  const state = stateFor(withFraction, false);
  let payload: unknown;
  const database: DatabaseClientPort = {
    query: async (_sql, parameters) => {
      payload = JSON.parse(String(parameters[10]));
      return { rows: [{ status: "saved", state }] };
    },
  };
  const result = await new PostgresMenuCatalogAdapter(database).save(principal.actorId, withFraction);
  assert.equal(result.status, "saved");
  assert.deepEqual((payload as { products: { fraction: unknown }[] }).products[0]?.fraction, productFraction);
  // A row that drops the product setup is ambiguous and fails closed.
  const dropped: DatabaseClientPort = { query: async () => ({ rows: [{ status: "saved", state: stateFor(command, false) }] }) };
  await assert.rejects(new PostgresMenuCatalogAdapter(dropped).save(principal.actorId, withFraction));
});

test("menu publication accepts a product-level setup and rejects it next to an enabled legacy size setup before SQL", async () => {
  let saved = 0;
  const port: MenuCatalogPort = { read: async () => "forbidden", save: async () => { saved += 1; return { status: "conflict" }; } };
  const service = serviceFor(["manager"], port);
  const accepted = { ...command, products: [{ ...command.products[0]!, fraction: productFraction }] };
  await assert.rejects(service.save(principal, accepted), (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === "conflict");
  assert.equal(saved, 1, "a valid product-level setup reaches SQL");
  const bothEnabled = { ...command, products: [{ ...sizedProducts[0]!, fraction: productFraction, variants: [
    { ...sizedProducts[0]!.variants[0]!, fraction: productFraction }, sizedProducts[0]!.variants[1]!,
  ] }] };
  await assert.rejects(service.save(principal, bothEnabled), (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === "request");
  assert.equal(saved, 1, "two enabled sources never reach SQL");
  const legacyDisabled = { ...command, products: [{ ...sizedProducts[0]!, fraction: productFraction, variants: [
    { ...sizedProducts[0]!.variants[0]!, fraction: { ...productFraction, enabled: false, flavorGroupId: null } }, sizedProducts[0]!.variants[1]!,
  ] }] };
  await assert.rejects(service.save(principal, legacyDisabled), (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === "conflict");
  assert.equal(saved, 2, "a disabled legacy setup next to the product one reaches SQL");
});

const wrapId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";

const baseCommand: SaveMenuCatalogCommandV1 = command;

function sharedGroupCommand() {
  const burger = baseCommand.products[0]!;
  const group = baseCommand.modifierGroups[0]!;
  return {
    ...baseCommand,
    products: [
      { ...burger, modifierGroupIds: [group.groupId] },
      { ...burger, productId: wrapId, sku: "WRP-001", displayOrder: 1, modifierGroupIds: [group.groupId] },
    ],
    modifierGroups: [{ ...group, productId: null }],
  };
}

test("a modifier group shared by two products reaches SQL once and is mapped to both products in the domain", async () => {
  const shared = parseSaveMenuCatalogCommandV1(sharedGroupCommand());
  if (shared === undefined) throw new Error("TEST_SHARED_GROUP_COMMAND_INVALID");
  const state = stateFor(shared, false);
  let payload: { modifierGroups: { productId: unknown }[]; products: { modifierGroupIds: string[] }[] } | undefined;
  const database: DatabaseClientPort = {
    query: async (_sql, parameters) => {
      payload = JSON.parse(String(parameters[10]));
      return { rows: [{ status: "saved", state }] };
    },
  };
  const result = await new PostgresMenuCatalogAdapter(database).save(principal.actorId, shared);
  assert.equal(result.status, "saved");
  assert.equal(payload?.modifierGroups.length, 1);
  assert.equal(payload?.modifierGroups[0]?.productId, null);
  assert.deepEqual(payload?.products.map((product) => product.modifierGroupIds), [
    [command.modifierGroups[0]!.groupId], [command.modifierGroups[0]!.groupId],
  ]);
  // A row that lost the assignment of one product is ambiguous and fails closed.
  const lossy = parseSaveMenuCatalogCommandV1({
    ...sharedGroupCommand(),
    products: sharedGroupCommand().products.map((product, index) => (index === 1 ? { ...product, modifierGroupIds: [] } : product)),
  });
  if (lossy === undefined) throw new Error("TEST_LOSSY_COMMAND_INVALID");
  const dropped: DatabaseClientPort = { query: async () => ({ rows: [{ status: "saved", state: stateFor(lossy, false) }] }) };
  await assert.rejects(new PostgresMenuCatalogAdapter(dropped).save(principal.actorId, shared));
});

test("menu publication rejects a shared group assigned to a product outside the catalog before SQL", async () => {
  let saved = 0;
  const port: MenuCatalogPort = { read: async () => "forbidden", save: async () => { saved += 1; return { status: "conflict" }; } };
  const service = serviceFor(["manager"], port);
  const base = sharedGroupCommand();
  const ghost = { ...base, products: [{ ...base.products[0]!, modifierGroupIds: ["b509ec59-9f5e-496d-a45d-b83a46b49675"] }, base.products[1]!] };
  await assert.rejects(service.save(principal, ghost), (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === "request");
  const ownerShared = { ...base, modifierGroups: [{ ...base.modifierGroups[0]!, productId: base.products[0]!.productId }] };
  await assert.rejects(service.save(principal, ownerShared), (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === "request");
  assert.equal(saved, 0);
});

test("menu catalog with size presets roundtrips through save and read", async () => {
  const presetId = "6a409ec5-9f5e-496d-a45d-b83a46b49674";
  const variantId = "7a409ec5-9f5e-496d-a45d-b83a46b49675";
  const burger = command.products[0]!;
  const presetCommand = parseSaveMenuCatalogCommandV1({
    ...command,
    sizePresets: [{ id: presetId, name: "Chica", displayOrder: 0, active: true }],
    products: [{
      ...burger,
      variants: [{
        variantId,
        name: "Chica",
        unitPriceMinor: 10_000,
        active: true,
        displayOrder: 0,
        sku: "HAM-CH",
        sizePresetId: presetId,
      }],
    }],
  });
  if (presetCommand === undefined) throw new Error("TEST_PRESET_COMMAND_INVALID");
  const state = stateFor(presetCommand, false);

  let capturedPayload: unknown;
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      if (sql.includes("save_menu_catalog")) {
        capturedPayload = JSON.parse(String(parameters[10]));
        return { rows: [{ status: "saved", state }] };
      }
      return { rows: [{ state }] };
    },
  };
  const adapter = new PostgresMenuCatalogAdapter(database);
  const saveResult = await adapter.save(principal.actorId, presetCommand);
  assert.equal(saveResult.status, "saved");
  assert.deepEqual(saveResult.state, state);
  assert.equal((capturedPayload as { sizePresets: unknown[] }).sizePresets.length, 1);

  const readResult = await adapter.read(principal.actorId, validScope);
  assert.deepEqual(readResult, state);

  // Rejects variant referencing non-existent preset before SQL
  const invalidPresetRef = {
    ...presetCommand,
    products: [{
      ...burger,
      variants: [{
        variantId,
        name: "Chica",
        unitPriceMinor: 10_000,
        active: true,
        displayOrder: 0,
        sku: "HAM-CH",
        sizePresetId: "00000000-0000-4000-8000-000000000000",
      }],
    }],
  };
  const service = serviceFor(["manager"], adapter);
  await assert.rejects(
    service.save(principal, invalidPresetRef),
    (err: unknown) => err instanceof MenuCatalogApplicationError && err.code === "request",
  );
});
