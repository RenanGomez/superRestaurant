import type { Page, TestInfo } from "@playwright/test";

export const NO_SESSION_MESSAGE = "Sin sesión: ejecuta pnpm e2e:auth";

export interface Diagnostics {
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
  readonly serverErrors: string[];
  readonly failedRequests: string[];
}

export function attachDiagnostics(page: Page, testInfo?: TestInfo): Diagnostics {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  const failedRequests: string[] = [];
  const offlineProject = testInfo?.project.name === "offline";
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (failure.includes("net::ERR_ABORTED")) return;
    if (offlineProject && failure.includes("ERR_INTERNET_DISCONNECTED")) return;
    failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
  });
  return { pageErrors, consoleErrors, serverErrors, failedRequests };
}

/** Falla con un mensaje claro si la ruta redirigió a /login (no hay sesión guardada). */
export function expectAuthenticated(page: Page, path: string): void {
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error(`${NO_SESSION_MESSAGE} (la ruta ${path} redirigió a /login)`);
  }
}

export async function hasNextErrorOverlay(page: Page): Promise<boolean> {
  // En dev, <nextjs-portal> existe siempre (indicador de Next); sólo cuenta si contiene el diálogo de error.
  const dialog = 'nextjs-portal [data-nextjs-dialog], nextjs-portal [data-nextjs-dialog-overlay], nextjs-portal [role="dialog"]';
  if ((await page.locator(dialog).count()) > 0) return true;
  const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return /Application error|Unhandled Runtime Error/i.test(text);
}

export const DESTRUCTIVE =
  /eliminar|borrar|quitar|cancelar|cerrar sesion|salir|logout|cobrar|pagar|confirmar|publicar|enviar a cocina|guardar|crear|nueva|nuevo|abrir cuenta|abrir turno|cerrar caja|cerrar turno|sin venta|transferir|desactivar|asignar|marcar|imprimir|subir|convertir|reintentar/i;

/** Compara sin distinguir mayúsculas ni acentos. */
export function isDestructive(text: string): boolean {
  return DESTRUCTIVE.test(text.normalize("NFD").replace(/\p{M}/gu, ""));
}

export const SIN_SUCURSAL_TEXT = "Sin sucursales asignadas";
export const ELIGE_SUCURSAL_TEXT = "Elige tu sucursal";

export interface BranchSelection {
  readonly selected: boolean;
  readonly branchLabel: string | null;
}

const ACTIVE_BRANCH = /Sucursal activa/;
export const MAIN_NAV_SELECTOR = 'nav[aria-label="Navegación principal"]';
const MAIN_NAV = MAIN_NAV_SELECTOR;

async function readBranchLabel(page: Page): Promise<string | null> {
  const text = await page.locator(MAIN_NAV).first().innerText({ timeout: 2_000 }).catch(() => "");
  const label = text.replace(/\s+/g, " ").trim().slice(0, 80);
  return label === "" ? null : label;
}

/** Si la app pide elegir sucursal, elige una, confirma y vuelve a la ruta pedida. Falla si no hay sucursal utilizable. */
export async function ensureBranchSelected(page: Page, path: string): Promise<BranchSelection> {
  const chooser = page.getByText(ELIGE_SUCURSAL_TEXT, { exact: false }).first();
  const active = page.locator(MAIN_NAV).getByText(ACTIVE_BRANCH).first();
  const empty = page.getByText(SIN_SUCURSAL_TEXT, { exact: false }).first();
  await chooser.or(empty).or(active).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  if (await empty.isVisible().catch(() => false)) {
    throw new Error(`Sin sucursal: ${SIN_SUCURSAL_TEXT}`);
  }
  if (!(await chooser.isVisible().catch(() => false))) {
    return { selected: false, branchLabel: await readBranchLabel(page) };
  }
  const wanted = process.env.E2E_BRANCH;
  const radios = page.locator('input[name="scope"]');
  const radio = wanted === undefined || wanted === "" ? radios.first() : page.getByLabel(wanted).first();
  await radio.check({ timeout: 5_000 });
  await Promise.all([
    page.waitForURL(() => true, { timeout: 15_000 }).catch(() => undefined),
    page.getByRole("button", { name: "Confirmar sucursal" }).click({ noWaitAfter: false, timeout: 5_000 }),
  ]);
  await page.locator(MAIN_NAV).getByText(ACTIVE_BRANCH).first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    if (await page.getByText(SIN_SUCURSAL_TEXT, { exact: false }).first().isVisible().catch(() => false)) {
      throw new Error(`Sin sucursal: ${SIN_SUCURSAL_TEXT}`);
    }
    if (!(await page.getByText(ELIGE_SUCURSAL_TEXT, { exact: false }).first().isVisible().catch(() => false))) {
      return { selected: true, branchLabel: await readBranchLabel(page) };
    }
  }
  throw new Error("Sin sucursal: la selección no persistió tras confirmar");
}

