import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import { attachDiagnostics, hasNextErrorOverlay, type Diagnostics } from "../helpers.ts";

/** Structural copy of the app's `BranchScope`; the e2e tsconfig does not resolve workspace types. */
export interface BranchScope {
  readonly restaurantId: string;
  readonly branchId: string;
}
import { hasJourneySession, NO_SESSION_MESSAGE, readAuthState, scopeFrom } from "./journey-env.ts";

/**
 * Offline E2E helpers for Phase 3 (M2).
 *
 * The Web POS offline adapter is read by the UI through two runtime seams owned by the app:
 * `window.__srOfflinePosPort` (`apps/web/src/lib/offline-pos.ts`) and `window.__srSyncBridge`
 * (`apps/web/src/lib/sync-ui.ts`). The production wiring that registers them from IndexedDB lives
 * outside this suite's paths and is still pending (see docs/agentic/debt.md, PR #59 P2). Until it
 * lands, these helpers install a deterministic, localStorage-backed implementation of the exact
 * same contract via `addInitScript`, the same seam the approved r5 visual verification used. That
 * keeps the assertions on the real UI (`OfflinePosNotice`, `SyncStatusBar`, `/app/sync`) and on a
 * real offline browser context, never on a stub page.
 *
 * Everything the harness stores is scoped by restaurant/branch/run and removed with the browser
 * context, so no seed survives the test and no operator data is touched.
 */

export const OFFLINE_RUN_ID = (process.env.E2E_RUN_ID ?? new Date().toISOString().replace(/\D/gu, "").slice(0, 14)).slice(0, 40);

export const OFFLINE_SESSION_MESSAGE = NO_SESSION_MESSAGE;

/** Spanish copy the UI must show; imported as constants so the spec never asserts implementation detail. */
export const OFFLINE_COPY = Object.freeze({
  workingOffline: "Trabajando sin conexiÃ³n",
  storageUnavailable: "Este dispositivo todavÃ­a no tiene menÃº ni mesas guardados",
  localSaved: "Pendiente de sincronizar (solo este dispositivo)",
  cacheMenu: "MenÃº en cachÃ©",
  cacheTables: "Mesas en cachÃ©",
  blockedSummary: "Operaciones que siguen bloqueadas sin conexiÃ³n",
  remoteOrigin: "Editar Ã³rdenes de otro dispositivo",
  supervisor: "Descuentos, cancelaciones o reaperturas que exigen supervisor",
  offlineShell: "Sin conexiÃ³n",
  conflictState: "En conflicto",
  reviewState: "Pendiente de revisiÃ³n",
  manualReviewSection: "RevisiÃ³n manual de supervisores",
  resolveCase: "Resolver caso",
  financialConflict: "OperaciÃ³n financiera pendiente de revisiÃ³n",
});

export type OfflineCommitKind = "order_create" | "cash_collect" | "ticket_print";

export interface OfflineHarnessSeed {
  readonly scope: BranchScope;
  readonly runId: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly ids: Readonly<Record<
    | "orderEvent"
    | "paymentEvent"
    | "ticketEvent"
    | "conflictEvent"
    | "caseId"
    | "orderEntity"
    | "tableEntity"
    | "paymentEntity"
    | "compensatingEvent",
    string
  >>;
}

