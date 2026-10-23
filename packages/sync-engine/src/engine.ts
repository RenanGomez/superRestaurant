import type { BranchScope } from "@super-restaurant/shared-types";
import { createExponentialBackoff, type BackoffPolicy } from "./backoff.js";
import {
  CURSOR_RESYNC_CODES,
  FINANCIAL_ENTITY_TYPES,
  OUTBOX_STATES,
  REVOCATION_CODES,
  SYNC_PROTOCOL_VERSION,
  SYNC_SCHEMA_VERSION,
  isStableCode,
  isSyncId,
  parsePullResponse,
  parsePushResponse,
  parseSyncEnvelope,
  parseSyncScope,
  toEnvelope,
  type OutboxEntry,
  type OutboxState,
  type SyncEnvelope,
  type SyncEventResult,
  type SyncPullChange,
  type SyncPullRequest,
  type SyncPushRequest,
  type SyncScopeInput,
} from "./contract.js";
import {
  createEmptyState,
  findReplica,
  parseDurableState,
  sameScope,
  type DurableSyncState,
  type ReplicaEntity,
  type ScopeState,
  type ScopeStatus,
} from "./durable-state.js";
import { SyncEngineError, SyncTransportError, unwrap } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { asPlainRecord, type JsonObject, type JsonValue } from "./json.js";
import { isBlockingState, isTerminalState, transitionOutboxState } from "./outbox-state.js";
import { checkPayload } from "./payload-guard.js";

// ---- Ports -------------------------------------------------------------------------------

export interface DurableSyncStoragePort {
  /** Returns the raw persisted state, or `null` when the device has none. Parsed at runtime by the engine. */
  loadState(deviceId: string): Promise<unknown>;
  /** Atomically stores the whole state (replica, outbox, sequence and cursors) or throws leaving the old state intact. */
  persist(state: DurableSyncState): Promise<void>;
}

export interface SyncTransportPort {
  /** Throws `SyncTransportError` for transport failures. Resolves with the raw response body. */
  push(request: SyncPushRequest): Promise<unknown>;
  pull(request: SyncPullRequest): Promise<unknown>;
}

export interface IdGeneratorPort {
  uuid(): string;
}

export interface ClockPort {
  nowMs(): number;
}

interface WebCryptoLike {
  randomUUID?: () => string;
}

/** Default generator over the platform Web Crypto (`globalThis.crypto`); no `node:crypto`. */
export function createRandomIdGenerator(): IdGeneratorPort {
  return Object.freeze({
    uuid: (): string => {
      const web = (globalThis as { readonly crypto?: WebCryptoLike }).crypto;
      if (web?.randomUUID === undefined) throw new SyncEngineError("ID_GENERATION_INVALID", "Web Crypto unavailable");
      return web.randomUUID();
    },
  });
}

export const systemClock: ClockPort = Object.freeze({ nowMs: () => Date.now() });

export interface SyncEngineOptions {
  readonly deviceId: string;
  readonly storage: DurableSyncStoragePort;
  readonly transport: SyncTransportPort;
  readonly ids?: IdGeneratorPort;
  readonly clock?: ClockPort;
  readonly backoff?: BackoffPolicy;
  readonly maxBatchSize?: number;
  readonly leaseMs?: number;
  readonly maxPagesPerSync?: number;
  readonly pullLimit?: number;
}

export interface EnqueueInput {
  readonly scope: SyncScopeInput;
  readonly actorId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly baseVersion?: number | null;
  readonly occurredAt?: string;
  /** Optimistic local replica content; defaults to the payload. */
  readonly replicaSnapshot?: unknown;
}

export interface PushEventOutcome {
  readonly eventId: string;
  readonly state: OutboxState;
  readonly code: string | null;
}

