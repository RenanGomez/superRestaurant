import "reflect-metadata";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Pool, type QueryResultRow } from "pg";

import { configureApiApp } from "../app-setup.js";
import { AppModule } from "../app.module.js";
import { SyncCursor } from "../sync/sync-cursor.js";
import { AUTH_PRINCIPAL_VERIFIER, AccessTokenRejectedError, type AuthenticatedPrincipal } from "../auth/authentication.js";
import {
  DATABASE_CLIENT,
  guardPostgresPool,
  type DatabaseClientPort,
  type TransactionalDatabaseClientPort,
} from "../database.js";

export interface HttpTestApp {
  readonly baseUrl: string;
  close(): Promise<void>;
  /** JSON request with a Bearer token; returns the status and parsed body (null when empty). */
  request(token: string | null, method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<{ readonly body: unknown; readonly status: number }>;
}

/**
 * Boots the real AppModule (controllers, guard, services, Postgres adapters) with two substitutions
 * only: `DATABASE_CLIENT` is a real pg Pool as `app_api` against the disposable local cluster, and
 * `AUTH_PRINCIPAL_VERIFIER` maps a fixture Bearer token to its actor id instead of calling Supabase
 * Auth. Membership lookups and every authorization decision still run against the database.
 *
 * The port also implements `transaction`: the purchasing/inventory services only write through it, and
 * a test double that lacked it would turn every such write into a 503 instead of exercising the real
 * path.
 */
export async function bootstrapHttpApp(appApiUrl: string, principals: ReadonlyMap<string, string>): Promise<HttpTestApp> {
  const pool = guardPostgresPool(new Pool({
    application_name: "super-restaurant-http-flow-test",
    connectionString: appApiUrl,
    connectionTimeoutMillis: 5_000,
    max: 5,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  }));
  const database: TransactionalDatabaseClientPort = {
    async query(sql, parameters) {
      const result = await pool.query<QueryResultRow>(sql, [...parameters]);
      return Object.freeze({ rows: Object.freeze([...result.rows]) });
    },
    async transaction<T>(operation: (client: DatabaseClientPort) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await operation({
          async query(sql, parameters) {
            const reply = await client.query<QueryResultRow>(sql, [...parameters]);
            return Object.freeze({ rows: Object.freeze([...reply.rows]) });
          },
        });
        await client.query("commit");
        return result;
      } catch (error: unknown) {
        try { await client.query("rollback"); } catch { /* the connection is released anyway */ }
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const verifier = {
    async verifyAccessToken(accessToken: string): Promise<AuthenticatedPrincipal> {
      const actorId = principals.get(accessToken);
      if (actorId === undefined) throw new AccessTokenRejectedError();
      return Object.freeze({ actorId });
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_CLIENT).useValue(database)
    .overrideProvider(SyncCursor).useValue(new SyncCursor("test-cursor-secret-only-for-tests-12345"))
    .overrideProvider(AUTH_PRINCIPAL_VERIFIER).useValue(verifier)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");
  const baseUrl = `${await app.getUrl()}/api/v1`;
  return {
    baseUrl,
    async close() {
      await app.close();
      await pool.end();
    },
    async request(token, method, path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { body: text.length === 0 ? null : JSON.parse(text) as unknown, status: response.status };
    },
  };
}
