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
