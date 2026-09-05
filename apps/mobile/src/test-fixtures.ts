/**
 * Synthetic fixtures used only by this app's tests.
 *
 * Nothing here is imported by application code, and none of these values exist
 * in any remote environment: the identifiers are obviously fabricated, the
 * currency is the ISO test code `XTS`, and no fixture is ever written anywhere.
 */
import { parseMenuCatalogStateV1 } from "@super-restaurant/shared-types";
import type { MenuCatalogV1, OperationalShiftSummaryV1 } from "@super-restaurant/shared-types";

import type { MobileConfig } from "./config.js";
import type { MobileBranchScope } from "./mobile-client.js";
import type { MobileSession } from "./session.js";

export const FIXTURE_RESTAURANT_A = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_BRANCH_A = "22222222-2222-4222-8222-222222222222";
export const FIXTURE_RESTAURANT_B = "33333333-3333-4333-8333-333333333333";
export const FIXTURE_BRANCH_B = "44444444-4444-4444-8444-444444444444";

export const FIXTURE_ZONE = "55555555-5555-4555-8555-555555555555";
export const FIXTURE_TABLE = "66666666-6666-4666-8666-666666666666";
const FIXTURE_CATEGORY = "77777777-7777-4777-8777-777777777777";
const FIXTURE_PRODUCT = "88888888-8888-4888-8888-888888888888";
const FIXTURE_GROUP = "99999999-9999-4999-8999-999999999999";
const FIXTURE_OPTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIXTURE_CATALOG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIXTURE_ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIXTURE_TIMESTAMP = "2026-09-04T12:00:00.000Z";
const FIXTURE_SHIFT = "f1111111-1111-4111-8111-111111111111";

/** Synthetic Supabase user ids; two distinct operators. */
export const FIXTURE_USER_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const FIXTURE_USER_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** ISO 4217 test currency: never a real market currency, never a default. */
export const FIXTURE_CURRENCY = "XTS";

export const fixtureConfig: MobileConfig = Object.freeze({
  apiBaseUrl: "http://127.0.0.1:4312",
  supabasePublishableKey: "sb_publishable_fixture",
  supabaseUrl: "https://fixture.supabase.co",
});

export const scopeA: MobileBranchScope = Object.freeze({
  branchId: FIXTURE_BRANCH_A,
  restaurantId: FIXTURE_RESTAURANT_A,
});

export const scopeB: MobileBranchScope = Object.freeze({
  branchId: FIXTURE_BRANCH_B,
  restaurantId: FIXTURE_RESTAURANT_B,
});

export function fixtureSession(overrides: Partial<MobileSession> = {}): MobileSession {
  return Object.freeze({
    accessToken: "harness-token-1",
    email: "operador.sintetico@example.invalid",
    userId: FIXTURE_USER_A,
    ...overrides,
  });
}

export function membershipListBody(scopes: readonly MobileBranchScope[]): unknown {
  return {
    memberships: scopes.map((scope, index) => ({
      branchName: `Sucursal ${index + 1}`,
      restaurantName: `Restaurante ${index + 1}`,
      roles: ["waiter"],
      scope: { branchId: scope.branchId, restaurantId: scope.restaurantId },
    })),
    schemaVersion: 1,
  };
}

export function authorizedBranchBody(scope: MobileBranchScope): unknown {
  return { branchId: scope.branchId, restaurantId: scope.restaurantId, roles: ["waiter"] };
}

export function operationalShiftListBody(scope: MobileBranchScope): unknown {
  return {
    schemaVersion: 1,
    scope: { branchId: scope.branchId, restaurantId: scope.restaurantId },
    shifts: [{
      name: "Servicio activo",
      openedAt: FIXTURE_TIMESTAMP,
      openedBy: FIXTURE_ACTOR,
      schemaVersion: 1,
      scope: { branchId: scope.branchId, restaurantId: scope.restaurantId },
      shiftId: FIXTURE_SHIFT,
      status: "open",
      version: 1,
    } satisfies OperationalShiftSummaryV1],
  };
}

export function diningLayoutBody(scope: MobileBranchScope, zoneName = "Terraza"): unknown {
  return {
    schemaVersion: 1,
    scope: { branchId: scope.branchId, restaurantId: scope.restaurantId },
    zones: [{
      name: zoneName,
      tables: [{
        capacity: 4,
        layout: { height: 2, width: 2, x: 0, y: 0 },
        name: "Mesa 1",
        replayed: false,
        schemaVersion: 1,
        scope: { branchId: scope.branchId, restaurantId: scope.restaurantId },
        shape: "round",
        tableId: FIXTURE_TABLE,
        updatedAt: FIXTURE_TIMESTAMP,
        updatedBy: FIXTURE_ACTOR,
        version: 1,
        zoneId: FIXTURE_ZONE,
      }],
      version: 1,
      zoneId: FIXTURE_ZONE,
    }],
  };
}

