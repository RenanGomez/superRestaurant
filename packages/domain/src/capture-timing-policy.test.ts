import assert from "node:assert/strict";
import test from "node:test";

import {
  ExpiredCaptureEditingLeaseError,
  InvalidCaptureRecoveryPreferenceError,
  InvalidCaptureTimestampError,
  captureEditingLeaseExpiresAt,
  captureRecoveryExpiresAt,
  isCaptureDeadlineActive,
  renewCaptureEditingLease,
  renewCaptureRecovery,
} from "./capture-timing-policy.js";

test("recovery uses a UTC calendar month and clamps end-of-month days", () => {
  assert.equal(captureRecoveryExpiresAt("2026-01-31T23:59:59.999Z"), "2026-02-28T23:59:59.999Z");
  assert.equal(captureRecoveryExpiresAt("2028-01-31T00:00:00.000Z"), "2028-02-29T00:00:00.000Z");
  assert.equal(captureRecoveryExpiresAt("2026-12-15T12:30:00.000Z"), "2027-01-15T12:30:00.000Z");
  assert.equal(captureRecoveryExpiresAt("2000-01-31T00:00:00.000Z"), "2000-02-29T00:00:00.000Z");
  assert.equal(captureRecoveryExpiresAt("1900-01-31T00:00:00.000Z"), "1900-02-28T00:00:00.000Z");
});

test("five-minute editing lease expires at equality and renews only while active", () => {
  const expiry = captureEditingLeaseExpiresAt("2026-09-15T23:58:00.000Z");
  assert.equal(expiry, "2026-09-16T00:03:00.000Z");
  assert.equal(isCaptureDeadlineActive(expiry, "2026-09-16T00:02:59.999Z"), true);
  assert.equal(isCaptureDeadlineActive(expiry, "2026-09-16T00:03:00.000Z"), false);
  assert.equal(renewCaptureEditingLease(expiry, "2026-09-16T00:02:00.000Z"), "2026-09-16T00:07:00.000Z");
  assert.equal(renewCaptureEditingLease(expiry, "2026-09-15T23:57:00.000Z"), expiry, "clock regression cannot shorten a lease");
  assert.throws(() => renewCaptureEditingLease(expiry, expiry), ExpiredCaptureEditingLeaseError);
});

test("recovery renewal is opt-in and never silently extends an active month", () => {
  const expiry = "2026-10-15T12:00:00.000Z";
  assert.equal(renewCaptureRecovery(expiry, "2026-10-16T12:00:00.000Z", false), expiry);
  assert.equal(renewCaptureRecovery(expiry, "2026-10-14T12:00:00.000Z", true), expiry);
  assert.equal(renewCaptureRecovery(expiry, expiry, true), "2026-11-15T12:00:00.000Z");
});

test("all timing boundaries reject malformed or noncanonical timestamps", () => {
  for (const invalid of ["2026-09-15", "2026-09-15T18:00:00Z", "2026-02-30T18:00:00.000Z", "", 123]) {
    assert.throws(() => captureRecoveryExpiresAt(invalid as string), InvalidCaptureTimestampError);
    assert.throws(() => captureEditingLeaseExpiresAt(invalid as string), InvalidCaptureTimestampError);
    assert.throws(() => isCaptureDeadlineActive("2026-09-15T18:00:00.000Z", invalid as string), InvalidCaptureTimestampError);
  }
  assert.throws(() => captureRecoveryExpiresAt("9999-12-15T00:00:00.000Z"), InvalidCaptureTimestampError);
  assert.throws(() => renewCaptureRecovery("2026-10-15T12:00:00.000Z", "2026-10-15T12:00:00.000Z", null as unknown as boolean), InvalidCaptureRecoveryPreferenceError);
});
