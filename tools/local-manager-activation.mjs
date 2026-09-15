// Operator-only activation for the one existing Vittorinos manager.
// The password stays in one loopback request and is never logged or persisted.
/* global AbortSignal, fetch */
import console from "node:console";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import { PROJECT, databaseConfig } from "./local-admin-recovery.mjs";
import { createPasswordAttempt, createPasswordSetterHandler } from "./local-admin-password-setter.mjs";

export const MANAGER_EMAIL = "emmanuel.rgomez@gmail.com";
export const RESTAURANT_NAME = "Vittorinos Pizza";
export const BRANCH_NAME = "Sucursal Navojoa";
export const RESTAURANT_TIME_ZONE = "America/Hermosillo";
export const MANAGER_SETTER = "http://127.0.0.1:4321";
export const MANAGER_JOURNAL = resolve(dirname(fileURLToPath(import.meta.url)), "../tmp/local-manager-activation.attempt.json");

const SUPABASE = `https://${PROJECT}.supabase.co`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failure = (stage) => new Error(`LOCAL_MANAGER_ACTIVATION_${stage}`);
const managerPreflightSql = `
select u.id::text as id, u.email
from auth.users u
where u.email = $1
  and u.deleted_at is null
  and u.confirmed_at is null
  and u.last_sign_in_at is null
  and not exists (
    select 1 from app.system_admins a
    where a.user_id = u.id and a.revoked_at is null
  )
  and 1 = (
    select count(*) from app.memberships m
    where m.user_id = u.id and m.revoked_at is null
  )
  and 1 = (
    select count(*)
    from app.memberships m
    join app.membership_role_grants g on g.membership_id = m.id
    where m.user_id = u.id and m.revoked_at is null and g.revoked_at is null
  )
  and exists (
    select 1
    from app.memberships m
    join app.membership_role_grants g on g.membership_id = m.id
    join app.restaurants r on r.id = m.restaurant_id
    join app.branches b on b.id = m.branch_id and b.restaurant_id = r.id
    where m.user_id = u.id and m.revoked_at is null and g.revoked_at is null
      and g.role_code = $2 and r.name = $3 and r.time_zone = $4
      and r.disabled_at is null and b.name = $5 and b.disabled_at is null
  )`;

export async function verifyExistingManager(database, admin) {
  let connected = false;
  try {
    await database.connect();
    connected = true;
    await database.query("BEGIN TRANSACTION READ ONLY");
    const { rows } = await database.query(managerPreflightSql, [
      MANAGER_EMAIL,
      "manager",
      RESTAURANT_NAME,
      RESTAURANT_TIME_ZONE,
      BRANCH_NAME,
    ]);
    if (rows.length !== 1 || rows[0].email !== MANAGER_EMAIL || !rows[0].id) throw failure("IDENTITY");
    const { data, error } = await admin.getUserById(rows[0].id);
    const user = data?.user;
    if (
      error
      || user?.id !== rows[0].id
      || user.email !== MANAGER_EMAIL
      || user.deleted_at
      || user.confirmed_at
      || user.email_confirmed_at
      || user.last_sign_in_at
    ) throw failure("IDENTITY");
    return rows[0].id;
  } catch {
    throw failure("IDENTITY");
  } finally {
    if (connected) {
      try { await database.query("ROLLBACK"); } finally { await database.end(); }
    } else {
      await database.end().catch(() => {});
    }
  }
}

export async function updateManagerCredentials(admin, id, password) {
  const result = await admin.updateUserById(id, { password, email_confirm: true });
  const user = result.data?.user;
  if (!result.error && !user?.confirmed_at && !user?.email_confirmed_at) return { data: result.data, error: failure("CONFIRMATION") };
  return result;
}

async function main(args) {
  const expected = ["--serve", "--confirm=ACTIVATE_EXISTING_VITTORINOS_MANAGER"];
  if (!(args.length === expected.length && expected.every((arg) => args.includes(arg)))) throw failure("EXPLICIT_GATES_REQUIRED");
  const env = parseEnv(await readFile(resolve(ROOT, ".env.adr010.local"), "utf8"));
  const key = env.TENANCY_VERIFICATION_SUPABASE_SECRET_KEY;
  if (!key?.startsWith("sb_secret_")) throw failure("CONFIGURATION");
  const require = createRequire(resolve(ROOT, "apps/api/package.json"));
  const { createClient } = require("@supabase/supabase-js");
  const { Client } = require("pg");
  const config = databaseConfig(env.ADR010_DATABASE_URL, await readFile(resolve(ROOT, ".certs/prod-ca-2021.crt"), "utf8"));
  const client = createClient(SUPABASE, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) }) },
  });
  const preflight = () => verifyExistingManager(new Client(config), client.auth.admin);
  await preflight();
  const attempt = createPasswordAttempt({
    preflight,
    targetEmail: MANAGER_EMAIL,
    updatePassword: (id, password) => updateManagerCredentials(client.auth.admin, id, password),
    claim: async () => {
      await mkdir(dirname(MANAGER_JOURNAL), { recursive: true });
      const file = await open(MANAGER_JOURNAL, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ state: "attempted" })); await file.sync(); } finally { await file.close(); }
    },
    record: (state, stage) => writeFile(MANAGER_JOURNAL, JSON.stringify(stage ? { state, stage } : { state }), { mode: 0o600 }),
  });
  const handler = createPasswordSetterHandler(attempt, undefined, Object.freeze({
    email: MANAGER_EMAIL,
    heading: "Activar cuenta manager de Vittorinos",
    label: "manager",
    setter: MANAGER_SETTER,
  }));
  const server = createServer(handler);
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on("error", () => { console.error("LOCAL_MANAGER_ACTIVATION_UNAVAILABLE"); process.exit(1); });
  server.listen(4321, "127.0.0.1", () => console.log(`Local manager activation ready: ${MANAGER_SETTER}`));
  setTimeout(() => { server.closeAllConnections(); server.close(); process.exit(0); }, 60 * 60 * 1000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { console.error("LOCAL_MANAGER_ACTIVATION_STOPPED_NO_AUTOMATIC_RETRY"); process.exitCode = 1; });
}
