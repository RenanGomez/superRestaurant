const LOCK_PREFIX = "sr-sync-leader:";
const CHANNEL_NAME = "sr-sync-leader";
/**
 * How long a tab waits for the leader lock before declaring itself a follower. The Web Lock
 * is granted synchronously when nobody holds it, so this only fires while another tab leads.
 */
export const SYNC_LEADER_TIMEOUT_MS = 2_000;

export type SyncLeaderStatus = "leader" | "follower" | "unsupported";

export interface SyncLeaderHandle {
  readonly isLeader: boolean;
  /** `follower` means another tab holds the lock; `unsupported` means the browser has no Web Locks. */
  readonly status: SyncLeaderStatus;
  /** Runs when this tab takes the lock, including a later takeover after starting as a follower. */
  onGranted(callback: () => void): () => void;
  /**
   * Runs only when the lock is lost (request settled or failed) without a voluntary
   * `release()`, so a tab can discard its engine instead of assuming it still leads.
   */
  onLost(callback: () => void): () => void;
  /** Voluntary release. Never fires `onLost`; a pending takeover by another tab proceeds. */
  release(): void;
}

export interface SyncLeaderOptions {
  readonly locks?: LockManager;
  readonly channel?: BroadcastChannel | null;
  /** Wait for the lock before reporting `follower`. The lock request stays queued afterwards. */
  readonly timeoutMs?: number;
}

interface LeaderAnnouncement {
  readonly type: "leader-claimed" | "leader-released";
  readonly deviceId: string;
}

function unavailable(status: SyncLeaderStatus): SyncLeaderHandle {
  return Object.freeze({
    isLeader: false,
    status,
    onGranted: (): (() => void) => () => undefined,
    onLost: (): (() => void) => () => undefined,
    release: (): void => undefined,
  });
}

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

function notifyAll(listeners: Set<() => void>): void {
  const pending = [...listeners];
  listeners.clear();
  for (const callback of pending) {
    try {
      callback();
    } catch {
      continue;
    }
  }
}

/**
 * Elects one syncing tab per device. Every tab may read the store, but only the leader opens
 * the bridge and sends events; a follower keeps its lock request queued so it takes over when
 * the leader closes, and reports `follower` meanwhile instead of hanging on `await`.
 */
export async function acquireSyncLeader(deviceId: string, options: SyncLeaderOptions = {}): Promise<SyncLeaderHandle> {
  const locks = options.locks ?? globalThis.navigator?.locks;
  if (!deviceId || locks === undefined) return unavailable("unsupported");

  const channel = options.channel === undefined ? openChannel() : options.channel;
  const ownsChannel = options.channel === undefined;
  const timeoutMs = options.timeoutMs ?? SYNC_LEADER_TIMEOUT_MS;

  let leader = false;
  let released = false;
  let lost = false;
  let grantSettled = false;
  let releaseLock: (() => void) | null = null;
  let settleGrant: ((value: boolean) => void) | null = null;
  const granted = new Promise<boolean>((resolve) => {
    settleGrant = resolve;
  });
  const grantedListeners = new Set<() => void>();
  const lostListeners = new Set<() => void>();

  const closeOwned = (): void => {
    if (ownsChannel) channel?.close();
  };
  const announce = (type: LeaderAnnouncement["type"]): void => {
    channel?.postMessage({ type, deviceId } satisfies LeaderAnnouncement);
  };
  const settleGranted = (value: boolean): void => {
    if (grantSettled) return;
    grantSettled = true;
    settleGrant?.(value);
    settleGrant = null;
  };
  const loseLeadership = (): void => {
    if (lost) return;
    lost = true;
    leader = false;
    closeOwned();
    grantedListeners.clear();
    notifyAll(lostListeners);
  };
  const becomeLeader = (): void => {
    leader = true;
    announce("leader-claimed");
    if (released) {
      // The tab unmounted while its request was still queued: hand the lock straight back.
      leader = false;
      const done = releaseLock;
      releaseLock = null;
      done?.();
      closeOwned();
      return;
    }
    notifyAll(grantedListeners);
  };

  let request: Promise<unknown>;
  try {
    request = locks.request(`${LOCK_PREFIX}${deviceId}`, { mode: "exclusive" }, () => {
      const held = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      becomeLeader();
      settleGranted(true);
      return held;
    });
  } catch {
    closeOwned();
    return unavailable("unsupported");
  }
  const finishRequest = (): void => {
    settleGranted(false);
    if (released) {
      leader = false;
      closeOwned();
      return;
    }
    loseLeadership();
  };
  void request.then(finishRequest, finishRequest);

  const timeout = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    void granted.then(() => clearTimeout(timer));
  });
  const isLeaderNow = await Promise.race([granted, timeout]);
  if (released) return unavailable("unsupported");

  return Object.freeze({
    get isLeader(): boolean {
      return leader;
    },
    get status(): SyncLeaderStatus {
      return leader ? "leader" : "follower";
    },
    onGranted(callback: () => void): () => void {
      if (lost) return () => undefined;
      if (leader) {
        callback();
        return () => undefined;
      }
      if (!isLeaderNow) grantedListeners.add(callback);
      return () => {
        grantedListeners.delete(callback);
      };
    },
    onLost(callback: () => void): () => void {
      if (lost || released) return () => undefined;
      lostListeners.add(callback);
      return () => {
        lostListeners.delete(callback);
      };
    },
    release(): void {
      if (released) return;
      released = true;
      grantedListeners.clear();
      lostListeners.clear();
      if (!leader) {
        closeOwned();
        return;
      }
      announce("leader-released");
      leader = false;
      const done = releaseLock;
      releaseLock = null;
      done?.();
      closeOwned();
    },
  });
}