export interface PushOutcome {
  readonly sent: number;
  readonly events: readonly PushEventOutcome[];
  readonly revoked: boolean;
  /** accepted/duplicate only close the outbox entry; the caller should pull, the cursor is untouched. */
  readonly pullRecommended: boolean;
  readonly failureCode: string | null;
}

export type PullStatus = "complete" | "partial" | "resync_required" | "revoked" | "failed";

export interface PullOutcome {
  readonly status: PullStatus;
  readonly pages: number;
  readonly applied: number;
  readonly code: string | null;
  readonly retryable: boolean;
}

export interface SyncStatusSummary {
  readonly scope: BranchScope;
  readonly scopeStatus: ScopeStatus | "unregistered";
  readonly counts: Readonly<Record<OutboxState, number>>;
  readonly awaitingPush: number;
  readonly blockedPending: number;
  readonly needsAttention: number;
  readonly hasPullCursor: boolean;
}

const NIL_ID = "00000000-0000-4000-8000-000000000000";

class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  public run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${(value as readonly JsonValue[]).map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as { readonly [key: string]: JsonValue };
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as JsonValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Intent fingerprint: scope, entity, operation and payload (never the envelope identity). */
function intentFingerprint(envelope: SyncEnvelope): string {
  return canonicalJson([envelope.restaurantId, envelope.branchId, envelope.entityType, envelope.entityId, envelope.operation, envelope.payload]);
}

function safeCode(error: unknown): { readonly code: string; readonly retryable: boolean } {
  if (error instanceof SyncTransportError && isStableCode(error.code)) return { code: error.code, retryable: error.retryable };
  return { code: "TRANSPORT_ERROR", retryable: true };
}

function isFinancial(entry: SyncEnvelope): boolean {
  return FINANCIAL_ENTITY_TYPES.includes(entry.entityType);
}

function replaceScope(state: DurableSyncState, scope: SyncScopeInput, patch: Partial<ScopeState>): DurableSyncState {
  const existing = state.scopes.find((item) => sameScope(item, scope));
  if (existing === undefined) {
    const created: ScopeState = { restaurantId: scope.restaurantId, branchId: scope.branchId, status: "active", pullCursor: null, ...patch };
    return { ...state, scopes: [...state.scopes, created] };
  }
  return { ...state, scopes: state.scopes.map((item) => (item === existing ? { ...item, ...patch } : item)) };
}

/** Marks the scope revoked and moves pending financial events to manual review. */
function revokeScope(state: DurableSyncState, scope: SyncScopeInput, code: string, nowMs: number): DurableSyncState {
  const revoked = replaceScope(state, scope, { status: "revoked" });
  return {
    ...revoked,
    outbox: revoked.outbox.map((entry) => (
      sameScope(entry, scope) && isFinancial(entry) && (entry.localState === "pending" || entry.localState === "retry_wait")
        ? transitionOutboxState(entry, { type: "invalidate", errorCode: code, nowMs })
        : entry
    )),
  };
}

export class DeviceSyncEngine {
  private readonly deviceId: string;
  private readonly storage: DurableSyncStoragePort;
  private readonly transport: SyncTransportPort;
  private readonly ids: IdGeneratorPort;
  private readonly clock: ClockPort;
  private readonly backoff: BackoffPolicy;
  private readonly maxBatchSize: number;
  private readonly leaseMs: number;
  private readonly maxPagesPerSync: number;
  private readonly pullLimit: number;
  private readonly stateQueue = new SerialQueue();
  private readonly pullQueue = new SerialQueue();
  private state: DurableSyncState | null = null;

