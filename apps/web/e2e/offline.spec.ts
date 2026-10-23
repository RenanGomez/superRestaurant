// Documenta el comportamiento actual al cortar la red. El web no tiene soporte offline todavía
// (Fase 3 del plan); esta prueba sólo registra qué pasa y exige que la ruta se recupere al reconectar.
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { attachDiagnostics, expectAuthenticated, hasNextErrorOverlay } from "./helpers.ts";
import { APP_ROUTES } from "./routes.ts";

interface OfflineRecord {
  route: string;
  pageErrors: string[];
  overlay: boolean;
  bodyTextSnippet: string;
  url: string;
}

const records: OfflineRecord[] = [];

for (const route of APP_ROUTES) {
  test(`@offline ${route.label} (${route.path})`, async ({ page, context }, testInfo) => {
    const diagnostics = attachDiagnostics(page, testInfo);
    await page.goto(route.path);
    expectAuthenticated(page, route.path);
    await page.waitForLoadState("networkidle").catch(() => undefined);

    await context.setOffline(true);
    try {
      const links = page.locator('nav[aria-label="Navegación principal"] a[href]');
      const count = await links.count();
      for (let i = 0; i < count; i += 1) {
        const href = await links.nth(i).getAttribute("href");
        if (href !== null && href !== route.path) {
          await links.nth(i).click({ timeout: 3_000, noWaitAfter: true }).catch(() => undefined);
          break;
        }
      }
      await page.waitForTimeout(3_000);
      const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      const record: OfflineRecord = {
        route: route.path,
        pageErrors: [...diagnostics.pageErrors],
        overlay: await hasNextErrorOverlay(page),
        bodyTextSnippet: text.slice(0, 300),
        url: page.url(),
      };
      records.push(record);
      expect.soft(record.pageErrors, "pageerror sin red").toEqual([]);
    } finally {
      await context.setOffline(false);
    }

    await page.goto(route.path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(await hasNextErrorOverlay(page), "overlay tras reconectar").toBe(false);
  });
}

test.afterAll(() => {
  mkdirSync("e2e-report", { recursive: true });
  writeFileSync("e2e-report/offline-offline.json", JSON.stringify(records, null, 2));
});
