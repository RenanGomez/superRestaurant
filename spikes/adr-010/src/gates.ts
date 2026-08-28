import type { Adr010Adapter, WriteFrontierInspection } from "./adapter.js";
import {
  createFixtures,
  GateFailure,
  type CreateOrderInput,
  type GateName,
  type OrderArtifacts,
  type OrderRecord,
  type SpikeFixtures,
} from "./model.js";

export const gateNames: readonly GateName[] = [
  "isolation",
  "transaction",
  "idempotency",
  "single-write-frontier",
  "realtime-recovery",
  "auth-scope-revocation",
  "migration",
  "backup-restore",
  "secrets",
  "reproducibility",
];

export interface CommonGateReport {
  /** This gate always requires an evidence review and never passes automatically. */
  readonly pendingHumanInspection: readonly ["single-write-frontier"];
  readonly singleWriteFrontier: WriteFrontierInspection;
}

export const runCommonGates = async (adapter: Adr010Adapter, fixtures = createFixtures()): Promise<CommonGateReport> => {
  await adapter.migrateFromEmpty();
  await isolationGate(adapter, fixtures);
  await transactionGate(adapter, fixtures);
  await idempotencyGate(adapter, fixtures);
  const singleWriteFrontier = singleWriteFrontierGate(adapter);
  await realtimeRecoveryGate(adapter, fixtures);
  await authScopeRevocationGate(adapter, fixtures);
  await migrationGate(adapter, fixtures);
  await backupRestoreGate(adapter, fixtures);
  secretsGate(adapter);
  reproducibilityGate(adapter);
  return { pendingHumanInspection: ["single-write-frontier"], singleWriteFrontier };
};

export const isolationGate = async (adapter: Adr010Adapter, fixtures: SpikeFixtures): Promise<void> => {
  const order = await createFixtureOrder(adapter, fixtures, "isolation");
  const crossTenant = await adapter.getOrder(fixtures.otherRestaurantScope, order.id);
  const crossBranch = await adapter.getOrder(fixtures.otherBranchScope, order.id);
  if (crossTenant !== undefined || crossBranch !== undefined) {
    throw new GateFailure("isolation", "Cross-restaurant or cross-branch order read was allowed.");
  }

  const session = await adapter.issueSession("actor-isolation-write", fixtures.primaryScope);
  for (const [name, foreignScope] of [
    ["restaurant", fixtures.otherRestaurantScope],
    ["branch", fixtures.otherBranchScope],
  ] as const) {
    const before = await adapter.readOrderArtifacts(foreignScope);
    await expectReject(
      adapter.createOrder(orderInput(fixtures, session.id, `isolation-write-${name}`, foreignScope)),
      "isolation",
      `Cross-${name} order write was allowed.`,
    );
    assertSameArtifacts(before, await adapter.readOrderArtifacts(foreignScope), "isolation", `Cross-${name} write left persisted state.`);
  }
};

export const transactionGate = async (adapter: Adr010Adapter, fixtures: SpikeFixtures): Promise<void> => {
  const session = await adapter.issueSession("actor-transaction", fixtures.primaryScope);
  const before = await adapter.readOrderArtifacts(fixtures.primaryScope);
  await expectReject(
    adapter.createOrder({ ...orderInput(fixtures, session.id, "transaction"), induceFailureAfterOrder: true }),
    "transaction",
    "The adapter accepted an induced write failure.",
  );
  assertSameArtifacts(
    before,
    await adapter.readOrderArtifacts(fixtures.primaryScope),
    "transaction",
    "Induced failure left an order, line, snapshot, or audit artifact.",
  );
};

export const idempotencyGate = async (adapter: Adr010Adapter, fixtures: SpikeFixtures): Promise<void> => {
  const session = await adapter.issueSession("actor-idempotency", fixtures.primaryScope);
  const input = orderInput(fixtures, session.id, "idempotency");
  const results = await Promise.all(Array.from({ length: 20 }, () => adapter.createOrder(input)));
  if (new Set(results.map((result) => result.id)).size !== 1) {
    throw new GateFailure("idempotency", "Twenty concurrent re-sends produced more than one business order.");
  }
  const persistedIds = await adapter.findOrderIdsByIdempotency(fixtures.primaryScope, input.idempotencyKey);
  if (persistedIds.length !== 1 || persistedIds[0] !== results[0]?.id) {
    throw new GateFailure("idempotency", "Concurrent re-sends did not leave exactly one persisted idempotent business result.");
  }
};

export const singleWriteFrontierGate = (adapter: Adr010Adapter): WriteFrontierInspection => {
  const inspection = adapter.writeFrontierInspection();
  if (inspection.status !== "requires-human-inspection" || inspection.evidenceLocation.trim() === "" || inspection.verificationCommand.trim() === "") {
    throw new GateFailure("single-write-frontier", "The adapter did not provide inspectable write-frontier evidence.");
  }
  for (const [entity, paths] of Object.entries(inspection.claimedPaths)) {
    if (paths.length !== 1) {
      throw new GateFailure("single-write-frontier", `${entity} claims ${paths.length} authorized write paths.`);
    }
  }
  return inspection;
};

