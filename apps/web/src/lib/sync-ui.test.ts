import assert from "node:assert/strict";
import test from "node:test";

import {
  MANUAL_REVIEW_CASE_SCHEMA_VERSION,
  parseSyncScopeV1,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS,
  SYNC_OUTBOX_STATES,
  type BranchScope,
} from "@super-restaurant/shared-types";

import {
  buildResolveManualReviewCommand,
  buildSyncBannerMessage,
  canRetrySyncEvent,
  deriveConnectivityState,
  describeSyncOutcomeForOperator,
  EMPTY_WEB_SYNC_SNAPSHOT,
  filterSyncEvents,
  formatEntityTypeLabel,
  formatManualReviewStatusLabel,
  formatOperationLabel,
  formatOutboxStateLabel,
  formatSyncAmountMinor,
  formatSyncEventTitle,
  formatSyncTime,
  getConnectivityPresentation,
  isSupervisorRoleList,
  normalizeScopedSyncSnapshot,
  parseScopedManualReviewList,
  sanitizeOperatorSummary,
  summarizeSyncEvents,
  SYNC_MATRIX_MESSAGES,
  tryGenerateSyncId,
  validateManualReviewResolutionForm,
  type SyncUiEventItem,
} from "./sync-ui.js";

const SCOPE_A: BranchScope = parseSyncScopeV1({
  branchId: "11111111-1111-4111-8111-111111111111",
  restaurantId: "22222222-2222-4222-8222-222222222222",
})!;

const SCOPE_B: BranchScope = parseSyncScopeV1({
  branchId: "33333333-3333-4333-8333-333333333333",
  restaurantId: "22222222-2222-4222-8222-222222222222",
})!;

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const TECHNICAL_CODE_PATTERN = /\b(AUTH_REVOKED|DEVICE_REVOKED|SCHEMA_OUTDATED|CONCURRENT_[A-Z_]+|manual_review|retry_wait|pullCursor|baseVersion|outbox|UUID|LWW|WAN)\b/u;

function sampleEvent(overrides: Partial<SyncUiEventItem> = {}): SyncUiEventItem {
  return {
    branchId: SCOPE_A.branchId,
    entityType: "Order",
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    financial: false,
    lastErrorCode: null,
    localSequence: 1,
    localState: "pending",
    occurredAt: "2026-11-23T17:15:00Z",
    operation: "create",
    restaurantId: SCOPE_A.restaurantId,
    retryCount: 0,
    schemaOutdated: false,
    summaryLabel: "Mesa 4",
    updatedAt: null,
    ...overrides,
  };
}

test("deriveConnectivityState covers all five states of OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §1.1", () => {
  const base = {
    blockedEventCount: 0,
    browserOnline: true,
    openManualReviewCount: 0,
    reconnecting: false,
    resyncRequired: false,
    retryWaitCount: 0,
    schemaOutdated: false,
    scopeRevoked: false,
    serverReachable: true,
    storageQuarantined: false,
  };

  assert.equal(deriveConnectivityState(base), "online");
  assert.equal(deriveConnectivityState({ ...base, browserOnline: false }), "offline");
  assert.equal(deriveConnectivityState({ ...base, serverReachable: false }), "degraded");
  assert.equal(deriveConnectivityState({ ...base, retryWaitCount: 2 }), "degraded");
  assert.equal(deriveConnectivityState({ ...base, resyncRequired: true }), "degraded");
  assert.equal(deriveConnectivityState({ ...base, reconnecting: true }), "reconnecting");
  assert.equal(deriveConnectivityState({ ...base, blockedEventCount: 1 }), "sync_blocked");
  assert.equal(deriveConnectivityState({ ...base, openManualReviewCount: 1 }), "sync_blocked");
  assert.equal(deriveConnectivityState({ ...base, schemaOutdated: true }), "sync_blocked");
  assert.equal(deriveConnectivityState({ ...base, scopeRevoked: true }), "sync_blocked");
  assert.equal(deriveConnectivityState({ ...base, storageQuarantined: true }), "sync_blocked");
  // Offline takes precedence over sync_blocked when browser has no network at all.
  assert.equal(deriveConnectivityState({ ...base, blockedEventCount: 2, browserOnline: false }), "offline");
});

