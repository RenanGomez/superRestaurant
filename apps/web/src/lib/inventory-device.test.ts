import assert from "node:assert/strict";
import test from "node:test";
import type { BranchScope } from "@super-restaurant/shared-types";

import { INVENTORY_DEVICE_ID_KEY } from "./inventory-ui.js";
import { registerInventoryDevice, resolveInventoryDeviceId } from "./inventory-device.js";

const actor = "00000000-0000-4000-8000-0000000000a1";
const otherActor = "00000000-0000-4000-8000-0000000000a2";
const profile = "00000000-0000-4000-8000-0000000000b1";
const scope: BranchScope = { restaurantId: "00000000-0000-4000-8000-0000000000c1", branchId: "00000000-0000-4000-8000-0000000000c2" } as BranchScope;

function memoryStore(seed?: string): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(INVENTORY_DEVICE_ID_KEY, seed);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("el id de inventario se deriva por actor y es estable entre montajes", () => {
  const store = memoryStore(profile);
  const first = resolveInventoryDeviceId(store, actor, () => "00000000-0000-4000-8000-0000000000ff");
  const second = resolveInventoryDeviceId(store, actor, () => "00000000-0000-4000-8000-0000000000ff");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.notEqual(first, profile, "el id que viaja al API no expone el perfil");
});

test("dos actores del mismo equipo derivan ids distintos para el registro de sync", () => {
  const store = memoryStore(profile);
  const first = resolveInventoryDeviceId(store, actor, () => "unused");
  const second = resolveInventoryDeviceId(store, otherActor, () => "unused");
  assert.notEqual(first, second);
  // The profile identity is untouched: only the id sent to the API is derived.
  assert.equal(store.getItem(INVENTORY_DEVICE_ID_KEY), profile);
});

test("registerInventoryDevice publica el id y el scope en la ruta del proxy", async () => {
  const calls: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
  const ok = await registerInventoryDevice({
    deviceId: actor,
    scope,
    fetchImpl: (url, init) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.url ?? "", /\/api\/sync\/devices$/u);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { deviceId: actor, scope });
});

test("un fallo de red o un 403 dejan el equipo sin registrar", async () => {
  const rejected = await registerInventoryDevice({
    deviceId: actor,
    scope,
    fetchImpl: () => Promise.resolve(new Response("{}", { status: 403 })),
  });
  assert.equal(rejected, false);
  const offline = await registerInventoryDevice({
    deviceId: actor,
    scope,
    fetchImpl: () => Promise.reject(new Error("offline")),
  });
  assert.equal(offline, false);
});
