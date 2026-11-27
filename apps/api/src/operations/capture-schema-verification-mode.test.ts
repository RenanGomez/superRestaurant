import assert from "node:assert/strict";
import test from "node:test";

import { parseCaptureVerificationMode } from "./capture-schema-verification-mode.js";

test("accepts exactly one explicit verification mode", () => {
  assert.equal(parseCaptureVerificationMode(["--local-disposable-only"]), "local");
  assert.equal(parseCaptureVerificationMode(["--remote-only"]), "remote");
});

test("rejects missing, extra or unknown arguments instead of falling back to the remote", () => {
  const cases: readonly (readonly string[])[] = [
    [],
    ["--local-disposable-only", "--extra"],
    ["--remote-only", "x"],
    ["--local"],
    ["--local-disposable-only", "--local-disposable-only"],
  ];

  for (const argv of cases) assert.equal(parseCaptureVerificationMode(argv), undefined);
});
