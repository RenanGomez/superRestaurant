// Shared fixtures for the sync-engine tests. Not a test file itself: no test is registered here and
// the package test script never runs it directly (the `.test.ts` suffix only keeps it out of dist).
import { parseBranchScope, type BranchScope } from "@super-restaurant/shared-types";
import type { ClockPort, EnqueueInput, IdGeneratorPort, SyncTransportPort } from "./engine.js";
import type { SyncEnvelope, SyncPullChange, SyncPullRequest, SyncPushRequest } from "./contract.js";
import { SyncTransportError } from "./errors.js";
import type { JsonObject } from "./json.js";

export function id(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

export function scopeOf(restaurant: number, branch: number): BranchScope {
  const scope = parseBranchScope({ restaurantId: id(restaurant), branchId: id(branch) });
  if (scope === undefined) throw new Error("fixture scope must be valid");
  return scope;
}

export const SCOPE_A1 = scopeOf(0xa0, 0xa1);
export const SCOPE_A2 = scopeOf(0xa0, 0xa2);
export const SCOPE_B1 = scopeOf(0xb0, 0xb1);
export const DEVICE = id(0xd1);
export const ACTOR = id(0xac);

export class SequentialIds implements IdGeneratorPort {
  private counter = 0x10000;
  public uuid(): string {
    this.counter += 1;
    return id(this.counter);
  }
}

export class FakeClock implements ClockPort {
  public constructor(public now = Date.UTC(2026, 9, 22, 12, 0, 0)) {}
  public nowMs(): number {
    return this.now;
  }
  public advance(ms: number): void {
    this.now += ms;
  }
}

const entityIdsByKey = new Map<string, string>();

/** Deterministic entity per idempotency key, so replays of the same key hit the same entity. */
export function orderInput(scope: BranchScope, key: string, extra: Partial<EnqueueInput> = {}): EnqueueInput {
  let entityId = entityIdsByKey.get(key);
  if (entityId === undefined) {
    entityId = id(0xe000 + entityIdsByKey.size);
    entityIdsByKey.set(key, entityId);
  }
  return {
    scope,
    actorId: ACTOR,
    entityType: "Order",
    entityId,
    operation: "create",
    idempotencyKey: key,
    payload: { note: key },
    ...extra,
  };
}

interface Applied {
  readonly eventId: string;
  readonly status: "accepted" | "conflict";
  readonly version: number;
}

/** In-process authoritative server with a dedup ledger, per-scope changelog and opaque cursors. */
export class FakeServer implements SyncTransportPort {
  public readonly effects: string[] = [];
  public readonly pushRequests: SyncPushRequest[] = [];
  public readonly pullRequests: SyncPullRequest[] = [];
  public pushError: SyncTransportError | null = null;
  public pullError: SyncTransportError | null = null;
  public timeoutAfterCommit = 0;
  public readonly omitResults = new Set<string>();
  public readonly conflictEntities = new Set<string>();
  public pushCodeOverride = new Map<string, { status: "rejected" | "manual_review"; code: string }>();
  public pullOverride: ((request: SyncPullRequest) => unknown) | null = null;
  private readonly ledger = new Map<string, Applied>();
  private readonly changelog = new Map<string, SyncPullChange[]>();
  private readonly versions = new Map<string, number>();

  public inject(scope: BranchScope, change: Omit<SyncPullChange, "restaurantId" | "branchId">): void {
    const key = `${scope.restaurantId}/${scope.branchId}`;
    const list = this.changelog.get(key) ?? [];
    list.push({ ...change, restaurantId: scope.restaurantId, branchId: scope.branchId });
    this.changelog.set(key, list);
  }

  public push(request: SyncPushRequest): Promise<unknown> {
    this.pushRequests.push(structuredClone(request));
    if (this.pushError !== null) return Promise.reject(this.pushError);
    const results: unknown[] = [];
    for (const event of request.events) {
      results.push(this.apply(request, event));
    }
    const visible = results.filter((result) => !this.omitResults.has((result as { eventId: string }).eventId));
    if (this.timeoutAfterCommit > 0) {
      this.timeoutAfterCommit -= 1;
      return Promise.reject(new SyncTransportError("TIMEOUT", true));
    }
    return Promise.resolve({ results: visible });
  }

  private apply(request: SyncPushRequest, event: SyncEnvelope): unknown {
    const override = this.pushCodeOverride.get(event.eventId);
    if (override !== undefined) {
      return { eventId: event.eventId, idempotencyKey: event.idempotencyKey, status: override.status, code: override.code, canonicalVersion: null, auditId: null };
    }
    const ledgerKey = `${request.scope.restaurantId}/${request.scope.branchId}|${event.idempotencyKey}`;
    const known = this.ledger.get(ledgerKey);
    if (known !== undefined) {
      return { eventId: event.eventId, idempotencyKey: event.idempotencyKey, status: "duplicate", code: null, canonicalVersion: known.version, auditId: `audit-${known.eventId}` };
    }
    if (this.conflictEntities.has(event.entityId)) {
      this.ledger.set(ledgerKey, { eventId: event.eventId, status: "conflict", version: 0 });
      return { eventId: event.eventId, idempotencyKey: event.idempotencyKey, status: "conflict", code: "STALE_BASE_VERSION", canonicalVersion: null, auditId: null };
    }
    const version = (this.versions.get(event.entityId) ?? 0) + 1;
    this.versions.set(event.entityId, version);
    this.ledger.set(ledgerKey, { eventId: event.eventId, status: "accepted", version });
    this.effects.push(event.idempotencyKey);
    this.inject(request.scope, {
      entityType: event.entityType, entityId: event.entityId, canonicalVersion: version, tombstone: event.operation === "delete",
      snapshot: event.operation === "delete" ? null : (event.payload as JsonObject),
    });
    return { eventId: event.eventId, idempotencyKey: event.idempotencyKey, status: "accepted", code: null, canonicalVersion: version, auditId: `audit-${event.eventId}` };
  }

  public pull(request: SyncPullRequest): Promise<unknown> {
    this.pullRequests.push(structuredClone(request));
    if (this.pullError !== null) return Promise.reject(this.pullError);
    if (this.pullOverride !== null) return Promise.resolve(this.pullOverride(request));
    const key = `${request.scope.restaurantId}/${request.scope.branchId}`;
    let offset = 0;
    if (request.cursor !== null) {
      const parts = request.cursor.split("|");
      if (parts[0] !== "cur" || parts.length !== 3) return Promise.reject(new SyncTransportError("CURSOR_INVALID", false));
      if (parts[1] !== key) return Promise.reject(new SyncTransportError("CURSOR_SCOPE_MISMATCH", false));
      offset = Number(parts[2]);
    }
    const list = this.changelog.get(key) ?? [];
    const page = list.slice(offset, offset + request.limit);
    const end = offset + page.length;
    return Promise.resolve({
      scope: request.scope,
      changes: page,
      nextCursor: `cur|${key}|${end}`,
      hasMore: end < list.length,
    });
  }
}
