import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEVICE_IDENTITY_STORAGE_KEY,
  MobileDeviceIdentityError,
  createMobileDeviceIdentity,
  type MobileSecureStorePort,
} from "./device-identity.js";

const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason) => { unhandled.push(reason); });

const VALID = "d0000000-0000-4000-8000-000000000001";

/** A keystore whose every answer the test decides, including when it answers. */
function store(overrides: Partial<MobileSecureStorePort> & {
  readonly initial?: string | null;
} = {}): MobileSecureStorePort & {
  readonly reads: () => number;
  readonly writes: () => readonly { key: string; value: string }[];
} {
  const values = new Map<string, string>();
  if (typeof overrides.initial === "string") values.set(DEVICE_IDENTITY_STORAGE_KEY, overrides.initial);
  const writes: { key: string; value: string }[] = [];
  let reads = 0;
  return Object.freeze({
    getItem: overrides.getItem ?? ((key: string): Promise<string | null> => {
      reads += 1;
      return Promise.resolve(values.get(key) ?? null);
    }),
    isAvailable: overrides.isAvailable ?? ((): Promise<boolean> => Promise.resolve(true)),
    reads: (): number => reads,
    setItem: overrides.setItem ?? ((key: string, value: string): Promise<void> => {
      writes.push({ key, value });
      values.set(key, value);
      return Promise.resolve();
    }),
    writes: (): readonly { key: string; value: string }[] => [...writes],
  });
}

/** Generates values the test chose, and says how many it was asked for. */
function generator(...values: readonly string[]): (() => string) & { readonly calls: () => number } {
  let calls = 0;
  const next = (): string => {
    const value = values[calls] ?? `d0000000-0000-4000-8000-${String(calls).padStart(12, "0")}`;
    calls += 1;
    return value;
  };
  return Object.assign(next, { calls: (): number => calls });
}

function failure(error: unknown): string {
  assert.ok(error instanceof MobileDeviceIdentityError, `not a device identity error: ${String(error)}`);
  return error.failure;
}

test("an empty keystore mints one identity and keeps it under the versioned key", async () => {
  const keystore = store();
  const randomUuid = generator(VALID);
  const identity = createMobileDeviceIdentity({ randomUuid, store: keystore });

  assert.equal(await identity.load(), VALID);
  assert.deepEqual(keystore.writes(), [{ key: DEVICE_IDENTITY_STORAGE_KEY, value: VALID }]);
  assert.match(DEVICE_IDENTITY_STORAGE_KEY, /\.v1$/u, "the key has to carry its format version");

  // Read again: the same value, and nothing minted or written a second time.
  assert.equal(await identity.load(), VALID);
  assert.equal(randomUuid.calls(), 1);
  assert.equal(keystore.writes().length, 1);
});

test("an identity already stored is returned as it is, never replaced", async () => {
  const keystore = store({ initial: VALID });
  const randomUuid = generator("d0000000-0000-4000-8000-000000000002");
  const identity = createMobileDeviceIdentity({ randomUuid, store: keystore });

  assert.equal(await identity.load(), VALID);
  assert.equal(randomUuid.calls(), 0, "a stored identity must not be regenerated");
  assert.deepEqual(keystore.writes(), []);
});

test("two concurrent loads share one attempt, so they cannot mint two identities", async () => {
  // The keystore answers only when the test lets it, which is exactly the
  // window in which a second caller could start its own read.
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const randomUuid = generator(VALID, "d0000000-0000-4000-8000-000000000009");
  const identity = createMobileDeviceIdentity({
    randomUuid,
    store: store({ getItem: (): Promise<string | null> => gate.then(() => null) }),
  });

  const first = identity.load();
  const second = identity.load();
  const third = identity.load();
  release?.();

  assert.deepEqual(await Promise.all([first, second, third]), [VALID, VALID, VALID]);
  assert.equal(randomUuid.calls(), 1, "one attempt, one identity");
});

