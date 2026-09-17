import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocalCustomerConcurrencyConfig, LOCAL_CUSTOMER_CONCURRENCY_MARKER,
  type CustomerConcurrencyConfig } from "./customer-directory-concurrency-verification.js";

test("local concurrency config rejects remote hosts, other databases and absent marker before connecting", () => {
  const config: CustomerConcurrencyConfig = { host: "127.0.0.1", port: 55432,
    database: "superrestaurant_concurrency_test", user: "postgres", marker: LOCAL_CUSTOMER_CONCURRENCY_MARKER,
    actorId: "00000000-0000-4000-8000-000000000001", restaurantId: "00000000-0000-4000-8000-000000000002",
    branchId: "00000000-0000-4000-8000-000000000003" };
  assert.doesNotThrow(() => assertLocalCustomerConcurrencyConfig(config));
  for (const mutation of [{ host: "db.remote.example" }, { database: "postgres" }, { marker: "" },
    { port: 543.2 }, { port: 543 }, { actorId: "invalid" }, { user: "remote-user" }]) {
    assert.throws(() => assertLocalCustomerConcurrencyConfig({ ...config, ...mutation } as CustomerConcurrencyConfig));
  }
});
