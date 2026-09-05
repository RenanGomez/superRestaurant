import assert from "node:assert/strict";
import test from "node:test";

import { createMobileAuth } from "./supabase-auth.js";
import { fixtureConfig } from "./test-fixtures.js";

/** Records every Web Storage access the SDK could attempt on a device. */
function installStorageSpy(): { readonly calls: string[]; readonly restore: () => void } {
  const calls: string[] = [];
  const spy = {
    clear: (): void => { calls.push("clear"); },
    getItem: (key: string): null => { calls.push(`get:${key}`); return null; },
    key: (): null => null,
    length: 0,
    removeItem: (key: string): void => { calls.push(`remove:${key}`); },
    setItem: (key: string): void => { calls.push(`set:${key}`); },
  };
  const global = globalThis as unknown as Record<string, unknown>;
  const previousLocal = global.localStorage;
  const previousSession = global.sessionStorage;
  global.localStorage = spy;
  global.sessionStorage = spy;
  return {
    calls,
    restore: (): void => { global.localStorage = previousLocal; global.sessionStorage = previousSession; },
  };
}

test("exposes the whole authentication port, including the token ticker", () => {
  const auth = createMobileAuth(fixtureConfig);
  assert.deepEqual(Object.keys(auth).sort(), [
    "currentSession",
    "onSessionChange",
    "signIn",
    "signOut",
    "startAutoRefresh",
    "stopAutoRefresh",
  ]);
  assert.equal(Object.isFrozen(auth), true);
});

test("starts, pauses and resumes the ticker without writing to device storage", async () => {
  const storage = installStorageSpy();
  try {
    const auth = createMobileAuth(fixtureConfig);

    // start → pause → resume, the sequence the app lifecycle drives.
    await auth.startAutoRefresh();
    await auth.stopAutoRefresh();
    await auth.startAutoRefresh();
    await auth.stopAutoRefresh();

    // No session was ever stored, so reading one yields "not signed in".
    assert.equal(await auth.currentSession(), undefined);

    // A local sign-out with no session is a no-op and never touches storage.
    await auth.signOut();

    const unsubscribe = auth.onSessionChange(() => undefined);
    assert.equal(typeof unsubscribe, "function");
    unsubscribe();

    assert.deepEqual(storage.calls, []);
  } finally {
    storage.restore();
  }
});