/** Devuelve el texto del aviso «No tienes autorización…» si el main lo muestra para esta cuenta. */
export async function detectUnauthorized(page: Page): Promise<string | null> {
  const alerts = page.locator('main [role="alert"]');
  const total = await alerts.count().catch(() => 0);
  for (let i = 0; i < total; i += 1) {
    const text = (await alerts.nth(i).innerText({ timeout: 2_000 }).catch(() => "")).replace(/\s+/g, " ").trim();
    if (text.startsWith("No tienes autorización")) return text;
  }
  return null;
}

/** Falla si la ruta final no es la pedida (salvo /app). */
export function expectFinalRoute(page: Page, path: string): void {
  const finalPath = new URL(page.url()).pathname;
  if (path !== "/app" && finalPath !== path) {
    throw new Error(`La ruta ${path} redirigió a ${finalPath}`);
  }
}

export const MIN_MAIN_TEXT = 20;

/** Guarda de estado (no de cantidad): sucursal activa, sin pantallas de selección y main con contenido. Devuelve la longitud del texto de main. */
export async function assertBranchState(page: Page, path: string): Promise<number> {
  const mainText = (await page.locator("main").first().innerText({ timeout: 5_000 }).catch(() => "")).trim();
  const problems: string[] = [];
  if (path !== "/app" && !(await page.locator(MAIN_NAV).getByText(ACTIVE_BRANCH).first().isVisible().catch(() => false))) {
    problems.push("el nav no muestra «Sucursal activa»");
  }
  if (mainText.includes(ELIGE_SUCURSAL_TEXT)) problems.push(`main muestra «${ELIGE_SUCURSAL_TEXT}»`);
  if (mainText.includes(SIN_SUCURSAL_TEXT)) problems.push(`main muestra «${SIN_SUCURSAL_TEXT}»`);
  if (mainText.length < MIN_MAIN_TEXT) problems.push(`main casi vacío (${mainText.length} caracteres)`);
  if (problems.length > 0) throw new Error(`Estado inválido en ${path}: ${problems.join("; ")}`);
  return mainText.length;
}

/** Cierra un diálogo abierto pulsando «Cerrar», «Cancelar» o aria-label="Cerrar". Devuelve true si pulsó alguno. */
export async function closeOpenDialog(page: Page): Promise<boolean> {
  const dialog = page.locator('[role="dialog"]:visible').first();
  if ((await dialog.count()) === 0) return false;
  const closer = dialog
    .locator('button[aria-label="Cerrar"]')
    .or(dialog.getByRole("button", { name: /^(cerrar|cancelar)$/i }))
    .first();
  if ((await closer.count()) === 0) return false;
  try {
    await closer.click({ timeout: 2_000, noWaitAfter: true });
    return true;
  } catch {
    return false;
  }
}

export const NEXT_DEVTOOLS = /Next\.js Dev Tools/i;
export const SAFE_NAMES: readonly RegExp[] = [/^confirmar sucursal$/i];
