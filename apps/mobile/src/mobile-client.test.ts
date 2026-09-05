import assert from "node:assert/strict";
import test from "node:test";

import * as client from "./mobile-client.js";
import {
  MOBILE_API_PATHS,
  MobileRequestError,
  authorizeBranch,
  getDiningLayout,
  getMenuCatalog,
  isAuthorizedMobilePath,
  listMemberships,
} from "./mobile-client.js";
import {
  FIXTURE_CURRENCY,
  authorizedBranchBody,
  diningLayoutBody,
  failingFetcher,
  fixtureConfig,
  jsonFetcher,
  membershipListBody,
  menuCatalogStateBody,
  scopeA,
  scopeB,
} from "./test-fixtures.js";

test("exposes only read capabilities: no order, payment or cash mutation", () => {
  assert.deepEqual(Object.keys(client).sort(), [
    "MOBILE_API_PATHS",
    "MobileRequestError",
    "authorizeBranch",
    "getDiningLayout",
    "getMenuCatalog",
    "isAuthorizedMobilePath",
    "listMemberships",
  ]);
  assert.deepEqual(Object.values(MOBILE_API_PATHS).sort(), [
    "/api/v1/access/branch",
    "/api/v1/access/memberships",
    "/api/v1/catalog/menu",
    "/api/v1/dining/layout",
  ]);
});

test("refuses any path outside the authorized allowlist", () => {
  for (const path of Object.values(MOBILE_API_PATHS)) assert.equal(isAuthorizedMobilePath(path), true, path);
  assert.equal(isAuthorizedMobilePath(`${MOBILE_API_PATHS.diningLayout}?restaurantId=x`), true);
  for (const path of [
    "/api/v1/orders",
    "/api/v1/orders/items/transition",
    "/api/v1/payments",
    "/api/v1/cash-registers",
    "/api/v1/kds/tickets",
    "/api/v1/dining/tables",
    "/api/v1/access/memberships/../../orders",
    "",
  ]) assert.equal(isAuthorizedMobilePath(path), false, path);
});

