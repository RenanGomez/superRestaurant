import { expect, test } from "@playwright/test";

import { INVENTORY_TAB_LABELS, INVENTORY_TABS } from "../../src/lib/inventory-ui.ts";
import { ensureBranchSelected, expectAuthenticated } from "../helpers.ts";
import { assertVisualUi, trackVisualUi } from "./assert-ui.ts";

// Inventario completo: las seis pestanas en escritorio y en movil. Gated por E2E_VISUAL=1 porque
// necesita el stack local levantado y la sesion guardada con `pnpm e2e:auth`.
test.skip(!process.env.E2E_VISUAL, "requiere E2E_VISUAL=1 y entorno local");

const CAPTURE_DIR = "docs/agentic/visual-verify-2026-11-26";

interface Viewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly Viewport[] = [
  { label: "inventario-desktop", width: 1366, height: 800 },
  { label: "inventario-mobile", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`Inventario ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const tab of INVENTORY_TABS) {
      test(`@visual-inventario ${viewport.label} ${tab}`, async ({ page }) => {
        trackVisualUi(page);
        const route = `/app/inventario?tab=${tab}`;
        await page.goto(route);
        expectAuthenticated(page, route);
        await ensureBranchSelected(page, route);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await expect(page.getByRole("tab", { name: INVENTORY_TAB_LABELS[tab], exact: true }))
          .toHaveAttribute("aria-selected", "true");
        await expect(page.locator("main").first()).toBeVisible();
        await assertVisualUi(page, `${viewport.label}-${tab}`, { captureDir: CAPTURE_DIR });
      });
    }
  });
}
