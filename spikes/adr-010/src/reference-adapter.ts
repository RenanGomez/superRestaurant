import type { Adr010Adapter, WriteFrontierInspection } from "./adapter.js";
import type {
  ActorId,
  CreateOrderInput,
  KdsEvent,
  KdsRecovery,
  OrderId,
  OrderArtifacts,
  OrderRecord,
  ReproducibilityEvidence,
  Session,
  SessionId,
  SpikeFixtures,
} from "./model.js";

export interface ReferenceFaults {
  readonly leakTenantRead?: boolean;
  readonly allowCrossScopeWrite?: boolean;
  readonly commitPartialOnFailure?: boolean;
  readonly commitArtifactsWithoutOrderOnFailure?: boolean;
  readonly duplicateIdempotency?: boolean;
  readonly loseKdsHistory?: boolean;
  readonly leakKdsScope?: boolean;
  readonly skipRevocationCheck?: boolean;
  readonly clientExposedEnvironmentNames?: readonly string[];
  readonly reproducibilityEvidence?: ReproducibilityEvidence;
  readonly writeFrontierInspection?: WriteFrontierInspection;
  readonly resetOnMigrate?: boolean;
  readonly loseBackupArtifacts?: boolean;
}

interface State {
  readonly orders: Map<OrderId, OrderRecord>;
  readonly orderLines: Map<string, ArtifactOwner>;
  readonly snapshots: Map<string, ArtifactOwner>;
  readonly audits: Map<string, ArtifactOwner>;
  readonly idempotency: Map<string, OrderId>;
  readonly sessions: Map<SessionId, Session>;
  readonly revokedSessions: Set<SessionId>;
  readonly kdsEvents: KdsEvent[];
  readonly inFlightIdempotency: Map<string, Promise<OrderRecord>>;
  nextOrder: number;
  nextSession: number;
  nextCursor: number;
}

interface ArtifactOwner {
  readonly orderId: OrderId;
  readonly scope: CreateOrderInput["scope"];
}

const newState = (): State => ({
  orders: new Map(),
  orderLines: new Map(),
  snapshots: new Map(),
  audits: new Map(),
  idempotency: new Map(),
  sessions: new Map(),
  revokedSessions: new Set(),
  kdsEvents: [],
  inFlightIdempotency: new Map(),
  nextOrder: 1,
  nextSession: 1,
  nextCursor: 1,
});

const cloneState = (state: State): State => ({
  orders: new Map(state.orders),
  orderLines: new Map(state.orderLines),
  snapshots: new Map(state.snapshots),
  audits: new Map(state.audits),
  idempotency: new Map(state.idempotency),
  sessions: new Map(state.sessions),
  revokedSessions: new Set(state.revokedSessions),
  kdsEvents: [...state.kdsEvents],
  inFlightIdempotency: state.inFlightIdempotency,
  nextOrder: state.nextOrder,
  nextSession: state.nextSession,
  nextCursor: state.nextCursor,
});

/**
 * Deliberately non-persistent reference implementation. It proves only that
 * the harness can exercise common gates and reject injected faults.
 */
export class InMemoryReferenceAdapter implements Adr010Adapter {
  public readonly option = "reference" as const;
  private state = newState();

  public constructor(private readonly faults: ReferenceFaults = {}) {}

  public async migrateFromEmpty(): Promise<void> {
    // A rerun represents an idempotent versioned migration, never a reset.
    if (this.faults.resetOnMigrate) this.state = newState();
  }

  public async resetToEmpty(): Promise<void> {
    this.state = newState();
  }

  public async issueSession(actorId: ActorId, scope: SpikeFixtures["primaryScope"]): Promise<Session> {
    const id = `session-${this.state.nextSession++}`;
    const session = { id, actorId, scope };
    this.state.sessions.set(id, session);
    return session;
  }

  public async revokeSession(sessionId: SessionId): Promise<void> {
    this.state.revokedSessions.add(sessionId);
  }

