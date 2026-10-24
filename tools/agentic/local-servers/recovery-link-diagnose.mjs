// Diagnóstico: genera un enlace de recuperación y lo sigue en un Chrome sin ventana,
// registrando las redirecciones (con los valores largos enmascarados) y la respuesta
// de /auth/callback/session. No fija ninguna contraseña.
//   node tools/agentic/local-servers/recovery-link-diagnose.mjs <correo>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const require = createRequire(join(ROOT, "apps", "web", "package.json"));
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("@playwright/test");

const email = (process.argv[2] ?? "").trim().toLowerCase();
function parseEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const mask = (u) => u.replace(/([?&#]|^)([a-z_]+)=([^&]*)/gi, (_, sep, k, v) => `${sep}${k}=${v.length > 24 ? `<${v.length} chars>` : v}`);

const webEnv = parseEnv(join(ROOT, "apps", "web", ".env.local"));
const apiEnv = parseEnv(join(ROOT, ".env.adr010.local"));
const redirectTo = `${(webEnv.WEB_ORIGIN ?? "http://localhost:8082").replace(/\/$/, "")}/auth/callback`;
const admin = createClient(webEnv.SUPABASE_URL, apiEnv.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
if (error) { console.error("generateLink:", error.message); process.exit(1); }
const link = data.properties.action_link;
console.log("enlace:", mask(link));
console.log("redirect_to pedido:", redirectTo);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext()).newPage();
page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log("nav:", mask(f.url())); });
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/auth/callback/session") || u.includes("/auth/v1/")) {
    let body = "";
    try { body = (await r.text()).slice(0, 200); } catch { /* sin cuerpo */ }
    console.log("resp:", r.status(), mask(u), body.replace(/\s+/g, " "));
  }
});
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((e) => console.log("goto:", e.message.split("\n")[0]));
await page.waitForTimeout(6000);
console.log("final:", mask(page.url()));
console.log("texto:", (await page.locator("body").innerText().catch(() => "")).slice(0, 200).replace(/\s+/g, " "));
await browser.close();
