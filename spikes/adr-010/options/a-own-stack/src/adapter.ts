import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Pool, type PoolClient } from "pg";

import type { Adr010Adapter, ReproducibilityEvidence, WriteFrontierInspection } from "../../../src/index.js";
import type {
  ActorId,
  CreateOrderInput,
  KdsRecovery,
  OrderArtifacts,
  OrderId,
  OrderRecord,
  Session,
  SessionId,
  SpikeFixtures,
} from "../../../src/model.js";
import type { OwnStackAdr010ServerConfig } from "./config.js";

const schema = "adr010_a";
const migrationFile = "0001_adr010_a_thin_slice.sql";

type OrderRow = {
  readonly id: string;
  readonly idempotency_key: string;
  readonly restaurant_id: string;
  readonly branch_id: string;
  readonly actor_id: string;
};

type LineRow = {
  readonly menu_item_id: string;
  readonly quantity: number;
  readonly name: string;
  readonly unit_amount_minor: string;
  readonly currency: string;
};

const backupTables = ["restaurants", "branches", "sessions", "orders", "order_lines", "line_snapshots", "audit_log", "kds_events"] as const;
type BackupTable = (typeof backupTables)[number];

/* Backup data is untrusted at restore time. Identifiers below are source-controlled. */
const backupTableColumns: Readonly<Record<BackupTable, readonly string[]>> = {
  restaurants: ["id"],
  branches: ["restaurant_id", "id"],
  sessions: ["id", "actor_id", "restaurant_id", "branch_id", "revoked_at", "created_at"],
  orders: ["id", "restaurant_id", "branch_id", "actor_id", "idempotency_key", "created_at"],
  order_lines: ["id", "order_id", "menu_item_id", "quantity"],
  line_snapshots: ["id", "order_line_id", "name", "unit_amount_minor", "currency"],
  audit_log: ["id", "order_id", "actor_id", "branch_id", "action"],
  kds_events: ["cursor", "order_id", "restaurant_id", "branch_id", "created_at"],
};

type Backup = {
  readonly kind: "adr010-a-logical-backup-v1";
  readonly tables: Readonly<Record<BackupTable, readonly Record<string, unknown>[]>>;
};

/**
 * PostgreSQL-backed thin-slice adapter. It has no fallback state: each method
 * reads or writes the configured database. Its session row is a spike-only
 * stand-in for a future Auth implementation, but revocation and tenant scope
 * are revalidated by the SQL write function inside the same transaction.
 */
export class OwnStackPostgresAdr010Adapter implements Adr010Adapter {
  public readonly option = "A" as const;
  readonly #pool: Pool;

  public constructor(config: OwnStackAdr010ServerConfig) {
    this.#pool = new Pool({ connectionString: config.databaseUrl, max: 24 });
  }

  public async close(): Promise<void> {
    await this.#pool.end();
  }

  public async migrateFromEmpty(): Promise<void> {
    const migration = await readFile(this.migrationPath(), "utf8");
    await this.#pool.query(migration);
  }

  public async resetToEmpty(): Promise<void> {
    await this.#pool.query(`drop schema if exists ${schema} cascade`);
  }

