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

/** Si la app pide elegir sucursal, elige una, confirma y vuelve a la ruta pedida. Falla si no hay sucursal utilizable. */
export async function ensureBranchSelected(page: Page, path: string): Promise<void> {
  const chooser = page.getByText(ELIGE_SUCURSAL_TEXT, { exact: false }).first();
  const empty = page.getByText(SIN_SUCURSAL_TEXT, { exact: false }).first();
  if (await empty.isVisible().catch(() => false)) {
    throw new Error(`Sin sucursal: ${SIN_SUCURSAL_TEXT}`);
  }
  if (await chooser.isVisible().catch(() => false)) {
    const wanted = process.env.E2E_BRANCH;
    const radios = page.locator('input[name="scope"]');
    const radio = wanted === undefined || wanted === "" ? radios.first() : page.getByLabel(wanted).first();
    await radio.check({ timeout: 5_000 });
    await page.getByRole("button", { name: "Confirmar sucursal" }).click({ noWaitAfter: false, timeout: 5_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    if (await page.getByText(ELIGE_SUCURSAL_TEXT, { exact: false }).first().isVisible().catch(() => false)) {
      throw new Error(`Sin sucursal: sigue visible «${ELIGE_SUCURSAL_TEXT}» tras confirmar`);
    }
    if (await page.getByText(SIN_SUCURSAL_TEXT, { exact: false }).first().isVisible().catch(() => false)) {
      throw new Error(`Sin sucursal: ${SIN_SUCURSAL_TEXT}`);
    }
  }
}

/** Falla si la ruta final no es la pedida (salvo /app). */
export function expectFinalRoute(page: Page, path: string): void {
  const finalPath = new URL(page.url()).pathname;
  if (path !== "/app" && finalPath !== path) {
    throw new Error(`La ruta ${path} redirigió a ${finalPath}`);
  }
}

export const NEXT_DEVTOOLS = /Next\.js Dev Tools/i;
export const SAFE_NAMES: readonly RegExp[] = [/^confirmar sucursal$/i];
