// Genera un enlace de recuperación de contraseña para un usuario existente y lo
// abre directamente en el navegador predeterminado, sin pasar por correo (evita
// que el escáner de Gmail consuma el token de un solo uso).
//
// Lee SUPABASE_URL de apps/web/.env.local y SUPABASE_SECRET_KEY de .env.adr010.local.
// Nunca imprime la clave ni el enlace. Solo para uso local.
//
//   node tools/agentic/local-servers/recovery-link.mjs <correo>
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const require = createRequire(join(ROOT, "apps", "web", "package.json"));
const { createClient } = require("@supabase/supabase-js");

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Uso: recovery-link.bat <correo-del-usuario>");
  process.exit(2);
}

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

const webEnv = parseEnv(join(ROOT, "apps", "web", ".env.local"));
const apiEnv = parseEnv(join(ROOT, ".env.adr010.local"));
const url = webEnv.SUPABASE_URL;
const secret = apiEnv.SUPABASE_SECRET_KEY;
if (!url || !secret?.startsWith("sb_secret_")) {
  console.error("Falta SUPABASE_URL en apps/web/.env.local o SUPABASE_SECRET_KEY en .env.adr010.local.");
  process.exit(2);
}
const redirectTo = `${(webEnv.WEB_ORIGIN ?? "http://localhost:8082").replace(/\/$/, "")}/auth/callback`;

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
if (error) {
  console.error(`No se pudo generar el enlace: ${error.message}`);
  process.exit(1);
}
const link = data?.properties?.action_link;
if (!link) {
  console.error("Supabase no devolvió el enlace.");
  process.exit(1);
}
console.log(`Enlace generado para ${email}; se abre en tu navegador y te llevará a ${redirectTo} y de ahí a /reset-password.`);
console.log("Es de un solo uso y caduca pronto. Si el navegador no se abre solo, vuelve a correr el script.");
// rundll32 recibe la URL como argumento literal: los "&" no pasan por cmd y no se cortan.
spawn("rundll32.exe", ["url.dll,FileProtocolHandler", link], { stdio: "ignore", detached: true, windowsHide: true }).unref();
