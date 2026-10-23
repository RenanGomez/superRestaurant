import { expect, test } from "@playwright/test";

import { attachDiagnostics, expectAuthenticated, hasNextErrorOverlay } from "./helpers.ts";
import { APP_ROUTES, PUBLIC_ROUTES } from "./routes.ts";

for (const route of APP_ROUTES) {
  test(`smoke ${route.label} (${route.path})`, async ({ page }, testInfo) => {
    const diagnostics = attachDiagnostics(page, testInfo);
    await page.goto(route.path);
    expectAuthenticated(page, route.path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(await hasNextErrorOverlay(page), "overlay de error de Next").toBe(false);
    await testInfo.attach("diagnostics.json", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
    expect.soft(diagnostics.pageErrors, "pageerror").toEqual([]);
    expect.soft(diagnostics.consoleErrors, "console.error").toEqual([]);
    expect.soft(diagnostics.serverErrors, "respuestas 5xx").toEqual([]);
    expect.soft(diagnostics.failedRequests, "requests fallidas").toEqual([]);
    await testInfo.attach("pantalla.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
}

test.describe("@public", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of PUBLIC_ROUTES) {
    test(`@public carga ${route.label} (${route.path})`, async ({ page }, testInfo) => {
      const diagnostics = attachDiagnostics(page, testInfo);
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(await hasNextErrorOverlay(page), "overlay de error de Next").toBe(false);
      expect(diagnostics.pageErrors).toEqual([]);
    });
  }

  test("@public /app sin sesión redirige a /login", async ({ page }) => {
    await page.goto("/app");
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe("/login");
  });
});
