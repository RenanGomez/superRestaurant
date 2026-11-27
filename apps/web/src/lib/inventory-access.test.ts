import assert from "node:assert/strict";
import test from "node:test";
import { MEMBERSHIP_ROLE_CODES } from "@super-restaurant/shared-types";

import { canManagePurchases, canReadPurchases } from "./inventory-access.js";

test("canReadPurchases allows the eight catalog.read roles and denies kitchen and courier", () => {
  const readers: readonly string[] = [
    "owner",
    "admin",
    "manager",
    "supervisor",
    "cashier",
    "waiter",
    "viewer",
    "auditor",
  ];
  for (const role of MEMBERSHIP_ROLE_CODES) {
    assert.equal(canReadPurchases([role]), readers.includes(role), role);
  }
  assert.equal(canReadPurchases(["kitchen"]), false);
  assert.equal(canReadPurchases(["courier"]), false);
});

test("canManagePurchases allows only owner, admin and manager", () => {
  const managers: readonly string[] = ["owner", "admin", "manager"];
  for (const role of MEMBERSHIP_ROLE_CODES) {
    assert.equal(canManagePurchases([role]), managers.includes(role), role);
  }
});

test("purchasing access helpers fail closed on hostile inputs", () => {
  const hostile = new Proxy(["owner"], {
    get() {
      throw new Error("hostile getter");
    },
  });
  const invalidInputs: readonly unknown[] = [
    undefined,
    null,
    [],
    ["owner", "owner"],
    ["invented"],
    "owner",
    hostile,
  ];
  for (const input of invalidInputs) {
    assert.equal(canReadPurchases(input), false);
    assert.equal(canManagePurchases(input), false);
  }
});

test("purchasing access helpers combine multiple valid roles", () => {
  assert.equal(canReadPurchases(["viewer", "cashier"]), true);
  assert.equal(canManagePurchases(["viewer", "cashier"]), false);
  assert.equal(canReadPurchases(["viewer", "manager"]), true);
  assert.equal(canManagePurchases(["viewer", "manager"]), true);
});