export function menuCatalogStateBody(
  scope: MobileBranchScope,
  currency: string = FIXTURE_CURRENCY,
  unitPriceMinor = 12_500,
): unknown {
  return {
    catalog: {
      catalogVersion: FIXTURE_CATALOG,
      categories: [{ active: true, categoryId: FIXTURE_CATEGORY, displayOrder: 0, name: "Entradas" }],
      currency,
      modifierGroups: [{
        active: true,
        displayOrder: 0,
        groupId: FIXTURE_GROUP,
        maximumQuantity: 1,
        minimumQuantity: 0,
        name: "Término",
        options: [{
          active: true,
          maximumQuantity: 1,
          name: "Bien cocido",
          optionId: FIXTURE_OPTION,
          unitPriceMinor: 0,
        }],
        productId: FIXTURE_PRODUCT,
      }],
      products: [{
        active: true,
        categoryId: FIXTURE_CATEGORY,
        displayOrder: 0,
        name: "Arrachera",
        productId: FIXTURE_PRODUCT,
        sku: "SKU-1",
        stationId: "kitchen",
        tax: null,
        unit: "pieza",
        unitPriceMinor,
      }],
      replayed: false,
      updatedAt: FIXTURE_TIMESTAMP,
      updatedBy: FIXTURE_ACTOR,
      version: 1,
    },
    schemaVersion: 1,
    scope: { branchId: scope.branchId, restaurantId: scope.restaurantId },
  };
}

/**
 * A second, richer catalog for the draft composer: active and inactive
 * categories, products, groups and options, a single-choice group and a
 * multiple-choice group with per-option caps. Every identifier below was
 * generated for this fixture and appears nowhere in the repository's evidence.
 */
export const FIXTURE_CATEGORY_DRINKS = "dbb668c1-f4ef-4eea-b85c-c70e851a9fa8";
export const FIXTURE_CATEGORY_RETIRED = "27d868b8-826e-405c-8b1a-22b6c9348c1a";
export const FIXTURE_PRODUCT_DRINK = "9883df8e-97fb-4060-87f9-1b4a787ad64d";
export const FIXTURE_PRODUCT_RETIRED = "707ab578-e2db-450f-bcf8-a3c5baf8e7a3";
export const FIXTURE_OPTION_RARE = "915f4e53-c855-4517-b6c8-5f5e64d03f68";
export const FIXTURE_GROUP_EXTRAS = "e4dd876e-8943-4f7a-a774-1076340c9dec";
export const FIXTURE_GROUP_RETIRED = "ae291aaf-d162-4b5a-90d8-cf52bb4813eb";
export const FIXTURE_OPTION_CHEESE = "7b8ff0d2-d307-4eb1-9646-705840e8d07a";
export const FIXTURE_OPTION_BACON = "aa71b1b5-2c4c-4dc2-8d56-56d95e0a08c8";
export const FIXTURE_OPTION_RETIRED = "b76c2f59-ca25-4e47-ac7d-87e154022d51";

/** A second zone and two more tables, so selection and change are observable. */
export const FIXTURE_ZONE_BAR = "61b825a6-9e44-48af-a00d-cdfb78012e2a";
export const FIXTURE_TABLE_LONG_NAME = "b0c2fec0-1f77-408a-a404-660795bdfdbb";
export const FIXTURE_TABLE_BAR = "ce050349-045a-4e53-a247-c214f66ac7ff";

/** Product ids re-exported so tests and the harness never retype them. */
export const FIXTURE_PRODUCT_MAIN = FIXTURE_PRODUCT;
export const FIXTURE_GROUP_DONENESS = FIXTURE_GROUP;
export const FIXTURE_OPTION_WELL_DONE = FIXTURE_OPTION;
export const FIXTURE_CATEGORY_STARTERS = FIXTURE_CATEGORY;

