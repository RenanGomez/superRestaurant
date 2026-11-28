import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { assertBranchState, expectAuthenticated, expectFinalRoute } from "../helpers.ts";
import { assertVisualUi, trackVisualUi } from "./assert-ui.ts";

// Resumen del día en escritorio y móvil, incluida la descarga del CSV. Gated por E2E_VISUAL=1
// porque necesita el stack local y la sesión guardada con `pnpm e2e:auth`.
test.skip(!process.env.E2E_VISUAL, "requiere E2E_VISUAL=1 y entorno local");

const ROUTE = "/app/reports/day";
const CAPTURE_DIR = "docs/agentic/visual-2026-11-28";
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface ProjectViewport {
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: Readonly<Record<string, ProjectViewport>> = {
  desktop: { width: 1366, height: 800 },
  mobile: { width: 390, height: 844 },
};

test("resumen del día: totales, descarga CSV y consola/red limpias", async ({ page }) => {
  const project = test.info().project.name;
  const viewport = VIEWPORTS[project];
  test.skip(viewport === undefined, `el proyecto ${project} no mide esta pantalla`);
  if (viewport === undefined) return;
  await page.setViewportSize(viewport);
  trackVisualUi(page);

  await page.goto(ROUTE);
  expectAuthenticated(page, ROUTE);
  // Un redirect a /app (sin sucursal o sin permiso) también renderiza `main`: la ruta final lo delata.
  expectFinalRoute(page, ROUTE);
  await assertBranchState(page, ROUTE);

  await expect(page.getByRole("heading", { level: 1, name: /Resumen del día/u })).toBeVisible();
  const totals = page.getByRole("region", { name: "Totales", exact: true });
  await expect(totals).toBeVisible();
  for (const card of ["Ventas", "Propinas", "Envíos", "Canceladas"]) {
    await expect(totals.getByText(card, { exact: true })).toBeVisible();
  }

  const exportButton = page.getByRole("button", { name: "Descargar CSV", exact: true });
  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeEnabled();
  await expect(exportButton).toHaveClass(/\bmin-h-11\b/u);

  // Antes de hacer clic: el auditor enfoca con Tab desde el cuerpo, así no cae en el overlay de devtools.
  const captureDir = resolve(REPO_ROOT, CAPTURE_DIR);
  mkdirSync(captureDir, { recursive: true });
  await page.screenshot({ path: resolve(captureDir, `reports-day-${project}.png`), fullPage: true });
  await assertVisualUi(page, `reports-day-${project}`, { captureDir: CAPTURE_DIR });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    exportButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^day-summary_.+\.csv$/u);
  // No se escribe el archivo en el repo: cancel() descarta la descarga temporal del navegador.
  await download.cancel();
});
