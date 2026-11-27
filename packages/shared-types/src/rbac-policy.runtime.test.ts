import assert from "node:assert/strict";
import test from "node:test";
import { MEMBERSHIP_ROLE_CODES, RBAC_ROLE_PERMISSIONS_V1, rolesGrantPermission } from "./index.js";

test("matrix covers every role with frozen, unique permissions", () => {
  assert.deepEqual(Object.keys(RBAC_ROLE_PERMISSIONS_V1).sort(), [...MEMBERSHIP_ROLE_CODES].sort());
  assert.ok(Object.isFrozen(RBAC_ROLE_PERMISSIONS_V1));
  for (const role of MEMBERSHIP_ROLE_CODES) {
    const permissions = RBAC_ROLE_PERMISSIONS_V1[role];
    assert.ok(Object.isFrozen(permissions));
    assert.equal(new Set(permissions).size, permissions.length);
  }
});

test("catalog permissions match the role matrix", () => {
  const readers: readonly string[] = ["owner", "admin", "manager", "supervisor", "cashier", "waiter", "viewer", "auditor"];
  const managers: readonly string[] = ["owner", "admin", "manager"];
  for (const role of MEMBERSHIP_ROLE_CODES) {
    assert.equal(rolesGrantPermission([role], "catalog.read"), readers.includes(role), role);
    assert.equal(rolesGrantPermission([role], "catalog.manage"), managers.includes(role), role);
  }
});

test("invalid roles fail closed and valid roles combine", () => {
  const hostile = new Proxy(["owner"], { get() { throw new Error("hostile getter"); } });
  for (const roles of [undefined, null, [], ["owner", "owner"], ["invented"], "owner", hostile]) {
    assert.equal(rolesGrantPermission(roles, "catalog.read"), false);
  }
  assert.equal(rolesGrantPermission(["viewer", "cashier"], "payments.collect"), true);
});
