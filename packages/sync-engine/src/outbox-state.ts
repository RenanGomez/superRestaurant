import { type OutboxEntry, type OutboxOutcome, type OutboxState, type ServerResultStatus } from "./contract.js";
import { SyncEngineError } from "./errors.js";

/** OFFLINE_SYNC_CONTRACT section 7.1: allowed state-to-state transitions. */
export const OUTBOX_TRANSITIONS: Readonly<Record<OutboxState, readonly OutboxState[]>> = Object.freeze({
  pending: Object.freeze<OutboxState[]>(["sending", "manual_review"]),
  sending: Object.freeze<OutboxState[]>(["accepted", "duplicate", "rejected", "conflict", "manual_review", "retry_wait", "pending"]),
  retry_wait: Object.freeze<OutboxState[]>(["sending", "manual_review"]),
  accepted: Object.freeze<OutboxState[]>([]),
  duplicate: Object.freeze<OutboxState[]>([]),
  rejected: Object.freeze<OutboxState[]>([]),
  conflict: Object.freeze<OutboxState[]>(["manual_review"]),
  manual_review: Object.freeze<OutboxState[]>([]),
});

export const TERMINAL_STATES: readonly OutboxState[] = Object.freeze<OutboxState[]>(["accepted", "duplicate", "rejected"]);

export function canTransition(from: OutboxState, to: OutboxState): boolean {
  return OUTBOX_TRANSITIONS[from].includes(to);
}

export function isTerminalState(state: OutboxState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** States that stop later events of the same entity until a resolution event is linked. */
export function isBlockingState(state: OutboxState): boolean {
  return state === "conflict" || state === "manual_review";
}

export type OutboxEvent =
  | { readonly type: "claim"; readonly attemptId: string; readonly leaseUntil: number; readonly nowMs: number }
  | { readonly type: "lease_expired"; readonly nowMs: number }
  | { readonly type: "retry"; readonly errorCode: string; readonly nextAttemptAt: number; readonly nowMs: number }
  | { readonly type: "result"; readonly status: ServerResultStatus; readonly outcome: OutboxOutcome; readonly nowMs: number }
  | { readonly type: "invalidate"; readonly errorCode: string; readonly nowMs: number }
  | { readonly type: "escalate"; readonly errorCode: string; readonly nowMs: number }
  | { readonly type: "block"; readonly blockedBy: string | null }
  | { readonly type: "resolve"; readonly resolvedBy: string; readonly nowMs: number };

function next(current: OutboxEntry, changes: Partial<OutboxEntry>): OutboxEntry {
  // Identity, scope, payload and idempotency key are never in `changes`: envelopes are immutable.
  return Object.freeze({ ...current, ...changes });
}

function invalid(current: OutboxEntry, event: OutboxEvent): SyncEngineError {
  if (current.localState === "accepted" || current.localState === "duplicate" || current.localState === "rejected") {
    return new SyncEngineError("OUTBOX_TERMINAL_IMMUTABLE", `${current.localState}`);
  }
  return new SyncEngineError("OUTBOX_TRANSITION_INVALID", `${current.localState} -x-> ${event.type}`);
}

/**
 * Pure transition function. Throws `OUTBOX_TERMINAL_IMMUTABLE` for any event on a terminal
 * entry and `OUTBOX_TRANSITION_INVALID` for transitions not allowed by section 7.1.
 */
export function transitionOutboxState(current: OutboxEntry, event: OutboxEvent): OutboxEntry {
  const state = current.localState;
  switch (event.type) {
    case "claim":
      if (state !== "pending" && state !== "retry_wait") throw invalid(current, event);
      return next(current, {
        localState: "sending", attemptId: event.attemptId, leaseUntil: event.leaseUntil,
        nextAttemptAt: null, blockedBy: null, updatedAt: event.nowMs,
      });
    case "lease_expired":
      if (state !== "sending") throw invalid(current, event);
      return next(current, { localState: "pending", attemptId: null, leaseUntil: null, updatedAt: event.nowMs });
    case "retry":
      if (state !== "sending") throw invalid(current, event);
      return next(current, {
        localState: "retry_wait", retryCount: current.retryCount + 1, lastErrorCode: event.errorCode,
        nextAttemptAt: event.nextAttemptAt, attemptId: null, leaseUntil: null, updatedAt: event.nowMs,
      });
    case "result":
      if (state !== "sending") throw invalid(current, event);
      return next(current, {
        localState: event.status, outcome: event.outcome, lastErrorCode: event.outcome.code,
        attemptId: null, leaseUntil: null, nextAttemptAt: null, blockedBy: null, updatedAt: event.nowMs,
      });
    case "invalidate":
      if (state !== "pending" && state !== "retry_wait") throw invalid(current, event);
      return next(current, {
        localState: "manual_review", lastErrorCode: event.errorCode, nextAttemptAt: null, blockedBy: null, updatedAt: event.nowMs,
      });
    case "escalate":
      if (state !== "conflict") throw invalid(current, event);
      return next(current, { localState: "manual_review", lastErrorCode: event.errorCode, updatedAt: event.nowMs });
    case "block":
      if (state !== "pending") throw invalid(current, event);
      return current.blockedBy === event.blockedBy ? current : next(current, { blockedBy: event.blockedBy });
    case "resolve":
      if (state !== "conflict" && state !== "manual_review") throw invalid(current, event);
      return next(current, { resolvedBy: event.resolvedBy, updatedAt: event.nowMs });
  }
}
