import type { BranchScope, SyncConnectivityStateV1 } from "@super-restaurant/shared-types";

import { WEB_SYNC_STATE_CHANGED_EVENT } from "../sync-ui";
import type { SyncLeaderHandle } from "./sync-leader";

export const SYNC_FOLLOWER_NOTICE = "Otra pestaña de este equipo sincroniza; esta pestaña no envía eventos.";
export const SYNC_UNSUPPORTED_NOTICE = "Este navegador no ofrece el bloqueo entre pestañas: esta pestaña no sincroniza.";

/** The subset of `WebSyncBridgeHandle` the runtime needs; tests provide a plain fake. */
export interface RuntimeBridge {
  readonly register: (scope: BranchScope) => void;
  readonly unregister: () => void;
  readonly syncNow: (scope: BranchScope) => Promise<void>;
  readonly release: () => Promise<unknown>;
  readonly setConnectivity: (state: SyncConnectivityStateV1) => void;
}

export interface RuntimeTimers {
  setInterval(callback: () => void, milliseconds: number): number;
  clearInterval(id: number): void;
}

export interface OfflineRuntimeOptions {
  readonly deviceId: string;
  readonly scope: BranchScope;
  readonly acquireLeader: () => Promise<SyncLeaderHandle>;
  /** Opens the durable bridge. Called only by the leader, and again after losing the lock. */
  readonly openBridge: () => Promise<RuntimeBridge>;
  /** Reports why this tab does not sync, or `null` when it leads. */
  readonly reportFollower: (notice: string | null) => void;
  readonly syncIntervalMs?: number;
  readonly timers?: RuntimeTimers;
  readonly isOnline?: () => boolean;
}

export interface OfflineRuntimeController {
  readonly isActive: boolean;
  setConnectivity(state: SyncConnectivityStateV1): void;
  syncNow(): void;
  stop(): void;
}

const DEFAULT_SYNC_INTERVAL_MS = 60_000;

/**
 * Why this tab is not syncing, read by the shell status bar. Module state on purpose:
 * one document, one offline runtime, no extra reactivity layer.
 */
let followerNotice: string | null = null;

export function setSyncFollowerNotice(notice: string | null): void {
  if (followerNotice === notice) return;
  followerNotice = notice;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WEB_SYNC_STATE_CHANGED_EVENT));
  }
}

export function getSyncFollowerNotice(): string | null {
  return followerNotice;
}

const browserTimers: RuntimeTimers = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds) as unknown as number,
  clearInterval: (id) => clearInterval(id),
};

/**
 * Runs the web offline engine behind a single leader tab.
 *
 * Only the leader opens the bridge and pushes events, so two tabs of the same device cannot
 * send the same outbox twice. A follower waits for the lock with a timeout, says why it is not
 * syncing, and keeps its lock request queued: when the leader tab closes (or loses the lock)
 * the follower takes over and opens its own engine against the same durable store. Losing the
 * lock tears the engine down first — the new leader owns the store, and the outbox entry keeps
 * its idempotency key across the reopen.
 */
export function startOfflineRuntime(options: OfflineRuntimeOptions): OfflineRuntimeController {
  const { scope, acquireLeader, openBridge, reportFollower } = options;
  const intervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const timers = options.timers ?? browserTimers;
  const isOnline = options.isOnline ?? ((): boolean => typeof navigator === "undefined" || navigator.onLine !== false);

  let stopped = false;
  let bridge: RuntimeBridge | undefined;
  let leader: SyncLeaderHandle | undefined;
  let ticker: number | undefined;
  let offGranted: (() => void) | undefined;
  let offLost: (() => void) | undefined;

  const clearWatchers = (): void => {
    offGranted?.();
    offGranted = undefined;
    offLost?.();
    offLost = undefined;
  };

  const stopBridge = (): void => {
    if (ticker !== undefined) {
      timers.clearInterval(ticker);
      ticker = undefined;
    }
    const current = bridge;
    bridge = undefined;
    if (current !== undefined) {
      current.unregister();
      // A clean release purges the local store; retained evidence keeps the queue for the
      // next engine, which retries with the same idempotency keys.
      void current.release();
    }
  };

  const openAsLeader = async (): Promise<void> => {
    if (stopped || bridge !== undefined) return;
    try {
      const opened = await openBridge();
      if (stopped) {
        await opened.release();
        return;
      }
      bridge = opened;
      reportFollower(null);
      opened.setConnectivity(isOnline() ? "online" : "offline");
      opened.register(scope);
      await opened.syncNow(scope);
      ticker = timers.setInterval(() => {
        if (isOnline()) void opened.syncNow(scope);
      }, intervalMs);
    } catch {
      // No IndexedDB / no Web Crypto: the UI keeps reporting storage unavailable.
      bridge = undefined;
    }
  };

  const watchLoss = (handle: SyncLeaderHandle): void => {
    offLost = handle.onLost(() => {
      offLost = undefined;
      // The lock is gone: discard this engine before the new leader writes the store.
      leader = undefined;
      stopBridge();
      void acquire();
    });
  };

  const acquire = async (): Promise<void> => {
    if (stopped) return;
    let acquired: SyncLeaderHandle;
    try {
      acquired = await acquireLeader();
    } catch {
      reportFollower(SYNC_UNSUPPORTED_NOTICE);
      return;
    }
    if (stopped) {
      acquired.release();
      return;
    }
    leader = acquired;
    if (acquired.isLeader) {
      reportFollower(null);
      watchLoss(acquired);
      await openAsLeader();
      return;
    }
    reportFollower(acquired.status === "unsupported" ? SYNC_UNSUPPORTED_NOTICE : SYNC_FOLLOWER_NOTICE);
    offGranted = acquired.onGranted(() => {
      offGranted = undefined;
      reportFollower(null);
      watchLoss(acquired);
      void openAsLeader();
    });
  };

  void acquire();

  return {
    get isActive(): boolean {
      return bridge !== undefined;
    },
    setConnectivity(state: SyncConnectivityStateV1): void {
      bridge?.setConnectivity(state);
    },
    syncNow(): void {
      if (bridge !== undefined) void bridge.syncNow(scope);
    },
    stop(): void {
      stopped = true;
      clearWatchers();
      stopBridge();
      leader?.release();
      leader = undefined;
      reportFollower(null);
    },
  };
}
