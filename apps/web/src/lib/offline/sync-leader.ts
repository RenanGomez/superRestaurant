const LOCK_PREFIX = "sr-sync-leader:";
const CHANNEL_NAME = "sr-sync-leader";

export interface SyncLeaderHandle {
  readonly isLeader: boolean;
  onLost(callback: () => void): () => void;
  release(): void;
}

export interface SyncLeaderOptions {
  readonly locks?: LockManager;
  readonly channel?: BroadcastChannel | null;
}

interface LeaderAnnouncement {
  readonly type: "leader-claimed" | "leader-released";
  readonly deviceId: string;
}

function unavailable(): SyncLeaderHandle {
  return Object.freeze({
    isLeader: false,
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

export async function acquireSyncLeader(deviceId: string, options: SyncLeaderOptions = {}): Promise<SyncLeaderHandle> {
  const locks = options.locks ?? globalThis.navigator?.locks;
  if (!deviceId || locks === undefined) return unavailable();

  const channel = options.channel === undefined ? openChannel() : options.channel;
  const ownsChannel = options.channel === undefined;
  const listeners = new Set<() => void>();
  let leader = false;
  let released = false;
  let lost = false;
  let releaseLock: (() => void) | null = null;
  let settle: ((value: boolean) => void) | null = null;
  const granted = new Promise<boolean>((resolve) => {
    settle = resolve;
  });

  const closeOwned = (): void => {
    if (ownsChannel) channel?.close();
  };
  const announce = (type: LeaderAnnouncement["type"]): void => {
    channel?.postMessage({ type, deviceId } satisfies LeaderAnnouncement);
  };
  const notifyLost = (): void => {
    if (lost) return;
    lost = true;
    leader = false;
    closeOwned();
    const pending = [...listeners];
    listeners.clear();
    for (const callback of pending) {
      try {
        callback();
      } catch {
        continue;
      }
    }
  };

  let request: Promise<unknown>;
  try {
    request = locks.request(`${LOCK_PREFIX}${deviceId}`, { mode: "exclusive" }, () => {
      leader = true;
      announce("leader-claimed");
      settle?.(true);
      settle = null;
      return new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
    });
  } catch {
    closeOwned();
    return unavailable();
  }
  const finishRequest = (): void => {
    settle?.(false);
    settle = null;
    notifyLost();
  };
  void request.then(finishRequest, finishRequest);

  if (!(await granted)) return unavailable();

  return {
    get isLeader(): boolean {
      return leader;
    },
    onLost(callback: () => void): () => void {
      if (lost || !leader) return () => undefined;
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    release(): void {
      if (released) return;
      released = true;
      if (!leader) {
        closeOwned();
        return;
      }
      announce("leader-released");
      const done = releaseLock;
      releaseLock = null;
      done?.();
      notifyLost();
    },
  };
}
