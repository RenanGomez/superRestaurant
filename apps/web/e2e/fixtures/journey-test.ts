import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

import {
  attachDiagnostics, ensureBranchSelected, expectAuthenticated, expectFinalRoute, hasNextErrorOverlay,
  type Diagnostics,
} from "../helpers.ts";
import { createJourneyApi, type CaptureTrayItem, type JourneyApi } from "./journey-api.ts";
import { escapeRegExp, hasJourneySession, NO_SESSION_MESSAGE } from "./journey-env.ts";

export interface CleanupStep {
  readonly name: string;
  readonly run: () => Promise<void>;
}

export class CleanupStack {
  private readonly steps: CleanupStep[] = [];

  public add(name: string, run: () => Promise<void>): void {
    this.steps.push({ name, run });
  }

  public async run(): Promise<void> {
    const errors: string[] = [];
    for (const step of [...this.steps].reverse()) {
      try {
        await step.run();
      } catch (error: unknown) {
        errors.push(`${step.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.steps.length = 0;
    if (errors.length > 0) throw new Error(`Cleanup incompleto:\n- ${errors.join("\n- ")}`);
  }
}

interface JourneyFixtures {
  readonly api: JourneyApi;
  readonly cleanup: CleanupStack;
  readonly diag: Diagnostics;
  readonly runId: string;
}

function slug(value: string): string {
  return value.normalize("NFD").replace(/[^\w]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 40).toLowerCase();
}

export const test = base.extend<JourneyFixtures>({
  diag: [async ({ page }, use, testInfo) => {
    const diagnostics = attachDiagnostics(page, testInfo);
    await use(diagnostics);
    await testInfo.attach("diagnostics.json", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
    if (testInfo.status !== testInfo.expectedStatus) return;
    expect.soft(diagnostics.pageErrors, "pageerror").toEqual([]);
    expect.soft(diagnostics.consoleErrors, "console.error").toEqual([]);
    expect.soft(diagnostics.serverErrors, "respuestas 5xx").toEqual([]);
    expect.soft(diagnostics.failedRequests, "requests fallidas").toEqual([]);
  }, { auto: true }],

  runId: async ({}, use, testInfo) => {
    const base = process.env.E2E_RUN_ID ?? `${new Date().toISOString().replace(/\D/gu, "").slice(0, 14)}-${testInfo.workerIndex}`;
    await use(`${slug(testInfo.title)}-${base}`.slice(0, 80));
  },

  api: async ({ runId }, use) => {
    const api = createJourneyApi(runId);
    if (api === undefined) {
      test.skip(true, NO_SESSION_MESSAGE);
      throw new Error(NO_SESSION_MESSAGE);
    }
    await use(api);
  },

  cleanup: async ({}, use) => {
    const cleanup = new CleanupStack();
    await use(cleanup);
    await cleanup.run();
  },
});

export { expect };

/** Journeys run on desktop only and need the saved operator session. */
export function beforeJourney(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== "desktop", "Los journeys se ejecutan en el proyecto desktop");
  test.skip(!hasJourneySession(), NO_SESSION_MESSAGE);
}

export async function assertAppPage(page: Page, path: string): Promise<void> {
  expectAuthenticated(page, path);
  await ensureBranchSelected(page, path);
  expectFinalRoute(page, path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  expect(await hasNextErrorOverlay(page), "overlay de error de Next").toBe(false);
}

export async function openCapture(page: Page): Promise<void> {
  await page.goto("/app/capture");
  await assertAppPage(page, "/app/capture");
  await expect(page.getByRole("heading", { name: "Nueva captura", exact: true })).toBeVisible();
  await expect(page.getByText("Crea o recupera un borrador para comenzar.")).toBeVisible();
}

export async function openCaja(page: Page): Promise<void> {
  await page.goto("/app/caja");
  await assertAppPage(page, "/app/caja");
}

export async function newTrayIds(api: JourneyApi): Promise<ReadonlySet<string>> {
  const tray = await api.listTray();
  return new Set(tray.items.map((item) => item.captureDraftId));
}

/** Waits until the tray reports a draft that was not there before this journey started. */
export async function waitForNewDraft(
  api: JourneyApi,
  before: ReadonlySet<string>,
  matches?: (item: CaptureTrayItem) => boolean,
): Promise<CaptureTrayItem> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tray = await api.listTray();
    const found = tray.items.find((item) => !before.has(item.captureDraftId) && (matches === undefined || matches(item)));
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("No apareció el borrador nuevo en la bandeja de captura");
}

export async function startCounterCapture(page: Page): Promise<void> {
  await page.getByLabel("Cumplimiento", { exact: true }).selectOption("counter");
  await page.getByRole("button", { name: "Nueva captura", exact: true }).click();
  await expect(page.getByText("Borrador abierto.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("capture-menu-section")).toBeVisible();
}

export async function startPickupCapture(page: Page, name: string): Promise<void> {
  await page.getByLabel("Cumplimiento", { exact: true }).selectOption("pickup");
  await page.getByLabel("Nombre de quien recoge", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Nueva captura", exact: true }).click();
  await expect(page.getByText("Borrador abierto.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("capture-menu-section")).toBeVisible();
}

export async function searchCustomer(page: Page, customerName: string): Promise<void> {
  const search = page.getByRole("combobox", { name: "Buscar cliente" });
  await page.getByLabel("Buscar por", { exact: true }).selectOption("name");
  await search.fill(customerName);
  const option = page.getByRole("option", { name: new RegExp(`^${escapeRegExp(customerName)}`) }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  const party = page.getByLabel("Cliente y canal de la captura");
  await expect(party.getByText(customerName, { exact: false }).first()).toBeVisible();
}

export async function startDeliveryCapture(page: Page, customerName: string): Promise<void> {
  await searchCustomer(page, customerName);
  await page.getByLabel("Cumplimiento", { exact: true }).selectOption("delivery");
  await page.getByRole("button", { name: `Nueva captura para ${customerName}`, exact: false }).click();
  await expect(page.getByText("Borrador abierto.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("capture-menu-section")).toBeVisible();
}

async function openCatalogProduct(page: Page, productName: string): Promise<void> {
  const search = page.getByLabel("Buscar producto", { exact: true });
  await search.fill(productName);
  const tile = page.getByTestId("capture-menu").getByRole("button", { name: new RegExp(escapeRegExp(productName)) }).first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await tile.click();
}

/** Opens the current catalog's configured pizza and adds it whole with the first paid crust. */
export async function addWholePizza(page: Page, note: string, productName = "Pizza Personalizada"): Promise<void> {
  await openCatalogProduct(page, productName);
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /^Grande/ }).click();
  await sheet.getByRole("button", { name: /Pay Pizza/ }).click();
  await sheet.getByPlaceholder("Ej. sin cebolla, bien cocida").fill(note);
  await sheet.locator("footer").getByRole("button", { name: /^Agregar/ }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });
  await expect(page.getByLabel("Resumen del pedido")).toContainText(productName);
}

/** Adds a half-and-half pizza: size, both flavors, crust and a kitchen note. */
export async function addHalfAndHalfPizza(
  page: Page,
  options: { readonly note: string; readonly productName?: string; readonly flavors?: readonly [string, string] },
): Promise<void> {
  const productName = options.productName ?? "Pizza Personalizada";
  const [leftFlavor, rightFlavor] = options.flavors ?? ["Salchicha", "Tocino"];
  await openCatalogProduct(page, productName);
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /^Grande/ }).click();
  await sheet.getByRole("button", { name: "Mitad y mitad", exact: true }).click();
  await sheet.locator('section[aria-label="Mitad A"]').getByRole("button", { name: new RegExp(leftFlavor) }).click();
  await sheet.locator('section[aria-label="Mitad B"]').getByRole("button", { name: new RegExp(rightFlavor) }).click();
  await sheet.getByRole("button", { name: /Orilla de Queso/ }).click();
  await sheet.getByPlaceholder("Ej. sin cebolla, bien cocida").fill(options.note);
  await sheet.locator("footer").getByRole("button", { name: /^Agregar/ }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });
  await expect(page.getByLabel("Resumen del pedido")).toContainText(productName);
}

/** Finds the "Borradores recuperables" row that belongs to this run and claims it. */
export async function recoverDraftRow(page: Page, matches: RegExp): Promise<void> {
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Borradores recuperables" }) });
  const row = section.getByRole("button").filter({ hasText: matches }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText("Borrador abierto.", { exact: true })).toBeVisible({ timeout: 30_000 });
}