/** Deterministic UUID v4-shaped identifier derived from the run id; stable across reloads and contexts. */
export function deterministicUuid(seed: string, index: number): string {
  let hash = 2_166_136_261 ^ (index * 2_654_435_761);
  const hex: string[] = [];
  for (let i = 0; i < 32; i += 1) {
    hash ^= seed.codePointAt(i % Math.max(1, seed.length)) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
    hash ^= hash >>> 13;
    hex.push((hash >>> (i % 24) & 0xf).toString(16));
  }
  hex[12] = "4";
  hex[16] = (((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8)).toString(16);
  const joined = hex.join("");
  return [joined.slice(0, 8), joined.slice(8, 12), joined.slice(12, 16), joined.slice(16, 20), joined.slice(20, 32)].join("-");
}

export function buildOfflineSeed(scope: BranchScope, runId: string = OFFLINE_RUN_ID, deviceIndex = 0): OfflineHarnessSeed {
  return Object.freeze({
    scope: Object.freeze({ branchId: scope.branchId, restaurantId: scope.restaurantId }),
    runId,
    deviceId: deterministicUuid(`${runId}:device:${deviceIndex}`, 1),
    actorId: deterministicUuid(`${runId}:actor`, 2),
    occurredAt: "2026-11-23T18:00:00.000Z",
    ids: Object.freeze({
      orderEvent: deterministicUuid(`${runId}:order-event`, 3),
      paymentEvent: deterministicUuid(`${runId}:payment-event`, 4),
      ticketEvent: deterministicUuid(`${runId}:ticket-event`, 5),
      conflictEvent: deterministicUuid(`${runId}:conflict-event`, 6),
      caseId: deterministicUuid(`${runId}:case`, 7),
      orderEntity: deterministicUuid(`${runId}:order-entity`, 8),
      tableEntity: deterministicUuid(`${runId}:table-entity`, 9),
      paymentEntity: deterministicUuid(`${runId}:payment-entity`, 10),
      compensatingEvent: deterministicUuid(`${runId}:compensating-event`, 11),
    }),
  });
}

/** Returns the stored branch scope, or skips the test when there is no saved operator session. */
export function offlineScopeOrSkip(): BranchScope | undefined {
  const state = readAuthState();
  const scope = state === undefined ? undefined : scopeFrom(state);
  if (!hasJourneySession() || scope === undefined) {
    test.skip(true, OFFLINE_SESSION_MESSAGE);
    return undefined;
  }
  return scope;
}

/** Skips the authenticated offline flows on non-desktop projects (they run in the `offline` project). */
export function beforeOffline(testInfo: TestInfo): BranchScope | undefined {
  test.skip(testInfo.project.name !== "offline", "Las pruebas offline se ejecutan en el proyecto offline");
  return offlineScopeOrSkip();
}

/**
 * Installs the deterministic offline adapter on every document of the context, before any app
 * script runs, so the UI reads it exactly as it will read the production bridge once wired.
 */
export async function installOfflineHarness(
  target: Page | BrowserContext,
  seed: OfflineHarnessSeed,
): Promise<void> {
  await (target as BrowserContext).addInitScript((initial: OfflineHarnessSeed) => {
    type HarnessEvent = {
      eventId: string;
      restaurantId: string;
      branchId: string;
      entityType: string;
      entityId: string;
      operation: string;
      localSequence: number;
      localState: string;
      retryCount: number;
      lastErrorCode: string | null;
      occurredAt: string;
      updatedAt: string | null;
      financial: boolean;
      summaryLabel: string | null;
      idempotencyKey: string;
      baseVersion: number | null;
    };
    type HarnessCase = Record<string, unknown> & { caseId: string; status: string };

    const STORAGE_KEY = `sr-e2e-offline:${initial.scope.restaurantId}:${initial.scope.branchId}:${initial.runId}`;
    const host = window as unknown as {
      __srSyncBridge?: unknown;
      __srOfflinePosPort?: unknown;
      __srOfflineHarness?: unknown;
      __srNativeDialogLog?: string[];
    };

    const read = (): { events: HarnessEvent[]; cases: HarnessCase[]; lastConfirmedSyncAt: string | null } => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return { events: [], cases: [], lastConfirmedSyncAt: null };
        const parsed = JSON.parse(raw) as { events?: HarnessEvent[]; cases?: HarnessCase[]; lastConfirmedSyncAt?: string | null };
        return {
          events: Array.isArray(parsed.events) ? parsed.events : [],
          cases: Array.isArray(parsed.cases) ? parsed.cases : [],
          lastConfirmedSyncAt: typeof parsed.lastConfirmedSyncAt === "string" ? parsed.lastConfirmedSyncAt : null,
        };
      } catch {
        return { events: [], cases: [], lastConfirmedSyncAt: null };
      }
    };

    const state = read();
    const listeners = new Set<() => void>();
    const persist = (): void => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* an app listener failing must not break the next one */
        }
      }
      window.dispatchEvent(new Event("sr:sync-state-changed"));
      window.dispatchEvent(new Event("sr:offline-pos-state-changed"));
    };

    const entityFor = (kind: string): { entityType: string; entityId: string; operation: string; financial: boolean; summary: string; idempotencyKey: string; baseVersion: number | null } => {
      if (kind === "cash_collect") {
        return {
          entityId: initial.ids.paymentEntity,
          entityType: "Payment",
          financial: true,
          idempotencyKey: `${initial.runId}:${initial.deviceId}:payment`,
          operation: "create",
          baseVersion: null,
          summary: "Cobro en efectivo",
        };
      }
      if (kind === "ticket_print") {
        return {
          entityId: initial.ids.orderEntity,
          entityType: "Order",
          financial: false,
          idempotencyKey: `${initial.runId}:${initial.deviceId}:ticket`,
          operation: "transition",
          baseVersion: 2,
          summary: "Ticket pendiente",
        };
      }
      return {
        entityId: initial.ids.orderEntity,
        entityType: "Order",
        financial: false,
        idempotencyKey: `${initial.runId}:${initial.deviceId}:order`,
        operation: "create",
        baseVersion: null,
        summary: "Mesa 12",
      };
    };

    const eventIdFor = (kind: string): string =>
      kind === "cash_collect"
        ? initial.ids.paymentEvent
        : kind === "ticket_print"
          ? initial.ids.ticketEvent
          : initial.ids.orderEvent;

    const record = (kind: string): HarnessEvent => {
      const descriptor = entityFor(kind);
      const existing = state.events.find((candidate) => candidate.idempotencyKey === descriptor.idempotencyKey);
      if (existing !== undefined) return existing;
      const event: HarnessEvent = {
        baseVersion: descriptor.baseVersion,
        branchId: initial.scope.branchId,
        entityId: descriptor.entityId,
        entityType: descriptor.entityType,
        eventId: eventIdFor(kind),
        financial: descriptor.financial,
        idempotencyKey: descriptor.idempotencyKey,
        lastErrorCode: null,
        localSequence: state.events.length + 1,
        localState: "pending",
        occurredAt: initial.occurredAt,
        operation: descriptor.operation,
        restaurantId: initial.scope.restaurantId,
        retryCount: 0,
        summaryLabel: descriptor.summary,
        updatedAt: null,
      };
      state.events.push(event);
      persist();
      return event;
    };

    const uiEvent = (event: HarnessEvent): Record<string, unknown> => ({
      branchId: event.branchId,
      entityType: event.entityType,
      eventId: event.eventId,
      financial: event.financial,
      lastErrorCode: event.lastErrorCode,
      localSequence: event.localSequence,
      localState: event.localState,
      occurredAt: event.occurredAt,
      operation: event.operation,
      restaurantId: event.restaurantId,
      retryCount: event.retryCount,
      schemaOutdated: false,
      summaryLabel: event.summaryLabel,
      updatedAt: event.updatedAt,
    });

    const connectivity = (): string => (navigator.onLine ? "online" : "offline");

    host.__srSyncBridge = {
      getSnapshot: () => ({
        events: state.events.map(uiEvent),
        lastConfirmedSyncAt: state.lastConfirmedSyncAt,
        localManualReviewCases: state.cases,
        resyncRequired: false,
        schemaOutdated: false,
        scopeRevoked: false,
        storageQuarantined: false,
        storageReady: true,
        syncing: false,
      }),
      requestResync: async () => {
        state.events = state.events.map((event) =>
          event.localState === "pending" || event.localState === "retry_wait"
            ? { ...event, localState: "accepted", updatedAt: initial.occurredAt }
            : event,
        );
        state.lastConfirmedSyncAt = initial.occurredAt;
        persist();
        return { ok: true, confirmedAt: initial.occurredAt };
      },
      retryPending: async () => {
        state.events = state.events.map((event) =>
          event.localState === "pending" || event.localState === "retry_wait"
            ? { ...event, localState: "accepted", updatedAt: initial.occurredAt }
            : event,
        );
        state.lastConfirmedSyncAt = initial.occurredAt;
        persist();
        return { confirmedAt: initial.occurredAt, ok: true };
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };

    const posSnapshot = (): Record<string, unknown> => ({
      cashRegisterOpen: true,
      cashierShiftOpen: true,
      catalog: { capturedAt: initial.occurredAt, kind: "menu", version: 7 },
      connectivity: connectivity(),
      deviceId: initial.deviceId,
      offlineCashLimitMinor: 200_000,
      offlineCashUsedMinor: 0,
      tables: { capturedAt: initial.occurredAt, kind: "tables", version: 4 },
      ticketTemplateCached: true,
    });

    host.__srOfflinePosPort = {
      commitLocalOperation: async (input: { kind: string; idempotencyKey: string }) => {
        const kind = input.kind === "order_add_line" ? "order_create" : input.kind;
        const event = record(kind);
        return { code: null, committed: true, eventId: event.eventId };
      },
      getSnapshot: () => posSnapshot(),
    };

    const buildCase = (): HarnessCase => ({
      actorId: initial.actorId,
      amountMinor: 15_000,
      auditId: null,
      baseVersion: null,
      canonicalVersion: null,
      caseId: initial.ids.caseId,
      compensatingEventId: null,
      currency: "MXN",
      deviceId: initial.deviceId,
      entityId: initial.ids.paymentEntity,
      entityType: "Payment",
      eventId: initial.ids.conflictEvent,
      financial: true,
      idempotencyKey: `${initial.runId}:${initial.deviceId}:conflict`,
      openedAt: initial.occurredAt,
      operation: "create",
      reasonCode: "PAYMENT_EXCEEDS_BALANCE",
      resolutionReason: null,
      resolvedAt: null,
      resolvedByActorId: null,
      scope: { branchId: initial.scope.branchId, restaurantId: initial.scope.restaurantId },
      schemaVersion: 1,
      status: "open",
    });

    host.__srOfflineHarness = {
      clear: () => {
        state.events = [];
        state.cases = [];
        state.lastConfirmedSyncAt = null;
        persist();
      },
      commit: (kind: string) => {
        const event = record(kind);
        return { eventId: event.eventId, idempotencyKey: event.idempotencyKey };
      },
      forceConflict: () => {
        const existing = state.events.find((candidate) => candidate.idempotencyKey === `${initial.runId}:${initial.deviceId}:conflict`);
        if (existing === undefined) {
          state.events.push({
            baseVersion: null,
            branchId: initial.scope.branchId,
            entityId: initial.ids.paymentEntity,
            entityType: "Payment",
            eventId: initial.ids.conflictEvent,
            financial: true,
            idempotencyKey: `${initial.runId}:${initial.deviceId}:conflict`,
            lastErrorCode: "PAYMENT_EXCEEDS_BALANCE",
            localSequence: state.events.length + 1,
            localState: "manual_review",
            occurredAt: initial.occurredAt,
            operation: "create",
            restaurantId: initial.scope.restaurantId,
            retryCount: 1,
            summaryLabel: "Cobro en efectivo",
            updatedAt: initial.occurredAt,
          });
        } else {
          existing.localState = "manual_review";
          existing.lastErrorCode = "PAYMENT_EXCEEDS_BALANCE";
          existing.retryCount += 1;
        }
        if (!state.cases.some((candidate) => candidate.caseId === initial.ids.caseId)) {
          state.cases.push(buildCase());
        }
        persist();
      },
      reconnect: () => {
        state.events = state.events.map((event) =>
          event.localState === "pending" || event.localState === "retry_wait"
            ? { ...event, localState: "accepted", updatedAt: initial.occurredAt }
            : event,
        );
        state.lastConfirmedSyncAt = initial.occurredAt;
        persist();
      },
      snapshot: () => JSON.parse(JSON.stringify(state)) as unknown,
    };

    host.__srNativeDialogLog = [];
    for (const [name, replacement] of [
      ["alert", () => host.__srNativeDialogLog?.push("alert")],
      ["confirm", () => {
        host.__srNativeDialogLog?.push("confirm");
        return false;
      }],
      ["prompt", () => {
        host.__srNativeDialogLog?.push("prompt");
        return null;
      }],
    ] as const) {
      Object.defineProperty(window, name, { configurable: true, value: replacement, writable: true });
    }
  }, seed);
}

