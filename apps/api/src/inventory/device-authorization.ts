import type { DatabaseClientPort } from "../database.js";

/**
 * `state` of a sync device for an actor inside one scoped branch: `active`, `revoked` or `unknown`.
 * `app_private.sync_device_state` is `SECURITY DEFINER`, has `EXECUTE` for `app_api` and also checks
 * `sync_authorized`, so a device from another tenant can never look active.
 */
const DEVICE_STATE_SQL =
  "select app_private.sync_device_state($1::uuid,$2::uuid,$3::text,$4::uuid) as state";

export interface InventoryDeviceCheck {
  readonly actorId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly deviceId: string;
}

/**
 * The inventory `deviceId` stays an audit trace, never an authorization: the actor comes from the
 * session and RBAC decides the operation. It is still validated against `app.sync_devices` so a
 * foreign, pruned or revoked device cannot be recorded as if it were this actor's (the P2 of
 * `debt.md`). The client derives the id per `(browser profile, actor)` with the same hash the sync
 * bridge uses, so one shared tablet keeps one row per cashier instead of colliding on the first.
 */
export async function isRegisteredInventoryDevice(
  database: DatabaseClientPort,
  check: InventoryDeviceCheck,
): Promise<boolean> {
  const result = await database.query(DEVICE_STATE_SQL, [
    check.restaurantId,
    check.branchId,
    check.deviceId,
    check.actorId,
  ]);
  const row = result.rows[0] as { state?: unknown } | undefined;
  return row?.state === "active";
}