  public constructor(options: SyncEngineOptions) {
    if (!isSyncId(options.deviceId)) throw new SyncEngineError("INPUT_INVALID", "deviceId");
    this.deviceId = options.deviceId;
    this.storage = options.storage;
    this.transport = options.transport;
    this.ids = options.ids ?? createRandomIdGenerator();
    this.clock = options.clock ?? systemClock;
    this.backoff = options.backoff ?? createExponentialBackoff();
    this.maxBatchSize = positiveInt(options.maxBatchSize ?? 50, "maxBatchSize");
    this.leaseMs = positiveInt(options.leaseMs ?? 30_000, "leaseMs");
    this.maxPagesPerSync = positiveInt(options.maxPagesPerSync ?? 20, "maxPagesPerSync");
    this.pullLimit = positiveInt(options.pullLimit ?? 100, "pullLimit");
  }

  /** Hydrates and validates durable state. Every public method calls this implicitly. */
  public async init(): Promise<void> {
    await this.stateQueue.run(async () => { await this.ensureLoaded(); });
  }

  // ---- Local operations -------------------------------------------------------------------

  /**
   * Local transaction of section 7.2: reserves `localSequence`, writes the optimistic replica and
   * creates the outbox envelope in ONE `persist`. Calls are serialized, so concurrent enqueues
   * never share a sequence. A repeated `idempotencyKey` returns the existing event.
   */
  public enqueue(input: EnqueueInput): Promise<OutboxEntry> {
    return this.mutate((state) => this.buildEnqueue(state, input));
  }

  public resolveBlockingEvent(scopeInput: SyncScopeInput, blockingEventId: string, resolvedByEventId: string): Promise<void> {
    return this.mutate((state) => {
      const scope = unwrap(parseSyncScope(scopeInput));
      const blocking = state.outbox.find((entry) => sameScope(entry, scope) && entry.eventId === blockingEventId);
      const resolver = state.outbox.find((entry) => sameScope(entry, scope) && entry.eventId === resolvedByEventId);
      if (
        blocking === undefined || resolver === undefined
        || !isBlockingState(blocking.localState) || blocking.resolvedBy !== null
        || resolver.entityId !== blocking.entityId || resolver.entityType !== blocking.entityType
        || resolver.localSequence <= blocking.localSequence || resolver.localState === "rejected"
      ) throw new SyncEngineError("RESOLUTION_INVALID");
      const nowMs = this.clock.nowMs();
      const updated = transitionOutboxState(blocking, { type: "resolve", resolvedBy: resolvedByEventId, nowMs });
      return { state: { ...state, outbox: state.outbox.map((entry) => (entry === blocking ? updated : entry)) }, result: undefined };
    });
  }

  /** Explicit, caller-driven recovery after `resync_required`: restarts the scope from a null cursor. */
  public resetScopeForResync(scopeInput: SyncScopeInput): Promise<void> {
    return this.mutate((state) => {
      const scope = unwrap(parseSyncScope(scopeInput));
      const current = state.scopes.find((item) => sameScope(item, scope));
      if (current?.status !== "resync_required") return { state, result: undefined };
      return { state: replaceScope(state, scope, { status: "active", pullCursor: null }), result: undefined };
    });
  }

  // ---- Reads (scope filtered) --------------------------------------------------------------

  public getOutbox(scopeInput: SyncScopeInput): Promise<readonly OutboxEntry[]> {
    return this.read((state) => {
      const scope = unwrap(parseSyncScope(scopeInput));
      return state.outbox.filter((entry) => sameScope(entry, scope));
    });
  }

  public listReplica(scopeInput: SyncScopeInput): Promise<readonly ReplicaEntity[]> {
    return this.read((state) => {
      const scope = unwrap(parseSyncScope(scopeInput));
      return state.replica.filter((entity) => sameScope(entity, scope));
    });
  }

  public getReplicaEntity(scopeInput: SyncScopeInput, entityType: string, entityId: string): Promise<ReplicaEntity | null> {
    return this.read((state) => findReplica(state, unwrap(parseSyncScope(scopeInput)), entityType, entityId) ?? null);
  }

  public getPullCursor(scopeInput: SyncScopeInput): Promise<string | null> {
    return this.read((state) => {
      const scope = unwrap(parseSyncScope(scopeInput));
      return state.scopes.find((item) => sameScope(item, scope))?.pullCursor ?? null;
    });
  }

