import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";

import type { Adr010Adapter, WriteFrontierInspection } from "../../../src/adapter.js";
import {
  asBranchScope,
  type CreateOrderInput,
  type KdsRecovery,
  type OrderArtifacts,
  type OrderId,
  type OrderLineInput,
  type OrderRecord,
  type ReproducibilityEvidence,
  type Session,
  type SessionId,
  type SpikeFixtures,
} from "../../../src/model.js";
import type { AuthenticatedSupabasePrincipal } from "./auth-principal.js";
import { SupabaseAuthPrincipalVerifier } from "./auth-principal.js";
import { serializeJsonbArrayParameter } from "./auth-bootstrap.js";
import type { SupabaseAdr010GateConfig } from "./config.js";
import { SupabaseAdr010CriticalOrderService } from "./nest-boundary.js";
import { SupabaseAdr010CriticalFinancialService } from "./nest-boundary.js";
import type {
  CashPaymentRecord,
  CashRefundRecord,
  CriticalFinancialWritePort,
  SupabaseCreateCashPaymentRequest,
  SupabaseCreateCashRefundRequest,
  VerifiedCashPaymentCommand,
  VerifiedCashRefundCommand,
} from "./financial-contract.js";

export interface CriticalOrderWritePort {
  createOrder(command: VerifiedSupabaseServerCreateOrderCommand): Promise<OrderRecord>;
}

export interface VerifiedSupabaseServerCreateOrderCommand {
  readonly principal: AuthenticatedSupabasePrincipal;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly idempotencyKey: string;
  readonly lines: readonly OrderLineInput[];
  readonly induceFailureAfterOrder?: boolean;
}

type GateSession = {
  readonly id: SessionId;
  readonly userId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly readClient: SupabaseClient;
  readonly scope: SpikeFixtures["primaryScope"];
};

export type RefreshTokenRotationEvidence = Readonly<{
  readonly accessTokenRotated: boolean;
  readonly refreshTokenRotated: boolean;
  readonly refreshedSessionValid: boolean;
  readonly refreshedUserValid: boolean;
  readonly refreshedAccessTokenAccepted: boolean;
  readonly revokedRefreshTokenRejected: boolean;
}>;

const backupTables = ["orders", "order_lines", "order_line_snapshots", "order_idempotency", "audit_log", "kds_events", "payments", "refunds", "cash_movements", "financial_audit_log"] as const;
type BackupTable = (typeof backupTables)[number];
type LogicalBackup = {
  readonly format: "adr010-b-logical-v1";
  readonly projectRef: string;
  readonly tables: Readonly<Record<BackupTable, readonly Record<string, unknown>[]>>;
  readonly deviceSequences: readonly Record<string, unknown>[];
};

export type Adr010CloseOperations = {
  readonly reset: () => Promise<void>;
  readonly cleanup: () => Promise<void>;
  readonly endPool: () => Promise<void>;
};

/**
 * Runs one close attempt. The pool is ended only after every cleanup step has
 * succeeded, so callers can retry a failed attempt while its dependencies are
 * still usable. Both reset and Auth cleanup are attempted and their errors are
 * preserved when more than one step fails.
 */
