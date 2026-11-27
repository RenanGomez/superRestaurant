"use client";

import { useEffect, useState } from "react";
import type { BranchScope } from "@super-restaurant/shared-types";

import { registerInventoryDevice, resolveInventoryDeviceId } from "../../../lib/inventory-device";

export interface InventoryDeviceState {
  /** Derived per-actor id; empty until the effect resolves the browser profile. */
  readonly deviceId: string;
  /** True only after the server confirmed the device as `active` for this actor and branch. */
  readonly ready: boolean;
}

/**
 * Resolves and registers the inventory device once per mount. Writes stay disabled until the
 * registration succeeded: the API now rejects movements and receipts from a device that is not
 * registered for the actor, and the UI must not offer an action that is going to fail.
 */
export function useInventoryDevice(actorId: string, scope: BranchScope): InventoryDeviceState {
  const [state, setState] = useState<InventoryDeviceState>({ deviceId: "", ready: false });

  useEffect(() => {
    let cancelled = false;
    if (actorId === "") {
      setState({ deviceId: "", ready: false });
      return undefined;
    }
    const storage = typeof window === "undefined" ? undefined : window.localStorage;
    const deviceId = resolveInventoryDeviceId(storage, actorId, () => crypto.randomUUID());
    setState({ deviceId, ready: false });
    void registerInventoryDevice({ deviceId, scope }).then((ok) => {
      if (!cancelled) setState({ deviceId, ready: ok });
    });
    return () => {
      cancelled = true;
    };
  }, [actorId, scope.branchId, scope.restaurantId]);

  return state;
}
