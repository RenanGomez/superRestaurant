import { existsSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  OFFLINE_COPY,
  OFFLINE_SESSION_MESSAGE,
  beforeOffline,
  buildOfflineSeed,
  commitOfflineOperations,
  expectCleanOfflineRun,
  forceOfflineConflict,
  goOffline,
  goOnline,
  installOfflineHarness,
  readOfflineHarness,
  trackOfflineDiagnostics,
  writeOfflineEvidence,
} from "./fixtures/offline-helpers.ts";
import { authStatePath, journeyBaseUrl } from "./fixtures/journey-env.ts";

/**
 * Two isolated browser contexts represent two offline POS devices working on the same table/order.
 * Each context keeps its own durable local state (localStorage in the harness, IndexedDB in
 * production) and its own deviceId, so the same physical order receives distinct idempotency keys.
 * After reconnecting, `/app/sync` must surface the conflict and the audited manual-review flow,
 * never `alert`/`confirm`/`prompt` and never an uncaught page error.
 */

async function openOfflineDevice(
  context: BrowserContext,
  testInfo: Parameters<typeof trackOfflineDiagnostics>[1],
): Promise<{ readonly page: Page; readonly diagnostics: ReturnType<typeof trackOfflineDiagnostics>["diagnostics"]; readonly dialogs: readonly string[] }> {
  const page = await context.newPage();
  const tracked = trackOfflineDiagnostics(page, testInfo);
  return { diagnostics: tracked.diagnostics, dialogs: tracked.dialogs, page };
}

test.describe("conflicto offline entre dos dispositivos", () => {
  test("@offline dos contextos aislados detectan conflicto y abren manual_review en /app/sync", async ({ browser }, testInfo) => {
    const scope = beforeOffline(testInfo);
    if (scope === undefined) test.skip(true, OFFLINE_SESSION_MESSAGE);
    if (scope === undefined) return;

    const statePath = authStatePath();
    const storageState = existsSync(statePath) ? statePath : undefined;
    if (storageState === undefined) test.skip(true, OFFLINE_SESSION_MESSAGE);

    const contexts: BrowserContext[] = [];
    try {
      const contextA = await browser.newContext({
        baseURL: journeyBaseUrl(),
        locale: "es-MX",
        timezoneId: "America/Mexico_City",
        viewport: { height: 900, width: 1440 },
        ...(storageState === undefined ? {} : { storageState }),
      });
      const contextB = await browser.newContext({
        baseURL: journeyBaseUrl(),
        locale: "es-MX",
        timezoneId: "America/Mexico_City",
        viewport: { height: 900, width: 1440 },
        ...(storageState === undefined ? {} : { storageState }),
      });
      contexts.push(contextA, contextB);

      const seedA = buildOfflineSeed(scope, undefined, 0);
      const seedB = buildOfflineSeed(scope, seedA.runId, 1);
      await installOfflineHarness(contextA, seedA);
      await installOfflineHarness(contextB, seedB);

      const deviceA = await openOfflineDevice(contextA, testInfo);
      const deviceB = await openOfflineDevice(contextB, testInfo);

      for (const device of [deviceA, deviceB]) {
        await device.page.goto("/app/capture", { waitUntil: "domcontentloaded" });
        if (new URL(device.page.url()).pathname.startsWith("/login")) test.skip(true, OFFLINE_SESSION_MESSAGE);
        await expect(device.page.getByRole("heading", { name: /Nueva captura/u })).toBeVisible({ timeout: 20_000 });
      }

      await goOffline(contextA, deviceA.page);
      await goOffline(contextB, deviceB.page);

      // Both devices work on the same order and record their own cash collection with distinct keys.
      await commitOfflineOperations(deviceA.page, ["order_create", "cash_collect"]);
      await commitOfflineOperations(deviceB.page, ["order_create", "cash_collect"]);

      const pendingA = await readOfflineHarness(deviceA.page);
      const pendingB = await readOfflineHarness(deviceB.page);
      const orderA = pendingA.events.find((event) => event.entityType === "Order");
      const orderB = pendingB.events.find((event) => event.entityType === "Order");
      expect(orderA?.entityId, "misma orden en ambos dispositivos").toBe(orderB?.entityId);
      const paymentKeysA = pendingA.events.filter((event) => event.entityType === "Payment").map((event) => event.idempotencyKey);
      const paymentKeysB = pendingB.events.filter((event) => event.entityType === "Payment").map((event) => event.idempotencyKey);
      expect(paymentKeysA).toHaveLength(1);
      expect(paymentKeysB).toHaveLength(1);
      expect(paymentKeysA[0], "claves de idempotencia distintas por dispositivo").not.toBe(paymentKeysB[0]);

      // Reconnecting flags both pending payments for audited manual review.
      await forceOfflineConflict(deviceA.page);
      await forceOfflineConflict(deviceB.page);
      await goOnline(contextA);
      await goOnline(contextB);

      for (const device of [deviceA, deviceB]) {
        await device.page.goto("/app/sync", { waitUntil: "domcontentloaded" });
        if (new URL(device.page.url()).pathname.startsWith("/login")) test.skip(true, OFFLINE_SESSION_MESSAGE);
        await expect(device.page.getByRole("heading", { name: /Conexión y pendientes/u })).toBeVisible({ timeout: 20_000 });
      }

      const syncPage = deviceA.page;
      const summary = syncPage.locator('section[aria-label="Resumen de conectividad"]');
      await expect(summary).toHaveAttribute("data-connectivity-state", "sync_blocked");
      await expect(summary).toContainText(OFFLINE_COPY.financialConflict);

      const eventSection = syncPage.locator('section[aria-label="Eventos en este dispositivo"]');
      await expect(eventSection).toContainText(OFFLINE_COPY.reviewState);
      await expect(eventSection).toContainText("Financiero");
      await expect(eventSection.getByRole("button", { name: "Ir a revisión" }).first()).toBeVisible();

      const reviewSection = syncPage.locator('section[aria-label="Revisión manual de supervisores"]');
      await expect(reviewSection).toContainText("Caso #1");
      await expect(reviewSection).toContainText("Pendiente de revisión");
      await expect(reviewSection).toContainText(/\$\s?150\.00/u);

      const resolveButton = reviewSection.getByRole("button", { name: OFFLINE_COPY.resolveCase }).first();
      if ((await resolveButton.count()) === 0) {
        test.skip(true, "La cuenta guardada no tiene rol de supervisión para resolver manual_review");
      }
      await resolveButton.click();

      const dialog = syncPage.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: /Resolver cobro/u })).toBeVisible();
      await dialog.getByRole("button", { name: "Descartar cambio pendiente" }).click();
      await dialog.getByLabel("Motivo de la resolución (obligatorio)").fill("Se verificó el comprobante de caja del run E2E; no se cobra dos veces.");
      await expect(dialog.getByRole("button", { name: "Confirmar resolución" })).toBeEnabled();
      // Cancel instead of submitting: the harness case is local evidence, never a server mutation.
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await expect(dialog).toBeHidden();

      for (const device of [deviceA, deviceB]) {
        await expectCleanOfflineRun(device.page, device.diagnostics, device.dialogs);
      }

      writeOfflineEvidence("offline-conflict", {
        deviceAPaymentKeys: paymentKeysA,
        deviceBPaymentKeys: paymentKeysB,
        orderEntityId: orderA?.entityId ?? null,
        runId: seedA.runId,
      });
    } finally {
      for (const context of contexts) await context.close().catch(() => undefined);
    }
  });
});
