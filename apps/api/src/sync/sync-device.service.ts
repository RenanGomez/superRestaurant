import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { isSyncId, parseBranchScope, type BranchScope } from "@super-restaurant/shared-types";

import { DATABASE_CLIENT, type TransactionalDatabaseClientPort } from "../database.js";

/** Registers the calling device in `(restaurant, branch)` so `sync/push` is not rejected as `DEVICE_REVOKED`. */
@Injectable()
export class SyncDeviceService {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort) {}

  public async register(actorId: string, input: unknown): Promise<{ readonly status: "active" }> {
    const { deviceId, scope } = parseRegistration(input);
    try {
      return await this.database.transaction(async (db) => {
        const response = await db.query(
          "select app_private.sync_register_device($1::uuid,$2::uuid,$3::uuid,$4::text) as registered",
          [actorId, scope.restaurantId, scope.branchId, deviceId],
        );
        if ((response.rows[0] as { readonly registered?: boolean } | undefined)?.registered !== true) {
          throw new ForbiddenException({ code: "SYNC_SCOPE_FORBIDDEN" });
        }
        return { status: "active" as const };
      });
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) throw error;
      throw mapDatabaseError(error);
    }
  }
}

function parseRegistration(input: unknown): { readonly deviceId: string; readonly scope: BranchScope } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalidRequest();
  const body = input as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "deviceId,scope") throw invalidRequest();
  const scope = parseBranchScope(body["scope"]);
  const deviceId = body["deviceId"];
  if (scope === undefined || !isSyncId(deviceId) || deviceId !== deviceId.toLowerCase()) throw invalidRequest();
  return { deviceId, scope };
}

function invalidRequest(): BadRequestException {
  return new BadRequestException({ code: "SYNC_REQUEST_INVALID" });
}

/** Maps the SQLSTATEs the registration function can raise to the stable API codes. */
function mapDatabaseError(error: unknown): Error {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
  if (code === "42501") return new ForbiddenException({ code: "SYNC_SCOPE_FORBIDDEN" });
  if (code === "22P02") return new BadRequestException({ code: "SYNC_DEVICE_INVALID" });
  return error instanceof Error ? error : new Error("SYNC_DEVICE_REGISTRATION_FAILED");
}