export const runAdr010CloseAttempt = async ({ reset, cleanup, endPool }: Adr010CloseOperations): Promise<void> => {
  const errors: unknown[] = [];
  try { await reset(); } catch (error) { errors.push(error); }
  try { await cleanup(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "ADR010_B_CLOSE_CLEANUP_FAILED");
  await endPool();
};

export type FinancialArtifactSnapshot = Readonly<{
  readonly payments: readonly Record<string, unknown>[];
  readonly refunds: readonly Record<string, unknown>[];
  readonly cashMovements: readonly Record<string, unknown>[];
  readonly audits: readonly Record<string, unknown>[];
}>;

/** The only critical Order write port; it uses PostgreSQL, never the Data API. */
export class SupabaseCriticalOrderPostgresPort implements CriticalOrderWritePort {
  public constructor(private readonly pool: Pool) {}

  public async createOrder(input: VerifiedSupabaseServerCreateOrderCommand): Promise<OrderRecord> {
    const result = await this.pool.query<{ readonly order: unknown }>(
      "select adr010_b_private.adr010_b_create_order($1::jsonb) as \"order\"",
      [{
        actorId: input.principal.actorId,
        restaurantId: input.restaurantId,
        branchId: input.branchId,
        idempotencyKey: input.idempotencyKey,
        lines: input.lines,
        induceFailureAfterOrder: input.induceFailureAfterOrder === true,
      }],
    );
    return parseOrderRecord(result.rows[0]?.order);
  }
}

/** The only critical Payment/CashMovement write port; it uses PostgreSQL, never the Data API. */
export class SupabaseCriticalFinancialPostgresPort implements CriticalFinancialWritePort {
  public constructor(private readonly pool: Pool) {}

  public async createCashPayment(input: VerifiedCashPaymentCommand): Promise<CashPaymentRecord> {
    const result = await this.pool.query<{ readonly payment: unknown }>(
      "select adr010_b_private.adr010_b_create_cash_payment($1::jsonb) as payment",
      [{ ...input, actorId: input.principal.actorId }],
    );
    return parseCashPaymentRecord(result.rows[0]?.payment);
  }

  public async refundCashPayment(input: VerifiedCashRefundCommand): Promise<CashRefundRecord> {
    const result = await this.pool.query<{ readonly refund: unknown }>(
      "select adr010_b_private.adr010_b_refund_cash_payment($1::jsonb) as refund",
      [{ ...input, actorId: input.principal.actorId }],
    );
    return parseCashRefundRecord(result.rows[0]?.refund);
  }
}

/**
 * Remote-only option-B gate adapter. It creates real disposable Supabase Auth
 * sessions. Every critical write enters the Nest service, which calls
 * auth.getUser and derives actorId before reaching private PostgreSQL.
 */
export class SupabaseNestAdr010Adapter implements Adr010Adapter {
  public readonly option = "B" as const;
  readonly #pool: Pool;
  readonly #admin: SupabaseClient;
  readonly #criticalService: SupabaseAdr010CriticalOrderService;
  readonly #financialService: SupabaseAdr010CriticalFinancialService;
  readonly #sessions = new Map<SessionId, GateSession>();
  readonly #createdUserIds = new Set<string>();
  readonly #revokedSessionIds = new Set<SessionId>();
  #closed = false;
  #closePromise: Promise<void> | undefined;

  public constructor(private readonly config: SupabaseAdr010GateConfig) {
    this.#pool = new Pool({ connectionString: config.databaseUrl });
    this.#admin = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const verifier = new SupabaseAuthPrincipalVerifier(config);
    this.#criticalService = new SupabaseAdr010CriticalOrderService(
      new SupabaseCriticalOrderPostgresPort(this.#pool),
      verifier,
    );
    this.#financialService = new SupabaseAdr010CriticalFinancialService(
      new SupabaseCriticalFinancialPostgresPort(this.#pool),
      verifier,
    );
  }

  public async migrateFromEmpty(): Promise<void> {
    const migrationRows = await this.#pool.query<{ readonly version: string }>(
      "select version from supabase_migrations.schema_migrations where version=any($1::text[]) order by version",
      [["20260825000100", "20260826000100", "20260827000100", "20260828000100", "20260829000100"]],
    );
    if (migrationRows.rows.map(({ version }) => version).join(",") !== "20260825000100,20260826000100,20260827000100,20260828000100,20260829000100") {
      throw new Error("ADR010_B_MIGRATION_SERIES_INCOMPLETE");
    }
    await this.#withTransaction(async (client) => {
      await client.query(`insert into adr010_b.restaurants(id,name) values
        ('00000000-0000-4000-8000-0000000000a1','Amber'),('00000000-0000-4000-8000-0000000000b1','Cobalt') on conflict do nothing`);
      await client.query(`insert into adr010_b.branches(id,restaurant_id,name) values
        ('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a1','Amber North'),
        ('00000000-0000-4000-8000-0000000000a3','00000000-0000-4000-8000-0000000000a1','Amber South'),
        ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b1','Cobalt North'),
        ('00000000-0000-4000-8000-0000000000b3','00000000-0000-4000-8000-0000000000b1','Cobalt South') on conflict do nothing`);
    });
    const result = await this.#pool.query<{
      readonly structural_rows: string;
      readonly structural_branches: string;
      readonly rls_tables: string;
      readonly private_rpcs: string;
      readonly device_sequence_table: boolean;
      readonly device_sequence_rls: boolean;
      readonly data_api_write_denied: boolean;
      readonly private_execution_denied: boolean;
      readonly authenticated_read_granted: boolean;
      readonly bootstrap_read_denied: boolean;
      readonly privileged_data_api_read_denied: boolean;
    }>(`
      select
        (select count(*)::text from adr010_b.restaurants where id in
          ('00000000-0000-4000-8000-0000000000a1'::uuid,'00000000-0000-4000-8000-0000000000b1'::uuid)) structural_rows,
        (select count(*)::text from adr010_b.branches where id in
          ('00000000-0000-4000-8000-0000000000a2'::uuid,'00000000-0000-4000-8000-0000000000a3'::uuid,
           '00000000-0000-4000-8000-0000000000b2'::uuid,'00000000-0000-4000-8000-0000000000b3'::uuid)) structural_branches,
        (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='adr010_b' and c.relrowsecurity and c.relforcerowsecurity
          and c.relname in ('restaurants','branches','memberships','bootstrap_users','orders','order_lines','order_line_snapshots','order_idempotency','audit_log','kds_events','payments','refunds','cash_movements','financial_audit_log')) rls_tables,
        (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='adr010_b_private' and p.proname in ('adr010_b_create_order','adr010_b_create_cash_payment','adr010_b_refund_cash_payment','adr010_b_claim_device_sequence')) private_rpcs,
        to_regclass('adr010_b_private.device_sequences') is not null device_sequence_table,
        exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='adr010_b_private' and c.relname='device_sequences' and c.relrowsecurity and c.relforcerowsecurity) device_sequence_rls,
        not exists (
          select 1 from unnest(array['anon','authenticated','service_role']) role_name
          cross join pg_tables table_name where table_name.schemaname='adr010_b' and
          (has_table_privilege(role_name,format('%I.%I',table_name.schemaname,table_name.tablename),'INSERT') or
           has_table_privilege(role_name,format('%I.%I',table_name.schemaname,table_name.tablename),'UPDATE') or
           has_table_privilege(role_name,format('%I.%I',table_name.schemaname,table_name.tablename),'DELETE'))
        ) data_api_write_denied,
        not exists (
          select 1 from unnest(array['anon','authenticated','service_role']) role_name where
          has_schema_privilege(role_name,'adr010_b_private','USAGE') or
          has_function_privilege(role_name,'adr010_b_private.adr010_b_create_order(jsonb)','EXECUTE')
        ) private_execution_denied,
        has_table_privilege('authenticated','adr010_b.orders','SELECT') authenticated_read_granted,
        not has_table_privilege('authenticated','adr010_b.bootstrap_users','SELECT') bootstrap_read_denied,
        not exists (
          select 1 from unnest(array['anon','service_role']) role_name
          cross join pg_tables table_name where table_name.schemaname='adr010_b' and
          has_table_privilege(role_name,format('%I.%I',table_name.schemaname,table_name.tablename),'SELECT')
        ) privileged_data_api_read_denied
    `);
    const row = result.rows[0];
    if (row?.structural_rows !== "2" || row.structural_branches !== "4" || row.rls_tables !== "14" || row.private_rpcs !== "4" || row.device_sequence_table !== true || row.device_sequence_rls !== true ||
      row.data_api_write_denied !== true || row.private_execution_denied !== true || row.authenticated_read_granted !== true ||
      row.bootstrap_read_denied !== true || row.privileged_data_api_read_denied !== true) {
      throw new Error("ADR010_B_MIGRATION_OR_STRUCTURAL_FIXTURES_INCOMPLETE");
    }
  }

  public async resetToEmpty(): Promise<void> {
    await this.#withTransaction((client) => this.#resetWithClient(client));
  }

  public async issueSession(_requestedActorId: string, scope: SpikeFixtures["primaryScope"], role: "cashier" | "manager" = "cashier"): Promise<Session> {
    const bootstrapRunId = randomUUID();
    const credentials = { email: `adr010-b-gate-${randomUUID()}@example.com`, password: randomBytes(32).toString("base64url") };
    const { data: created, error: createError } = await this.#admin.auth.admin.createUser({
      ...credentials,
      email_confirm: true,
      // Reuse the bootstrap marker contract so the explicit cleanup command can
      // discover a user left behind by process termination before close().
      app_metadata: {
        adr010_b_bootstrap: "v1",
        bootstrap_run_id: bootstrapRunId,
        adr010_b_common_gate: true,
        project_ref: this.config.confirmedIsolatedProjectRef,
      },
    });
    if (createError !== null || created.user === null) throw new Error("ADR010_B_AUTH_USER_CREATION_FAILED");
    const userId = created.user.id;
    this.#createdUserIds.add(userId);
    try {
      await this.#withTransaction(async (database) => {
        await database.query(
          "insert into adr010_b.bootstrap_users(user_id,fixture_key,bootstrap_run_id) values($1::uuid,'amber',$2::uuid)",
          [userId, bootstrapRunId],
        );
        await database.query(
          "insert into adr010_b.memberships(user_id,restaurant_id,branch_id,role) values($1::uuid,$2::uuid,$3::uuid,$4::text)",
          [userId, scope.restaurantId, scope.branchId, role],
        );
      });
      const client = createClient(this.config.url, this.config.publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      const { data: signedIn, error: signInError } = await client.auth.signInWithPassword(credentials);
      if (signInError !== null || signedIn.session === null || signedIn.user?.id !== userId) throw new Error("ADR010_B_AUTH_SESSION_CREATION_FAILED");
      const id = randomUUID();
      this.#sessions.set(id, {
        id,
        userId,
        accessToken: signedIn.session.access_token,
        refreshToken: signedIn.session.refresh_token,
        readClient: client,
        scope,
      });
      return { id, actorId: userId, scope };
    } catch (error) {
      // Do not discard the tracked ID until both database evidence and the
      // Auth identity have actually been removed. close() can retry a partial
      // cleanup and the Auth metadata marker remains available to the explicit
      // cleanup command if this process terminates first.
      try {
        await this.#cleanupCreatedUsers([userId]);
      } catch {
        throw new Error("ADR010_B_AUTH_SESSION_SETUP_FAILED_CLEANUP_REQUIRED", { cause: error });
      }
      throw error;
    }
  }

  public async revokeSession(sessionId: SessionId): Promise<void> {
    const session = this.#requireSession(sessionId);
    await this.#pool.query("update adr010_b.memberships set revoked_at=now() where user_id=$1::uuid and revoked_at is null", [session.userId]);
    const { error } = await this.#admin.auth.admin.signOut(session.accessToken, "global");
    if (error !== null) throw new Error("ADR010_B_AUTH_SESSION_REVOCATION_FAILED");
    this.#revokedSessionIds.add(sessionId);
  }

  /**
   * Gate-only evidence for Supabase Auth refresh rotation. Refresh tokens stay
   * in the in-memory session map and are never returned or logged.
   */
  public async proveRefreshTokenRotation(sessionId: SessionId): Promise<RefreshTokenRotationEvidence> {
    const session = this.#requireSession(sessionId);
    const previousAccessToken = session.accessToken;
    const previousRefreshToken = session.refreshToken;
    const { data, error } = await session.readClient.auth.refreshSession({ refresh_token: previousRefreshToken });
    const refreshedSessionValid = error === null
      && data.session !== null
      && typeof data.session.access_token === "string"
      && data.session.access_token.length > 0
      && typeof data.session.refresh_token === "string"
      && data.session.refresh_token.length > 0
      && data.session.token_type === "bearer"
      && data.session.user.id === session.userId;
    const refreshedUserValid = error === null
      && data.user !== null
      && data.user.id === session.userId;
    if (!refreshedSessionValid || !refreshedUserValid) throw new Error("ADR010_B_REFRESH_TOKEN_ROTATION_FAILED");

    const refreshedSession = data.session;
    if (refreshedSession === null) throw new Error("ADR010_B_REFRESH_TOKEN_ROTATION_FAILED");
    const accessTokenRotated = refreshedSession.access_token !== previousAccessToken;
    const refreshTokenRotated = refreshedSession.refresh_token !== previousRefreshToken;
    if (!accessTokenRotated || !refreshTokenRotated) throw new Error("ADR010_B_REFRESH_TOKEN_NOT_ROTATED");

    // Replace both credentials together only after Auth returned a valid,
    // identity-bound session. The map is the only in-memory token store.
    this.#sessions.set(sessionId, {
      ...session,
      accessToken: refreshedSession.access_token,
      refreshToken: refreshedSession.refresh_token,
    });

    try {
      await this.createOrder({
        sessionId,
        scope: session.scope,
        idempotencyKey: `refresh-token-gate-${randomUUID()}`,
        lines: [{ menuItemId: "refresh-token-gate-item", quantity: 1, snapshot: { name: "Refresh token gate", unitAmountMinor: 1, currency: "MXN" } }],
      });
    } catch {
      throw new Error("ADR010_B_REFRESHED_ACCESS_TOKEN_WRITE_FAILED");
    }
    const refreshedAccessTokenAccepted = true;

    await this.revokeSession(sessionId);
    const latestSession = this.#requireSession(sessionId);
    const { data: revokedData, error: revokedError } = await latestSession.readClient.auth.refreshSession({
      refresh_token: latestSession.refreshToken,
    });
    const revokedRefreshTokenRejected = revokedError !== null || revokedData.session === null;
    if (!revokedRefreshTokenRejected) throw new Error("ADR010_B_REVOKED_REFRESH_TOKEN_ACCEPTED");

    return Object.freeze({
      accessTokenRotated,
      refreshTokenRotated,
      refreshedSessionValid,
      refreshedUserValid,
      refreshedAccessTokenAccepted,
      revokedRefreshTokenRejected,
    });
  }

  public async createOrder(input: CreateOrderInput): Promise<OrderRecord> {
    const session = this.#requireSession(input.sessionId);
    return this.#criticalService.createOrder({
      accessToken: session.accessToken,
      restaurantId: input.scope.restaurantId,
      branchId: input.scope.branchId,
      idempotencyKey: input.idempotencyKey,
      lines: input.lines,
      ...(input.induceFailureAfterOrder === undefined ? {} : { induceFailureAfterOrder: input.induceFailureAfterOrder }),
    });
  }

  public async createCashPayment(input: SupabaseCreateCashPaymentRequest): Promise<CashPaymentRecord> {
    return this.#financialService.createCashPayment(input);
  }

  public async refundCashPayment(input: SupabaseCreateCashRefundRequest): Promise<CashRefundRecord> {
    return this.#financialService.refundCashPayment(input);
  }

  /** Integration-only bridge; production Nest controllers receive bearer tokens directly. */
  public accessTokenForGate(sessionId: SessionId): string { return this.#requireSession(sessionId).accessToken; }

  public async readFinancialArtifacts(scope: CreateOrderInput["scope"]): Promise<{ readonly payments: number; readonly refunds: number; readonly cashMovements: number; readonly audits: number }> {
    const values = [scope.restaurantId, scope.branchId];
    const count = async (table: "payments" | "refunds" | "cash_movements" | "financial_audit_log") => {
      const result = await this.#pool.query<{ readonly count: string }>(`select count(*)::text count from adr010_b.${table} where restaurant_id=$1::uuid and branch_id=$2::uuid`, values);
      return parseSafeInteger(result.rows[0]?.count, `FINANCIAL_${table.toUpperCase()}`);
    };
    const [payments, refunds, cashMovements, audits] = await Promise.all([count("payments"), count("refunds"), count("cash_movements"), count("financial_audit_log")]);
    return { payments, refunds, cashMovements, audits };
  }

  public async readFinancialArtifactSnapshot(scope: CreateOrderInput["scope"]): Promise<FinancialArtifactSnapshot> {
    const values = [scope.restaurantId, scope.branchId];
    const read = (table: "payments" | "refunds" | "cash_movements" | "financial_audit_log") =>
      this.#pool.query<Record<string, unknown>>(`select * from adr010_b.${table} where restaurant_id=$1::uuid and branch_id=$2::uuid order by id`, values);
    const [payments, refunds, cashMovements, audits] = await Promise.all([
      read("payments"), read("refunds"), read("cash_movements"), read("financial_audit_log"),
    ]);
    return { payments: payments.rows, refunds: refunds.rows, cashMovements: cashMovements.rows, audits: audits.rows };
  }

  public async getOrder(scope: CreateOrderInput["scope"], orderId: OrderId): Promise<OrderRecord | undefined> {
    const owner = await this.#pool.query<{ readonly actor_id: string }>("select actor_id::text from adr010_b.orders where id=$1::uuid", [orderId]);
    const session = [...this.#sessions.values()].find(({ userId, id }) => userId === owner.rows[0]?.actor_id && !this.#revokedSessionIds.has(id));
    if (session === undefined) throw new Error("ADR010_B_ORDER_HAS_NO_ACTIVE_RLS_FIXTURE_SESSION");
    const { data: visible, error: readError } = await session.readClient.schema("adr010_b").from("orders").select("id")
      .eq("restaurant_id", scope.restaurantId).eq("branch_id", scope.branchId).eq("id", orderId);
    if (readError !== null) throw new Error("ADR010_B_RLS_ORDER_READ_FAILED");
    if (visible.length === 0) return undefined;
    if (visible.length !== 1) throw new Error("ADR010_B_RLS_ORDER_READ_AMBIGUOUS");
    const result = await this.#pool.query<{ readonly record: unknown }>(
      `select jsonb_build_object(
        'id',o.id,'idempotencyKey',o.idempotency_key,
        'scope',jsonb_build_object('restaurantId',o.restaurant_id,'branchId',o.branch_id),
        'lines',coalesce((select jsonb_agg(jsonb_build_object('menuItemId',l.menu_item_id,'quantity',l.quantity,
          'snapshot',jsonb_build_object('name',s.name,'unitAmountMinor',s.unit_amount_minor,'currency',s.currency)) order by l.created_at,l.id)
          from adr010_b.order_lines l join adr010_b.order_line_snapshots s
          on s.line_id=l.id and s.restaurant_id=l.restaurant_id and s.branch_id=l.branch_id where l.order_id=o.id),'[]'::jsonb),
        'audit',jsonb_build_object('actorId',o.actor_id,'branchId',o.branch_id,'action','ORDER_CREATED')) record
       from adr010_b.orders o where o.restaurant_id=$1::uuid and o.branch_id=$2::uuid and o.id=$3::uuid`,
      [scope.restaurantId, scope.branchId, orderId],
    );
    const value = result.rows[0]?.record;
    return value === null || value === undefined ? undefined : parseOrderRecord(value);
  }

  public async countOrders(scope?: CreateOrderInput["scope"]): Promise<number> {
    const result = await this.#pool.query<{ readonly count: string }>(
      scope === undefined ? "select count(*)::text count from adr010_b.orders" :
        "select count(*)::text count from adr010_b.orders where restaurant_id=$1::uuid and branch_id=$2::uuid",
      scope === undefined ? [] : [scope.restaurantId, scope.branchId],
    );
    return parseSafeInteger(result.rows[0]?.count, "ORDER_COUNT");
  }

  public async findOrderIdsByIdempotency(scope: CreateOrderInput["scope"], idempotencyKey: string): Promise<readonly OrderId[]> {
    const result = await this.#pool.query<{ readonly id: string }>(
      "select id::text from adr010_b.orders where restaurant_id=$1::uuid and branch_id=$2::uuid and idempotency_key=$3 order by id",
      [scope.restaurantId, scope.branchId, idempotencyKey],
    );
    return result.rows.map(({ id }) => id);
  }

  public async readOrderArtifacts(scope: CreateOrderInput["scope"]): Promise<OrderArtifacts> {
    const values = [scope.restaurantId, scope.branchId];
    const queryIds = (table: "orders" | "order_lines" | "order_line_snapshots" | "audit_log") =>
      this.#pool.query<{ readonly id: string }>(`select id::text from adr010_b.${table} where restaurant_id=$1::uuid and branch_id=$2::uuid order by id`, values);
    const [orders, lines, snapshots, audits] = await Promise.all([queryIds("orders"), queryIds("order_lines"), queryIds("order_line_snapshots"), queryIds("audit_log")]);
    return {
      orderIds: orders.rows.map(({ id }) => id), lineIds: lines.rows.map(({ id }) => id),
      snapshotIds: snapshots.rows.map(({ id }) => id), auditIds: audits.rows.map(({ id }) => id),
    };
  }

  public writeFrontierInspection(): WriteFrontierInspection {
    return {
      status: "requires-human-inspection",
      evidenceLocation: "spikes/adr-010/options/b-supabase-nest/WRITE_FRONTIER.md",
      verificationCommand: "pnpm --filter @super-restaurant/adr-010-spike test:option-b:gates",
      claimedPaths: {
        Order: ["Nest critical service -> PostgreSQL port -> adr010_b_private.adr010_b_create_order"],
        Payment: ["Nest critical financial service -> PostgreSQL port -> adr010_b_private.adr010_b_create_cash_payment / adr010_b_refund_cash_payment"],
        CashMovement: ["Nest critical financial service -> PostgreSQL port -> payment/refund private SQL functions atomically append immutable cash movement"],
      },
    };
  }

  public async recoverKds(scope: CreateOrderInput["scope"], afterCursor: number): Promise<KdsRecovery> {
    const session = [...this.#sessions.values()].find(({ id }) => !this.#revokedSessionIds.has(id));
    if (session === undefined) throw new Error("ADR010_B_KDS_HAS_NO_ACTIVE_RLS_FIXTURE_SESSION");
    const { data, error } = await session.readClient.schema("adr010_b").from("kds_events")
      .select("cursor,order_id,restaurant_id,branch_id")
      .eq("restaurant_id", scope.restaurantId).eq("branch_id", scope.branchId).gt("cursor", afterCursor).order("cursor");
    if (error !== null) throw new Error("ADR010_B_RLS_KDS_RECOVERY_FAILED");
    const events = data.map((row) => ({ cursor: parseSafeInteger(String(row.cursor), "KDS_CURSOR"), orderId: String(row.order_id), scope: asBranchScope(String(row.restaurant_id), String(row.branch_id)) }));
    return { events, cursor: events.at(-1)?.cursor ?? afterCursor };
  }

  public async backup(): Promise<unknown> {
    return this.#withTransaction(async (client) => {
      // All tables must come from one database snapshot. Reading them through
      // separate pool queries could combine states from different commits.
      await client.query("set transaction isolation level repeatable read read only");
      const tables = {} as Record<BackupTable, readonly Record<string, unknown>[]>;
      for (const table of backupTables) {
        tables[table] = (await client.query<Record<string, unknown>>(`select * from adr010_b.${table} order by 1`)).rows;
      }
      const deviceSequences = (await client.query<Record<string, unknown>>("select * from adr010_b_private.device_sequences order by device_id")).rows;
      return { format: "adr010-b-logical-v1", projectRef: this.config.confirmedIsolatedProjectRef, tables, deviceSequences } satisfies LogicalBackup;
    });
  }

  public async restore(backup: unknown): Promise<void> {
    const data = parseLogicalBackup(backup, this.config.confirmedIsolatedProjectRef);
    await this.#withTransaction(async (client) => {
      await assertRestoreTargetEmpty(client);
      await restoreRows(client, "orders", data.tables.orders);
      await restoreRows(client, "order_lines", data.tables.order_lines);
      await restoreRows(client, "order_line_snapshots", data.tables.order_line_snapshots);
      await restoreRows(client, "order_idempotency", data.tables.order_idempotency);
      await restoreRows(client, "audit_log", data.tables.audit_log);
      await restoreRows(client, "kds_events", data.tables.kds_events);
      await restoreRows(client, "payments", data.tables.payments);
      await restoreRows(client, "refunds", data.tables.refunds);
      await restoreRows(client, "cash_movements", data.tables.cash_movements);
      await restoreRows(client, "financial_audit_log", data.tables.financial_audit_log);
      await restoreDeviceSequences(client, data.deviceSequences);
      await client.query("select setval(pg_get_serial_sequence('adr010_b.kds_events','cursor'),coalesce((select max(cursor) from adr010_b.kds_events),1),exists(select 1 from adr010_b.kds_events))");
    });
  }

  public clientExposedEnvironmentNames(): readonly string[] { return ["ADR010_SUPABASE_URL", "ADR010_SUPABASE_PUBLISHABLE_KEY"]; }

  public reproducibilityEvidence(): ReproducibilityEvidence {
    return { lockfile: "pnpm-lock.yaml", commands: [
      "pnpm install --frozen-lockfile", "pnpm --filter @super-restaurant/adr-010-spike lint",
      "pnpm --filter @super-restaurant/adr-010-spike typecheck", "pnpm --filter @super-restaurant/adr-010-spike test",
      "pnpm --filter @super-restaurant/adr-010-spike build",
    ], evidenceLocation: "spikes/adr-010/options/b-supabase-nest/REMOTE_EVIDENCE.md" };
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closePromise !== undefined) return this.#closePromise;
    const attempt = runAdr010CloseAttempt({
      reset: () => this.resetToEmpty(),
      cleanup: () => this.#cleanupCreatedUsers([...this.#createdUserIds]),
      endPool: () => this.#pool.end(),
    });
    this.#closePromise = attempt.then(
      () => { this.#closed = true; },
      (error: unknown) => {
        // Cleanup failures leave the pool open and the state retryable. Do not
        // memoize a rejected promise, otherwise a later close() would not retry.
        this.#closePromise = undefined;
        throw error;
      },
    );
    return this.#closePromise;
  }

  public async probePrivateDatabase(): Promise<void> { await this.migrateFromEmpty(); }

  #requireSession(id: SessionId): GateSession {
    const session = this.#sessions.get(id);
    if (session === undefined) throw new Error("ADR010_B_UNKNOWN_SESSION");
    return session;
  }

  async #withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try { await client.query("begin"); const result = await operation(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async #resetWithClient(client: PoolClient): Promise<void> {
    await client.query("select set_config('adr010_b.financial_cleanup','on',true)");
    await client.query("delete from adr010_b_private.device_sequences");
    for (const table of ["financial_audit_log","cash_movements","refunds","payments","kds_events","audit_log","order_line_snapshots","order_lines","order_idempotency","orders"] as const) await client.query(`delete from adr010_b.${table}`);
  }

  async #cleanupCreatedUsers(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.#pool.query(
      "select adr010_b_private.adr010_b_cleanup_auth_bootstrap($1::jsonb)",
      [serializeJsonbArrayParameter(userIds)],
    );
    const failures: string[] = [];
    for (const userId of userIds) {
      const { error } = await this.#admin.auth.admin.deleteUser(userId);
      if (error === null) this.#createdUserIds.delete(userId);
      else failures.push(userId);
    }
    if (failures.length > 0) throw new Error("ADR010_B_AUTH_CLEANUP_INCOMPLETE");
    const cleanedUserIds = new Set(userIds);
    if (this.#createdUserIds.size === 0) {
      this.#sessions.clear();
      this.#revokedSessionIds.clear();
    } else {
      for (const [sessionId, session] of this.#sessions) {
        if (cleanedUserIds.has(session.userId)) this.#sessions.delete(sessionId);
      }
      for (const sessionId of this.#revokedSessionIds) {
        if (!this.#sessions.has(sessionId)) this.#revokedSessionIds.delete(sessionId);
      }
    }
  }
}

