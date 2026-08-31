import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./authentication.js";
import {
  MembershipAuthorizationService,
  ScopeAuthorizationRejectedError,
  type MembershipLookupPort,
} from "./membership-authorization.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const scopeInput = Object.freeze({ branchId: "branch-a", restaurantId: "restaurant-a" });
const scope = parseBranchScope(scopeInput);
if (scope === undefined) throw new Error("test scope must be valid");

test("authorizes only the verified actor in the exact active branch scope", async () => {
  const calls: unknown[] = [];
  const memberships: MembershipLookupPort = {
    findActiveMembership: async (receivedPrincipal, receivedScope) => {
      calls.push({ receivedPrincipal, receivedScope });
      return { roles: ["manager"], scope };
    },
  };
  const service = new MembershipAuthorizationService(memberships);

  const authorized = await service.authorizeBranch(principal, scopeInput, ["manager", "owner"]);
  assert.deepEqual(authorized, { principal, roles: ["manager"], scope });
  assert.deepEqual(calls, [{ receivedPrincipal: principal, receivedScope: scope }]);
  assert.ok(Object.isFrozen(authorized));
  assert.ok(Object.isFrozen(authorized.roles));
});

test("rejects missing membership, wrong scope and insufficient role", async () => {
  const noMembership = new MembershipAuthorizationService({ findActiveMembership: async () => undefined });
  await assert.rejects(noMembership.authorizeBranch(principal, scopeInput, ["waiter"]), ScopeAuthorizationRejectedError);

  const wrongScope = parseBranchScope({ branchId: "branch-b", restaurantId: "restaurant-a" });
  if (wrongScope === undefined) throw new Error("test scope must be valid");
  const mismatched = new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["manager"], scope: wrongScope }),
  });
  await assert.rejects(mismatched.authorizeBranch(principal, scopeInput, ["manager"]), ScopeAuthorizationRejectedError);

  const insufficient = new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles: ["viewer"], scope }),
  });
  await assert.rejects(insufficient.authorizeBranch(principal, scopeInput, ["cashier"]), ScopeAuthorizationRejectedError);
});

test("rejects invalid scope, principal and role requirements before lookup", async () => {
  let calls = 0;
  const service = new MembershipAuthorizationService({
    findActiveMembership: async () => {
      calls += 1;
      return { roles: ["owner"], scope };
    },
  });

  await assert.rejects(service.authorizeBranch(principal, { restaurantId: "restaurant-a" }, ["owner"]), ScopeAuthorizationRejectedError);
  await assert.rejects(service.authorizeBranch({ actorId: "caller-id" }, scopeInput, ["owner"]), ScopeAuthorizationRejectedError);
  await assert.rejects(service.authorizeBranch(principal, scopeInput, []), ScopeAuthorizationRejectedError);
  assert.equal(calls, 0);
});

test("fails closed on malformed or duplicated membership roles", async () => {
  for (const roles of [["owner", "owner"], ["invented-role"], []]) {
    const service = new MembershipAuthorizationService({
      findActiveMembership: async () => ({ roles: roles as never, scope }),
    });
    await assert.rejects(service.authorizeBranch(principal, scopeInput, ["owner"]), ScopeAuthorizationRejectedError);
  }
});

test("fails closed on hostile membership adapters and role requirements", async () => {
  const hostileMembership = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
  const service = new MembershipAuthorizationService({
    findActiveMembership: async () => hostileMembership as never,
  });
  await assert.rejects(service.authorizeBranch(principal, scopeInput, ["owner"]), ScopeAuthorizationRejectedError);

  const hostileRoles = new Proxy(["owner"], { get: () => { throw new Error("trap"); } });
  await assert.rejects(service.authorizeBranch(principal, scopeInput, hostileRoles as never), ScopeAuthorizationRejectedError);
});
