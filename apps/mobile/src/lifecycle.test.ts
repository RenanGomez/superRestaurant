import assert from "node:assert/strict";
import test from "node:test";

import {
  lifecycleEffects,
  shouldRevalidateOnForeground,
  shouldRunAutoRefresh,
  toMobileAppStatus,
  type MobileAppStatus,
} from "./lifecycle.js";

test("normalizes the platform status without guessing", () => {
  assert.equal(toMobileAppStatus("active"), "active");
  assert.equal(toMobileAppStatus("background"), "background");
  assert.equal(toMobileAppStatus("inactive"), "inactive");
  for (const value of ["extension", "", undefined, null, 1, {}]) {
    assert.equal(toMobileAppStatus(value), "unknown", String(value));
  }
});

test("revalidates only on a real return to the foreground", () => {
  assert.equal(shouldRevalidateOnForeground("background", "active"), true);
  assert.equal(shouldRevalidateOnForeground("inactive", "active"), true);
  assert.equal(shouldRevalidateOnForeground("active", "active"), false);
  assert.equal(shouldRevalidateOnForeground("unknown", "active"), false);
  assert.equal(shouldRevalidateOnForeground("active", "background"), false);
  assert.equal(shouldRevalidateOnForeground("background", "inactive"), false);
});

test("runs the token ticker only in the foreground", () => {
  assert.equal(shouldRunAutoRefresh("active"), true);
  for (const status of ["background", "inactive", "unknown"] as const) {
    assert.equal(shouldRunAutoRefresh(status), false, status);
  }
});

test("start, pause, resume and repeated resume produce the expected effects", () => {
  const sequence: readonly MobileAppStatus[] = ["background", "active", "active", "inactive", "active"];
  let previous: MobileAppStatus = "active";
  const applied = sequence.map((next) => {
    const effects = lifecycleEffects(previous, next);
    previous = next;
    return effects;
  });

  assert.deepEqual(applied, [
    { autoRefresh: "stop", revalidate: false },
    { autoRefresh: "start", revalidate: true },
    { autoRefresh: "start", revalidate: false },
    { autoRefresh: "stop", revalidate: false },
    { autoRefresh: "start", revalidate: true },
  ]);
  assert.equal(applied.filter((effects) => effects.revalidate).length, 2);
});
