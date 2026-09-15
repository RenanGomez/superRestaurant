// Operator-only password setter for the existing global administrator.
// The password stays in one local HTTPS-equivalent loopback request and is never logged or persisted.
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
import { EMAIL, PROJECT, databaseConfig, verifyExistingAdmin } from "./local-admin-recovery.mjs";

export const SETTER = "http://127.0.0.1:4320";
export const PASSWORD_JOURNAL = resolve(dirname(fileURLToPath(import.meta.url)), "../tmp/local-admin-password-set.attempt.json");
const SUPABASE = `https://${PROJECT}.supabase.co`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failure = (stage) => new Error(`LOCAL_PASSWORD_SET_${stage}`);

export function validatePassword(password, confirmation) {
  if (typeof password !== "string" || password !== confirmation || password.length < 12 || password.length > 128) throw failure("INVALID_INPUT");
  return password;
}

export function createPasswordAttempt({ preflight, updatePassword, claim, record, targetEmail = EMAIL }) {
  let attempted = false;
  return async (password, confirmation) => {
    validatePassword(password, confirmation);
    if (attempted) throw failure("ALREADY_ATTEMPTED");
    attempted = true;
    let claimed = false;
    let stage = "IDENTITY";
    try {
      const id = await preflight();
      stage = "ALREADY_ATTEMPTED";
      await claim();
      claimed = true;
      stage = "UPDATE";
      const { data, error } = await updatePassword(id, password);
      if (error || data?.user?.id !== id || data.user.email !== targetEmail || data.user.deleted_at) throw failure("UPDATE");
      await record("updated");
    } catch (error) {
      if (claimed) await record("failed", "update").catch(() => {});
      if (/^LOCAL_PASSWORD_SET_[A-Z_]+$/u.test(error?.message ?? "")) throw error;
      throw failure(stage);
    }
  };
}

function page(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    Connection: "close",
  });
  response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Establecer contraseña local</title><body>${body}</body></html>`);
}

function localRequestFailure(request, setter = SETTER) {
  if (request.headers.host !== new URL(setter).host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) return "NETWORK";
  const origin = request.headers.origin;
  const fetchSite = request.headers["sec-fetch-site"];
  // The in-app browser can omit fetch metadata or report an opaque local origin.
  // Reject explicit remote origins/contexts; Host + loopback + the unguessable CSRF nonce remain mandatory.
  if (origin && ![setter, "null"].includes(origin)) return "ORIGIN";
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) return "FETCH_SITE";
  return undefined;
}

async function readForm(request, response) {
  const contentType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    page(response, 403, "Acceso rechazado (LOCAL_PASSWORD_SET_ACCESS_CONTENT_TYPE).");
    return undefined;
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 1024) {
      page(response, 413, "Solicitud rechazada.");
      return undefined;
    }
  }
  return new URLSearchParams(body);
}

export function createPasswordSetterHandler(
  attempt,
  csrf = randomBytes(32).toString("hex"),
  account = Object.freeze({ email: EMAIL, heading: "Establecer contraseña del administrador", label: "administrador" }),
) {
  return async (request, response) => {
    const accessFailure = localRequestFailure(request, account.setter ?? SETTER);
    if (accessFailure) return page(response, 403, `Acceso rechazado (LOCAL_PASSWORD_SET_ACCESS_${accessFailure}).`);
    if (request.method === "GET" && request.url === "/") {
      return page(response, 200, `<h1>${account.heading}</h1><p>Cuenta existente: ${account.email}</p><p>La contraseña no se guarda en archivos ni se muestra en registros.</p><form method="post" action="/probe"><input type="hidden" name="nonce" value="${csrf}"><button type="submit">Comprobar navegador (no cambia la contraseña)</button></form><form method="post" action="/set-password"><input type="hidden" name="nonce" value="${csrf}"><p><label>Nueva contraseña (12–128 caracteres)<br><input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label></p><p><label>Confirmar contraseña<br><input name="confirmation" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label></p><button type="submit">Guardar contraseña</button></form>`);
    }
    if (request.method !== "POST" || !["/probe", "/set-password"].includes(request.url)) return page(response, 404, "Ruta no disponible.");
    try {
      const form = await readForm(request, response);
      if (!form) return;
      if (request.url === "/probe") {
        if ([...form.keys()].some((key) => key !== "nonce") || form.getAll("nonce").length !== 1 || form.get("nonce") !== csrf) return page(response, 403, "Acceso rechazado (LOCAL_PASSWORD_SET_ACCESS_NONCE).");
        return page(response, 200, "<h1>Navegador compatible</h1><p>La comprobación local pasó y no cambió ninguna contraseña.</p><p><a href=\"/\">Volver al formulario</a></p>");
      }
      const allowed = new Set(["nonce", "password", "confirmation"]);
      if ([...form.keys()].some((key) => !allowed.has(key)) || [...allowed].some((key) => form.getAll(key).length !== 1) || form.get("nonce") !== csrf) return page(response, 403, "Acceso rechazado (LOCAL_PASSWORD_SET_ACCESS_NONCE_OR_FIELDS).");
      await attempt(form.get("password"), form.get("confirmation"));
      page(response, 200, `<h1>Contraseña actualizada</h1><p>La cuenta ${account.email} conserva su identidad y rol ${account.label}. Ya puedes iniciar sesión en la consola.</p><p><a href="http://localhost:8082/login">Abrir inicio de sesión</a></p>`);
    } catch (error) {
      const code = /^LOCAL_PASSWORD_SET_[A-Z_]+$/u.test(error?.message ?? "") ? error.message : "LOCAL_PASSWORD_SET_UNAVAILABLE";
      const status = code === "LOCAL_PASSWORD_SET_INVALID_INPUT" ? 400 : 409;
      const guidance = status === 400 ? "Las contraseñas deben coincidir y tener entre 12 y 128 caracteres. Puedes corregirlas y volver a enviar." : "No se realizará otro intento automáticamente.";
      page(response, status, `<h1>No se pudo guardar la contraseña</h1><p>${code}. ${guidance}</p>`);
    }
  };
}

async function main(args) {
  const expected = ["--serve", "--confirm=SET_EXISTING_GLOBAL_ADMIN_PASSWORD"];
  if (!(args.length === expected.length && expected.every((arg) => args.includes(arg)))) throw failure("EXPLICIT_GATES_REQUIRED");
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
  const attempt = createPasswordAttempt({
    preflight,
    updatePassword: (id, password) => client.auth.admin.updateUserById(id, { password }),
    claim: async () => {
      await mkdir(dirname(PASSWORD_JOURNAL), { recursive: true });
      const file = await open(PASSWORD_JOURNAL, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ state: "attempted" })); await file.sync(); } finally { await file.close(); }
    },
    record: (state, stage) => writeFile(PASSWORD_JOURNAL, JSON.stringify(stage ? { state, stage } : { state }), { mode: 0o600 }),
  });
  const server = createServer(createPasswordSetterHandler(attempt));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on("error", () => { console.error("LOCAL_PASSWORD_SETTER_UNAVAILABLE"); process.exit(1); });
  server.listen(4320, "127.0.0.1", () => console.log(`Local password setter ready: ${SETTER}`));
  // Keep enough time for the human-only password step; the one-attempt guard and journal
  // still prevent a second remote mutation after a valid submission reaches this process.
  setTimeout(() => { server.closeAllConnections(); server.close(); process.exit(0); }, 60 * 60 * 1000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { console.error("LOCAL_PASSWORD_SETTER_STOPPED_NO_AUTOMATIC_RETRY"); process.exitCode = 1; });
}