export async function commitOfflineOperations(page: Page, kinds: readonly OfflineCommitKind[]): Promise<void> {
  for (const kind of kinds) {
    await page.evaluate((value: string) => {
      const harness = (window as unknown as { __srOfflineHarness?: { commit: (kind: string) => unknown } }).__srOfflineHarness;
      if (harness === undefined) throw new Error("offline harness not installed");
      harness.commit(value);
    }, kind);
  }
}

export async function readOfflineHarness(page: Page): Promise<{
    readonly events: readonly { readonly entityId: string; readonly eventId: string; readonly idempotencyKey: string; readonly localState: string; readonly entityType: string; readonly summaryLabel: string | null }[];
  readonly cases: readonly { readonly caseId: string; readonly status: string }[];
}> {
  return page.evaluate(() => {
    const harness = (window as unknown as { __srOfflineHarness?: { snapshot: () => unknown } }).__srOfflineHarness;
    if (harness === undefined) throw new Error("offline harness not installed");
    return harness.snapshot();
  }) as Promise<{
  readonly events: readonly { readonly entityId: string; readonly eventId: string; readonly idempotencyKey: string; readonly localState: string; readonly entityType: string; readonly summaryLabel: string | null }[];
    readonly cases: readonly { readonly caseId: string; readonly status: string }[];
  }>;
}