  public async createOrder(input: CreateOrderInput): Promise<OrderRecord> {
    const session = this.state.sessions.get(input.sessionId);
    if (
      session === undefined ||
      (!this.faults.skipRevocationCheck && this.state.revokedSessions.has(input.sessionId)) ||
      (!this.faults.allowCrossScopeWrite && !sameScope(session.scope, input.scope))
    ) {
      throw new Error("UNAUTHORIZED_SCOPE");
    }

    const existingId = this.state.idempotency.get(input.idempotencyKey);
    if (existingId !== undefined && !this.faults.duplicateIdempotency) {
      return this.state.orders.get(existingId) as OrderRecord;
    }

    if (!this.faults.duplicateIdempotency) {
      const pending = this.state.inFlightIdempotency.get(input.idempotencyKey);
      if (pending !== undefined) return pending;

      const created = this.createOrderAtomically(input, session);
      this.state.inFlightIdempotency.set(input.idempotencyKey, created);
      try {
        return await created;
      } finally {
        this.state.inFlightIdempotency.delete(input.idempotencyKey);
      }
    }

    return this.createOrderAtomically(input, session);
  }

  private async createOrderAtomically(input: CreateOrderInput, session: Session): Promise<OrderRecord> {
    // Force the 20 Promise.all submissions through a real async race window.
    await Promise.resolve();
    const staged = cloneState(this.state);
    const order = makeOrder(staged, input, session);
    staged.orders.set(order.id, order);

    if (input.induceFailureAfterOrder) {
      if (this.faults.commitPartialOnFailure) {
        this.state = staged;
      }
      if (this.faults.commitArtifactsWithoutOrderOnFailure) {
        materializeArtifacts(staged, order);
        staged.orders.delete(order.id);
        this.state = staged;
      }
      throw new Error("INDUCED_WRITE_FAILURE");
    }

    materializeArtifacts(staged, order);
    staged.idempotency.set(input.idempotencyKey, order.id);
    staged.kdsEvents.push({ cursor: staged.nextCursor++, orderId: order.id, scope: order.scope });
    this.state = staged;
    return order;
  }

  public async getOrder(scope: CreateOrderInput["scope"], orderId: OrderId): Promise<OrderRecord | undefined> {
    const order = this.state.orders.get(orderId);
    if (order === undefined) return undefined;
    return this.faults.leakTenantRead || sameScope(order.scope, scope) ? order : undefined;
  }

  public async countOrders(scope?: CreateOrderInput["scope"]): Promise<number> {
    return [...this.state.orders.values()].filter((order) => scope === undefined || sameScope(order.scope, scope)).length;
  }

  public async findOrderIdsByIdempotency(scope: CreateOrderInput["scope"], idempotencyKey: string): Promise<readonly OrderId[]> {
    return [...this.state.orders.values()]
      .filter((order) => sameScope(order.scope, scope) && order.idempotencyKey === idempotencyKey)
      .map((order) => order.id)
      .sort();
  }

  public async readOrderArtifacts(scope: CreateOrderInput["scope"]): Promise<OrderArtifacts> {
    const orderIds = [...this.state.orders.values()]
      .filter((order) => sameScope(order.scope, scope))
      .map((order) => order.id)
      .sort();
    const relatedIds = (artifacts: ReadonlyMap<string, ArtifactOwner>): readonly string[] =>
      [...artifacts.entries()]
        .filter(([, owner]) => sameScope(owner.scope, scope))
        .map(([id]) => id)
        .sort();
    return {
      orderIds,
      lineIds: relatedIds(this.state.orderLines),
      snapshotIds: relatedIds(this.state.snapshots),
      auditIds: relatedIds(this.state.audits),
    };
  }

  public writeFrontierInspection(): WriteFrontierInspection {
    return this.faults.writeFrontierInspection ?? {
      status: "requires-human-inspection",
      evidenceLocation: "spikes/adr-010/src/reference-adapter.ts",
      verificationCommand: "pnpm --filter @super-restaurant/adr-010-spike test",
      claimedPaths: {
        Order: ["adapter.createOrder"],
        Payment: ["adapter.applyPayment"],
        CashMovement: ["adapter.recordCashMovement"],
      },
    };
  }

