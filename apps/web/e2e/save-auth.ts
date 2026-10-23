// Abre Chrome para que una persona inicie sesión manualmente y guarda la sesión (storageState).
// Ningún script escribe credenciales; nunca se imprimen cookies.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8082";
const AUTH_DIR = "playwright/.auth";
const AUTH_FILE = `${AUTH_DIR}/user.json`;

mkdirSync(AUTH_DIR, { recursive: true });
console.log(`Se abrirá Chrome en ${baseURL}/login.`);
console.log("Inicia sesión a mano; tienes hasta 10 minutos. Al llegar a /app la sesión se guarda y el navegador se cierra.");

const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
  const context = await browser.newContext({ baseURL, locale: "es-MX", timezoneId: "America/Mexico_City" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.waitForURL(/\/app(\/|\?|$)/, { timeout: 10 * 60_000 });
  await context.storageState({ path: AUTH_FILE });
  console.log(`Sesión guardada en apps/web/${AUTH_FILE} (ignorada por git).`);
} finally {
  await browser.close();
}