const deviceSequenceRestoreDefinition = {
  columns: "device_id,last_sequence,updated_at",
  definition: "device_id text,last_sequence bigint,updated_at timestamptz",
} as const;

const restoreDefinitions: Record<BackupTable, { readonly columns: string; readonly definition: string; readonly override?: boolean }> = {
  orders: { columns: "id,restaurant_id,branch_id,actor_id,idempotency_key,request_payload,status,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,actor_id uuid,idempotency_key text,request_payload jsonb,status text,created_at timestamptz" },
  order_lines: { columns: "id,restaurant_id,branch_id,order_id,menu_item_id,quantity,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,order_id uuid,menu_item_id text,quantity integer,created_at timestamptz" },
  order_line_snapshots: { columns: "id,restaurant_id,branch_id,line_id,name,unit_amount_minor,currency,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,line_id uuid,name text,unit_amount_minor bigint,currency char(3),created_at timestamptz" },
  order_idempotency: { columns: "id,restaurant_id,branch_id,idempotency_key,order_id,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,idempotency_key text,order_id uuid,created_at timestamptz" },
  audit_log: { columns: "id,restaurant_id,branch_id,order_id,actor_id,action,reason,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,order_id uuid,actor_id uuid,action text,reason text,created_at timestamptz" },
  kds_events: { columns: "cursor,id,restaurant_id,branch_id,order_id,event_type,created_at", definition: "cursor bigint,id uuid,restaurant_id uuid,branch_id uuid,order_id uuid,event_type text,created_at timestamptz", override: true },
  payments: { columns: "id,restaurant_id,branch_id,order_id,actor_id,idempotency_key,request_payload,amount_minor,currency,method,device_id,local_sequence,occurred_at,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,order_id uuid,actor_id uuid,idempotency_key text,request_payload jsonb,amount_minor bigint,currency char(3),method text,device_id text,local_sequence bigint,occurred_at timestamptz,created_at timestamptz" },
  refunds: { columns: "id,restaurant_id,branch_id,order_id,payment_id,actor_id,idempotency_key,request_payload,amount_minor,currency,device_id,local_sequence,occurred_at,reason,authorization_approved,authorization_actor_id,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,order_id uuid,payment_id uuid,actor_id uuid,idempotency_key text,request_payload jsonb,amount_minor bigint,currency char(3),device_id text,local_sequence bigint,occurred_at timestamptz,reason text,authorization_approved boolean,authorization_actor_id uuid,created_at timestamptz" },
  cash_movements: { columns: "id,restaurant_id,branch_id,payment_id,refund_id,actor_id,direction,amount_minor,currency,source_type,source_id,device_id,local_sequence,occurred_at,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,payment_id uuid,refund_id uuid,actor_id uuid,direction text,amount_minor bigint,currency char(3),source_type text,source_id uuid,device_id text,local_sequence bigint,occurred_at timestamptz,created_at timestamptz" },
  financial_audit_log: { columns: "id,restaurant_id,branch_id,order_id,payment_id,refund_id,cash_movement_id,actor_id,action,reason,authorization_approved,authorization_actor_id,device_id,local_sequence,occurred_at,created_at", definition: "id uuid,restaurant_id uuid,branch_id uuid,order_id uuid,payment_id uuid,refund_id uuid,cash_movement_id uuid,actor_id uuid,action text,reason text,authorization_approved boolean,authorization_actor_id uuid,device_id text,local_sequence bigint,occurred_at timestamptz,created_at timestamptz" },
};

