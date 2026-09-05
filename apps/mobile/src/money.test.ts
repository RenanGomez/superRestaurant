import assert from "node:assert/strict";
import test from "node:test";

import { formatMinorAmount, isRenderableMinorAmount, renderMinorAmount } from "./money.js";

test("renders integer minor units with the currency the contract carries", () => {
  assert.equal(formatMinorAmount(0, "XTS"), "0 u.m. · XTS");
  assert.equal(formatMinorAmount(7, "MXN"), "7 u.m. · MXN");
  assert.equal(formatMinorAmount(12_500, "XTS"), "12,500 u.m. · XTS");
  assert.equal(formatMinorAmount(1_234_567, "USD"), "1,234,567 u.m. · USD");
  assert.equal(formatMinorAmount(-250, "XTS"), "-250 u.m. · XTS");
});

test("never assumes a currency: an absent or malformed code is refused", () => {
  for (const currency of ["", "mxn", "MX", "MXNN", "MX1", " MXN"]) {
    assert.throws(() => formatMinorAmount(100, currency), /MOBILE_MONEY_INVALID/u, currency);
  }
});

test("refuses non-integer money instead of rounding it", () => {
  for (const amount of [12.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => formatMinorAmount(amount, "XTS"), /MOBILE_MONEY_INVALID/u, String(amount));
  }
});

test("a screen shows the contract amount, or says it is unavailable — never a guess", () => {
  assert.equal(renderMinorAmount(12_500, "XTS"), "12,500 u.m. · XTS");
  for (const [amount, currency] of [[12.5, "XTS"], [100, "mxn"], [100, ""], [Number.NaN, "XTS"]] as const) {
    assert.equal(renderMinorAmount(amount, currency), "Precio no disponible", `${amount} ${currency}`);
  }
  // No currency is ever substituted for a missing one.
  assert.equal(renderMinorAmount(100, "").includes("MXN"), false);
});

test("reports renderable amounts without throwing", () => {
  assert.equal(isRenderableMinorAmount(100, "XTS"), true);
  assert.equal(isRenderableMinorAmount(100.5, "XTS"), false);
  assert.equal(isRenderableMinorAmount(100, "xts"), false);
  assert.equal(isRenderableMinorAmount("100", "XTS"), false);
  assert.equal(isRenderableMinorAmount(100, undefined), false);
});
