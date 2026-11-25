export const OFFLINE_PURGE_EVENTS = ["sign_out", "auth_revoked", "device_revoked", "device_compromised"] as const;
export type OfflinePurgeEvent = (typeof OFFLINE_PURGE_EVENTS)[number];

export const OFFLINE_PURGE_ACTIONS = ["purge_all", "purge_replica_keep_outbox", "lock_and_keep"] as const;
export type OfflinePurgeAction = (typeof OFFLINE_PURGE_ACTIONS)[number];

export interface OfflinePurgeInput {
  readonly event: OfflinePurgeEvent;
  readonly hasFinancialEvidence: boolean;
}

export interface OfflinePurgeDecision {
  readonly action: OfflinePurgeAction;
  readonly reason: string;
}

export function decideOfflinePurge(input: OfflinePurgeInput): OfflinePurgeDecision {
  switch (input.event) {
    case "sign_out":
      return input.hasFinancialEvidence
        ? { action: "purge_replica_keep_outbox", reason: "sign_out_with_financial_evidence" }
        : { action: "purge_all", reason: "sign_out_without_financial_evidence" };
    case "auth_revoked":
      return { action: "purge_replica_keep_outbox", reason: "auth_revoked_keeps_retained_outbox" };
    case "device_revoked":
      return input.hasFinancialEvidence
        ? { action: "lock_and_keep", reason: "device_revoked_with_financial_evidence" }
        : { action: "purge_all", reason: "device_revoked_without_financial_evidence" };
    case "device_compromised":
      return input.hasFinancialEvidence
        ? { action: "purge_replica_keep_outbox", reason: "device_compromised_with_financial_evidence" }
        : { action: "purge_all", reason: "device_compromised_without_financial_evidence" };
    default:
      return { action: "lock_and_keep", reason: "unknown_event_fail_closed" };
  }
}
