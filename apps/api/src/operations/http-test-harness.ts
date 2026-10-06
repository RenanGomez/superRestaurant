import { randomUUID } from "node:crypto";

import { bootstrapHttpApp, type HttpTestApp } from "./http-test-app.js";
import { HTTP_TEST_ACTORS, provisionHttpFixtures, type HttpTestActorName, type HttpTestFixtures } from "./http-test-fixtures.js";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "./local-postgres.js";

export type Json = Record<string, unknown>;
export type HttpMethod = "GET" | "POST" | "PUT";

export interface HttpFlowContext {
  readonly admin: LocalPostgres["admin"];
  readonly app: HttpTestApp;
  readonly audit: () => { deviceId: string; eventId: string; idempotencyKey: string; occurredAt: string };
  readonly check: (name: string) => void;
  readonly deviceId: string;
  readonly fixtures: HttpTestFixtures;
  readonly foreignScope: { restaurantId: string; branchId: string };
  readonly query: (parameters: Record<string, string>) => string;
  readonly scope: { restaurantId: string; branchId: string };
  send(actor: HttpTestActorName | null, method: HttpMethod, path: string, body?: unknown): Promise<{ status: number; body: Json }>;
}

/**
 * One disposable PostgreSQL 17 cluster per flow (own runId, own cleanup; about 30 s each because the
 * migrations are applied from scratch every time). Never remote: it needs `--local-disposable-only`.
 */
export async function runHttpFlow(
  options: { readonly databasePrefix: string; readonly marker: string; readonly stage: string },
  body: (context: HttpFlowContext) => Promise<Json>,
): Promise<void> {
  if (process.env.HTTP_TEST_MODE !== undefined && process.env.HTTP_TEST_MODE !== "local") throw new Error("LOCAL_CONFIRMATION_REQUIRED");
  assertLocalConfirmation(process.argv.filter((argument) => argument !== "--"));
  const local = new LocalPostgres({ marker: options.marker, databasePrefix: options.databasePrefix, authUsersExtraColumns: ", raw_user_meta_data jsonb" });
  let app: HttpTestApp | undefined;
  const checks: string[] = [];
  try {
    await local.start();
    await local.applyMigrations(listMigrationNames());
    await local.enableAppApiLogin();
    const fixtures = await provisionHttpFixtures(local.admin);
    const principals = new Map<string, string>((Object.keys(HTTP_TEST_ACTORS) as HttpTestActorName[]).map((name) => [fixtures.tokens[name], fixtures.actorIds[name]]));
    app = await bootstrapHttpApp(local.appApiUrl, principals);
    const http = app;
    const deviceId = randomUUID();
    const summary = await body({
      admin: local.admin, app: http, deviceId, fixtures,
      audit: () => ({ deviceId, eventId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: new Date().toISOString() }),
      check: (name) => { checks.push(name); },
      foreignScope: { restaurantId: fixtures.restaurantB, branchId: fixtures.branchB },
      query: (parameters) => `?${new URLSearchParams(parameters).toString()}`,
      scope: { restaurantId: fixtures.restaurantA, branchId: fixtures.branchA },
      send: async (actor, method, path, payload) => {
        const response = await http.request(actor === null ? null : fixtures.tokens[actor], method, path, payload);
        return { status: response.status, body: (response.body ?? {}) as Json };
      },
    });
    process.stdout.write(`${JSON.stringify({ stage: options.stage, status: "ok", runId: local.runId, checks, ...summary })}\n`);
  } finally {
    try { await app?.close(); } catch { process.exitCode = 1; }
    const cleanup = await local.stop();
    process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: cleanup.failed ? "failed" : "ok", stopped: cleanup.stopped, runId: local.runId, marker: options.marker })}\n`);
    if (cleanup.failed) process.exitCode = 1;
  }
}