const restoreRows = async (client: PoolClient, table: BackupTable, rows: readonly Record<string, unknown>[]): Promise<void> => {
  if (rows.length === 0) return;
  const shape = restoreDefinitions[table];
  await client.query(`insert into adr010_b.${table}(${shape.columns}) ${shape.override === true ? "overriding system value " : ""}select ${shape.columns} from jsonb_to_recordset($1::jsonb) as restored(${shape.definition})`, [JSON.stringify(rows)]);
};

const restoreDeviceSequences = async (client: PoolClient, rows: readonly Record<string, unknown>[]): Promise<void> => {
  if (rows.length === 0) return;
  const { columns, definition } = deviceSequenceRestoreDefinition;
  await client.query("insert into adr010_b_private.device_sequences(" + columns + ") select " + columns + " from jsonb_to_recordset($1::jsonb) as restored(" + definition + ")", [JSON.stringify(rows)]);
};

const assertRestoreTargetEmpty = async (client: PoolClient): Promise<void> => {
  for (const table of backupTables) {
    const result = await client.query<{ readonly present: boolean }>(`select exists(select 1 from adr010_b.${table}) present`);
    if (result.rows[0]?.present === true) throw new Error("ADR010_B_RESTORE_TARGET_NOT_EMPTY");
  }
  const deviceSequences = await client.query<{ readonly present: boolean }>("select exists(select 1 from adr010_b_private.device_sequences) present");
  if (deviceSequences.rows[0]?.present === true) throw new Error("ADR010_B_RESTORE_TARGET_NOT_EMPTY");
};