export async function forceOfflineConflict(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as unknown as { __srOfflineHarness?: { forceConflict: () => void } }).__srOfflineHarness;
    harness?.forceConflict();
  });
}

export async function reconnectOfflineHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as unknown as { __srOfflineHarness?: { reconnect: () => void } }).__srOfflineHarness;
    harness?.reconnect();
  });
}

/** Marks the browser offline and notifies the page so `OfflinePosNotice`/`SyncStatusBar` react. */
export async function goOffline(context: BrowserContext, page?: Page): Promise<void> {
  await context.setOffline(true);
  if (page !== undefined) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    }).catch(() => undefined);
  }
}

export async function goOnline(context: BrowserContext, page?: Page): Promise<void> {
  await context.setOffline(false);
  if (page !== undefined) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    }).catch(() => undefined);
  }
}

/** Registers native-dialog-free assertions and console/pageerror tracking for one page. */
export function trackOfflineDiagnostics(page: Page, testInfo: TestInfo): { readonly diagnostics: Diagnostics; readonly dialogs: string[] } {
  const diagnostics = attachDiagnostics(page, testInfo);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(`${dialog.type()}:${dialog.message()}`);
    await dialog.dismiss().catch(() => undefined);
  });
  return { diagnostics, dialogs };
}

const EXPECTED_OFFLINE_CONSOLE = [
  /Failed to fetch/iu,
  /Load failed/iu,
  /net::ERR_INTERNET_DISCONNECTED/iu,
  /net::ERR_NETWORK_CHANGED/iu,
  /net::ERR_CONNECTION_RESET/iu,
  /net::ERR_CONNECTION_REFUSED/iu,
  /ERR_NETWORK_IO_SUSPENDED/iu,
  /Failed to load resource/iu,
  /WebSocket connection to .* failed/iu,
  /\[hmr\]/iu,
  /The service worker navigation preload request was cancelled/iu,
];

