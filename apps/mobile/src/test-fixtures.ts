/**
 * Synthetic fixtures used only by this app's tests.
 *
 * Nothing here is imported by application code, and none of these values exist
 * in any remote environment: the identifiers are obviously fabricated, the
 * currency is the ISO test code `XTS`, and no fixture is ever written anywhere.
 */
import type { MobileConfig } from "./config.js";
import type { MobileBranchScope } from "./mobile-client.js";

export const FIXTURE_RESTAURANT_A = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_BRANCH_A = "22222222-2222-4222-8222-222222222222";
export const FIXTURE_RESTAURANT_B = "33333333-3333-4333-8333-333333333333";
export const FIXTURE_BRANCH_B = "44444444-4444-4444-8444-444444444444";

const FIXTURE_ZONE = "55555555-5555-4555-8555-555555555555";
const FIXTURE_TABLE = "66666666-6666-4666-8666-666666666666";
const FIXTURE_CATEGORY = "77777777-7777-4777-8777-777777777777";
const FIXTURE_PRODUCT = "88888888-8888-4888-8888-888888888888";
const FIXTURE_GROUP = "99999999-9999-4999-8999-999999999999";
const FIXTURE_OPTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIXTURE_CATALOG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIXTURE_ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIXTURE_TIMESTAMP = "2026-09-04T12:00:00.000Z";

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