test("SYNC_MATRIX_MESSAGES preserves the exact Spanish copy from OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §2.3", () => {
  assert.equal(
    SYNC_MATRIX_MESSAGES.offlineSavedLocally,
    "Sin conexión. Este cambio se guardó en este dispositivo; no está disponible en otros equipos todavía.",
  );
  assert.equal(
    SYNC_MATRIX_MESSAGES.pendingQueue(3),
    "Pendientes de sincronizar: 3. Puedes continuar con operaciones permitidas.",
  );
  assert.equal(
    SYNC_MATRIX_MESSAGES.retryPreserved,
    "No se confirmó la respuesta. Conservamos el cambio y lo reintentaremos sin duplicarlo.",
  );
  assert.equal(
    SYNC_MATRIX_MESSAGES.permissionRejected,
    "La autorización no fue válida en el servidor. El cambio no se aplicó.",
  );
  assert.equal(
    SYNC_MATRIX_MESSAGES.nonFinancialConflict,
    "Otro cambio usa una versión distinta. Conservamos ambas evidencias; revisa antes de continuar.",
  );
  assert.equal(
    SYNC_MATRIX_MESSAGES.financialConflict,
    "Operación financiera pendiente de revisión. No se fusionó ni se cobró de nuevo.",
  );
  assert.equal(
    SYNC_MATRIX_MESSAGES.kdsLocalOnly,
    "Estado guardado en este KDS; otras estaciones lo verán al sincronizar.",
  );
  assert.equal(
    SYNC_MATRIX_MESSAGES.reconciliationComplete("10:25"),
    "Sincronización confirmada a las 10:25. No hay pendientes.",
  );
  assert.equal(
    SYNC_MATRIX_MESSAGES.schemaOutdated,
    "Esta versión de la app debe actualizarse antes de sincronizar esta operación.",
  );
});

test("describeSyncOutcomeForOperator translates internal codes without exposing technical jargon or UUIDs", () => {
  const cases = [
    {
      expected: SYNC_MATRIX_MESSAGES.permissionRejected,
      input: { code: "AUTH_REVOKED", localState: "rejected" as const },
    },
    {
      expected: SYNC_MATRIX_MESSAGES.schemaOutdated,
      input: { code: "SCHEMA_VERSION_UNSUPPORTED", localState: "rejected" as const },
    },
    {
      expected: SYNC_MATRIX_MESSAGES.retryPreserved,
      input: { code: "TRANSPORT_ERROR", localState: "retry_wait" as const },
    },
    {
      expected: SYNC_MATRIX_MESSAGES.financialConflict,
      input: { code: "PAYMENT_OVERPAYMENT", entityType: "Payment" as const, financial: true, localState: "manual_review" as const },
    },
    {
      expected: SYNC_MATRIX_MESSAGES.nonFinancialConflict,
      input: { code: "CONCURRENT_ORDER_ITEM_MODIFICATION", entityType: "OrderItem" as const, financial: false, localState: "conflict" as const },
    },
    {
      expected: SYNC_MATRIX_MESSAGES.kdsLocalOnly,
      input: { code: null, entityType: "KdsTicket" as const, localState: "pending" as const },
    },
  ];

  for (const item of cases) {
    const text = describeSyncOutcomeForOperator(item.input);
    assert.equal(text, item.expected);
    assert.equal(UUID_PATTERN.test(text), false);
    assert.equal(TECHNICAL_CODE_PATTERN.test(text), false);
  }

  // Unknown backend error code falls back to safe Spanish text without leaking the raw code.
  const unknown = describeSyncOutcomeForOperator({ code: "INTERNAL_DB_42703_LEAK" });
  assert.equal(unknown.includes("42703"), false);
  assert.equal(unknown.includes("INTERNAL"), false);
});

test("all entity, operation, outbox, connectivity, and review labels are plain Spanish with zero jargon", () => {
  for (const entityType of SYNC_ENTITY_TYPES) {
    const label = formatEntityTypeLabel(entityType);
    assert.ok(label.length > 0);
    assert.equal(TECHNICAL_CODE_PATTERN.test(label), false);
  }
  for (const operation of SYNC_OPERATIONS) {
    const label = formatOperationLabel(operation);
    assert.ok(label.length > 0);
    assert.equal(TECHNICAL_CODE_PATTERN.test(label), false);
  }
  for (const state of SYNC_OUTBOX_STATES) {
    const label = formatOutboxStateLabel(state);
    assert.ok(label.length > 0);
    assert.equal(TECHNICAL_CODE_PATTERN.test(label), false);
  }
  for (const connectivity of ["online", "degraded", "offline", "reconnecting", "sync_blocked"] as const) {
    const presentation = getConnectivityPresentation(connectivity);
    assert.equal(TECHNICAL_CODE_PATTERN.test(presentation.label), false);
    assert.equal(TECHNICAL_CODE_PATTERN.test(presentation.description), false);
  }
  for (const status of ["open", "resolved_compensated", "resolved_rejected"] as const) {
    const label = formatManualReviewStatusLabel(status);
    assert.ok(label.length > 0);
    assert.equal(TECHNICAL_CODE_PATTERN.test(label), false);
  }
});

