import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import { requireSupabaseDestructiveDatabaseOptIn, type SupabaseAdr010DestructiveDatabaseConfig } from "./config.js";

export const freshRemotePushMigrationVersions = [
  "20260825000100",
  "20260826000100",
  "20260827000100",
  "20260828000100",
  "20260829000100",
] as const;

export const supabaseCliPackage = "supabase@2.109.1";

export type SupabaseCliInvocation = Readonly<{
  readonly executable: "npx" | "npx.cmd";
  readonly prefixArgs: readonly ["--yes", typeof supabaseCliPackage];
  readonly shell: boolean;
}>;

/**
 * The CLI is deliberately version-pinned. Windows needs its .cmd shim through
 * the system shell; every argument appended by this module is a fixed literal.
 */
export const resolveSupabaseCliInvocation = (platform: NodeJS.Platform = process.platform): SupabaseCliInvocation => ({
  executable: platform === "win32" ? "npx.cmd" : "npx",
  prefixArgs: ["--yes", supabaseCliPackage],
  shell: platform === "win32",
});

export type FreshRemotePushOptions = {
  readonly config: SupabaseAdr010DestructiveDatabaseConfig;
  readonly cwd: string;
  readonly apply: boolean;
  readonly runCommand?: (args: readonly string[]) => Promise<void>;
  readonly assertLinkedProjectRef?: (cwd: string, expectedProjectRef: string) => Promise<void>;
  readonly assertFreshRemoteTarget?: (databaseUrl: string) => Promise<void>;
  readonly assertFreshRemoteMigrationSeriesApplied?: (databaseUrl: string) => Promise<void>;
};

export type FreshRemotePushResult = Readonly<{
  readonly targetWasFresh: true;
  readonly dryRunCompleted: true;
  readonly pushApplied: boolean;
  readonly migrationCount: number;
}>;

/**
 * Requires a separate opt-in for a fresh remote push. The existing destructive
 * guard still validates the hosted URL, exact confirmation and database target.
 */
export const requireFreshRemotePushOptIn = (environment: NodeJS.ProcessEnv): SupabaseAdr010DestructiveDatabaseConfig => {
  if (environment.ADR010_RUN_SUPABASE_FRESH_PUSH !== "1") {
    throw new Error("ADR010_FRESH_PUSH_DISABLED");
  }
  return requireSupabaseDestructiveDatabaseOptIn(environment);
};

export const assertLinkedProjectRef = async (cwd: string, expectedProjectRef: string): Promise<void> => {
  let linkedProjectRef: string;
  try {
    linkedProjectRef = (await readFile(path.join(cwd, "supabase", ".temp", "project-ref"), "utf8")).trim();
  } catch {
    throw new Error("ADR010_FRESH_PUSH_LINK_METADATA_MISSING");
  }
  if (linkedProjectRef !== expectedProjectRef) throw new Error("ADR010_FRESH_PUSH_LINKED_PROJECT_MISMATCH");
};

/**
 * Checks only the disposable ADR-010 target and the managed Supabase
 * user/storage surfaces. It
 * never deletes rows, creates a project, links a project or changes schema.
 */
export const assertFreshRemoteTarget = async (databaseUrl: string): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const namespaceResult = await pool.query<{ readonly namespace_count: string }>(
      "select count(*)::text as namespace_count from pg_catalog.pg_namespace where nspname = any($1::text[])",
      [["adr010_b", "adr010_b_private"]],
    );
    if (namespaceResult.rows[0]?.namespace_count !== "0") throw new Error("ADR010_FRESH_PUSH_TARGET_NOT_EMPTY");

    if (await countRelationRows(pool, "supabase_migrations.schema_migrations") !== 0 ||
        await countRelationRows(pool, "auth.users") !== 0 ||
        await countRelationRows(pool, "storage.objects") !== 0 ||
        await countRelationRows(pool, "storage.buckets") !== 0 ||
        await countUnexpectedApplicationObjects(pool) !== 0) {
      throw new Error("ADR010_FRESH_PUSH_TARGET_NOT_EMPTY");
    }
  } finally {
    await pool.end();
  }
};

