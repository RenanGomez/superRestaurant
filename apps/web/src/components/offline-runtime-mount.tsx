"use client";

import { useEffect } from "react";
import type { BranchScope } from "@super-restaurant/shared-types";

import { createWebSyncTransport } from "../lib/offline/sync-transport";
import { openWebSyncBridge, type WebSyncBridgeHandle } from "../lib/offline/web-sync-bridge";

const DEVICE_ID_STORAGE_KEY = "sr-web-device-id";
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SYNC_INTERVAL_MS = 60_000;
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
 * Hidden client boundary of the authenticated shell. It opens the durable offline
 * bridge once the branch scope and actor are known, registers the two global ports
 * (`OfflinePosPort` + `WebSyncBridge`) so the sync bar shows the real queue, and
 * releases the store on unmount — which is what a sign-out triggers. Release purges
 * the local database only when nothing is unconfirmed.
 */
export function OfflineRuntimeMount({ scope, actorId }: OfflineRuntimeMountProps): null {
  const restaurantId = scope?.restaurantId;
  const branchId = scope?.branchId;
  const userId = actorId;

  useEffect(() => {
    if (restaurantId === undefined || branchId === undefined || userId === undefined) return undefined;
    const deviceId = resolveDeviceId();
    if (deviceId === undefined) return undefined;

    const activeScope = Object.freeze({ branchId, restaurantId });
    let disposed = false;
    let released = false;
    let handle: WebSyncBridgeHandle | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    const transport = createWebSyncTransport({
      accessToken: () => Promise.resolve(SAME_ORIGIN_PROXY_TOKEN),
      apiBaseUrl: window.location.origin,
      canSend: () => !released,
      paths: { pull: "/api/sync/pull", push: "/api/sync/push", snapshot: "/api/sync/snapshot" },
      timeoutMs: 30_000,
    });

    const online = (): void => {
      handle?.setConnectivity("online");
      if (handle !== undefined) void handle.syncNow(activeScope);
    };
    const offline = (): void => {
      handle?.setConnectivity("offline");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    void (async (): Promise<void> => {
      try {
        const opened = await openWebSyncBridge({
          actorId: userId,
          deviceId,
          transport,
        });
        if (disposed) {
          await opened.release();
          return;
        }
        handle = opened;
        opened.setConnectivity(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online");
        opened.register(activeScope);
        await opened.syncNow(activeScope);
        interval = setInterval(() => {
          if (typeof navigator !== "undefined" && !navigator.onLine) return;
          void opened.syncNow(activeScope);
        }, SYNC_INTERVAL_MS);
      } catch {
        // No IndexedDB / no Web Locks: the UI stays honest and reports storage unavailable.
      }
    })();

    return () => {
      disposed = true;
      released = true;
      if (interval !== undefined) clearInterval(interval);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      const current = handle;
      handle = undefined;
      if (current !== undefined) {
        current.unregister();
        void current.release();
      }
    };
  }, [branchId, restaurantId, userId]);

  return null;
}
