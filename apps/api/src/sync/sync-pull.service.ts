import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { isSyncId, parseBranchScope, parseSyncPullRequestV1, parseSyncPullResponseV1, type SyncPullResponseV1 } from "@super-restaurant/shared-types";
import { DATABASE_CLIENT, type TransactionalDatabaseClientPort } from "../database.js";
import { SyncCursor } from "./sync-cursor.js";

@Injectable()
export class SyncPullService {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort, @Inject(SyncCursor) private readonly cursor: SyncCursor) {}
  public async register(actorId: string, input: unknown): Promise<{ status: string }> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new BadRequestException({ code: "SYNC_REQUEST_INVALID" });
    const body = input as Record<string, unknown>;
    if (Object.keys(body).sort().join(",") !== "deviceId,scope") throw new BadRequestException({ code: "SYNC_REQUEST_INVALID" });
    const scope = parseBranchScope(body["scope"]); const deviceId = body["deviceId"];
    if (!scope || !isSyncId(deviceId) || deviceId !== deviceId.toLowerCase()) throw new BadRequestException({ code: "SYNC_REQUEST_INVALID" });
    return this.database.transaction(async (db) => {
      const response = await db.query("select app_private.sync_register_device($1::uuid,$2::uuid,$3::uuid,$4::text) as registered", [actorId, scope.restaurantId, scope.branchId, deviceId]);
      if ((response.rows[0] as { registered?: boolean } | undefined)?.registered !== true) throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      return { status: "active" };
    });
  }
  public async pull(actorId: string, input: unknown): Promise<SyncPullResponseV1> {
    const request = parseSyncPullRequestV1(input);
    if (!request) throw new BadRequestException({ code: "SYNC_REQUEST_INVALID" });
    const scope = { ...request.scope, actorId };
    let sequence = "0";
    try { if (request.cursor !== null) sequence = this.cursor.decode(request.cursor, scope); }
    catch (error) { throw new BadRequestException({ code: error instanceof Error ? error.message : "CURSOR_SCOPE_MISMATCH" }); }
    try {
      return await this.database.transaction(async (db) => {
        const result = await db.query("select * from app_private.sync_read_changes($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::integer,$6::text)", [actorId, request.scope.restaurantId, request.scope.branchId, sequence, request.limit + 1, request.deviceId]);
        const rows = result.rows as Array<Record<string, unknown>>;
        const page = rows.slice(0, request.limit);
        const changes = page.map((row) => ({ entityType: row["entity_type"], entityId: row["entity_id"], restaurantId: row["restaurant_id"], branchId: row["branch_id"], canonicalVersion: Number(row["canonical_version"]), tombstone: row["tombstone"], snapshot: row["snapshot"] }));
        const next = page.length ? String(page[page.length - 1]?.["canonical_sequence"]) : sequence;
        const response = parseSyncPullResponseV1({ protocolVersion: 1, scope: request.scope, changes, nextCursor: this.cursor.encode(scope, next), hasMore: rows.length > request.limit });
        if (!response) throw new Error("SYNC_CHANGE_INVALID");
        return response;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "42501") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      throw error;
    }
  }
}
