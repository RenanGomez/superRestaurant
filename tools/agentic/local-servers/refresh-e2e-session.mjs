// Renueva el access token del storageState de Playwright sin abrir el navegador.
// Uso: node tools/agentic/local-servers/refresh-e2e-session.mjs [ruta/user.json]
// No imprime tokens ni la URL de la base; solo el resultado y la expiración aproximada.
// Si el refresh token ya fue rotado por una navegación real (por ejemplo, tras un pase visual),
// responde "refresh_rejected" y hay que volver a hacer login con `pnpm --filter @super-restaurant/web e2e:auth`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const envPath = resolve(repoRoot, "apps", "web", ".env.local");
const authPath = resolve(repoRoot, process.argv[2] ?? "apps/web/playwright/.auth/user.json");

function readEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

const env = readEnv(envPath);
const state = JSON.parse(readFileSync(authPath, "utf8"));
const cookie = state.cookies?.find((candidate) => typeof candidate?.name === "string" && candidate.name.endsWith("-auth-token"));
if (cookie === undefined || !cookie.value.startsWith("base64-")) {
  console.error(JSON.stringify({ status: "no_session_cookie", file: authPath }));
  process.exit(1);
}

const session = JSON.parse(Buffer.from(cookie.value.slice("base64-".length), "base64url").toString("utf8"));
if (typeof session.refresh_token !== "string" || session.refresh_token.length === 0) {
  console.error(JSON.stringify({ status: "no_refresh_token", file: authPath }));
  process.exit(1);
}

const response = await fetch(`${String(env.SUPABASE_URL).replace(/\/$/u, "")}/auth/v1/token?grant_type=refresh_token`, {
  body: JSON.stringify({ refresh_token: session.refresh_token }),
  headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
  method: "POST",
});
if (!response.ok) {
  console.error(JSON.stringify({ detail: (await response.text()).slice(0, 200), status: "refresh_rejected", file: authPath }));
  process.exit(1);
}

const next = await response.json();
session.access_token = next.access_token;
session.refresh_token = next.refresh_token;
session.expires_in = next.expires_in;
session.expires_at = next.expires_at;
session.user = next.user ?? session.user;
cookie.value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
writeFileSync(authPath, JSON.stringify(state, null, 2));
const minutes = typeof session.expires_at === "number" ? Math.round((session.expires_at * 1000 - Date.now()) / 60_000) : undefined;
console.log(JSON.stringify({ expiresInMinutes: minutes, file: authPath, status: "refreshed" }));
