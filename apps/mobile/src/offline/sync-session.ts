/**
 * Session lifecycle of the local offline store (ADR-005 §5).
 *
 * The security requirement is that **a sign-out or a revocation stops new
 * pushes immediately** and that pending financial evidence is never destroyed
 * to satisfy a logout. The gate is therefore process-local and synchronous:
 * `pushesAllowed()` flips to `false` before the first `await`, and the sync
 * transport consults it on every request.
 *
 * The table below is the implemented policy:
 *
 * | Scenario                                  | Storage                        | DEK      |
 * |-------------------------------------------|--------------------------------|----------|
 * | Sign-out without pending evidence         | cache purged, sequence kept    | kept     |
 * | Sign-out with pending/blocking evidence   | locked, evidence kept          | kept     |
 * | `AUTH_REVOKED` for a scope                | locked, replica purged         | kept     |
 * | `DEVICE_REVOKED` without financial events | every row wiped                | shredded |
 * | `DEVICE_REVOKED` with financial events    | locked, evidence kept          | kept     |
 * | `DEVICE_COMPROMISED` (any evidence)       | every row wiped                | shredded |
 * | Corrupt store (any scenario)              | quarantined, nothing purged    | kept     |
 *
 * The key is only destroyed together with a wipe of the rows it encrypts:
 * shredding the DEK alone would leave an unreadable database behind while also
 * making post-incident reconciliation impossible.
 */
import { parseSyncScope, type SyncScopeInput } from "@super-restaurant/sync-engine";

import type {
  MobileSyncLocalStorageAdmin,
  MobileSyncPendingEvidence,
  MobileSyncPurgeOutcome,
} from "./sync-store.js";

export type MobileSyncSignOutOutcome =
  | { readonly status: "clean"; readonly purge: MobileSyncPurgeOutcome }
  | {
    readonly status: "evidence-retained";
    readonly locked: true;
    readonly evidence: MobileSyncPendingEvidence;
    readonly purge: MobileSyncPurgeOutcome;
  }
  | { readonly status: "corrupt"; readonly quarantined: true };

export type MobileScopeRevocationOutcome =
  | { readonly status: "revoked"; readonly locked: true; readonly purge: MobileSyncPurgeOutcome }
  | { readonly status: "corrupt"; readonly quarantined: true };

export type MobileDeviceRevocationReason = "DEVICE_REVOKED" | "DEVICE_COMPROMISED";

export type MobileDeviceRevocationOutcome =
  | { readonly status: "shredded"; readonly evidenceWasPending: boolean }
  | { readonly status: "evidence-quarantined"; readonly evidence: MobileSyncPendingEvidence; readonly purge: MobileSyncPurgeOutcome }
  | { readonly status: "corrupt"; readonly quarantined: true };

export type MobileSyncResumeOutcome =
  | { readonly status: "resumed" }
  | { readonly status: "corrupt"; readonly quarantined: true };

export type MobileSyncSessionErrorCode = "RESUME_INVALID";

export class MobileSyncSessionError extends Error {
  public constructor(public readonly code: MobileSyncSessionErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "MobileSyncSessionError";
  }
}

/** The only key operation this policy needs. */
export interface MobileSyncKeyPurgePort {
  readonly purge: (deviceId: string) => Promise<void>;
}

export interface MobileOfflineSessionOptions {
  readonly deviceId: string;
  readonly storage: MobileSyncLocalStorageAdmin;
  readonly keys: MobileSyncKeyPurgePort;
}

function hasPendingEvidence(evidence: MobileSyncPendingEvidence): boolean {
  return evidence.pendingCount > 0 || evidence.blockingCount > 0 || evidence.financialPendingCount > 0;
}

export class MobileOfflineSession {
  private readonly deviceId: string;
  private readonly storage: MobileSyncLocalStorageAdmin;
  private readonly keys: MobileSyncKeyPurgePort;
  /** Kept `false` forever after a lock: re-enabling requires a new authenticated session. */
  private gate = true;
  /** One sign-out runs once: a provider echo or a second caller joins the same purge. */
  private signOutInFlight: Promise<MobileSyncSignOutOutcome> | undefined;

  public constructor(options: MobileOfflineSessionOptions) {
    this.deviceId = options.deviceId;
    this.storage = options.storage;
    this.keys = options.keys;
  }

  /**
   * Synchronous push gate. No `await` happens before it returns, which is what
   * makes a sign-out able to stop an in-flight retry loop immediately.
   */
  public pushesAllowed(): boolean {
    return this.gate;
  }

  /** Closes the gate without touching storage, for callers that only need the traffic stop. */
  public closePushGate(): void {
    this.gate = false;
  }

