import type { BranchScope, RestaurantId } from "@super-restaurant/shared-types";

/**
 * Deliberately small spike model. These are harness records, not proposed
 * production tables, DTOs, or a replacement for packages/domain.
 */
export type ActorId = string;
export type OrderId = string;
export type SessionId = string;
export type KdsCursor = number;

export interface OrderLineInput {
  readonly menuItemId: string;
  readonly quantity: number;
  readonly snapshot: {
    readonly name: string;
    readonly unitAmountMinor: number;
    readonly currency: string;
  };
}

export interface CreateOrderInput {
  readonly idempotencyKey: string;
  readonly scope: BranchScope;
  readonly sessionId: SessionId;
  readonly lines: readonly OrderLineInput[];
  /** Test-only fault hook used to demonstrate atomicity detection. */
  readonly induceFailureAfterOrder?: boolean;
}

export interface OrderRecord {
  readonly id: OrderId;
  readonly idempotencyKey: string;
  readonly scope: BranchScope;
  readonly lines: readonly OrderLineInput[];
  readonly audit: {
    readonly actorId: ActorId;
    readonly branchId: string;
    readonly action: "ORDER_CREATED";
  };
}

/**
 * Observable persisted artifacts. Real option adapters must obtain these from
 * their datastore, not reconstruct them from the create-order response.
 */
export interface OrderArtifacts {
  readonly orderIds: readonly OrderId[];
  readonly lineIds: readonly string[];
  readonly snapshotIds: readonly string[];
  readonly auditIds: readonly string[];
}

export interface ReproducibilityEvidence {
  readonly lockfile: "pnpm-lock.yaml";
  readonly commands: readonly string[];
  /** Stable path or external evidence reference with the command output. */
  readonly evidenceLocation: string;
}

export interface KdsEvent {
  readonly cursor: KdsCursor;
  readonly orderId: OrderId;
  readonly scope: BranchScope;
}

export interface KdsRecovery {
  readonly events: readonly KdsEvent[];
  readonly cursor: KdsCursor;
}

export interface Session {
  readonly id: SessionId;
  readonly actorId: ActorId;
  readonly scope: BranchScope;
}

export interface SpikeFixtures {
  readonly restaurants: readonly RestaurantId[];
  readonly branches: readonly BranchScope[];
  readonly primaryScope: BranchScope;
  readonly otherRestaurantScope: BranchScope;
  readonly otherBranchScope: BranchScope;
  readonly secondRestaurantSecondBranchScope: BranchScope;
}

export class GateFailure extends Error {
  public constructor(
    public readonly gate: GateName,
    message: string,
  ) {
    super(message);
    this.name = "GateFailure";
  }
}

export type GateName =
  | "isolation"
  | "transaction"
  | "idempotency"
  | "single-write-frontier"
  | "realtime-recovery"
  | "auth-scope-revocation"
  | "migration"
  | "backup-restore"
  | "secrets"
  | "reproducibility";

export const asRestaurantId = (value: string): RestaurantId => value as RestaurantId;

export const asBranchScope = (restaurantId: string, branchId: string): BranchScope =>
  ({ restaurantId: asRestaurantId(restaurantId), branchId: branchId as BranchScope["branchId"] });

export const createFixtures = (): SpikeFixtures => {
  const primaryScope = asBranchScope("restaurant-amber", "branch-amber-north");
  const otherBranchScope = asBranchScope("restaurant-amber", "branch-amber-south");
  const otherRestaurantScope = asBranchScope("restaurant-cobalt", "branch-cobalt-north");
  const secondRestaurantSecondBranchScope = asBranchScope("restaurant-cobalt", "branch-cobalt-south");

  return {
    restaurants: [asRestaurantId("restaurant-amber"), asRestaurantId("restaurant-cobalt")],
    branches: [
      primaryScope,
      otherBranchScope,
      otherRestaurantScope,
      secondRestaurantSecondBranchScope,
    ],
    primaryScope,
    otherBranchScope,
    otherRestaurantScope,
    secondRestaurantSecondBranchScope,
  };
};
