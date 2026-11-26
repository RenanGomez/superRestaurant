"use client";

import { useEffect } from "react";
import type { BranchScope } from "@super-restaurant/shared-types";

import { setSyncFollowerNotice, startOfflineRuntime } from "../lib/offline/runtime-sync-runner";
import { acquireSyncLeader } from "../lib/offline/sync-leader";
import { createWebSyncTransport } from "../lib/offline/sync-transport";
import { openWebSyncBridge, syncDeviceIdForActor } from "../lib/offline/web-sync-bridge";

const DEVICE_ID_STORAGE_KEY = "sr-web-device-id";
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/**
 * The same-origin `/api/sync/*` handler authenticates with the httpOnly session
 * cookie. This placeholder satisfies the transport's non-empty-token contract and
 * is never a credential: no Supabase token or API origin reaches the browser.
 */
const SAME_ORIGIN_PROXY_TOKEN = "same-origin-session";

function resolveDeviceId(): string | undefined {
  if (typeof window === "undefined" || typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    return undefined;
  }
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing !== null && DEVICE_ID_PATTERN.test(existing)) return existing.toLowerCase();
    const created = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return undefined;
  }
}

export interface OfflineRuntimeMountProps {
  readonly scope: BranchScope | undefined;
  readonly actorId: string | undefined;
}

/**
 * Hidden client boundary of the authenticated shell. It elects one syncing tab per device with
 * the Web Locks API, opens the durable offline bridge only for the leader, registers the two
 * global ports (`OfflinePosPort` + `WebSyncBridge`) so the sync bar shows the real queue, and
 * releases the store on unmount — which is what a sign-out triggers. Release applies the
 * sign-out purge policy and keeps any retained financial evidence.
 */
export function OfflineRuntimeMount({ scope, actorId }: OfflineRuntimeMountProps): null {
  const restaurantId = scope?.restaurantId;
  const branchId = scope?.branchId;
  const userId = actorId;

  useEffect(() => {
    if (restaurantId === undefined || branchId === undefined || userId === undefined) return undefined;
    const baseDeviceId = resolveDeviceId();
    if (baseDeviceId === undefined) return undefined;
    // The server binds a sync device row to its actor, so the id sent to the API must
    // be per (tablet, actor). Derived with the bridge's deterministic hash; the browser
    // identity in localStorage stays shared and the store stays per actor.
    const deviceId = syncDeviceIdForActor(baseDeviceId, userId);
    const activeScope = Object.freeze({ branchId, restaurantId });

    const transport = createWebSyncTransport({
      accessToken: () => Promise.resolve(SAME_ORIGIN_PROXY_TOKEN),
      apiBaseUrl: window.location.origin,
      canSend: () => controller.isActive,
      paths: { devices: "/api/sync/devices", pull: "/api/sync/pull", push: "/api/sync/push", snapshot: "/api/sync/snapshot" },
      timeoutMs: 30_000,
    });

    const controller = startOfflineRuntime({
      deviceId,
      scope: activeScope,
      acquireLeader: () => acquireSyncLeader(deviceId),
      openBridge: () => openWebSyncBridge({ actorId: userId, deviceId, transport }),
      reportFollower: setSyncFollowerNotice,
    });

    const online = (): void => {
      controller.setConnectivity("online");
      controller.syncNow();
    };
    const offline = (): void => {
      controller.setConnectivity("offline");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      controller.stop();
    };
  }, [branchId, restaurantId, userId]);

  return null;
}
