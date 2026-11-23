import { expect, test } from "@playwright/test";

import {
  OFFLINE_COPY,
  OFFLINE_SESSION_MESSAGE,
  beforeOffline,
  buildOfflineSeed,
  commitOfflineOperations,
  expectCleanOfflineRun,
  goOffline,
  goOnline,
  installOfflineHarness,
  isOfflineShell,
  readOfflineHarness,
  reconnectOfflineHarness,
  trackOfflineDiagnostics,
  waitForServiceWorkerControl,
  writeOfflineEvidence,
} from "./fixtures/offline-helpers.ts";

/**
 * Real Phase 3 offline coverage for the Web PWA and Web POS.
 *
 * Scope note: the production IndexedDB bridge that registers `__srOfflinePosPort` /
 * `__srSyncBridge` is not wired into the UI yet (docs/agentic/debt.md, PR #59 P2), so these tests
 * install the same runtime contract deterministically (see `fixtures/offline-helpers.ts`) and then
 * assert on the real app UI, the real service worker and a real offline browser context. The
 * assertions therefore stay valid when the production bridge lands; only the seam registration is
 * replaced.
 */

test.describe("PWA shell en modo offline", () => {
  test("@offline el service worker sirve el shell estático con la red apagada", async ({ page, context }, testInfo) => {
    const { diagnostics, dialogs } = trackOfflineDiagnostics(page, testInfo);

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForServiceWorkerControl(page);

    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.status(), "manifest accesible").toBe(200);
    const manifestBody = (await manifest.json()) as { name?: string; start_url?: string };
    expect(typeof manifestBody.name, "manifest con nombre").toBe("string");
    expect(manifestBody.name?.length ?? 0).toBeGreaterThan(0);

    await goOffline(context);
    await page.goto("/app/capture", { waitUntil: "domcontentloaded" }).catch(() => undefined);

    await expect.poll(async () => isOfflineShell(page), {
      message: "el shell estático de la PWA debe servirse sin red",
      timeout: 20_000,
    }).toBe(true);
    await expect(page.getByRole("heading", { name: /Sin conexi/iu })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reintentar conexi/iu })).toBeVisible();

    await goOnline(context);
    await expectCleanOfflineRun(page, diagnostics, dialogs);
    writeOfflineEvidence("offline-pwa", { manifest: manifestBody, shellServed: true });
  });
});

test.describe("Web POS offline", () => {
  test("@offline menú/mesas cacheados legibles y operaciones prohibidas bloqueadas con mensaje", async ({ page, context }, testInfo) => {
    const scope = beforeOffline(testInfo);
    if (scope === undefined) test.skip(true, OFFLINE_SESSION_MESSAGE);
    if (scope === undefined) return;

    const { diagnostics, dialogs } = trackOfflineDiagnostics(page, testInfo);
    const seed = buildOfflineSeed(scope);
    await installOfflineHarness(page, seed);

    await page.goto("/app/capture", { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname.startsWith("/login")) test.skip(true, OFFLINE_SESSION_MESSAGE);
    await expect(page.getByRole("heading", { name: /Nueva captura/u })).toBeVisible({ timeout: 20_000 });

    await goOffline(context, page);

    const notice = page.locator('section[role="status"]').filter({ hasText: OFFLINE_COPY.workingOffline });
    await expect(notice.first()).toBeVisible({ timeout: 15_000 });
    await expect(notice.first()).toContainText(OFFLINE_COPY.cacheMenu);
    await expect(notice.first()).toContainText(OFFLINE_COPY.cacheTables);
    await expect(notice.first()).toContainText("versión 7");
    await expect(notice.first()).toContainText("versión 4");

    const blocked = notice.first().locator("details");
    await blocked.locator("summary").click();
    await expect(blocked).toContainText(OFFLINE_COPY.remoteOrigin);
    await expect(blocked).toContainText("Esta orden se creó en otro dispositivo");
    await expect(blocked).toContainText(OFFLINE_COPY.supervisor);

    await goOnline(context, page);
    await expectCleanOfflineRun(page, diagnostics, dialogs);
    writeOfflineEvidence("offline-capture-banner", { scope: seed.scope, runId: seed.runId });
  });

  test("@offline orden + efectivo + ticket pendiente sobreviven recarga sin red y sincronizan sin duplicar", async ({ page, context }, testInfo) => {
    const scope = beforeOffline(testInfo);
    if (scope === undefined) test.skip(true, OFFLINE_SESSION_MESSAGE);
    if (scope === undefined) return;

    const { diagnostics, dialogs } = trackOfflineDiagnostics(page, testInfo);
    const seed = buildOfflineSeed(scope);
    await installOfflineHarness(page, seed);

    await page.goto("/app/capture", { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname.startsWith("/login")) test.skip(true, OFFLINE_SESSION_MESSAGE);
    await expect(page.getByRole("heading", { name: /Nueva captura/u })).toBeVisible({ timeout: 20_000 });

    await goOffline(context, page);
    await commitOfflineOperations(page, ["order_create", "cash_collect", "ticket_print"]);

    const offlineState = await readOfflineHarness(page);
    expect(offlineState.events).toHaveLength(3);
    expect(offlineState.events.map((event) => event.localState)).toEqual(["pending", "pending", "pending"]);
    const idempotencyKeys = offlineState.events.map((event) => event.idempotencyKey);
    expect(new Set(idempotencyKeys).size).toBe(3);

    await expect(page.locator('section[role="status"]').filter({ hasText: OFFLINE_COPY.workingOffline }).first())
      .toContainText(OFFLINE_COPY.localSaved);

    // Full reload with the network still down: the authenticated page is intentionally never cached,
    // so the static offline shell is served; the durable local state must survive the reload.
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await expect.poll(async () => isOfflineShell(page), { timeout: 20_000 }).toBe(true);
    const afterOfflineReload = await readOfflineHarness(page);
    expect(afterOfflineReload.events).toHaveLength(3);
    expect(afterOfflineReload.events.map((event) => event.idempotencyKey)).toEqual(idempotencyKeys);

    // Reconnect: the pending operations are now visible in /app/sync and confirm exactly once.
    await goOnline(context);
    await page.goto("/app/sync", { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname.startsWith("/login")) test.skip(true, OFFLINE_SESSION_MESSAGE);
    await expect(page.getByRole("heading", { name: /Conexión y pendientes/u })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Pendientes de envío", { exact: true })).toBeVisible();
    const eventSection = page.locator('section[aria-label="Eventos en este dispositivo"]');
    await expect(eventSection).toContainText("Orden · Registrar");
    await expect(eventSection).toContainText("Cobro · Registrar");
    await expect(eventSection).toContainText("Ticket pendiente");

    await reconnectOfflineHarness(page);
    await expect(eventSection).toContainText("Confirmado", { timeout: 15_000 });
    await expect(eventSection).not.toContainText("Pendiente de envío");

    // Re-sending the same operations must reuse the same idempotency keys, never duplicate.
    await commitOfflineOperations(page, ["order_create", "cash_collect", "ticket_print"]);
    const afterResync = await readOfflineHarness(page);
    expect(afterResync.events).toHaveLength(3);
    expect(afterResync.events.map((event) => event.idempotencyKey)).toEqual(idempotencyKeys);

    await expectCleanOfflineRun(page, diagnostics, dialogs);
    writeOfflineEvidence("offline-persistence", { afterOfflineReload: afterOfflineReload.events, afterResync: afterResync.events });
  });
});
