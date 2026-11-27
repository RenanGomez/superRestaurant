"use client";

import { useEffect, useState } from "react";
import type { BranchScope } from "@super-restaurant/shared-types";

import { registerInventoryDevice, resolveInventoryDeviceId } from "../../../lib/inventory-device";

export type InventoryDeviceStatus = "pending" | "ready" | "rejected";

export interface InventoryDeviceState {
  /** Derived per-actor id; empty until the effect resolves the browser profile. */
  readonly deviceId: string;
  /**
   * `ready` only after the server confirmed the device as active for this actor and branch.
   * `rejected` means the registration failed or timed out: the API would reject the writes.
   */
  readonly status: InventoryDeviceStatus;
}

/**
 * Resolves and registers the inventory device once per mount. Writes stay disabled until the
 * registration succeeded: the API rejects movements and receipts from a device that is not
 * registered for the actor, and the UI must not offer an action that is going to fail.
 */
export function useInventoryDevice(actorId: string, scope: BranchScope): InventoryDeviceState {
  const [state, setState] = useState<InventoryDeviceState>({ deviceId: "", status: "pending" });

  useEffect(() => {
    let cancelled = false;
    if (actorId === "") {
      setState({ deviceId: "", status: "rejected" });
      return undefined;
    }
    const storage = typeof window === "undefined" ? undefined : window.localStorage;
    const deviceId = resolveInventoryDeviceId(storage, actorId, () => crypto.randomUUID());
    setState({ deviceId, status: "pending" });
    void registerInventoryDevice({ deviceId, scope }).then((ok) => {
      if (!cancelled) setState({ deviceId, status: ok ? "ready" : "rejected" });
    });
    return () => {
      cancelled = true;
    };
  }, [actorId, scope.branchId, scope.restaurantId]);

  return state;
}