  public async recoverKds(scope: CreateOrderInput["scope"], afterCursor: number): Promise<KdsRecovery> {
    const events = this.faults.loseKdsHistory
      ? []
      : this.state.kdsEvents.filter(
          (event) => event.cursor > afterCursor && (this.faults.leakKdsScope || sameScope(event.scope, scope)),
        );
    const cursor = events.at(-1)?.cursor ?? afterCursor;
    return { events, cursor };
  }

  public async backup(): Promise<unknown> {
    const backup = {
      orders: [...this.state.orders.entries()],
      orderLines: [...this.state.orderLines.entries()],
      snapshots: [...this.state.snapshots.entries()],
      audits: [...this.state.audits.entries()],
      idempotency: [...this.state.idempotency.entries()],
      kdsEvents: [...this.state.kdsEvents],
      nextOrder: this.state.nextOrder,
      nextSession: this.state.nextSession,
      nextCursor: this.state.nextCursor,
    };
    if (this.faults.loseBackupArtifacts) {
      return { ...backup, snapshots: [], audits: [] };
    }
    return backup;
  }

  public async restore(backup: unknown): Promise<void> {
    const data = backup as {
      orders: [OrderId, OrderRecord][];
      orderLines: [string, ArtifactOwner][];
      snapshots: [string, ArtifactOwner][];
      audits: [string, ArtifactOwner][];
      idempotency: [string, OrderId][];
      kdsEvents: KdsEvent[];
      nextOrder: number;
      nextSession: number;
      nextCursor: number;
    };
    this.state = {
      orders: new Map(data.orders),
      orderLines: new Map(data.orderLines),
      snapshots: new Map(data.snapshots),
      audits: new Map(data.audits),
      idempotency: new Map(data.idempotency),
      sessions: new Map(),
      revokedSessions: new Set(),
      kdsEvents: [...data.kdsEvents],
      inFlightIdempotency: new Map(),
      nextOrder: data.nextOrder,
      nextSession: data.nextSession,
      nextCursor: data.nextCursor,
    };
  }

  public clientExposedEnvironmentNames(): readonly string[] {
    return this.faults.clientExposedEnvironmentNames ?? ["ADR010_SUPABASE_URL", "ADR010_SUPABASE_PUBLISHABLE_KEY"];
  }

  public reproducibilityEvidence(): ReproducibilityEvidence {
    return this.faults.reproducibilityEvidence ?? {
      lockfile: "pnpm-lock.yaml",
      commands: [
        "pnpm install --frozen-lockfile",
        "pnpm --filter @super-restaurant/adr-010-spike lint",
        "pnpm --filter @super-restaurant/adr-010-spike typecheck",
        "pnpm --filter @super-restaurant/adr-010-spike test",
        "pnpm --filter @super-restaurant/adr-010-spike build",
      ],
      evidenceLocation: "spikes/adr-010/README.md#reproducible-local-commands",
    };
  }
}

const makeOrder = (state: State, input: CreateOrderInput, session: Session): OrderRecord => ({
  id: `order-${state.nextOrder++}`,
  idempotencyKey: input.idempotencyKey,
  scope: input.scope,
  lines: input.lines,
  audit: { actorId: session.actorId, branchId: input.scope.branchId, action: "ORDER_CREATED" },
});

const materializeArtifacts = (state: State, order: OrderRecord): void => {
  for (const [index] of order.lines.entries()) {
    const lineId = `${order.id}:line:${index}`;
    const owner = { orderId: order.id, scope: order.scope };
    state.orderLines.set(lineId, owner);
    state.snapshots.set(`${lineId}:snapshot`, owner);
  }
  state.audits.set(`${order.id}:audit`, { orderId: order.id, scope: order.scope });
};

const sameScope = (left: CreateOrderInput["scope"], right: CreateOrderInput["scope"]): boolean =>
  left.restaurantId === right.restaurantId && left.branchId === right.branchId;