  /** Codes and counters only. The UI layer owns every user-facing sentence. */
  public getStatusSummary(scopeInput: SyncScopeInput): Promise<SyncStatusSummary> {
    return this.read((state) => {
      const scope = unwrap(parseSyncScope(scopeInput));
      const scoped = state.outbox.filter((entry) => sameScope(entry, scope));
      const counts = Object.fromEntries(OUTBOX_STATES.map((name) => [name, 0])) as Record<OutboxState, number>;
      for (const entry of scoped) counts[entry.localState] += 1;
      const current = state.scopes.find((item) => sameScope(item, scope));
      return Object.freeze({
        scope,
        scopeStatus: current?.status ?? "unregistered",
        counts: Object.freeze(counts),
        awaitingPush: counts.pending + counts.sending + counts.retry_wait,
        blockedPending: scoped.filter((entry) => entry.localState === "pending" && entry.blockedBy !== null).length,
        needsAttention: scoped.filter((entry) => isBlockingState(entry.localState) && entry.resolvedBy === null).length,
        hasPullCursor: current?.pullCursor !== null && current?.pullCursor !== undefined,
      });
    });
  }

  // ---- Push --------------------------------------------------------------------------------

  /** Sends ONE batch for the scope: oldest eligible events first, never mixing scopes. */
  public async push(scopeInput: SyncScopeInput): Promise<PushOutcome> {
    const scope = unwrap(parseSyncScope(scopeInput));
    const claimed = await this.mutate((state) => this.claimBatch(state, scope));
    if (claimed.length === 0) return Object.freeze({ sent: 0, events: Object.freeze([]), revoked: false, pullRecommended: false, failureCode: null });

    const request: SyncPushRequest = Object.freeze({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      deviceId: this.deviceId,
      scope,
      events: Object.freeze(claimed.map(toEnvelope)),
    });
    let results: ReadonlyMap<string, SyncEventResult> | null = null;
    let failure: { readonly code: string; readonly retryable: boolean } | null = null;
    try {
      const parsed = parsePushResponse(await this.transport.push(request));
      if (parsed.ok) {
        const byId = new Map<string, SyncEventResult>();
        for (const result of parsed.value.results) if (!byId.has(result.eventId)) byId.set(result.eventId, result);
        results = byId;
      } else {
        failure = { code: "RESPONSE_INVALID", retryable: true };
      }
    } catch (error) {
      failure = safeCode(error);
    }
    return this.mutate((state) => this.applyPushOutcome(state, scope, claimed, results, failure));
  }

  /** Push one batch, then pull. Push never advances the cursor; only the pull does. */
  public async sync(scopeInput: SyncScopeInput): Promise<{ readonly push: PushOutcome; readonly pull: PullOutcome }> {
    const push = await this.push(scopeInput);
    const pull = await this.pull(scopeInput);
    return { push, pull };
  }

  // ---- Pull --------------------------------------------------------------------------------

  /**
   * Pages through the scope until `hasMore` is false or `maxPagesPerSync` is reached. Each page
   * and its cursor are persisted together. Transport failures keep the previous cursor.
   */
  public pull(scopeInput: SyncScopeInput): Promise<PullOutcome> {
    return this.pullQueue.run(() => this.pullPages(unwrap(parseSyncScope(scopeInput))));
  }

  // ---- Internals ---------------------------------------------------------------------------

  private async ensureLoaded(): Promise<DurableSyncState> {
    if (this.state !== null) return this.state;
    let raw: unknown;
    try {
      raw = await this.storage.loadState(this.deviceId);
    } catch {
      throw new SyncEngineError("STORAGE_LOAD_FAILED");
    }
    this.state = raw === null || raw === undefined ? createEmptyState(this.deviceId) : unwrap(parseDurableState(raw, this.deviceId));
    return this.state;
  }

