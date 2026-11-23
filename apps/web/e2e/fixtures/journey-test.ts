import { expect, test as base, type Locator, type Page, type TestInfo } from "@playwright/test";

import {
  attachDiagnostics, ensureBranchSelected, expectAuthenticated, expectFinalRoute, hasNextErrorOverlay,
  type Diagnostics,
} from "../helpers.ts";
import { createJourneyApi, type CaptureTrayItem, type JourneyApi, type OpenRegisterHandle } from "./journey-api.ts";
import { escapeRegExp, hasJourneySession, journeyBaseUrl, NO_SESSION_MESSAGE } from "./journey-env.ts";

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

/** Waits until the tray reports a draft that was not there before and matches this run's marker. */
export async function waitForNewDraft(
  api: JourneyApi,
  before: ReadonlySet<string>,
  matches: (item: CaptureTrayItem) => boolean,
): Promise<CaptureTrayItem> {
  let found: CaptureTrayItem | undefined;
  await expect.poll(async () => {
    const tray = await api.listTray();
    found = tray.items.find((item) => !before.has(item.captureDraftId) && matches(item));
    return found !== undefined;
  }, { message: "No apareció el borrador del run en la bandeja de captura", timeout: 30_000, intervals: [500, 1_000] }).toBe(true);
  if (found === undefined) throw new Error("No apareció el borrador del run en la bandeja de captura");
  return found;
}

/**
 * Registers a cleanup sweep BEFORE the UI creates a draft. At teardown it closes only the drafts
 * that appeared after `before` and still match this run's marker, so it never touches another
 * operator's drafts and still runs when the test fails before it knows the new id.
 */
export function registerDraftSweep(
  cleanup: CleanupStack,
  api: JourneyApi,
  before: ReadonlySet<string>,
  matches: (item: CaptureTrayItem) => boolean,
  label: string,
): void {
  cleanup.add(`barrer borradores del ${label}`, async () => {
    const tray = await api.listTray();
    for (const item of tray.items) {
      if (!before.has(item.captureDraftId) && matches(item)) await api.closeDraft(item.captureDraftId);
    }
  });
}

/** Skips with a clear message when the branch has no published catalog to capture against. */
export async function requireCatalog(api: JourneyApi): Promise<void> {
  const catalog = (await api.menuCatalog()).catalog;
  if (catalog === null) {
    test.skip(true, "La sucursal no tiene catálogo publicado; siembra uno de pruebas antes de correr journeys");
    throw new Error("Sin catálogo");
  }
}

/** Skips unless the catalog has the exact pizza, size, flavors and crust the specs configure. */
export async function requirePizzaCatalog(api: JourneyApi): Promise<void> {
  const catalog = (await api.menuCatalog()).catalog;
  const product = catalog?.products.find((candidate) => candidate.active && candidate.name === "Pizza Personalizada");
  const variant = product?.variants?.find((candidate) => candidate.active && candidate.name === "Grande");
  const groups = catalog?.modifierGroups ?? [];
  const ingredients = groups.find((group) => group.active && group.name === "Ingredientes");
  const crust = groups.find((group) => group.active && group.name === "Orillas");
  const flavorsOk = ["Salchicha", "Tocino"].every((name) => ingredients?.options.some((option) => option.active && option.name === name));
  const crustOk = ["Pay Pizza", "Orilla de Queso"].every((name) => crust?.options.some((option) => option.active && option.name === name));
  if (catalog === null || product === undefined || variant === undefined || ingredients === undefined || crust === undefined
    || !flavorsOk || !crustOk) {
    test.skip(true, "Falta el catálogo sembrado: Pizza Personalizada / Grande / Ingredientes (Salchicha, Tocino) / Orillas (Pay Pizza, Orilla de Queso)");
    throw new Error("Catálogo de pizza incompleto");
  }
}

/** Skips unless the branch can seed a draft order with its first sellable product and an open shift. */
export async function requireOrderSeed(api: JourneyApi): Promise<void> {
  const catalog = (await api.menuCatalog()).catalog;
  const product = catalog?.products.find((candidate) => candidate.active
    && (candidate.variants ?? []).some((variant) => variant.active));
  const shift = (await api.listActiveShifts()).shifts.find((candidate) => candidate.status === "open");
  if (product === undefined || shift === undefined) {
    test.skip(true, "Falta un producto vendible con tamaño o un turno operativo abierto para sembrar la orden");
    throw new Error("Precondiciones de orden incompletas");
  }
}

/** Skips with a clear message when the branch has no open operational shift. */
export async function requireActiveShift(api: JourneyApi): Promise<string> {
  const shift = (await api.listActiveShifts()).shifts.find((candidate) => candidate.status === "open");
  if (shift === undefined) {
    test.skip(true, "No hay turno operativo abierto; ábrelo en Caja antes de correr journeys");
    throw new Error("Sin turno operativo abierto");
  }
  return shift.shiftId;
}

/**
 * MXN amounts for the checked-in seeded catalog: two decimals, no float math kept beyond the
 * integer minor units. Accepts the integers the API returns so tests never re-price a sale.
 */
export function pesosInput(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

/**
 * Opens a register through the API and points the browser's cash cookies at it before the UI is
 * touched. Cleanup is registered first, so a failure after this point still closes the register.
 */
export async function openRegisterForRun(
  page: Page,
  api: JourneyApi,
  cleanup: CleanupStack,
  shiftId: string,
  openingFloatMinor: number,
  label: string,
): Promise<OpenRegisterHandle> {
  const register = await api.openRegister(shiftId, openingFloatMinor);
  cleanup.add(`cerrar la caja del ${label}`, () => api.closeRegister(register));
  const baseUrl = journeyBaseUrl();
  await page.context().addCookies([
    { name: "sr-register-id", value: register.registerId, url: baseUrl },
    { name: "sr-device-id", value: register.deviceId, url: baseUrl },
    { name: "sr-cash-session-id", value: register.cashRegisterSessionId, url: baseUrl },
  ]);
  return register;
}

/** Opens the order detail panel owned by the URL, the same entry point journey 6 uses. */
export async function openOrderDetail(page: Page, orderId: string): Promise<Locator> {
  await page.goto(`/app/orders?orderId=${encodeURIComponent(orderId)}`);
  await assertAppPage(page, "/app/orders");
  const panel = page.getByRole("region", { name: "Detalle de la orden" });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}

/** Collects the exact remaining balance in cash from an open checkout page. */
export async function payExactCash(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Exacto" }).click();
  await expect(page.getByText(/Cambio después de propina/u)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Cobrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Cobro registrado|Recibo no disponible/u })).toBeVisible({ timeout: 25_000 });
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
