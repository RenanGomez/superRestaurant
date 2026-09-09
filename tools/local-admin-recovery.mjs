// Operator-only recovery for the existing global administrator. Never import from an app.
// --preflight is read-only. --serve also requires the two explicit gates below.
// The persistent attempt journal deliberately prevents retries, including after failures.
/* global AbortSignal, fetch */
import console from "node:console";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import { URL, URLSearchParams, fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const PROJECT = "zwbyiefqeujstyzysydn";
export const EMAIL = "rgafrog@gmail.com";
export const CALLBACK = "http://localhost:8082/auth/callback";
export const BROKER = "http://127.0.0.1:4319";
const SUPABASE = `https://${PROJECT}.supabase.co`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JOURNAL = resolve(ROOT, "tmp/local-admin-recovery.attempt.json");
const failure = (stage) => new Error(`LOCAL_RECOVERY_${stage}`);

export function databaseConfig(connectionString, ca) {
  const url = new URL(connectionString);
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === `db.${PROJECT}.supabase.co` && user === "postgres";
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(url.hostname) && user === `postgres.${PROJECT}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler) || url.pathname !== "/postgres" || !url.password || !ca) throw failure("CONFIGURATION");
  // Explicit fields prevent pg connection-string ssl options from overriding verification.
  return { host: url.hostname, port: Number(url.port || 5432), user, password: decodeURIComponent(url.password), database: "postgres", ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 10000, statement_timeout: 10000 };
}

export async function verifyExistingAdmin(database, admin) {
  let connected = false;
  try {
    await database.connect(); connected = true;
    await database.query("BEGIN READ ONLY");
    const { rows } = await database.query("select u.id, u.email from auth.users u join app.system_admins a on a.user_id = u.id where u.email = $1 and u.deleted_at is null and a.revoked_at is null", [EMAIL]);
    if (rows.length !== 1 || rows[0].email !== EMAIL || !rows[0].id) throw failure("IDENTITY");
    const { data, error } = await admin.getUserById(rows[0].id);
    if (error || data?.user?.id !== rows[0].id || data.user.email !== EMAIL || data.user.deleted_at) throw failure("IDENTITY");
    return rows[0].id;
  } catch { throw failure("IDENTITY"); }
  finally {
    if (connected) {
      try { await database.query("ROLLBACK"); } finally { await database.end(); }
    } else { await database.end().catch(() => {}); }
  }
}

export function validateActionLink(value) {
  const url = new URL(value);
  if (url.origin !== SUPABASE || url.username || url.password || url.pathname !== "/auth/v1/verify" || url.hash || url.searchParams.get("type") !== "recovery" || url.searchParams.get("redirect_to") !== CALLBACK || !url.searchParams.get("token")) throw failure("ACTION_LINK");
  return url.href;
}

export function validateRecoveryRedirect(value) {
  const url = new URL(value);
  if (url.origin !== new URL(CALLBACK).origin || url.pathname !== "/auth/callback" || url.username || url.password || url.search) throw failure("CALLBACK");
  const fragment = new URLSearchParams(url.hash.slice(1));
  if ([...fragment.keys()].some((key) => key.startsWith("error")) || fragment.get("type") !== "recovery") throw failure("CALLBACK");
  const clean = new URLSearchParams({ type: "recovery" });
  for (const key of ["access_token", "refresh_token"]) {
    const values = fragment.getAll(key);
    if (values.length !== 1 || typeof values[0] !== "string" || values[0].length < 20 || values[0].length > 8192 || /\s/u.test(values[0])) throw failure("CALLBACK");
    clean.set(key, values[0]);
  }
  return `${CALLBACK}#${clean}`;
}

export function createAttempt({ preflight, admin, fetcher, claim, record }) {
  let attempted = false;
  return async () => {
    if (attempted) throw failure("ALREADY_ATTEMPTED");
    attempted = true; // Set before the first await, including concurrent requests.
    let claimed = false;
    let stage = "IDENTITY";
    try {
      const id = await preflight();
      stage = "ALREADY_ATTEMPTED";
      await claim(); claimed = true;
      stage = "GENERATION";
      const { data, error } = await admin.generateLink({ type: "recovery", email: EMAIL, options: { redirectTo: CALLBACK } });
      if (error || data?.user?.id !== id || data.user.email !== EMAIL) throw failure(stage);
      stage = "ACTION_LINK";
      const link = validateActionLink(data?.properties?.action_link);
      stage = "VERIFICATION";
      const response = await fetcher(link, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (![302, 303, 307].includes(response.status)) throw failure(stage);
      stage = "CALLBACK";
      const target = validateRecoveryRedirect(response.headers.get("location"));
      await response.body?.cancel();
      await record("delivered");
      return target;
    } catch {
      if (claimed) await record("failed").catch(() => {});
      throw failure(stage);
    }
  };
}

function page(response, status, body, nonce) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, "Connection": "close" });
  response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Recuperar acceso local</title><body>${body}</body></html>`);
}

export function createBrokerHandler(attempt, csrf = randomBytes(32).toString("hex")) {
  return async (request, response) => {
    const nonce = randomBytes(24).toString("hex");
    if (request.headers.host !== new URL(BROKER).host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) return page(response, 403, "Acceso rechazado.", nonce);
    if (request.method === "GET" && request.url === "/") return page(response, 200, `<h1>Recuperar acceso del administrador</h1><p>Se preparará una única sesión para ${EMAIL}. A continuación podrás establecer tu contraseña.</p><form method="post" action="/recover"><input type="hidden" name="nonce" value="${csrf}"><button type="submit">Abrir recuperación de contraseña</button></form>`, nonce);
    if (request.method !== "POST" || request.url !== "/recover") return page(response, 404, "Ruta no disponible.", nonce);
    if (request.headers.origin !== BROKER || request.headers["content-type"] !== "application/x-www-form-urlencoded" || (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin")) return page(response, 403, "Acceso rechazado.", nonce);
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 512) return page(response, 413, "Solicitud rechazada.", nonce);
      }
      const form = new URLSearchParams(body);
      if (form.getAll("nonce").length !== 1 || form.get("nonce") !== csrf) return page(response, 403, "Acceso rechazado.", nonce);
      const target = await attempt();
      // Tokens are never a Location header, request URL, disk file, or console output.
      // JSON escaping protects the inline script even against malicious provider output.
      page(response, 200, `<p>Abriendo el formulario de contraseña…</p><script nonce="${nonce}">location.replace(${JSON.stringify(target).replaceAll("<", "\\u003c")});</script>`, nonce);
    } catch (error) {
      const code = /^LOCAL_RECOVERY_[A-Z_]+$/u.test(error?.message ?? "") ? error.message : "LOCAL_RECOVERY_UNAVAILABLE";
      page(response, 409, `<h1>No se pudo entregar la sesión</h1><p>${code}. No se generará otro enlace automáticamente.</p>`, nonce);
    }
  };
}

async function main(args) {
  const preflightOnly = args.length === 1 && args[0] === "--preflight";
  const expected = ["--serve", "--confirm=RECOVER_EXISTING_GLOBAL_ADMIN", "--redirect-preflight=verified"];
  if (!preflightOnly && !(args.length === expected.length && expected.every((arg) => args.includes(arg)))) throw failure("EXPLICIT_GATES_REQUIRED");
  const env = parseEnv(await readFile(resolve(ROOT, ".env.adr010.local"), "utf8"));
  const key = env.TENANCY_VERIFICATION_SUPABASE_SECRET_KEY;
  if (!key?.startsWith("sb_secret_")) throw failure("CONFIGURATION");
  const require = createRequire(resolve(ROOT, "apps/api/package.json"));
  const { createClient } = require("@supabase/supabase-js");
  const { Client } = require("pg");
  const config = databaseConfig(env.ADR010_DATABASE_URL, await readFile(resolve(ROOT, ".certs/prod-ca-2021.crt"), "utf8"));
  const client = createClient(SUPABASE, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (url, options) => fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) }) } });
  const preflight = () => verifyExistingAdmin(new Client(config), client.auth.admin);
  await preflight();
  console.log(JSON.stringify({ exactProject: true, existingAuthUser: true, activeSystemAdmin: true, tlsVerified: true, emailNotSent: true }));
  if (preflightOnly) return;
  const attempt = createAttempt({ preflight, admin: client.auth.admin, fetcher: fetch, claim: async () => {
    await mkdir(dirname(JOURNAL), { recursive: true });
    const file = await open(JOURNAL, "wx", 0o600);
    try { await file.writeFile(JSON.stringify({ state: "attempted" })); await file.sync(); } finally { await file.close(); }
  }, record: (state) => writeFile(JOURNAL, JSON.stringify({ state }), { mode: 0o600 }) });
  const server = createServer(createBrokerHandler(attempt));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on("error", () => { console.error("LOCAL_RECOVERY_BROKER_UNAVAILABLE"); process.exit(1); });
  server.listen(4319, "127.0.0.1", () => console.log(`Local recovery ready: ${BROKER}`));
  // Process exit discards all credentials and pending responses after this short window.
  setTimeout(() => { server.closeAllConnections(); server.close(); process.exit(0); }, 15 * 60 * 1000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { console.error("LOCAL_RECOVERY_STOPPED_NO_AUTOMATIC_RETRY"); process.exitCode = 1; });
}
