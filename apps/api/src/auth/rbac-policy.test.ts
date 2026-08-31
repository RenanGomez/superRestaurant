import assert from "node:assert/strict";
import test from "node:test";

import { MEMBERSHIP_ROLE_CODES, RBAC_PERMISSION_CODES } from "@super-restaurant/shared-types";

import { RBAC_ROLE_PERMISSIONS_V1, rbacMatrixVersion, rolesGrantPermission } from "./rbac-policy.js";

test("defines an exact, deeply frozen version-one matrix for every canonical role", () => {
  assert.equal(rbacMatrixVersion, 1);
  assert.deepEqual(Object.keys(RBAC_ROLE_PERMISSIONS_V1).sort(), [...MEMBERSHIP_ROLE_CODES].sort());
  assert.deepEqual(RBAC_ROLE_PERMISSIONS_V1.owner, RBAC_PERMISSION_CODES);
  assert.ok(Object.isFrozen(RBAC_ROLE_PERMISSIONS_V1));

  for (const role of MEMBERSHIP_ROLE_CODES) {
    const assigned = RBAC_ROLE_PERMISSIONS_V1[role];
    assert.ok(Object.isFrozen(assigned));
    assert.equal(new Set(assigned).size, assigned.length);
    assert.ok(assigned.every((permission) => RBAC_PERMISSION_CODES.includes(permission)));
    assert.ok(assigned.includes("branch.select"));
  }
});

test("keeps privileged and operational permissions explicit without role inheritance", () => {
  assert.equal(rolesGrantPermission(["owner"], "memberships.manage"), true);
  assert.equal(rolesGrantPermission(["admin"], "memberships.manage"), true);
  assert.equal(rolesGrantPermission(["manager"], "memberships.manage"), false);
  assert.equal(rolesGrantPermission(["manager"], "catalog.manage"), true);
  assert.equal(rolesGrantPermission(["supervisor"], "orders.cancel.sent"), true);
  assert.equal(rolesGrantPermission(["cashier"], "orders.cancel.sent"), false);
  assert.equal(rolesGrantPermission(["kitchen"], "kds.transition"), true);
  assert.equal(rolesGrantPermission(["viewer"], "orders.create"), false);
  assert.equal(rolesGrantPermission(["auditor"], "reports.read"), true);
});

test("combines multiple active roles but rejects malformed or hostile input fail-closed", () => {
  assert.equal(rolesGrantPermission(["viewer", "cashier"], "payments.collect"), true);
  for (const roles of [undefined, null, [], ["owner", "owner"], ["invented"], "owner"]) {
    assert.equal(rolesGrantPermission(roles, "branch.select"), false);
  }
  assert.equal(rolesGrantPermission(["owner"], "invented.permission"), false);

  const hostileRoles = new Proxy(["owner"], { get: () => { throw new Error("trap"); } });
  assert.equal(rolesGrantPermission(hostileRoles, "branch.select"), false);
});