  private mutate<T>(change: (state: DurableSyncState) => { readonly state: DurableSyncState; readonly result: T }): Promise<T> {
    return this.stateQueue.run(async () => {
      const current = await this.ensureLoaded();
      const outcome = change(current);
      if (outcome.state !== current) {
        const next = deepFreeze(outcome.state);
        try {
          await this.storage.persist(next);
        } catch {
          throw new SyncEngineError("STORAGE_COMMIT_FAILED");
        }
        this.state = next;
      }
      return outcome.result;
    });
  }

  private read<T>(select: (state: DurableSyncState) => T): Promise<T> {
    return this.stateQueue.run(async () => select(await this.ensureLoaded()));
  }

  private newId(taken: ReadonlySet<string> = new Set()): string {
    const id = this.ids.uuid();
    if (!isSyncId(id) || taken.has(id)) throw new SyncEngineError("ID_GENERATION_INVALID");
    return id;
  }

  private buildEnqueue(state: DurableSyncState, input: EnqueueInput): { readonly state: DurableSyncState; readonly result: OutboxEntry } {
    const source = asPlainRecord(input);
    if (source === undefined) throw new SyncEngineError("INPUT_INVALID", "input");
    const scope = unwrap(parseSyncScope(source["scope"]));
    if (state.scopes.find((item) => sameScope(item, scope))?.status === "revoked") throw new SyncEngineError("SCOPE_REVOKED");

    const { entityType, entityId, operation } = source;
    const existing = typeof entityType === "string" && typeof entityId === "string" ? findReplica(state, scope, entityType, entityId) : undefined;
    let baseVersion = source["baseVersion"];
    if (baseVersion === undefined) baseVersion = operation === "create" ? null : existing?.canonicalVersion;
    const nowMs = this.clock.nowMs();
    const draft = {
      eventId: NIL_ID,
      idempotencyKey: source["idempotencyKey"],
      deviceId: this.deviceId,
      actorId: source["actorId"],
      restaurantId: scope.restaurantId,
      branchId: scope.branchId,
      entityType,
      entityId,
      operation,
      schemaVersion: SYNC_SCHEMA_VERSION,
      localSequence: state.lastLocalSequence + 1,
      baseVersion,
      occurredAt: source["occurredAt"] ?? new Date(nowMs).toISOString(),
      receivedAt: null,
      payload: source["payload"],
      retryCount: 0,
      localState: "pending",
    };
    const probe = unwrap(parseSyncEnvelope(draft));

    const duplicate = state.outbox.find((entry) => sameScope(entry, scope) && entry.idempotencyKey === probe.idempotencyKey);
    if (duplicate !== undefined) {
      if (intentFingerprint(duplicate) !== intentFingerprint(probe)) throw new SyncEngineError("IDEMPOTENCY_KEY_REUSE");
      return { state, result: duplicate };
    }
    if (existing?.tombstone === true) throw new SyncEngineError("ENTITY_TOMBSTONED");
    if (existing !== undefined && probe.operation === "create") throw new SyncEngineError("ENTITY_EXISTS");

    let snapshot: JsonObject | null = null;
    if (probe.operation !== "delete") {
      snapshot = source["replicaSnapshot"] === undefined ? probe.payload : unwrap(checkPayload(source["replicaSnapshot"]));
    }
    const eventId = this.newId(new Set(state.outbox.map((entry) => entry.eventId)));
    const envelope = unwrap(parseSyncEnvelope({ ...probe, eventId }));
    const entry: OutboxEntry = Object.freeze({
      ...envelope,
      leaseUntil: null, attemptId: null, nextAttemptAt: null, lastErrorCode: null, blockedBy: null, resolvedBy: null, outcome: null, updatedAt: nowMs,
    });
    const entity: ReplicaEntity = {
      restaurantId: scope.restaurantId, branchId: scope.branchId, entityType: probe.entityType, entityId: probe.entityId,
      canonicalVersion: existing?.canonicalVersion ?? 0, tombstone: false, snapshot, pendingEventId: eventId,
    };
    const registered = state.scopes.some((item) => sameScope(item, scope));
    const next: DurableSyncState = {
      ...state,
      lastLocalSequence: envelope.localSequence,
      scopes: registered ? state.scopes : [...state.scopes, { restaurantId: scope.restaurantId, branchId: scope.branchId, status: "active", pullCursor: null }],
      outbox: [...state.outbox, entry],
      replica: existing === undefined ? [...state.replica, entity] : state.replica.map((item) => (item === existing ? entity : item)),
    };
    return { state: next, result: entry };
  }