test("summarizeSyncEvents, filterSyncEvents, and canRetrySyncEvent classify events deterministically", () => {
  const events: readonly SyncUiEventItem[] = [
    sampleEvent({ eventId: "10000000-0000-4000-8000-000000000001", localSequence: 1, localState: "accepted" }),
    sampleEvent({ eventId: "10000000-0000-4000-8000-000000000002", localSequence: 2, localState: "pending" }),
    sampleEvent({ eventId: "10000000-0000-4000-8000-000000000003", localSequence: 3, localState: "retry_wait", retryCount: 2 }),
    sampleEvent({
      entityType: "Payment",
      eventId: "10000000-0000-4000-8000-000000000004",
      financial: true,
      localSequence: 4,
      localState: "manual_review",
    }),
    sampleEvent({
      eventId: "10000000-0000-4000-8000-000000000005",
      lastErrorCode: "SCHEMA_OUTDATED",
      localSequence: 5,
      localState: "rejected",
      schemaOutdated: true,
    }),
  ];

  const counts = summarizeSyncEvents(events);
  assert.equal(counts.total, 5);
  assert.equal(counts.pendingCount, 2);
  assert.equal(counts.retryWaitCount, 1);
  assert.equal(counts.confirmedCount, 1);
  assert.equal(counts.blockedCount, 2);
  assert.equal(counts.hasRetryable, true);
  assert.equal(counts.hasFinancialBlocked, true);
  assert.equal(counts.hasSchemaOutdated, true);

  assert.deepEqual(
    filterSyncEvents(events, "pending").map((item) => item.localSequence),
    [3, 2],
  );
  assert.deepEqual(
    filterSyncEvents(events, "attention").map((item) => item.localSequence),
    [5, 4],
  );
  assert.deepEqual(
    filterSyncEvents(events, "confirmed").map((item) => item.localSequence),
    [1],
  );

  assert.equal(canRetrySyncEvent(events[1]!), true);
  assert.equal(canRetrySyncEvent(events[2]!), true);
  assert.equal(canRetrySyncEvent(events[3]!), false);
  assert.equal(canRetrySyncEvent(events[4]!), false);
});