  public async issueSession(actorId: ActorId, scope: SpikeFixtures["primaryScope"]): Promise<Session> {
    const id = `session-${randomUUID()}`;
    await this.#pool.query(
      `insert into ${schema}.sessions (id, actor_id, restaurant_id, branch_id) values ($1, $2, $3, $4)`,
      [id, actorId, scope.restaurantId, scope.branchId],
    );
    return { id, actorId, scope };
  }

  public async revokeSession(sessionId: SessionId): Promise<void> {
    await this.#pool.query(`update ${schema}.sessions set revoked_at = clock_timestamp() where id = $1`, [sessionId]);
  }

  public async createOrder(input: CreateOrderInput): Promise<OrderRecord> {
    const result = await this.#pool.query<{ readonly order_id: string }>(
      `select order_id from ${schema}.create_order($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        input.sessionId,
        input.scope.restaurantId,
        input.scope.branchId,
        input.idempotencyKey,
        JSON.stringify(input.lines),
        input.induceFailureAfterOrder === true,
      ],
    );
    const orderId = result.rows[0]?.order_id;
    if (orderId === undefined) throw new Error("PostgreSQL ADR-010 create_order returned no order id.");
    const order = await this.loadOrder(input.scope.restaurantId, input.scope.branchId, orderId);
    if (order === undefined) throw new Error("PostgreSQL ADR-010 order was not readable in its authorized scope.");
    return order;
  }

  public async getOrder(scope: CreateOrderInput["scope"], orderId: OrderId): Promise<OrderRecord | undefined> {
    return this.loadOrder(scope.restaurantId, scope.branchId, orderId);
  }

  public async countOrders(scope?: CreateOrderInput["scope"]): Promise<number> {
    const result = scope === undefined
      ? await this.#pool.query<{ readonly count: string }>(`select count(*)::text as count from ${schema}.orders`)
      : await this.#pool.query<{ readonly count: string }>(
          `select count(*)::text as count from ${schema}.orders where restaurant_id = $1 and branch_id = $2`,
          [scope.restaurantId, scope.branchId],
        );
    return Number(result.rows[0]?.count ?? "0");
  }

  public async findOrderIdsByIdempotency(scope: CreateOrderInput["scope"], idempotencyKey: string): Promise<readonly OrderId[]> {
    const result = await this.#pool.query<{ readonly id: string }>(
      `select id::text as id from ${schema}.orders where restaurant_id = $1 and branch_id = $2 and idempotency_key = $3 order by id`,
      [scope.restaurantId, scope.branchId, idempotencyKey],
    );
    return result.rows.map((row) => row.id);
  }

  public async readOrderArtifacts(scope: CreateOrderInput["scope"]): Promise<OrderArtifacts> {
    const result = await this.#pool.query<{
      readonly order_ids: readonly string[];
      readonly line_ids: readonly string[];
      readonly snapshot_ids: readonly string[];
      readonly audit_ids: readonly string[];
    }>(
      `select
        coalesce(array_agg(distinct o.id::text order by o.id::text) filter (where o.id is not null), '{}') as order_ids,
        coalesce(array_agg(distinct l.id::text order by l.id::text) filter (where l.id is not null), '{}') as line_ids,
        coalesce(array_agg(distinct s.id::text order by s.id::text) filter (where s.id is not null), '{}') as snapshot_ids,
        coalesce(array_agg(distinct a.id::text order by a.id::text) filter (where a.id is not null), '{}') as audit_ids
       from ${schema}.orders o
       left join ${schema}.order_lines l on l.order_id = o.id
       left join ${schema}.line_snapshots s on s.order_line_id = l.id
       left join ${schema}.audit_log a on a.order_id = o.id
       where o.restaurant_id = $1 and o.branch_id = $2`,
      [scope.restaurantId, scope.branchId],
    );
    const row = result.rows[0];
    return { orderIds: row?.order_ids ?? [], lineIds: row?.line_ids ?? [], snapshotIds: row?.snapshot_ids ?? [], auditIds: row?.audit_ids ?? [] };
  }

  public writeFrontierInspection(): WriteFrontierInspection {
    return {
      status: "requires-human-inspection",
      evidenceLocation: "spikes/adr-010/options/a-own-stack/README.md#frontera-unica-de-escritura",
      verificationCommand: "rg -n \"insert into|update |delete from|create_order\" spikes/adr-010/options/a-own-stack/src spikes/adr-010/options/a-own-stack/migrations",
      claimedPaths: {
        Order: ["OwnStackCriticalOrderService -> OwnStackPostgresAdr010Adapter.createOrder -> adr010_a.create_order"],
        Payment: ["Reserved: no payment write is implemented in this thin slice"],
        CashMovement: ["Reserved: no cash-movement write is implemented in this thin slice"],
      },
    };
  }

  public async recoverKds(scope: CreateOrderInput["scope"], afterCursor: number): Promise<KdsRecovery> {
    const result = await this.#pool.query<{ readonly cursor: string; readonly order_id: string; readonly restaurant_id: string; readonly branch_id: string }>(
      `select cursor::text, order_id::text, restaurant_id, branch_id from ${schema}.kds_events
       where restaurant_id = $1 and branch_id = $2 and cursor > $3 order by cursor`,
      [scope.restaurantId, scope.branchId, afterCursor],
    );
    const events = result.rows.map((row) => ({
      cursor: Number(row.cursor),
      orderId: row.order_id,
      scope: { restaurantId: row.restaurant_id as CreateOrderInput["scope"]["restaurantId"], branchId: row.branch_id as CreateOrderInput["scope"]["branchId"] },
    }));
    return { events, cursor: events.at(-1)?.cursor ?? afterCursor };
  }

  public async backup(): Promise<unknown> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin transaction isolation level repeatable read read only");
      const tables = await this.readBackupTables(client);
      await client.query("commit");
      return { kind: "adr010-a-logical-backup-v1", tables } satisfies Backup;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  public async restore(backup: unknown): Promise<void> {
    const parsed = parseBackupForRestore(backup);
    await this.migrateFromEmpty();
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      await assertRestoreTargetHasNoBusinessRows(client);
      await assertReferenceRowsMatch(client, parsed);
      for (const table of backupTables.slice(2)) {
        for (const row of parsed.tables[table] ?? []) await insertBackupRow(client, table, row);
      }
      await client.query(`select setval('${schema}.kds_events_cursor_seq', coalesce((select max(cursor) from ${schema}.kds_events), 1), true)`);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  public clientExposedEnvironmentNames(): readonly string[] {
    return [];
  }

  public reproducibilityEvidence(): ReproducibilityEvidence {
    return {
      lockfile: "pnpm-lock.yaml",
      commands: [
        "pnpm install --frozen-lockfile",
        "pnpm --filter @super-restaurant/adr-010-spike lint",
        "pnpm --filter @super-restaurant/adr-010-spike typecheck",
        "pnpm --filter @super-restaurant/adr-010-spike test",
        "pnpm --filter @super-restaurant/adr-010-spike build",
      ],
      evidenceLocation: "spikes/adr-010/options/a-own-stack/README.md#evidencia-reproducible",
    };
  }

  private migrationPath(): string {
    return path.resolve(process.cwd(), "options", "a-own-stack", "migrations", migrationFile);
  }

  private async loadOrder(restaurantId: string, branchId: string, orderId: string): Promise<OrderRecord | undefined> {
    const orderResult = await this.#pool.query<OrderRow>(
      `select id::text, idempotency_key, restaurant_id, branch_id, actor_id from ${schema}.orders
       where id = $1 and restaurant_id = $2 and branch_id = $3`,
      [orderId, restaurantId, branchId],
    );
    const order = orderResult.rows[0];
    if (order === undefined) return undefined;
    const [linesResult, auditResult] = await Promise.all([
      this.#pool.query<LineRow>(
        `select l.menu_item_id, l.quantity, s.name, s.unit_amount_minor::text, s.currency from ${schema}.order_lines l
         join ${schema}.line_snapshots s on s.order_line_id = l.id where l.order_id = $1 order by l.id`,
        [order.id],
      ),
      this.#pool.query<{ readonly actor_id: string; readonly branch_id: string; readonly action: "ORDER_CREATED" }>(
        `select actor_id, branch_id, action from ${schema}.audit_log where order_id = $1`, [order.id],
      ),
    ]);
    const audit = auditResult.rows[0];
    if (audit === undefined) throw new Error("PostgreSQL ADR-010 order has no audit artifact.");
    return {
      id: order.id,
      idempotencyKey: order.idempotency_key,
      scope: { restaurantId: order.restaurant_id as CreateOrderInput["scope"]["restaurantId"], branchId: order.branch_id as CreateOrderInput["scope"]["branchId"] },
      lines: linesResult.rows.map((line) => ({
        menuItemId: line.menu_item_id,
        quantity: line.quantity,
        snapshot: { name: line.name, unitAmountMinor: Number(line.unit_amount_minor), currency: line.currency },
      })),
      audit: { actorId: audit.actor_id, branchId: audit.branch_id, action: audit.action },
    };
  }

  private async readBackupTables(client: PoolClient): Promise<Readonly<Record<string, readonly Record<string, unknown>[]>>> {
    const entries = await Promise.all(backupTables.map(async (table) => [table, (await client.query<Record<string, unknown>>(`select * from ${schema}.${table} order by 1`)).rows] as const));
    return Object.fromEntries(entries);
  }
}

export const parseBackupForRestore = (value: unknown): Backup => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid PostgreSQL ADR-010 backup.");
  const candidate = value as Partial<Backup>;
  if (candidate.kind !== "adr010-a-logical-backup-v1" || typeof candidate.tables !== "object" || candidate.tables === null) {
    throw new Error("Invalid PostgreSQL ADR-010 backup format.");
  }
  const tables = candidate.tables as Record<string, unknown>;
  if (Object.keys(tables).length !== backupTables.length || backupTables.some((table) => !(table in tables))) {
    throw new Error("PostgreSQL ADR-010 backup must contain exactly the supported tables.");
  }
  for (const table of backupTables) {
    const rows = tables[table];
    if (!Array.isArray(rows)) throw new Error(`PostgreSQL ADR-010 backup table ${table} must be an array.`);
    for (const row of rows) assertBackupRowShape(table, row);
  }
  return { kind: candidate.kind, tables: tables as Backup["tables"] };
};

const assertBackupRowShape: (table: BackupTable, row: unknown) => asserts row is Record<string, unknown> = (table, row) => {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw new Error(`Backup row for ${table} is not an object.`);
  const columns = backupTableColumns[table];
  const keys = Object.keys(row);
  if (keys.length !== columns.length || columns.some((column) => !(column in row)) || keys.some((key) => !columns.includes(key))) {
    throw new Error(`Backup row for ${table} has an unsupported shape.`);
  }
};

const insertBackupRow = async (client: PoolClient, table: BackupTable, row: Record<string, unknown>): Promise<void> => {
  assertBackupRowShape(table, row);
  const columns = backupTableColumns[table];
  const values = columns.map((column) => row[column]);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  // `table` and `columns` are fixed allowlists above, never backup input.
  // The restore target was checked empty, so a conflict is corruption, not a
  // condition to hide with ON CONFLICT DO NOTHING.
  await client.query(`insert into ${schema}.${table} (${columns.join(", ")}) values (${placeholders.join(", ")})`, values);
};

const assertRestoreTargetHasNoBusinessRows = async (client: PoolClient): Promise<void> => {
  for (const table of backupTables.slice(2)) {
    const result = await client.query<{ readonly count: string }>(`select count(*)::text as count from ${schema}.${table}`);
    if (result.rows[0]?.count !== "0") {
      throw new Error("PostgreSQL ADR-010 restore target contains business rows; reset the isolated schema before restoring.");
    }
  }
};

const assertReferenceRowsMatch = async (client: PoolClient, backup: Backup): Promise<void> => {
  for (const table of backupTables.slice(0, 2)) {
    const columns = backupTableColumns[table];
    const actual = (await client.query<Record<string, unknown>>(`select ${columns.join(", ")} from ${schema}.${table} order by ${columns.join(", ")}`)).rows;
    const expected = backup.tables[table];
    if (!sameBackupRows(columns, expected, actual)) {
      throw new Error("PostgreSQL ADR-010 restore reference fixtures do not match the isolated migration.");
    }
  }
};

const sameBackupRows = (
  columns: readonly string[],
  expected: readonly Record<string, unknown>[],
  actual: readonly Record<string, unknown>[],
): boolean =>
  expected.length === actual.length && expected.every((row, index) => columns.every((column) => row[column] === actual[index]?.[column]));
