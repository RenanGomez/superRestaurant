import assert from "node:assert/strict";
import test from "node:test";
import { ordersHref, ordersOrderId, ordersView } from "./orders-view.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("ordersView is list without a valid order id", () => {
  assert.equal(ordersView(new URLSearchParams("")), "list");
  assert.equal(ordersView(new URLSearchParams("addItem=1")), "list");
  assert.equal(ordersView(new URLSearchParams("orderId=not-a-uuid&addItem=1")), "list");
  assert.equal(ordersOrderId(new URLSearchParams("orderId=nope")), undefined);
});

test("ordersView is detail with an order id and adding only when addItem=1", () => {
  assert.equal(ordersView(new URLSearchParams(`orderId=${ID}`)), "detail");
  assert.equal(ordersView(new URLSearchParams(`orderId=${ID}&addItem=0`)), "detail");
  assert.equal(ordersView(new URLSearchParams(`orderId=${ID}&addItem=1`)), "adding");
  assert.equal(ordersOrderId(new URLSearchParams(`orderId=${ID}`)), ID);
});

test("ordersHref round-trips through ordersView", () => {
  assert.equal(ordersHref(undefined, true), "/app/orders");
  assert.equal(ordersHref(ID, false), `/app/orders?orderId=${ID}`);
  assert.equal(ordersHref(ID, true), `/app/orders?orderId=${ID}&addItem=1`);
  for (const adding of [false, true]) {
    const query = ordersHref(ID, adding).split("?")[1]!;
    assert.equal(ordersView(new URLSearchParams(query)), adding ? "adding" : "detail");
  }
});