  private claimBatch(state: DurableSyncState, scope: BranchScope): { readonly state: DurableSyncState; readonly result: readonly OutboxEntry[] } {
    const current = state.scopes.find((item) => sameScope(item, scope));
    if (current === undefined) return { state, result: [] };
    if (current.status === "revoked") throw new SyncEngineError("SCOPE_REVOKED");
    const nowMs = this.clock.nowMs();
    const blockers = new Map<string, string>();
    const held = new Set<string>();
    const claimed: OutboxEntry[] = [];

    const outbox = state.outbox.map((original) => {
      if (!sameScope(original, scope)) return original;
      let entry = original;
      if (entry.localState === "sending" && entry.leaseUntil !== null && entry.leaseUntil <= nowMs) {
        entry = transitionOutboxState(entry, { type: "lease_expired", nowMs });
      }
      if (entry.localState === "retry_wait" && entry.retryCount >= this.backoff.maxRetries) {
        entry = transitionOutboxState(entry, { type: "invalidate", errorCode: "RETRY_LIMIT", nowMs });
      }
      if (isBlockingState(entry.localState)) {
        if (entry.resolvedBy === null && !blockers.has(entry.entityId)) blockers.set(entry.entityId, entry.eventId);
        return entry;
      }
      const due = entry.localState === "pending" || (entry.localState === "retry_wait" && (entry.nextAttemptAt ?? 0) <= nowMs);
      if (!due) {
        if (!isTerminalState(entry.localState)) held.add(entry.entityId);
        return entry;
      }
      const blocker = blockers.get(entry.entityId);
      if (blocker !== undefined) {
        return entry.localState === "pending" ? transitionOutboxState(entry, { type: "block", blockedBy: blocker }) : entry;
      }
      if (entry.localState === "pending" && entry.blockedBy !== null) entry = transitionOutboxState(entry, { type: "block", blockedBy: null });
      if (held.has(entry.entityId) || claimed.length >= this.maxBatchSize) {
        held.add(entry.entityId);
        return entry;
      }
      const sending = transitionOutboxState(entry, { type: "claim", attemptId: this.newId(), leaseUntil: nowMs + this.leaseMs, nowMs });
      claimed.push(sending);
      return sending;
    });

    const changed = outbox.some((entry, index) => entry !== state.outbox[index]);
    return { state: changed ? { ...state, outbox } : state, result: claimed };
  }