test("buildSyncBannerMessage selects the exact §2.3 guidance for every operational state", () => {
  const emptyCounts = summarizeSyncEvents([]);
  const confirmed = buildSyncBannerMessage({
    counts: emptyCounts,
    hasFinancialReview: false,
    lastConfirmedSyncAt: "2026-11-23T17:25:00Z",
    openManualReviewCount: 0,
    schemaOutdated: false,
    scopeRevoked: false,
    state: "online",
    storageQuarantined: false,
    timeZone: "UTC",
  });
  assert.equal(confirmed, "Sincronización confirmada a las 17:25. No hay pendientes.");

  const pendingBanner = buildSyncBannerMessage({
    counts: summarizeSyncEvents([sampleEvent(), sampleEvent({ eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", localSequence: 2 })]),
    hasFinancialReview: false,
    lastConfirmedSyncAt: null,
    openManualReviewCount: 0,
    schemaOutdated: false,
    scopeRevoked: false,
    state: "online",
    storageQuarantined: false,
  });
  assert.equal(pendingBanner, "Pendientes de sincronizar: 2. Puedes continuar con operaciones permitidas.");

  const financialBlocked = buildSyncBannerMessage({
    counts: emptyCounts,
    hasFinancialReview: true,
    lastConfirmedSyncAt: null,
    openManualReviewCount: 1,
    schemaOutdated: false,
    scopeRevoked: false,
    state: "sync_blocked",
    storageQuarantined: false,
  });
  assert.equal(financialBlocked, SYNC_MATRIX_MESSAGES.financialConflict);

  const schemaBlocked = buildSyncBannerMessage({
    counts: emptyCounts,
    hasFinancialReview: true,
    lastConfirmedSyncAt: null,
    openManualReviewCount: 1,
    schemaOutdated: true,
    scopeRevoked: false,
    state: "sync_blocked",
    storageQuarantined: false,
  });
  assert.equal(schemaBlocked, SYNC_MATRIX_MESSAGES.schemaOutdated);
});

test("sanitizeOperatorSummary strips UUIDs so no raw identifier leaks into event titles", () => {
  assert.equal(sanitizeOperatorSummary("Mesa 7"), "Mesa 7");
  assert.equal(sanitizeOperatorSummary("Orden 11111111-1111-4111-8111-111111111111"), null);
  const title = formatSyncEventTitle(sampleEvent({ summaryLabel: "11111111-1111-4111-8111-111111111111" }));
  assert.equal(title, "Orden · Registrar");
  assert.equal(UUID_PATTERN.test(title), false);
});

test("formatSyncAmountMinor formats integer minor units without floats and rejects unsafe inputs", () => {
  assert.equal(formatSyncAmountMinor(13050, "MXN"), "$130.50");
  assert.equal(formatSyncAmountMinor(0, "MXN"), "$0.00");
  assert.equal(formatSyncAmountMinor(-2500, "MXN"), "-$25.00");
  assert.equal(formatSyncAmountMinor(500, "JPY"), "$500");
  assert.equal(formatSyncAmountMinor(12.34, "MXN"), null);
  assert.equal(formatSyncAmountMinor(1000, "XYZ"), null);
  assert.equal(formatSyncAmountMinor(null, "MXN"), null);
});

test("formatSyncTime handles valid timestamps and rejects invalid ones cleanly", () => {
  assert.equal(formatSyncTime("2026-11-23T17:09:00Z", "UTC"), "17:09");
  assert.equal(formatSyncTime("not-a-date", "UTC"), null);
  assert.equal(formatSyncTime(null), null);
});

test("normalizeScopedSyncSnapshot filters out cross-branch events and malformed records fail-closed", () => {
  const normalized = normalizeScopedSyncSnapshot(
    {
      events: [
        sampleEvent({ eventId: "10000000-0000-4000-8000-000000000010", localSequence: 10 }),
        sampleEvent({
          branchId: SCOPE_B.branchId,
          eventId: "10000000-0000-4000-8000-000000000011",
          localSequence: 11,
        }),
        { eventId: "not-a-uuid", localSequence: -1 },
      ],
      lastConfirmedSyncAt: "2026-11-23T17:30:00Z",
      storageReady: true,
    },
    SCOPE_A,
  );

  assert.equal(normalized.storageReady, true);
  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.events[0]?.localSequence, 10);
  assert.equal(normalizeScopedSyncSnapshot(null, SCOPE_A), EMPTY_WEB_SYNC_SNAPSHOT);
});

test("validateManualReviewResolutionForm and buildResolveManualReviewCommand enforce server contract", () => {
  assert.equal(validateManualReviewResolutionForm({ decision: "invalid", reason: "ok ok" }).ok, false);
  assert.equal(validateManualReviewResolutionForm({ decision: "reject", reason: "  " }).ok, false);
  assert.equal(validateManualReviewResolutionForm({ decision: "reject", reason: "a\nb" }).ok, false);

  const valid = validateManualReviewResolutionForm({
    decision: "compensate",
    reason: "  Se verificó el ticket en caja física  ",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.reason, "Se verificó el ticket en caja física");
  }

  const command = buildResolveManualReviewCommand({
    caseId: "44444444-4444-4444-8444-444444444444",
    compensatingEventId: "55555555-5555-4555-8555-555555555555",
    decision: "compensate",
    deviceId: "66666666-6666-4666-8666-666666666666",
    idempotencyKey: "mr-resolve-1",
    occurredAt: "2026-11-23T17:35:00Z",
    reason: "Arqueo confirmado con recibo",
    scope: SCOPE_A,
  });
  assert.ok(command !== undefined);
  assert.equal(command?.decision, "compensate");
  assert.equal(command?.compensatingEventId, "55555555-5555-4555-8555-555555555555");

  const rejectCommand = buildResolveManualReviewCommand({
    caseId: "44444444-4444-4444-8444-444444444444",
    compensatingEventId: "55555555-5555-4555-8555-555555555555",
    decision: "reject",
    deviceId: "66666666-6666-4666-8666-666666666666",
    idempotencyKey: "mr-resolve-2",
    occurredAt: "2026-11-23T17:36:00Z",
    reason: "Intento duplicado descartado",
    scope: SCOPE_A,
  });
  assert.ok(rejectCommand !== undefined);
  assert.equal(rejectCommand?.compensatingEventId, null);

  assert.equal(isSupervisorRoleList(["waiter", "cashier"]), false);
  assert.equal(isSupervisorRoleList(["supervisor"]), true);
  assert.equal(isSupervisorRoleList(["owner"]), true);
});

test("parseScopedManualReviewList parses valid cases and rejects cross-branch leakage", () => {
  const validCase = {
    actorId: "77777777-7777-4777-8777-777777777777",
    amountMinor: 25000,
    auditId: null,
    baseVersion: null,
    canonicalVersion: 2,
    caseId: "44444444-4444-4444-8444-444444444444",
    compensatingEventId: null,
    currency: "MXN",
    deviceId: "66666666-6666-4666-8666-666666666666",
    entityId: "88888888-8888-4888-8888-888888888888",
    entityType: "Payment",
    eventId: "99999999-9999-4999-8999-999999999999",
    financial: true,
    idempotencyKey: "pay-1",
    openedAt: "2026-11-23T17:00:00Z",
    operation: "create",
    reasonCode: "PAYMENT_OVERPAYMENT",
    resolutionReason: null,
    resolvedAt: null,
    resolvedByActorId: null,
    schemaVersion: MANUAL_REVIEW_CASE_SCHEMA_VERSION,
    scope: SCOPE_A,
    status: "open",
  };

  const parsed = parseScopedManualReviewList({ cases: [validCase] }, SCOPE_A);
  assert.equal(parsed?.length, 1);
  assert.equal(parsed?.[0]?.amountMinor, 25000);

  // A case belonging to another branch is rejected fail-closed.
  const leaked = parseScopedManualReviewList({ cases: [{ ...validCase, scope: SCOPE_B }] }, SCOPE_A);
  assert.equal(leaked, undefined);
});

test("not_deployed or unconfirmed sync never emits reconciliationComplete (P1.1 / P2.4)", () => {
  const emptyCounts = summarizeSyncEvents([]);

  const notDeployed = buildSyncBannerMessage({
    counts: emptyCounts,
    hasFinancialReview: false,
    lastConfirmedSyncAt: "2026-11-23T17:25:00Z",
    openManualReviewCount: 0,
    schemaOutdated: false,
    scopeRevoked: false,
    state: "online",
    storageQuarantined: false,
    syncServiceAvailable: false,
    timeZone: "UTC",
  });
  assert.equal(notDeployed.includes("Sincronización confirmada"), false);
  assert.match(notDeployed, /aún no está habilitado/i);

  const unconfirmed = buildSyncBannerMessage({
    counts: emptyCounts,
    hasFinancialReview: false,
    lastConfirmedSyncAt: null,
    openManualReviewCount: 0,
    schemaOutdated: false,
    scopeRevoked: false,
    state: "online",
    storageQuarantined: false,
    syncServiceAvailable: true,
    timeZone: "UTC",
  });
  assert.equal(unconfirmed.includes("Sincronización confirmada"), false);
  assert.match(unconfirmed, /sin|no hay una sincronización confirmada/i);
});

test("rejected events without permission error codes do not claim invalid authorization (P2.5)", () => {
  const staleRejected = describeSyncOutcomeForOperator({
    code: "STALE_WRITE",
    localState: "rejected",
  });
  assert.equal(staleRejected, SYNC_MATRIX_MESSAGES.nonFinancialConflict);

  const preconditionRejected = describeSyncOutcomeForOperator({
    code: "PRECONDITION_FAILED",
    localState: "rejected",
  });
  assert.notEqual(preconditionRejected, SYNC_MATRIX_MESSAGES.permissionRejected);
  assert.equal(TECHNICAL_CODE_PATTERN.test(preconditionRejected), false);

  const genericRejected = describeSyncOutcomeForOperator({
    code: null,
    localState: "rejected",
  });
  assert.notEqual(genericRejected, SYNC_MATRIX_MESSAGES.permissionRejected);

  const authRejected = describeSyncOutcomeForOperator({
    code: "FORBIDDEN",
    localState: "rejected",
  });
  assert.equal(authRejected, SYNC_MATRIX_MESSAGES.permissionRejected);
});

test("tryGenerateSyncId fails closed without returning a static all-zeros UUID (P2.2)", () => {
  const generated = tryGenerateSyncId({
    randomUUID: () => "12345678-1234-4123-8123-123456789abc",
  });
  assert.equal(generated, "12345678-1234-4123-8123-123456789abc");

  assert.equal(tryGenerateSyncId(null), null);
  assert.equal(tryGenerateSyncId({}), null);
  assert.equal(tryGenerateSyncId({ randomUUID: () => "not-a-uuid" }), null);
  assert.equal(
    tryGenerateSyncId({
      randomUUID: () => {
        throw new Error("crypto unavailable");
      },
    }),
    null,
  );
});
