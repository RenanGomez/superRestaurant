export const OFFLINE_PURGE_EVENTS = ["sign_out", "auth_revoked", "device_revoked", "device_compromised"] as const;
export type OfflinePurgeEvent = (typeof OFFLINE_PURGE_EVENTS)[number];

export const OFFLINE_PURGE_ACTIONS = [
  "purge_all",
  "purge_replica_keep_outbox",
  "lock_and_purge_replica",
  "lock_and_keep",
] as const;
export type OfflinePurgeAction = (typeof OFFLINE_PURGE_ACTIONS)[number];

export interface OfflinePurgeInput {
  readonly event: OfflinePurgeEvent;
  readonly hasFinancialEvidence: boolean;
}

export interface OfflinePurgeDecision {
  readonly action: OfflinePurgeAction;
  readonly reason: string;
}

/**
 * Decides the requested purge action for an offline event.
 *
 * `purge_all` is a request for a total purge, not a guarantee that the local store is empty:
 * the store wipes slots, keys and metadata only when the outbox holds no retained evidence.
 * When evidence exists, `purge_all` degrades to `purge_replica_keep_outbox` (drop the replica,
 * keep the outbox). A purge never deletes retained financial evidence.
 *
 * A revocation (server `AUTH_REVOKED`/`DEVICE_REVOKED`, or a compromised device) seals the
 * store *before* dropping the replica: a retained outbox on a credential that no longer
 * authenticates must not stay readable. The outbox survives because it is the only copy of
 * the evidence; it is re-encrypted under a fresh key and the store is left locked.
 */
export function decideOfflinePurge(input: OfflinePurgeInput): OfflinePurgeDecision {
  switch (input.event) {
    case "sign_out":
      return input.hasFinancialEvidence
        ? { action: "purge_replica_keep_outbox", reason: "sign_out_with_financial_evidence" }
        : { action: "purge_all", reason: "sign_out_without_financial_evidence" };
    case "auth_revoked":
      return { action: "lock_and_purge_replica", reason: "auth_revoked_locks_and_drops_replica" };
    case "device_revoked":
      return input.hasFinancialEvidence
        ? { action: "lock_and_purge_replica", reason: "device_revoked_with_financial_evidence" }
        : { action: "purge_all", reason: "device_revoked_without_financial_evidence" };
    case "device_compromised":
      return input.hasFinancialEvidence
        ? { action: "lock_and_purge_replica", reason: "device_compromised_with_financial_evidence" }
        : { action: "purge_all", reason: "device_compromised_without_financial_evidence" };
    default:
      return { action: "lock_and_keep", reason: "unknown_event_fail_closed" };
  }
}