  private applyPushOutcome(
    state: DurableSyncState,
    scope: BranchScope,
    claimed: readonly OutboxEntry[],
    results: ReadonlyMap<string, SyncEventResult> | null,
    failure: { readonly code: string; readonly retryable: boolean } | null,
  ): { readonly state: DurableSyncState; readonly result: PushOutcome } {
    const nowMs = this.clock.nowMs();
    const attempts = new Map(claimed.map((entry) => [entry.eventId, entry.attemptId]));
    let revokedCode: string | null = failure !== null && REVOCATION_CODES.includes(failure.code) ? failure.code : null;
    if (results !== null) {
      for (const entry of claimed) {
        const code = results.get(entry.eventId)?.code;
        if (code !== undefined && code !== null && REVOCATION_CODES.includes(code)) revokedCode ??= code;
      }
    }

    const events: PushEventOutcome[] = [];
    let pullRecommended = false;
    const outbox = state.outbox.map((entry) => {
      if (!sameScope(entry, scope) || !attempts.has(entry.eventId)) return entry;
      if (entry.localState !== "sending" || entry.attemptId !== attempts.get(entry.eventId)) return entry; // stale attempt
      const next = this.nextEntryState(entry, results, failure, revokedCode, nowMs);
      events.push({ eventId: entry.eventId, state: next.localState, code: next.lastErrorCode });
      if (next.localState === "accepted" || next.localState === "duplicate") pullRecommended = true;
      return next;
    });
    let next: DurableSyncState = { ...state, outbox };
    if (revokedCode !== null) {
      next = revokeScope(next, scope, revokedCode, nowMs);
    }
    return {
      state: next,
      result: Object.freeze({
        sent: claimed.length,
        events: Object.freeze(events),
        revoked: revokedCode !== null,
        pullRecommended,
        failureCode: failure?.code ?? null,
      }),
    };
  }

  private nextEntryState(
    entry: OutboxEntry,
    results: ReadonlyMap<string, SyncEventResult> | null,
    failure: { readonly code: string; readonly retryable: boolean } | null,
    revokedCode: string | null,
    nowMs: number,
  ): OutboxEntry {
    const retry = (code: string): OutboxEntry => transitionOutboxState(entry, {
      type: "retry", errorCode: code, nowMs,
      nextAttemptAt: nowMs + this.backoff.nextDelayMs({ retryCount: entry.retryCount + 1, eventId: entry.eventId }),
    });
    const review = (code: string): OutboxEntry => transitionOutboxState(entry, {
      type: "result", status: "manual_review", nowMs, outcome: { code, canonicalVersion: null, auditId: null },
    });
    if (results === null) {
      const code = failure?.code ?? "TRANSPORT_ERROR";
      if (revokedCode !== null) return isFinancial(entry) ? review(code) : transitionOutboxState(entry, { type: "lease_expired", nowMs });
      return failure?.retryable === false ? review(code) : retry(code);
    }
    const result = results.get(entry.eventId);
    if (result === undefined || result.idempotencyKey !== entry.idempotencyKey) return retry("MISSING_RESULT");
    const revokedResult = result.code !== null && REVOCATION_CODES.includes(result.code);
    if (result.status === "rejected" && revokedResult && isFinancial(entry)) return review(result.code ?? "AUTH_REVOKED");
    return transitionOutboxState(entry, {
      type: "result", status: result.status, nowMs,
      outcome: { code: result.code, canonicalVersion: result.canonicalVersion, auditId: result.auditId },
    });
  }

