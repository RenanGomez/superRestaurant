import type {
  ActorId,
  CreateOrderInput,
  KdsRecovery,
  OrderArtifacts,
  OrderId,
  OrderRecord,
  Session,
  SessionId,
  SpikeFixtures,
  ReproducibilityEvidence,
} from "./model.js";

export type CriticalWrite = "Order" | "Payment" | "CashMovement";

/**
 * A single-write frontier cannot be proven by a self-reported list. This
 * record identifies the mandatory inspection evidence; a human must verify it
 * against the actual option before that option can pass ADR-010.
 */
export interface WriteFrontierInspection {
  readonly status: "requires-human-inspection";
  readonly evidenceLocation: string;
  readonly verificationCommand: string;
  readonly claimedPaths: Readonly<Record<CriticalWrite, readonly string[]>>;
}

/**
 * Common thin-slice contract. An A/B/C implementation must bind every method
 * to the actual option under review; passing this contract alone earns no score.
 */
export interface Adr010Adapter {
  readonly option: "A" | "B" | "C" | "reference";
  migrateFromEmpty(): Promise<void>;
  resetToEmpty(): Promise<void>;
  issueSession(actorId: ActorId, scope: SpikeFixtures["primaryScope"]): Promise<Session>;
  revokeSession(sessionId: SessionId): Promise<void>;
  createOrder(input: CreateOrderInput): Promise<OrderRecord>;
  getOrder(scope: CreateOrderInput["scope"], orderId: OrderId): Promise<OrderRecord | undefined>;
  countOrders(scope?: CreateOrderInput["scope"]): Promise<number>;
  findOrderIdsByIdempotency(scope: CreateOrderInput["scope"], idempotencyKey: string): Promise<readonly OrderId[]>;
  readOrderArtifacts(scope: CreateOrderInput["scope"]): Promise<OrderArtifacts>;
  writeFrontierInspection(): WriteFrontierInspection;
  recoverKds(scope: CreateOrderInput["scope"], afterCursor: number): Promise<KdsRecovery>;
  backup(): Promise<unknown>;
  restore(backup: unknown): Promise<void>;
  clientExposedEnvironmentNames(): readonly string[];
  reproducibilityEvidence(): ReproducibilityEvidence;
}
