import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

// Shared lifecycle for the fully local, disposable PostgreSQL 17 cluster used by the local
// verifiers and the HTTP flow test. Each instance owns a brand-new cluster under
// `.cache/postgres-local/<runId>` (initdb, loopback only, random SCRAM password) and stops it in
// `stop()`. It never reads env URLs/PGHOST, never touches Supabase or a shared database, and never
// deletes recursively or drops databases.
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cache = join(repositoryRoot, ".cache", "postgres-local");
const binaries = join(cache, "pgsql", "bin");
const migrationsDirectory = join(repositoryRoot, "supabase", "migrations");

export interface LocalPostgresOptions {
  /** Per-verifier database name prefix; the run id is appended. */
  readonly databasePrefix: string;
  /** Extra `auth.users` column definitions (for example `, raw_user_meta_data jsonb`), appended verbatim. */
  readonly authUsersExtraColumns?: string;
  readonly marker: string;
}

export interface LocalPostgresStopResult {
  readonly failed: boolean;
  readonly stopped: boolean;
}

/** Throws unless the process runs on win32 and was given exactly `--local-disposable-only`. */
export function assertLocalConfirmation(argv: readonly string[] = process.argv): void {
  if (process.platform !== "win32" || argv.slice(2).join(" ") !== "--local-disposable-only") {
    throw new Error("LOCAL_CONFIRMATION_REQUIRED");
  }
}

export function listMigrationNames(): readonly string[] {
  return readdirSync(migrationsDirectory).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name)).sort();
}

export function readMigration(name: string): string {
  return readFileSync(join(migrationsDirectory, name), "utf8");
}

export class LocalPostgres {
  public readonly runId = randomUUID().replaceAll("-", "");
  public readonly marker: string;
  public readonly database: string;
  public stage = "configuration";
  #admin: Client | undefined;
  #clusterCreated = false;
  #started = false;
  #stopped = true;
  #port = 0;
  #password = "";
  readonly #authUsersExtraColumns: string;
  readonly #runDirectory: string;
  readonly #data: string;
  readonly #passwordFile: string;
  #appApiPassword: string | undefined;

  public constructor(options: LocalPostgresOptions) {
    this.marker = options.marker;
    this.database = `${options.databasePrefix}_${this.runId}`;
    this.#authUsersExtraColumns = options.authUsersExtraColumns ?? "";
    this.#runDirectory = join(cache, this.runId);
    this.#data = join(this.#runDirectory, "data");
    this.#passwordFile = join(this.#runDirectory, "password.tmp");
  }