  private async pullPages(scope: BranchScope): Promise<PullOutcome> {
    let pages = 0;
    let applied = 0;
    const finish = (status: PullStatus, code: string | null = null, retryable = false): PullOutcome => (
      Object.freeze({ status, pages, applied, code, retryable })
    );
    for (;;) {
      const info = await this.read((state) => {
        const current = state.scopes.find((item) => sameScope(item, scope));
        return { status: current?.status ?? "active", cursor: current?.pullCursor ?? null };
      });
      if (info.status === "revoked") throw new SyncEngineError("SCOPE_REVOKED");
      if (info.status === "resync_required") return finish("resync_required", "RESYNC_REQUIRED");
      if (pages >= this.maxPagesPerSync) return finish("partial");

      let raw: unknown;
      try {
        raw = await this.transport.pull({ protocolVersion: SYNC_PROTOCOL_VERSION, scope, cursor: info.cursor, limit: this.pullLimit });
      } catch (error) {
        const failure = safeCode(error);
        if (CURSOR_RESYNC_CODES.includes(failure.code)) {
          await this.mutate((state) => ({ state: replaceScope(state, scope, { status: "resync_required" }), result: undefined }));
          return finish("resync_required", failure.code);
        }
        if (REVOCATION_CODES.includes(failure.code)) {
          await this.mutate((state) => ({ state: revokeScope(state, scope, failure.code, this.clock.nowMs()), result: undefined }));
          return finish("revoked", failure.code);
        }
        return finish("failed", failure.code, failure.retryable);
      }

      const parsed = parsePullResponse(raw);
      if (!parsed.ok) throw new SyncEngineError("PULL_RESPONSE_INVALID", parsed.field);
      const response = parsed.value;
      if (response.scope.restaurantId !== scope.restaurantId || response.scope.branchId !== scope.branchId) {
        throw new SyncEngineError("PULL_SCOPE_VIOLATION");
      }
      if (response.hasMore && (response.nextCursor === null || response.nextCursor === info.cursor)) {
        throw new SyncEngineError("PULL_RESPONSE_INVALID", "cursor did not advance");
      }
      const count = await this.mutate((state) => this.applyPage(state, scope, info.cursor, response.changes, response.nextCursor));
      pages += 1;
      applied += count;
      if (!response.hasMore) return finish("complete");
    }
  }

  /** One local transaction: replica changes and the new cursor are committed by the same `persist`. */
  private applyPage(
    state: DurableSyncState,
    scope: BranchScope,
    requestedCursor: string | null,
    changes: readonly SyncPullChange[],
    nextCursor: string | null,
  ): { readonly state: DurableSyncState; readonly result: number } {
    const current = state.scopes.find((item) => sameScope(item, scope));
    if ((current?.status ?? "active") !== "active" || (current?.pullCursor ?? null) !== requestedCursor) {
      throw new SyncEngineError("PULL_RESPONSE_INVALID", "scope changed during pull");
    }
    for (const change of changes) {
      if (change.restaurantId !== scope.restaurantId || change.branchId !== scope.branchId) throw new SyncEngineError("PULL_SCOPE_VIOLATION");
    }
    const replica: ReplicaEntity[] = [...state.replica];
    const index = new Map<string, number>();
    replica.forEach((entity, position) => {
      if (sameScope(entity, scope)) index.set(`${entity.entityType}|${entity.entityId}`, position);
    });
    const terminalEvents = new Set(state.outbox.filter((entry) => entry.localState === "accepted" || entry.localState === "duplicate").map((entry) => entry.eventId));
    let count = 0;
    for (const change of [...changes].sort((left, right) => left.canonicalVersion - right.canonicalVersion)) {
      const key = `${change.entityType}|${change.entityId}`;
      const position = index.get(key);
      const existing = position === undefined ? undefined : replica[position];
      if (existing?.tombstone === true) {
        if (!(change.tombstone && change.canonicalVersion > existing.canonicalVersion)) continue; // never resurrect
      } else if (existing !== undefined && change.canonicalVersion <= existing.canonicalVersion) {
        continue; // equal or older version never overwrites
      }
      const pending = existing?.pendingEventId ?? null;
      const entity: ReplicaEntity = {
        restaurantId: scope.restaurantId, branchId: scope.branchId, entityType: change.entityType, entityId: change.entityId,
        canonicalVersion: change.canonicalVersion, tombstone: change.tombstone, snapshot: change.tombstone ? null : change.snapshot,
        pendingEventId: change.tombstone || pending === null || terminalEvents.has(pending) ? null : pending,
      };
      if (position === undefined) {
        index.set(key, replica.length);
        replica.push(entity);
      } else {
        replica[position] = entity;
      }
      count += 1;
    }
    const cursor = nextCursor ?? requestedCursor;
    const registered = replaceScope({ ...state, replica }, scope, { pullCursor: cursor });
    return { state: registered, result: count };
  }
}

function positiveInt(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new SyncEngineError("INPUT_INVALID", name);
  return value;
}