  /**
   * Sign-out is idempotent and deduplicated: closing the gate and purging/locking
   * runs once even when the local sign-out and the provider echo both call it.
   * A failure is surfaced to the caller (never swallowed) and clears the memo so
   * a later attempt can retry the purge.
   */
  public prepareSignOut(): Promise<MobileSyncSignOutOutcome> {
    this.gate = false;
    if (this.signOutInFlight !== undefined) return this.signOutInFlight;
    const run = this.runPrepareSignOut();
    this.signOutInFlight = run;
    void run.catch(() => {
      if (this.signOutInFlight === run) this.signOutInFlight = undefined;
    });
    return run;
  }

  private async runPrepareSignOut(): Promise<MobileSyncSignOutOutcome> {
    const evidence = await this.storage.inspectPendingEvidence();
    if (evidence.status === "corrupt") {
      await this.storage.quarantineCorruptStore();
      return Object.freeze({ status: "corrupt" as const, quarantined: true as const });
    }
    if (hasPendingEvidence(evidence)) {
      await this.storage.lockStore();
      const purge = await this.storage.purgeNonEvidentiaryCache();
      return Object.freeze({ status: "evidence-retained" as const, locked: true as const, evidence, purge });
    }
    const purge = await this.storage.purgeNonEvidentiaryCache();
    return Object.freeze({ status: "clean" as const, purge });
  }

  /**
   * Reverses a `prepareSignOut` that kept pending evidence: an authenticated
   * session unlocks the store, reopens the push gate and leaves pending
   * evidence readable. It never rewrites `lastLocalSequence` (the snapshot is
   * untouched), and it refuses to resurrect a quarantined store.
   */
  public async resumeSession(scope: SyncScopeInput, actorId: string): Promise<MobileSyncResumeOutcome> {
    if (typeof actorId !== "string" || actorId.trim().length === 0) {
      throw new MobileSyncSessionError("RESUME_INVALID", "actorId");
    }
    const parsed = parseSyncScope(scope);
    if (!parsed.ok) throw new MobileSyncSessionError("RESUME_INVALID", parsed.field);

    const health = await this.storage.getStorageHealth();
    if (health.quarantined) return Object.freeze({ status: "corrupt" as const, quarantined: true as const });
    await this.storage.unlockStore();
    // A new authenticated session is a fresh lifecycle: a later sign-out must run
    // again instead of returning the previous purge outcome.
    this.signOutInFlight = undefined;
    this.gate = true;
    return Object.freeze({ status: "resumed" as const });
  }

  /**
   * `AUTH_REVOKED` / `UNAUTHORIZED_SCOPE`: the engine has already moved pending
   * financial events to `manual_review`. Stop all pushes, keep every outbox
   * entry encrypted, and drop the revoked scope's readable replica.
   */
  public async handleScopeRevocation(scope: SyncScopeInput): Promise<MobileScopeRevocationOutcome> {
    this.gate = false;
    const evidence = await this.storage.inspectPendingEvidence();
    if (evidence.status === "corrupt") {
      await this.storage.quarantineCorruptStore();
      return Object.freeze({ status: "corrupt" as const, quarantined: true as const });
    }
    await this.storage.lockStore();
    const purge = await this.storage.purgeReplicaForScope(scope);
    return Object.freeze({ status: "revoked" as const, locked: true as const, purge });
  }

  /**
   * `DEVICE_REVOKED` / `DEVICE_COMPROMISED`. A compromised device outranks
   * reconciliation: confidentiality wins and the rows plus their DEK are
   * destroyed. A non-compromised revocation keeps pending financial evidence
   * encrypted until a supervisor closes the review.
   */
  public async handleDeviceRevocation(reason: MobileDeviceRevocationReason): Promise<MobileDeviceRevocationOutcome> {
    this.gate = false;
    const evidence = await this.storage.inspectPendingEvidence();
    if (evidence.status === "corrupt") {
      await this.storage.quarantineCorruptStore();
      return Object.freeze({ status: "corrupt" as const, quarantined: true as const });
    }
    const mustShred = reason === "DEVICE_COMPROMISED" || evidence.financialPendingCount === 0;
    if (mustShred) {
      await this.storage.wipeAll();
      await this.keys.purge(this.deviceId);
      return Object.freeze({ status: "shredded" as const, evidenceWasPending: hasPendingEvidence(evidence) });
    }
    await this.storage.lockStore();
    const purge = await this.storage.purgeNonEvidentiaryCache();
    return Object.freeze({ status: "evidence-quarantined" as const, evidence, purge });
  }
}