  /** Superuser connection to the disposable database; valid after `start()` and until `stop()`. */
  public get admin(): Client {
    if (this.#admin === undefined) throw new Error("LOCAL_POSTGRES_NOT_STARTED");
    return this.#admin;
  }

  public get port(): number {
    return this.#port;
  }

  /** Superuser URL of the disposable database (loopback, random password). Never log it. */
  public get adminUrl(): string {
    return this.#url("postgres", this.#password);
  }

  /** `app_api` URL; only available after `enableAppApiLogin()`. Never log it. */
  public get appApiUrl(): string {
    if (this.#appApiPassword === undefined) throw new Error("LOCAL_APP_API_LOGIN_NOT_ENABLED");
    return this.#url("app_api", this.#appApiPassword);
  }

  public async start(onStage: (stage: string) => void = () => undefined): Promise<void> {
    const setStage = (stage: string): void => { this.stage = stage; onStage(stage); };
    const version = spawnSync(this.#executable("postgres"), ["--version"], { windowsHide: true, encoding: "utf8", timeout: 5000 });
    if (version.status !== 0 || !/^postgres \(PostgreSQL\) 17\./u.test(version.stdout.trim())) throw new Error("LOCAL_PG17_REQUIRED");
    mkdirSync(this.#runDirectory, { recursive: true });
    this.#password = randomBytes(32).toString("base64url");
    writeFileSync(this.#passwordFile, this.#password, { flag: "wx" });
    this.#port = await availablePort();
    setStage("initdb");
    this.#run("initdb", ["-D", this.#data, "-U", "postgres", "--auth-host=scram-sha-256", "--auth-local=scram-sha-256",
      "--pwfile", this.#passwordFile, "--encoding=UTF8", "--locale=C"]);
    this.#clusterCreated = true;
    unlinkSync(this.#passwordFile);
    setStage("start");
    this.#stopped = false;
    this.#run("pg_ctl", ["-D", this.#data, "-l", join(this.#runDirectory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${this.#port}`,
      "-w", "-t", "30", "start"]);
    this.#started = true;
    setStage("bootstrap");
    const bootstrap = new Client({ ...this.#config(), database: "postgres" });
    await bootstrap.connect();
    try { await bootstrap.query(`CREATE DATABASE "${this.database}"`); } finally { await bootstrap.end(); }
    this.#admin = new Client({ ...this.#config(), database: this.database });
    await this.#admin.connect();
    // Minimal LOCAL Auth shim supplies FK targets only; no Auth provider is simulated.
    await this.#admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz${this.#authUsersExtraColumns});
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';`);
  }

  /** Applies the given migration files (names from `listMigrationNames()`) in order, outside any transaction wrapper. */
  public async applyMigrations(names: readonly string[]): Promise<void> {
    for (const name of names) await this.admin.query(readMigration(name));
  }

  /** Gives the migration-created `app_api` role a random password so a real pool can connect as it. */
  public async enableAppApiLogin(): Promise<void> {
    this.#appApiPassword = randomBytes(32).toString("base64url");
    await this.admin.query(`ALTER ROLE app_api LOGIN PASSWORD '${this.#appApiPassword}'`);
  }

  /** Always safe to call; mirrors the verifiers' original `finally` cleanup. */
  public async stop(): Promise<LocalPostgresStopResult> {
    let failed = false;
    try { await this.#admin?.end(); } catch { failed = true; }
    if (this.#clusterCreated) {
      try { this.#run("pg_ctl", ["-D", this.#data, "-m", "fast", "-w", "-t", "30", "stop"]); this.#started = false; this.#stopped = true; }
      catch { if (this.#started || this.stage === "start") failed = true; }
    }
    try { if (existsSync(this.#passwordFile)) unlinkSync(this.#passwordFile); } catch { failed = true; }
    return { failed, stopped: this.#stopped };
  }

  #config(): { host: "127.0.0.1"; port: number; user: string; password: string;
    connectionTimeoutMillis: number; query_timeout: number; statement_timeout: number } {
    return { host: "127.0.0.1", port: this.#port, user: "postgres", password: this.#password,
      connectionTimeoutMillis: 5000, query_timeout: 30_000, statement_timeout: 30_000 };
  }

  #url(user: string, password: string): string {
    return `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${this.#port}/${this.database}`;
  }

  #executable(name: string): string {
    // Missing portable binaries are reported with a stable, actionable code.
    if (!existsSync(join(binaries, `${name}.exe`))) throw new Error("LOCAL_POSTGRES_MISSING");
    const path = realpathSync(join(binaries, `${name}.exe`));
    if (!path.toLowerCase().startsWith(`${realpathSync(cache).toLowerCase()}\\`)) throw new Error("LOCAL_BINARY_PATH_REJECTED");
    return path;
  }

  #run(name: string, args: readonly string[]): void {
    const result = spawnSync(this.#executable(name), [...args], { windowsHide: true, timeout: 60_000, stdio: "ignore" });
    if (result.status !== 0 || result.error !== undefined) throw new Error("LOCAL_PROCESS_FAILED");
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("LOCAL_PORT_REJECTED");
  await new Promise<void>((ok, reject) => server.close((error) => error === undefined ? ok() : reject(error)));
  return address.port;
}