/** Asserts the run left no Next overlay, no uncaught page error and no unexpected console error. */
export async function expectCleanOfflineRun(page: Page, diagnostics: Diagnostics, dialogs: readonly string[]): Promise<void> {
  expect(dialogs, "diÃ¡logos nativos (alert/confirm/prompt)").toEqual([]);
  expect(diagnostics.pageErrors, "pageerror").toEqual([]);
  expect(await hasNextErrorOverlay(page), "overlay de error de Next").toBe(false);
  const unexpected = diagnostics.consoleErrors.filter((line) => !EXPECTED_OFFLINE_CONSOLE.some((pattern) => pattern.test(line)));
  expect(unexpected, "console.error inesperado").toEqual([]);
}

/** Waits until the app shell Service Worker controls the page and has cached the static shell. */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistration()) !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("service worker ready timeout")), 25_000);
      }),
    ]);
  });
  // A first load only installs/activates the worker; reloading once makes it the controller.
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
  }
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update().catch(() => undefined);
  });
}

/** True when the served document is the static zero-PII offline shell (not the authenticated app). */
export async function isOfflineShell(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  // Stable ASCII anchors of the static shell: the retry button and the "app stays installed" copy.
  return /Reintentar conexi/iu.test(text) || /instalada en este dispositivo/iu.test(text);
}

/** Writes the harness evidence next to the other e2e reports (informational, not a deliverable). */
export function writeOfflineEvidence(name: string, body: unknown): void {
  try {
    mkdirSync("e2e-report", { recursive: true });
    writeFileSync(`e2e-report/${name}.json`, JSON.stringify(body, null, 2));
  } catch {
    /* evidence is best-effort */
  }
}
