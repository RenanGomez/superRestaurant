// Copia la sesión de superRestaurant que ya tiene tu Chrome normal (cookies y
// localStorage de http://localhost:8082 únicamente) al archivo que usan las
// pruebas E2E: apps/web/playwright/.auth/user.json. Nada de otros sitios se toca.
// Requiere que Chrome esté cerrado del todo antes de empezar.
//
// Método: arranca tu Chrome tal cual (con tu perfil, sin automatización) con el
// puerto de depuración abierto en 127.0.0.1, se conecta por CDP, lee las cookies
// de localhost y cierra Chrome.
//
//   node tools/agentic/local-servers/import-chrome-session.mjs [NombreDePerfil]
//   (perfil por defecto: "Default"; otros suelen llamarse "Profile 1", "Profile 6"...)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const WEB = join(ROOT, "apps", "web");
const require = createRequire(join(WEB, "package.json"));
const { chromium } = require("@playwright/test");

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:8082";
const profile = process.argv[2] ?? "Default";
const userDataDir = join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data");
const chromeExe = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));
const authFile = join(WEB, "playwright", ".auth", "user.json");
const port = 9222;
const t0 = Date.now();
const log = (message) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${message}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("\nSe agotaron 120 s. Mira la última línea de arriba para saber el paso.");
  console.error("Causa habitual: Chrome seguía abierto con este perfil. Ciérralo del todo (también desde la bandeja) y reintenta.");
  process.exit(3);
}, 120_000);

if (!chromeExe) { console.error("No encuentro chrome.exe en Program Files."); process.exit(2); }
if (!existsSync(join(userDataDir, profile))) {
  console.error(`No existe el perfil "${profile}" en ${userDataDir}. Pasa el nombre correcto como argumento.`);
  process.exit(2);
}

log(`Arrancando Chrome con el perfil "${profile}" y puerto de depuración ${port}...`);
const chrome = spawn(chromeExe, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  `--profile-directory=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-session-crashed-bubble",
  "--hide-crash-restore-bubble",
  "--new-window",
  `${baseUrl}/app`,
], { stdio: "ignore", detached: false });

let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  await sleep(1000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    ready = res.ok;
  } catch { /* todavía no */ }
}
if (!ready) {
  console.error("Chrome no abrió el puerto de depuración. Si ya había un Chrome abierto, se reutilizó esa ventana: ciérralo todo y reintenta.");
  process.exit(1);
}
log("Chrome listo. Conectando por CDP...");

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
if (!context) { console.error("Sin contexto de navegador."); process.exit(1); }

let page = context.pages().find((p) => p.url().startsWith(baseUrl));
if (!page) {
  page = await context.newPage();
  await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
}
await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
await sleep(1500);
log(`Página: ${page.url()}`);
if (new URL(page.url()).pathname.startsWith("/login")) {
  console.error("Tu Chrome no tiene sesión en superRestaurant (llegó a /login). Prueba con el otro perfil, o entra en esa ventana y vuelve a correr este script.");
  await browser.close().catch(() => undefined);
  chrome.kill();
  process.exit(1);
}

log("Sesión detectada. Copiando cookies de localhost...");
const cookies = await context.cookies([baseUrl]);
const localStorageEntries = await page.evaluate(() =>
  Object.entries(localStorage).map(([name, value]) => ({ name, value })),
);
const state = { cookies, origins: [{ origin: new URL(baseUrl).origin, localStorage: localStorageEntries }] };
mkdirSync(join(WEB, "playwright", ".auth"), { recursive: true });
writeFileSync(authFile, JSON.stringify(state, null, 2), { mode: 0o600 });
log(`Sesión copiada: ${cookies.length} cookie(s) de ${baseUrl} -> apps/web/playwright/.auth/user.json`);
clearTimeout(watchdog);
await browser.close().catch(() => undefined);
chrome.kill();
log("Chrome cerrado. Listo.");
process.exit(0);
