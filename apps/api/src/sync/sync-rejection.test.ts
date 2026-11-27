import assert from "node:assert/strict";
import test from "node:test";

import { SYNC_RECOVERABLE_REJECTION_CODES, SYNC_REVOCATION_CODES } from "@super-restaurant/shared-types";
import { classifyRejection } from "./sync-merge-executor.js";

test("invalid scope is a terminal event rejection", () => {
  const result = classifyRejection("INVALID_SCOPE");
  assert.deepEqual(result, { code: "INVALID_SCOPE", reason: "INVALID_SCOPE" });
  assert.equal((SYNC_REVOCATION_CODES as readonly string[]).includes(result.code), false);
  assert.equal((SYNC_RECOVERABLE_REJECTION_CODES as readonly string[]).includes(result.code), false);
});

test("other rejection codes remain unchanged", () => {
  for (const reason of ["AUTH_REVOKED", "DEVICE_REVOKED", "DEVICE_UNKNOWN", "ACTOR_MISMATCH"] as const) {
    assert.equal(classifyRejection(reason).code, reason);
  }
});
