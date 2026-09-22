import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Test } from "@nestjs/testing";

import { AppModule } from "../app.module.js";
import { AUTH_PRINCIPAL_VERIFIER, AccessTokenRejectedError } from "../auth/authentication.js";
import {
  CAPTURE_ATTENTION_PORT,
  CAPTURE_CREATION_PORT,
  CAPTURE_TRAY_PORT,
  PostgresCaptureCreator,
} from "../captures.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "../database.js";
import type { SchemaVerificationSession } from "./schema-verification.js";

interface CaptureTrayHttpFixture {
  readonly actorId: string;
  readonly branchId: string;
  readonly captureDraftId: string;
  readonly membershipId: string;
  readonly restaurantId: string;
}

/** Real AppModule/guard/RBAC/SQL over one caller-owned rollback transaction. */
export async function verifyCaptureTrayHttp(
  session: SchemaVerificationSession,
  database: DatabaseClientPort,
  fixture: CaptureTrayHttpFixture,
  onStage: (stage: string) => void = () => undefined,
): Promise<Readonly<{ captureDraftId: string; checks: number }>> {
  const { actorId, branchId, captureDraftId, membershipId, restaurantId } = fixture;
  const token = `rollback-only-${randomUUID()}`;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_CLIENT).useValue(database)
    .overrideProvider(AUTH_PRINCIPAL_VERIFIER).useValue({ verifyAccessToken: async (value: string) => {
      if (value !== token) throw new AccessTokenRejectedError();
      return Object.freeze({ actorId });
    } }).compile();
  const app = module.createNestApplication({ logger: false });
  let checks = 0;
  try {
    onStage("http_wiring");
    const postgres = module.get(PostgresCaptureCreator);
    assert.equal(module.get(CAPTURE_CREATION_PORT), postgres);
    assert.equal(module.get(CAPTURE_ATTENTION_PORT), postgres);
    assert.equal(module.get(CAPTURE_TRAY_PORT), postgres);
    checks += 3;
    app.setGlobalPrefix("api/v1");
    await app.listen(0, "127.0.0.1");
    const url = `${await app.getUrl()}/api/v1/captures`;
    const send = async (route: string, body: unknown, status: number, authorization: string | null = `Bearer ${token}`) => {
      const response = await fetch(`${url}${route}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...(authorization === null ? {} : { authorization }) },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(response.status, status);
      if (status !== 401) assert.equal(response.headers.get("cache-control"), "private, no-store");
      checks += 1;
      return await response.json() as Record<string, unknown>;
    };
    const scope = { restaurantId, branchId };
    const common = (expectedVersion: number) => ({
      captureDraftId,
      deviceId: randomUUID(),
      eventId: randomUUID(),
      expectedVersion,
      idempotencyKey: randomUUID(),
      occurredAt: new Date().toISOString(),
      schemaVersion: 1,
      scope,
    });
    const create = { ...common(0), fulfillmentChannel: "delivery", sourceChannel: "phone" };
    const tray = { limit: 20, schemaVersion: 1, scope };

    onStage("http_auth_validation");
    await send("/tray", tray, 401, null);
    await send("/tray", tray, 401, "Bearer rejected-rollback-only-token");
    await send("/tray", { ...tray, limit: 51 }, 400);
    await send("/tray", { ...tray, scope: { restaurantId, branchId: randomUUID() } }, 403);
    onStage("http_create");
    const created = await send("", create, 201);
    const createdDetail = created.detail as { attentionLeaseId: string; version: number };
    assert.equal(createdDetail.version, 1);
    checks += 1;
    onStage("http_tray");
    const firstTray = await send("/tray", tray, 200);
    assert.deepEqual((firstTray.items as { captureDraftId: string; version: number }[])
      .map((item) => ({ captureDraftId: item.captureDraftId, version: item.version })), [{ captureDraftId, version: 1 }]);
    checks += 1;
    onStage("http_claim");
    const claim = common(1);
    const claimed = await send("/claim", claim, 200);
    const claimedDetail = claimed.detail as { attentionLeaseId: string; ownerMembershipId: string; version: number };
    assert.equal(claimedDetail.ownerMembershipId, membershipId);
    assert.equal(claimedDetail.version, 2);
    assert.notEqual(claimedDetail.attentionLeaseId, createdDetail.attentionLeaseId);
    checks += 3;
    assert.equal((await send("/claim", claim, 200)).replayed, true);
    checks += 1;
    const secondTray = await send("/tray", tray, 200);
    assert.equal((secondTray.items as { version: number }[])[0]?.version, 2);
    checks += 1;

    onStage("http_rbac");
    const setRole = async (role: string) => {
      await session.query("RESET ROLE");
      await session.query("update app.membership_role_grants set role_code=$2 where membership_id=$1", [membershipId, role]);
      await session.query("SET LOCAL ROLE app_api");
    };
    await setRole("viewer");
    await send("/tray", tray, 403);
    await send("/claim", { ...common(2), captureDraftId }, 403);
    await setRole("cashier");
    onStage("http_revocation");
    await session.query("RESET ROLE");
    await session.query(
      "update app.memberships set revoked_at=clock_timestamp(),revoked_by=$2,revocation_reason='rollback-only Capture tray verification' where id=$1",
      [membershipId, actorId],
    );
    await session.query("SET LOCAL ROLE app_api");
    await send("/tray", tray, 403);
    await send("/claim", { ...common(2), captureDraftId }, 403);
    onStage("http_state");
    await session.query("RESET ROLE");
    const state = await session.query(
      `select
        (select count(*)::integer from app.capture_drafts where id=$1) as captures,
        (select count(*)::integer from app.capture_command_events where capture_draft_id=$1) as events`,
      [captureDraftId],
    );
    assert.deepEqual(state.rows, [{ captures: 1, events: 2 }]);
    checks += 1;
    await session.query("SET LOCAL ROLE app_api");
    return Object.freeze({ captureDraftId, checks });
  } finally {
    await app.close();
  }
}
