import { expect, test } from "@playwright/test";

import { assertBranchState, ensureBranchSelected, expectAuthenticated, expectFinalRoute } from "../helpers.ts";
import { assertVisualUi, trackVisualUi } from "./assert-ui.ts";

test.skip(!process.env.E2E_VISUAL, "requiere E2E_VISUAL=1 y entorno local");

const KDS_OFFLINE_ROUTE = "/app/sync";

interface Viewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly Viewport[] = [
  { label: "kds-offline-desktop", width: 1280, height: 800 },
  { label: "kds-offline-mobile", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`KDS offline ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`@offline-visual ${viewport.label} ${KDS_OFFLINE_ROUTE}`, async ({ page }) => {
      trackVisualUi(page);
      await page.goto(KDS_OFFLINE_ROUTE);
      expectAuthenticated(page, KDS_OFFLINE_ROUTE);
      await ensureBranchSelected(page, KDS_OFFLINE_ROUTE);
      // No silent catch: a screen that never settles must fail the pass, not be skipped.
      await page.waitForLoadState("networkidle", { timeout: 20_000 });
      // A redirect to /app or /login would still render a visible `main`; assert the real route
      // and the branch state so a broken offline screen cannot produce a green visual pass.
      expectFinalRoute(page, KDS_OFFLINE_ROUTE);
      await expect(page.locator("main").first()).toBeVisible();
      const mainLength = await assertBranchState(page, KDS_OFFLINE_ROUTE);
      expect(mainLength).toBeGreaterThan(0);
      await assertVisualUi(page, viewport.label);
    });
  });
}
