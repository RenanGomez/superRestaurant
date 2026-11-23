import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FRACTION_DIGITS,
  formatMinorAmount,
  formatMinorUnitsInput,
  isRenderableMinorAmount,
  parseMinorUnitsInput,
  renderMinorAmount,
} from "./money.js";

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

test("parses and formats editable major-unit inputs without float arithmetic", () => {
  assert.equal(parseMinorUnitsInput("125", "MXN"), 12_500);
  assert.equal(parseMinorUnitsInput("125.5", "MXN"), 12_550);
  assert.equal(parseMinorUnitsInput("125,05", "XTS"), 12_505);
  assert.equal(parseMinorUnitsInput("0.01", "USD"), 1);
  assert.equal(parseMinorUnitsInput("500", "JPY"), 500);
  assert.equal(parseMinorUnitsInput("500.5", "JPY"), null);
  assert.equal(parseMinorUnitsInput("12.345", "MXN"), null);
  assert.equal(parseMinorUnitsInput("-10", "MXN"), null);
  assert.equal(parseMinorUnitsInput("10abc", "MXN"), null);
  assert.equal(parseMinorUnitsInput("10", "ZZZ"), null);

  assert.equal(formatMinorUnitsInput(12_500, "MXN"), "125.00");
  assert.equal(formatMinorUnitsInput(5, "XTS"), "0.05");
  assert.equal(formatMinorUnitsInput(500, "JPY"), "500");
  assert.equal(formatMinorUnitsInput(-1, "MXN"), null);
  assert.equal(formatMinorUnitsInput(100, "ZZZ"), null);
});

test("parsing formatting is the identity for every supported currency and safe amount", () => {
  // A deterministic spread across the boundary, not a random sample: zero, the
  // smallest unit, a whole major unit, the largest countable minor amount and
  // points around them. Nothing here depends on float rounding.
  const amounts = [
    0, 1, 9, 10, 99, 100, 101, 999, 1_000, 12_345, 999_999, 123_456_789, 4_000_000_000_000_000,
    Number.MAX_SAFE_INTEGER,
  ] as const;
  for (const currency of Object.keys(FRACTION_DIGITS)) {
    for (const amount of amounts) {
      const formatted = formatMinorUnitsInput(amount, currency);
      assert.notEqual(formatted, null, `${amount} ${currency} should format`);
      assert.equal(
        parseMinorUnitsInput(formatted as string, currency),
        amount,
        `${amount} ${currency} round trip through ${JSON.stringify(formatted)}`,
      );
    }
  }
});

test("money refuses the unsafe boundary and unsupported numeric text instead of approximating", () => {
  // One past the largest exactly representable integer is not money.
  assert.equal(formatMinorUnitsInput(Number.MAX_SAFE_INTEGER + 1, "XTS"), null);
  assert.equal(formatMinorUnitsInput(Number.MAX_SAFE_INTEGER + 2, "MXN"), null);
  // Parsing a value that would overflow the safe range fails closed, not rounds.
  assert.equal(parseMinorUnitsInput("90071992547409.92", "MXN"), null);
  // Negatives, exponents and other numeric notations are not editable money.
  for (const text of ["-1", "-0.01", "1e3", "1E3", "0x10", "Infinity", "NaN", "+5", "1_000"]) {
    assert.equal(parseMinorUnitsInput(text, "MXN"), null, text);
  }
});

test("mobile and web agree on the minor-unit scale for shared currencies", () => {
  // Two clients that disagree on a currency's scale read the same integer as
  // different money. The web table is the source this app must not drift from;
  // `XTS` is the synthetic test currency mobile adds and web never ships.
  const webSource = readFileSync(
    path.join(process.cwd(), "..", "..", "apps", "web", "src", "lib", "money-scale.ts"),
    "utf8",
  );
  const webScale = new Map<string, number>();
  for (const match of webSource.matchAll(/\b([A-Z]{3}):\s*(\d+)/gu)) {
    webScale.set(String(match[1]), Number(match[2]));
  }
  assert.ok(webScale.size > 0, "the web scale table should be readable");
  for (const [currency, digits] of webScale) {
    assert.equal(FRACTION_DIGITS[currency], digits, `${currency} scale drifted from web`);
  }
  assert.equal(FRACTION_DIGITS["XTS"], 2);
});