export function orderEntryCatalogStateBody(
  scope: MobileBranchScope,
  currency: string = FIXTURE_CURRENCY,
  mainUnitPriceMinor = 12_500,
): unknown {
  return {
    catalog: {
      catalogVersion: FIXTURE_CATALOG,
      categories: [
        { active: true, categoryId: FIXTURE_CATEGORY, displayOrder: 0, name: "Entradas" },
        { active: true, categoryId: FIXTURE_CATEGORY_DRINKS, displayOrder: 1, name: "Bebidas" },
        { active: false, categoryId: FIXTURE_CATEGORY_RETIRED, displayOrder: 2, name: "Temporada anterior" },
      ],
      currency,
      modifierGroups: [
        {
          active: true,
          displayOrder: 0,
          groupId: FIXTURE_GROUP,
          maximumQuantity: 1,
          minimumQuantity: 1,
          name: "Término",
          options: [
            { active: true, maximumQuantity: 1, name: "Bien cocido", optionId: FIXTURE_OPTION, unitPriceMinor: 0 },
            { active: false, maximumQuantity: 1, name: "Término rojo", optionId: FIXTURE_OPTION_RARE, unitPriceMinor: 0 },
          ],
          productId: FIXTURE_PRODUCT,
        },
        {
          active: true,
          displayOrder: 1,
          groupId: FIXTURE_GROUP_EXTRAS,
          maximumQuantity: 3,
          minimumQuantity: 0,
          name: "Extras",
          options: [
            { active: true, maximumQuantity: 2, name: "Queso extra", optionId: FIXTURE_OPTION_CHEESE, unitPriceMinor: 2_500 },
            { active: true, maximumQuantity: null, name: "Tocino", optionId: FIXTURE_OPTION_BACON, unitPriceMinor: 3_000 },
          ],
          productId: FIXTURE_PRODUCT,
        },
        {
          active: false,
          displayOrder: 2,
          groupId: FIXTURE_GROUP_RETIRED,
          maximumQuantity: 1,
          minimumQuantity: 1,
          name: "Guarnición retirada",
          options: [
            { active: true, maximumQuantity: 1, name: "Ensalada de temporada", optionId: FIXTURE_OPTION_RETIRED, unitPriceMinor: 0 },
          ],
          productId: FIXTURE_PRODUCT,
        },
      ],
      products: [
        {
          active: true,
          categoryId: FIXTURE_CATEGORY,
          displayOrder: 0,
          name: "Arrachera al carbón con guarnición de temporada",
          productId: FIXTURE_PRODUCT,
          sku: "SKU-1",
          stationId: "kitchen",
          tax: null,
          unit: "pieza",
          unitPriceMinor: mainUnitPriceMinor,
        },
        {
          active: false,
          categoryId: FIXTURE_CATEGORY,
          displayOrder: 1,
          name: "Entrada retirada",
          productId: FIXTURE_PRODUCT_RETIRED,
          sku: null,
          stationId: "kitchen",
          tax: null,
          unit: "pieza",
          unitPriceMinor: 4_000,
        },
        {
          active: true,
          categoryId: FIXTURE_CATEGORY_DRINKS,
          displayOrder: 0,
          name: "Agua mineral",
          productId: FIXTURE_PRODUCT_DRINK,
          sku: "SKU-2",
          stationId: "bar",
          tax: null,
          unit: "botella",
          unitPriceMinor: 3_500,
        },
      ],
      replayed: false,
      updatedAt: FIXTURE_TIMESTAMP,
      updatedBy: FIXTURE_ACTOR,
      version: 1,
    },
    schemaVersion: 1,
    scope: { branchId: scope.branchId, restaurantId: scope.restaurantId },
  };
}

/** The same catalog, already parsed by the shared contract. Throws if invalid. */
export function orderEntryCatalog(
  scope: MobileBranchScope,
  currency: string = FIXTURE_CURRENCY,
  mainUnitPriceMinor = 12_500,
): MenuCatalogV1 {
  const state = parseMenuCatalogStateV1(orderEntryCatalogStateBody(scope, currency, mainUnitPriceMinor));
  if (state?.catalog === undefined || state.catalog === null) throw new Error("FIXTURE_CATALOG_INVALID");
  return state.catalog;
}

/** Two zones and three tables, one with a deliberately long name. */
export function orderEntryLayoutBody(scope: MobileBranchScope, zoneName = "Terraza"): unknown {
  const scoped = { branchId: scope.branchId, restaurantId: scope.restaurantId };
  const table = (tableId: string, name: string, capacity: number, zoneId: string): unknown => ({
    capacity,
    layout: { height: 2, width: 2, x: 0, y: 0 },
    name,
    replayed: false,
    schemaVersion: 1,
    scope: scoped,
    shape: "round",
    tableId,
    updatedAt: FIXTURE_TIMESTAMP,
    updatedBy: FIXTURE_ACTOR,
    version: 1,
    zoneId,
  });
  return {
    schemaVersion: 1,
    scope: scoped,
    zones: [
      {
        name: zoneName,
        tables: [
          table(FIXTURE_TABLE, "Mesa 1", 4, FIXTURE_ZONE),
          // 36 characters: the longest name the layout contract accepts is 40,
          // so this row exercises long text without leaving the contract.
          table(FIXTURE_TABLE_LONG_NAME, "Mesa 2 · ventanal poniente al jardín", 8, FIXTURE_ZONE),
        ],
        version: 1,
        zoneId: FIXTURE_ZONE,
      },
      {
        name: "Barra",
        tables: [table(FIXTURE_TABLE_BAR, "Barra 1", 1, FIXTURE_ZONE_BAR)],
        version: 1,
        zoneId: FIXTURE_ZONE_BAR,
      },
    ],
  };
}

/** A `fetch` double that records every call and answers with one JSON body. */
export function jsonFetcher(body: unknown, status = 200): {
  readonly calls: { url: string; init: RequestInit | undefined }[];
  readonly fetcher: typeof fetch;
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ init, url: String(input) });
    return Promise.resolve(new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    }));
  }) as typeof fetch;
  return { calls, fetcher };
}

/**
 * A `fetch` double that hands the parser the exact value it is given, without a
 * JSON round trip. Serializing would erase symbol keys, accessors, prototypes
 * and array holes — precisely what the adversarial parser tests exercise.
 */
export function valueFetcher(value: unknown, status = 200): typeof fetch {
  return ((): Promise<Response> => Promise.resolve({
    json: (): Promise<unknown> => Promise.resolve(value),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response)) as typeof fetch;
}

/** A `fetch` double that fails the way an unreachable network does. */
export function failingFetcher(): typeof fetch {
  return ((): Promise<Response> => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;
}
