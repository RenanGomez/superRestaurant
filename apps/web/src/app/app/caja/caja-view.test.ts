import assert from "node:assert/strict";
import test from "node:test";
import { cobrarHref, cobrarView, corteView, registerState } from "./caja-view.js";

const ORDER = "4859176a-9f5d-4d0c-9e20-a669f32edb9d";

test("register state reads the server report: missing or not_found is none, other failures are unavailable", () => {
  assert.equal(registerState(undefined), "none");
  assert.equal(registerState({ status: "not_found" }), "none");
  assert.equal(registerState({ status: "unavailable" }), "unavailable");
  assert.equal(registerState({ status: "conflict" }), "unavailable");
  assert.equal(registerState({ status: "ok", value: { register: { status: "open" } } }), "open");
  assert.equal(registerState({ status: "ok", value: { register: { status: "closed" } } }), "closed");
  assert.equal(registerState({ status: "ok", value: { register: { status: "weird" } } }), "unavailable");
});

test("cobrar shows only the opening form until a register is open", () => {
  for (const register of ["none", "closed"] as const) {
    assert.equal(cobrarView({ canOperate: true, register, orderId: ORDER, hasReceipt: false }), "open_register");
    assert.equal(cobrarView({ canOperate: true, register, orderId: undefined, hasReceipt: false }), "open_register");
  }
});

test("cobrar with an open register: one order when there is an orderId or a receipt, the list otherwise", () => {
  assert.equal(cobrarView({ canOperate: true, register: "open", orderId: ORDER, hasReceipt: false }), "order");
  assert.equal(cobrarView({ canOperate: true, register: "open", orderId: undefined, hasReceipt: true }), "order");
  assert.equal(cobrarView({ canOperate: true, register: "open", orderId: undefined, hasReceipt: false }), "list");
});

test("cobrar and corte refuse roles without cash permission and surface unreadable state", () => {
  assert.equal(cobrarView({ canOperate: false, register: "open", orderId: ORDER, hasReceipt: false }), "no_permission");
  assert.equal(corteView({ canOperate: false, register: "open" }), "no_permission");
  assert.equal(cobrarView({ canOperate: true, register: "unavailable", orderId: ORDER, hasReceipt: false }), "unavailable");
  assert.equal(corteView({ canOperate: true, register: "unavailable" }), "unavailable");
});

test("corte: nothing to cut without a register, report plus close when open, frozen report when closed", () => {
  assert.equal(corteView({ canOperate: true, register: "none" }), "no_register");
  assert.equal(corteView({ canOperate: true, register: "open" }), "open");
  assert.equal(corteView({ canOperate: true, register: "closed" }), "closed");
});

test("cobrar links point at the collect screen and encode the order id", () => {
  assert.equal(cobrarHref(), "/app/caja");
  assert.equal(cobrarHref(ORDER), `/app/caja?orderId=${ORDER}#cobrar`);
  assert.equal(cobrarHref("a b"), "/app/caja?orderId=a%20b#cobrar");
});