const countRelationRows = async (pool: Pool, relation: "supabase_migrations.schema_migrations" | "auth.users" | "storage.objects" | "storage.buckets"): Promise<number> => {
  const exists = await pool.query<{ readonly exists: boolean }>("select to_regclass($1::text) is not null as exists", [relation]);
  if (exists.rows[0]?.exists !== true) return 0;
  const result = await pool.query<{ readonly count: string }>(`select count(*)::text as count from ${relation}`);
  return Number(result.rows[0]?.count ?? "0");
};

const countUnexpectedApplicationObjects = async (pool: Pool): Promise<number> => {
  const result = await pool.query<{ readonly count: string }>(
    `select (
       (select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = any($1::text[]) and relation.relkind in ('r','p','v','m','f','S')) +
       (select count(*) from pg_catalog.pg_proc routine join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace where namespace.nspname = any($1::text[])) +
       (select count(*) from pg_catalog.pg_type data_type join pg_catalog.pg_namespace namespace on namespace.oid = data_type.typnamespace where namespace.nspname = any($1::text[]) and data_type.typtype in ('d','e','r'))
     )::text as count`,
    [["public", "adr010_b", "adr010_b_private"]],
  );
  return Number(result.rows[0]?.count ?? "0");
};

export const assertFreshRemoteMigrationSeriesApplied = async (databaseUrl: string): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{ readonly total_count: string; readonly migration_count: string; readonly distinct_count: string }>(
      `select count(*)::text as total_count,
              count(*) filter (where version = any($1::text[]))::text as migration_count,
              count(distinct version) filter (where version = any($1::text[]))::text as distinct_count
       from supabase_migrations.schema_migrations`,
      [freshRemotePushMigrationVersions],
    );
    const row = result.rows[0];
    if (row?.total_count !== String(freshRemotePushMigrationVersions.length) ||
        row.migration_count !== String(freshRemotePushMigrationVersions.length) ||
        row.distinct_count !== String(freshRemotePushMigrationVersions.length)) {
      throw new Error("ADR010_FRESH_PUSH_MIGRATION_SERIES_INCOMPLETE");
    }
  } finally {
    await pool.end();
  }
};

export const runFreshRemotePush = async (options: FreshRemotePushOptions): Promise<FreshRemotePushResult> => {
  const commandRunner = options.runCommand ?? ((args: readonly string[]) => runSupabaseCommand(args, options.cwd));
  const linkedProjectRefCheck = options.assertLinkedProjectRef ?? assertLinkedProjectRef;
  const freshRemoteTargetCheck = options.assertFreshRemoteTarget ?? assertFreshRemoteTarget;
  const appliedMigrationCheck = options.assertFreshRemoteMigrationSeriesApplied ?? assertFreshRemoteMigrationSeriesApplied;
  await linkedProjectRefCheck(options.cwd, options.config.confirmedIsolatedProjectRef);
  await freshRemoteTargetCheck(options.config.databaseUrl);
  await commandRunner(["db", "push", "--linked", "--dry-run", "--yes"]);
  if (!options.apply) {
    return { targetWasFresh: true, dryRunCompleted: true, pushApplied: false, migrationCount: freshRemotePushMigrationVersions.length };
  }
  await linkedProjectRefCheck(options.cwd, options.config.confirmedIsolatedProjectRef);
  await freshRemoteTargetCheck(options.config.databaseUrl);
  await commandRunner(["db", "push", "--linked", "--yes"]);
  await appliedMigrationCheck(options.config.databaseUrl);
  return { targetWasFresh: true, dryRunCompleted: true, pushApplied: true, migrationCount: freshRemotePushMigrationVersions.length };
};

const runSupabaseCommand = (args: readonly string[], cwd: string): Promise<void> => {
  const invocation = resolveSupabaseCliInvocation();
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, [...invocation.prefixArgs, ...args], {
      cwd,
      stdio: "inherit",
      shell: invocation.shell,
    });
    child.once("error", () => reject(new Error("ADR010_FRESH_PUSH_SUPABASE_CLI_FAILED")));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("ADR010_FRESH_PUSH_SUPABASE_COMMAND_FAILED"));
    });
  });
};