const parseLogicalBackup = (value: unknown, projectRef: string): LogicalBackup => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ADR010_B_INVALID_BACKUP");
  const record = value as Partial<LogicalBackup>;
  if (record.format !== "adr010-b-logical-v1" || record.projectRef !== projectRef || typeof record.tables !== "object" || record.tables === null || backupTables.some((table) => !Array.isArray(record.tables?.[table])) || !Array.isArray(record.deviceSequences)) throw new Error("ADR010_B_INVALID_BACKUP");
  return record as LogicalBackup;
};

const parseOrderRecord = (value: unknown): OrderRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ADR010_B_INVALID_ORDER_RECORD");
  const record = value as Partial<OrderRecord>;
  if (typeof record.id !== "string" || typeof record.idempotencyKey !== "string" || record.scope === undefined || !Array.isArray(record.lines) || record.audit === undefined) throw new Error("ADR010_B_INVALID_ORDER_RECORD");
  return record as OrderRecord;
};

const parseCashPaymentRecord = (value: unknown): CashPaymentRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ADR010_B_INVALID_CASH_PAYMENT_RECORD");
  const record = value as Partial<CashPaymentRecord>;
  if (typeof record.id !== "string" || typeof record.orderId !== "string" || typeof record.idempotencyKey !== "string" ||
    typeof record.amountMinor !== "number" || !Number.isSafeInteger(record.amountMinor) || record.amountMinor <= 0 || typeof record.currency !== "string" || typeof record.cashMovementId !== "string" || typeof record.localSequence !== "number" || !Number.isSafeInteger(record.localSequence) || record.localSequence <= 0) {
    throw new Error("ADR010_B_INVALID_CASH_PAYMENT_RECORD");
  }
  return record as CashPaymentRecord;
};

const parseCashRefundRecord = (value: unknown): CashRefundRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ADR010_B_INVALID_CASH_REFUND_RECORD");
  const record = value as Partial<CashRefundRecord>;
  if (typeof record.id !== "string" || typeof record.paymentId !== "string" || typeof record.idempotencyKey !== "string" ||
    typeof record.amountMinor !== "number" || !Number.isSafeInteger(record.amountMinor) || record.amountMinor <= 0 || typeof record.currency !== "string" || typeof record.cashMovementId !== "string" || typeof record.localSequence !== "number" || !Number.isSafeInteger(record.localSequence) || record.localSequence <= 0) {
    throw new Error("ADR010_B_INVALID_CASH_REFUND_RECORD");
  }
  return record as CashRefundRecord;
};

const parseSafeInteger = (value: string | undefined, label: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`ADR010_B_INVALID_${label}`);
  return parsed;
};
