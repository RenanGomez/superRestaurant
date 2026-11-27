import type { BranchScope } from "@super-restaurant/shared-types";

import { deviceIdForActor } from "./device-id";
import { ensureInventoryDeviceId, type InventoryDeviceStore } from "./inventory-ui";

/** Same-origin route that registers the device for this actor inside a scoped branch. */
export const INVENTORY_DEVICE_REGISTRATION_PATH = "/api/sync/devices";

/**
 * The id inventory writes send: derived per `(browser profile, actor)`, exactly like the sync
 * bridge. The profile id stays in `localStorage`; only the derived id reaches the API, so a
 * shared tablet keeps one `app.sync_devices` row per cashier instead of one row for the first.
 */
export function resolveInventoryDeviceId(
  store: InventoryDeviceStore | undefined,
  actorId: string,
  create: () => string,
): string {
  return deviceIdForActor(ensureInventoryDeviceId(store, create), actorId);
}

/**
 * Registers the device before the first write of the session. The server rejects inventory
 * writes from a device that is not `active` for the actor, so a failure here must keep the
 * operator from saving (the UI shows it) instead of letting the API reject later.
 */
export async function registerInventoryDevice(input: {
  readonly deviceId: string;
  readonly scope: BranchScope;
  readonly fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const send = input.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (send === undefined) return false;
  try {
    const response = await send(INVENTORY_DEVICE_REGISTRATION_PATH, {
      body: JSON.stringify({ deviceId: input.deviceId, scope: input.scope }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}