export const realtimeRecoveryGate = async (adapter: Adr010Adapter, fixtures: SpikeFixtures): Promise<void> => {
  // The client reads its cursor, misses the next pushed event, then catches up.
  const checkpoint = await adapter.recoverKds(fixtures.primaryScope, 0);
  const order = await createFixtureOrder(adapter, fixtures, "realtime");
  const recovered = await adapter.recoverKds(fixtures.primaryScope, checkpoint.cursor);
  if (!recovered.events.some((event) => event.orderId === order.id && sameScope(event.scope, fixtures.primaryScope))) {
    throw new GateFailure("realtime-recovery", "A deliberately missed KDS event cannot be recovered by cursor.");
  }
  for (const foreignScope of [fixtures.otherRestaurantScope, fixtures.otherBranchScope]) {
    const foreignRecovery = await adapter.recoverKds(foreignScope, checkpoint.cursor);
    if (foreignRecovery.events.some((event) => event.orderId === order.id)) {
      throw new GateFailure("realtime-recovery", "Cursor recovery leaked a KDS event outside its restaurant/branch scope.");
    }
  }
};

export const authScopeRevocationGate = async (adapter: Adr010Adapter, fixtures: SpikeFixtures): Promise<void> => {
  const session = await adapter.issueSession("actor-auth", fixtures.primaryScope);
  await expectReject(
    adapter.createOrder(orderInput(fixtures, session.id, "wrong-scope", fixtures.otherRestaurantScope)),
    "auth-scope-revocation",
    "A session wrote outside its restaurant/branch scope.",
  );
  await adapter.revokeSession(session.id);
  await expectReject(
    adapter.createOrder(orderInput(fixtures, session.id, "revoked")),
    "auth-scope-revocation",
    "A revoked session retained write access.",
  );
};

export const migrationGate = async (adapter: Adr010Adapter, fixtures: SpikeFixtures): Promise<void> => {
  await adapter.resetToEmpty();
  await adapter.migrateFromEmpty();
  await createFixtureOrder(adapter, fixtures, "migration-a");
  await createFixtureOrder(adapter, fixtures, "migration-b");
  const before = await adapter.readOrderArtifacts(fixtures.primaryScope);
  await adapter.migrateFromEmpty();
  assertSameArtifacts(before, await adapter.readOrderArtifacts(fixtures.primaryScope), "migration", "Versioned migration did not preserve order counts and identifiers.");
};

export const backupRestoreGate = async (adapter: Adr010Adapter, fixtures: SpikeFixtures): Promise<void> => {
  await createFixtureOrder(adapter, fixtures, "backup-a");
  await createFixtureOrder(adapter, fixtures, "backup-b");
  const before = await adapter.readOrderArtifacts(fixtures.primaryScope);
  const backup = await adapter.backup();
  await adapter.resetToEmpty();
  await adapter.restore(backup);
  assertSameArtifacts(before, await adapter.readOrderArtifacts(fixtures.primaryScope), "backup-restore", "Restore did not preserve expected artifact counts and identifiers.");
};

export const secretsGate = (adapter: Adr010Adapter): void => {
  const privileged = adapter.clientExposedEnvironmentNames().find(isPrivilegedClientEnvironmentName);
  if (privileged !== undefined) {
    throw new GateFailure("secrets", `Privileged environment variable ${privileged} is exposed to a client.`);
  }
};

export const reproducibilityGate = (adapter: Adr010Adapter): void => {
  const evidence = adapter.reproducibilityEvidence();
  const requiredCommands = [
    "pnpm install --frozen-lockfile",
    "pnpm --filter @super-restaurant/adr-010-spike lint",
    "pnpm --filter @super-restaurant/adr-010-spike typecheck",
    "pnpm --filter @super-restaurant/adr-010-spike test",
    "pnpm --filter @super-restaurant/adr-010-spike build",
  ];
  if (
    evidence.lockfile !== "pnpm-lock.yaml" ||
    evidence.evidenceLocation.trim() === "" ||
    requiredCommands.some((command) => !evidence.commands.includes(command))
  ) {
    throw new GateFailure("reproducibility", "Reproducibility evidence must name the lockfile, all frozen commands, and their output location.");
  }
};

const createFixtureOrder = async (adapter: Adr010Adapter, fixtures: SpikeFixtures, key: string): Promise<OrderRecord> => {
  const session = await adapter.issueSession(`actor-${key}`, fixtures.primaryScope);
  return adapter.createOrder(orderInput(fixtures, session.id, key));
};

const orderInput = (
  fixtures: SpikeFixtures,
  sessionId: string,
  idempotencyKey: string,
  scope = fixtures.primaryScope,
): CreateOrderInput => ({
  idempotencyKey,
  scope,
  sessionId,
  lines: [{ menuItemId: "menu-coffee", quantity: 1, snapshot: { name: "Coffee", unitAmountMinor: 3500, currency: "MXN" } }],
});

const expectReject = async (operation: Promise<unknown>, gate: GateName, message: string): Promise<void> => {
  try {
    await operation;
  } catch {
    return;
  }
  throw new GateFailure(gate, message);
};

const assertSameArtifacts = (before: OrderArtifacts, after: OrderArtifacts, gate: GateName, message: string): void => {
  const fields: (keyof OrderArtifacts)[] = ["orderIds", "lineIds", "snapshotIds", "auditIds"];
  if (fields.some((field) => !sameValues(before[field], after[field]))) throw new GateFailure(gate, message);
};

const sameValues = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameScope = (left: CreateOrderInput["scope"], right: CreateOrderInput["scope"]): boolean =>
  left.restaurantId === right.restaurantId && left.branchId === right.branchId;

const isPrivilegedClientEnvironmentName = (name: string): boolean => {
  const normalized = name.toUpperCase();
  if (/SUPABASE.*PUBLISHABLE.*KEY/.test(normalized)) return false;
  return /(ANON|SERVICE.*ROLE|DATABASE|DIRECT_URL|POSTGRES|PGPASSWORD|JWT.*SECRET|NEXTAUTH.*SECRET|PRIVATE.*KEY|SECRET|TOKEN)/.test(normalized);
};