test("a stored value this app did not write is corrupt, and is never overwritten", async () => {
  for (const stored of [
    "no-es-un-uuid",
    "",
    " d0000000-0000-4000-8000-000000000001",
    VALID.toUpperCase(),
    "d0000000-0000-0000-8000-000000000001",
    "d0000000-0000-4000-c000-000000000001",
  ]) {
    const keystore = store({ initial: stored });
    const randomUuid = generator(VALID);
    const identity = createMobileDeviceIdentity({ randomUuid, store: keystore });
    await assert.rejects(() => identity.load(), (error: unknown) => failure(error) === "corrupt", JSON.stringify(stored));
    assert.deepEqual(keystore.writes(), [], "a corrupt value must survive for the record");
    assert.equal(randomUuid.calls(), 0);
  }
});

test("no keystore, no identity: nothing is invented", async () => {
  const absent = createMobileDeviceIdentity({
    randomUuid: generator(VALID),
    store: store({ isAvailable: (): Promise<boolean> => Promise.resolve(false) }),
  });
  await assert.rejects(() => absent.load(), (error: unknown) => failure(error) === "unavailable");

  const throwing = createMobileDeviceIdentity({
    randomUuid: generator(VALID),
    store: store({ isAvailable: (): Promise<boolean> => Promise.reject(new Error("KEYSTORE")) }),
  });
  await assert.rejects(() => throwing.load(), (error: unknown) => failure(error) === "unavailable");
});

test("a keystore that refuses to read or to write fails explicitly", async () => {
  const unreadable = createMobileDeviceIdentity({
    randomUuid: generator(VALID),
    store: store({ getItem: (): Promise<string | null> => Promise.reject(new Error("LOCKED")) }),
  });
  await assert.rejects(() => unreadable.load(), (error: unknown) => failure(error) === "unreadable");

  const unwritable = createMobileDeviceIdentity({
    randomUuid: generator(VALID),
    store: store({ setItem: (): Promise<void> => Promise.reject(new Error("FULL")) }),
  });
  await assert.rejects(() => unwritable.load(), (error: unknown) => failure(error) === "unwritable");
});

test("a generator that throws or returns something else mints no identity", async () => {
  const throwing = createMobileDeviceIdentity({
    randomUuid: (): string => { throw new Error("NO_ENTROPY"); },
    store: store(),
  });
  await assert.rejects(() => throwing.load(), (error: unknown) => failure(error) === "unwritable");

  for (const value of ["", "42", "d0000000-0000-4000-8000"]) {
    const identity = createMobileDeviceIdentity({ randomUuid: () => value, store: store() });
    await assert.rejects(() => identity.load(), (error: unknown) => failure(error) === "unwritable", value);
  }
});

test("a failed attempt can be retried; a successful one is never repeated", async () => {
  let available = false;
  const keystore = store({ isAvailable: (): Promise<boolean> => Promise.resolve(available) });
  const randomUuid = generator(VALID);
  const identity = createMobileDeviceIdentity({ randomUuid, store: keystore });

  await assert.rejects(() => identity.load(), (error: unknown) => failure(error) === "unavailable");
  available = true;
  assert.equal(await identity.load(), VALID, "a keystore that was locked may be readable later");
  assert.equal(keystore.reads(), 1, "the successful attempt is the last read");
  assert.equal(await identity.load(), VALID);
  assert.equal(keystore.reads(), 1);
});

test("the identity is never written to a log, and nothing else is stored", () => {
  const source = readFileSync(path.join(process.cwd(), "src", "device-identity.ts"), "utf8");
  // Prose is allowed to explain what is *not* used; the code is what is checked.
  const code = source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");
  for (const forbidden of ["console.", "logger", "fetch(", "/api/", "accessToken", "email", "draft"]) {
    assert.equal(code.includes(forbidden), false, `device-identity.ts contains ${forbidden}`);
  }
  // One write, of one key: the identity, and nothing else.
  assert.equal(code.split("store.setItem(").length - 1, 1, "the keystore is written exactly once");
  assert.equal(code.includes("DEVICE_IDENTITY_STORAGE_KEY"), true);
});

test("no rejection was left unhandled", async () => {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(unhandled, []);
});