test("lists memberships with a bearer token and no body", async () => {
  const { calls, fetcher } = jsonFetcher(membershipListBody([scopeA, scopeB]));
  const list = await listMemberships(fixtureConfig, "token-1", fetcher);

  assert.equal(list.memberships.length, 2);
  assert.equal(list.memberships[0]?.scope.restaurantId, scopeA.restaurantId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${fixtureConfig.apiBaseUrl}/api/v1/access/memberships`);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.body, undefined);
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.deepEqual(calls[0]?.init?.headers, { authorization: "Bearer token-1" });
});

test("revalidates the exact pair against Nest and requires the same pair back", async () => {
  const { calls, fetcher } = jsonFetcher(authorizedBranchBody(scopeA));
  const branch = await authorizeBranch(fixtureConfig, "token-1", scopeA, fetcher);

  assert.deepEqual(branch, { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId, roles: ["waiter"] });
  assert.equal(calls[0]?.url, `${fixtureConfig.apiBaseUrl}/api/v1/access/branch`);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ branchId: scopeA.branchId, restaurantId: scopeA.restaurantId }));

  const crossed = jsonFetcher(authorizedBranchBody(scopeB));
  await assert.rejects(
    () => authorizeBranch(fixtureConfig, "token-1", scopeA, crossed.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("rejects an authorization response with unknown or duplicated roles", async () => {
  for (const roles of [[], ["owner", "owner"], ["root"], "waiter"]) {
    const { fetcher } = jsonFetcher({ ...(authorizedBranchBody(scopeA) as object), roles });
    await assert.rejects(
      () => authorizeBranch(fixtureConfig, "token-1", scopeA, fetcher),
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
      JSON.stringify(roles),
    );
  }
});

test("maps a revoked pair to its authorization status", async () => {
  const { fetcher } = jsonFetcher({ code: "SCOPE_AUTHORIZATION_REJECTED" }, 403);
  await assert.rejects(
    () => authorizeBranch(fixtureConfig, "token-1", scopeA, fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === 403,
  );
});

test("reads the layout of the requested branch only", async () => {
  const { calls, fetcher } = jsonFetcher(diningLayoutBody(scopeA));
  const layout = await getDiningLayout(fixtureConfig, "token-1", scopeA, fetcher);

  assert.equal(layout.zones.length, 1);
  assert.equal(layout.zones[0]?.tables[0]?.name, "Mesa 1");
  assert.equal(
    calls[0]?.url,
    `${fixtureConfig.apiBaseUrl}/api/v1/dining/layout?branchId=${scopeA.branchId}&restaurantId=${scopeA.restaurantId}`,
  );

  const crossed = jsonFetcher(diningLayoutBody(scopeB));
  await assert.rejects(
    () => getDiningLayout(fixtureConfig, "token-1", scopeA, crossed.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("reads the published catalog with the currency and minor units it carries", async () => {
  const { calls, fetcher } = jsonFetcher(menuCatalogStateBody(scopeA));
  const state = await getMenuCatalog(fixtureConfig, "token-1", scopeA, fetcher);

  assert.equal(state.catalog?.currency, FIXTURE_CURRENCY);
  assert.equal(state.catalog?.products[0]?.unitPriceMinor, 12_500);
  assert.equal(Number.isSafeInteger(state.catalog?.products[0]?.unitPriceMinor), true);
  assert.equal(
    calls[0]?.url,
    `${fixtureConfig.apiBaseUrl}/api/v1/catalog/menu?branchId=${scopeA.branchId}&restaurantId=${scopeA.restaurantId}`,
  );

  const empty = jsonFetcher({ catalog: null, schemaVersion: 1, scope: { ...scopeA } });
  const emptyState = await getMenuCatalog(fixtureConfig, "token-1", scopeA, empty.fetcher);
  assert.equal(emptyState.catalog, null);

  const crossed = jsonFetcher(menuCatalogStateBody(scopeB));
  await assert.rejects(
    () => getMenuCatalog(fixtureConfig, "token-1", scopeA, crossed.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("fails closed on a body that does not match the shared contract", async () => {
  for (const body of [
    { memberships: [], schemaVersion: 2 },
    { memberships: [{ branchName: "b", restaurantName: "r", roles: ["waiter"], scope: { branchId: "x", restaurantId: "y" } }], schemaVersion: 1 },
    { memberships: [], schemaVersion: 1, extra: true },
    [],
    null,
  ]) {
    const { fetcher } = jsonFetcher(body);
    await assert.rejects(
      () => listMemberships(fixtureConfig, "token-1", fetcher),
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
      JSON.stringify(body),
    );
  }
});

test("separates a network failure from a protocol failure", async () => {
  await assert.rejects(
    () => listMemberships(fixtureConfig, "token-1", failingFetcher()),
    (error: unknown) => error instanceof MobileRequestError && error.status === "network",
  );

  const notJson = ((): Promise<Response> => Promise.resolve(new Response("<html></html>", { status: 200 }))) as typeof fetch;
  await assert.rejects(
    () => listMemberships(fixtureConfig, "token-1", notJson),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("never sends a malformed pair or an empty token to the network", async () => {
  const { calls, fetcher } = jsonFetcher(diningLayoutBody(scopeA));
  for (const scope of [
    { branchId: "not-a-uuid", restaurantId: scopeA.restaurantId },
    { branchId: scopeA.branchId, restaurantId: "" },
  ]) {
    await assert.rejects(
      () => getDiningLayout(fixtureConfig, "token-1", scope, fetcher),
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
    );
  }
  await assert.rejects(
    () => listMemberships(fixtureConfig, "", fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === 401,
  );
  assert.equal(calls.length, 0);
});
