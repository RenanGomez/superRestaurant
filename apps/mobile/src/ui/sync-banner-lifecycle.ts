/**
 * The `!alive` guard and the locked-store resume path of the mobile sync banner,
 * expressed without React so they can be tested directly.
 *
 * The banner opens the encrypted offline runtime asynchronously. A sign-out or a
 * scope change can land while that open, the health read or the resume is still
 * in flight; in that case no late result may reach `onState`. `stop()` closes
 * that gate, exactly as the effect's `alive` flag does.
 */

/** Why the banner has to fall back to the empty snapshot. */
export type SyncBannerLifecycleNotice =
  | "resume-failed"
  | "storage-locked"
  | "storage-unavailable";

export type SyncBannerLifecycleState =
  | { readonly status: "ready" }
  | { readonly status: "unavailable"; readonly notice: SyncBannerLifecycleNotice };

export interface SyncBannerLifecycleDeps<Runtime> {
  /** Opens the encrypted offline runtime; may reject when storage is missing. */
  readonly openRuntime: () => Promise<Runtime>;
  /** Records the opened runtime before any await that can outlive it. */
  readonly onOpened: (runtime: Runtime) => void;
  /** Health of the opened store; `locked` requires a resume before use. */
  readonly loadHealth: (runtime: Runtime) => Promise<{ readonly locked: boolean }>;
  /** Resumes a locked store for the authenticated scope and actor. */
  readonly resumeSession: (runtime: Runtime) => Promise<{ readonly status: string }>;
  /**
   * The banner's reaction. `ready` means the store is usable; `unavailable`
   * carries why the banner must fall back to the empty snapshot. It is only
   * called while active, but `isActive` must be checked again after any await.
   */
  readonly onState: (
    state: SyncBannerLifecycleState,
    runtime: Runtime | undefined,
    isActive: () => boolean,
  ) => Promise<void> | void;
  /** Discards a runtime whose open finished after `stop()`. */
  readonly onDiscard: (runtime: Runtime) => Promise<void>;
}

export interface SyncBannerLifecycle {
  readonly isActive: () => boolean;
  readonly start: () => void;
  readonly stop: () => void;
}

export function createSyncBannerLifecycle<Runtime>(
  deps: SyncBannerLifecycleDeps<Runtime>,
): SyncBannerLifecycle {
  let active = false;
  const isActive = (): boolean => active;

  const run = async (): Promise<void> => {
    let runtime: Runtime | undefined;
    try {
      runtime = await deps.openRuntime();
      if (!active) {
        // The sign-out landed while the runtime was still opening. There was no
        // runtime to release, so discard this one exactly as a normal sign-out
        // would before closing it.
        await deps.onDiscard(runtime);
        return;
      }
      deps.onOpened(runtime);
      const health = await deps.loadHealth(runtime);
      if (!active) return;
      if (health.locked) {
        // A store locked by a previous sign-out with retained evidence, or by a
        // scope/device revocation, only reopens with this fresh authenticated
        // scope and actor. A quarantined store is never resurrected.
        const resumed = await deps.resumeSession(runtime);
        if (!active) return;
        if (resumed.status !== "resumed") {
          await deps.onState(
            {
              notice: resumed.status === "corrupt" ? "storage-locked" : "resume-failed",
              status: "unavailable",
            },
            runtime,
            isActive,
          );
          return;
        }
      }
      await deps.onState({ status: "ready" }, runtime, isActive);
    } catch {
      if (active) {
        await deps.onState({ notice: "storage-unavailable", status: "unavailable" }, runtime, isActive);
      }
    }
  };

  return Object.freeze({
    isActive,
    start: (): void => {
      if (active) return;
      active = true;
      void run();
    },
    stop: (): void => {
      active = false;
    },
  });
}
