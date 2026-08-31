import {
  DINING_ZONE_SCHEMA_VERSION,
  parseCreateDiningZoneCommandV1,
  parseDiningZoneV1,
  type CreateDiningZoneCommandV1,
  type DiningZoneV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const createDiningZoneSql = `
select
  status,
  schema_version,
  restaurant_id::text as restaurant_id,
  branch_id::text as branch_id,
  zone_id::text as zone_id,
  zone_name,
  zone_version,
  created_at,
  created_by::text as created_by
from app_private.create_dining_zone(
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4::uuid,
  $5::uuid,
  $6::uuid,
  $7::uuid,
  $8::timestamptz,
  $9::text
)
`;

export type DiningZoneApplicationErrorCode = "authorization" | "conflict" | "request" | "unavailable";

export class DiningZoneApplicationError extends Error {
  public readonly code: DiningZoneApplicationErrorCode;

  public constructor(code: DiningZoneApplicationErrorCode) {
    super(`DINING_ZONE_${code.toUpperCase()}`);
    this.name = "DiningZoneApplicationError";
    this.code = code;
  }
}

export type DiningZoneCreationResult =
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "created"; zone: DiningZoneV1 }>
  | Readonly<{ status: "replayed"; zone: DiningZoneV1 }>;

export interface DiningZoneCreationPort {
  createZone(actorId: string, command: CreateDiningZoneCommandV1): Promise<DiningZoneCreationResult>;
}

export const DINING_ZONE_CREATOR = Symbol("DINING_ZONE_CREATOR");

@Injectable()
export class PostgresDiningZoneCreator implements DiningZoneCreationPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async createZone(actorId: string, command: CreateDiningZoneCommandV1): Promise<DiningZoneCreationResult> {
    const result = await this.database.query(createDiningZoneSql, [
      actorId,
      command.scope.restaurantId,
      command.scope.branchId,
      command.zoneId,
      command.eventId,
      command.idempotencyKey,
      command.deviceId,
      command.occurredAt,
      command.name,
    ]);
    if (result.rows.length !== 1) throw unavailable();
    return parseCreationRow(result.rows[0]);
  }
}

@Injectable()
export class DiningZoneService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(DINING_ZONE_CREATOR) private readonly creator: DiningZoneCreationPort,
  ) {}

  public async createZone(principal: AuthenticatedPrincipal, input: unknown): Promise<DiningZoneV1> {
    const command = parseCreateDiningZoneCommandV1(input);
    if (command === undefined) throw applicationError("request");

    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, command.scope, "tables.manage");
      actorId = authorized.principal.actorId;
    } catch {
      throw applicationError("authorization");
    }

    let result: DiningZoneCreationResult;
    try {
      result = await this.creator.createZone(actorId, command);
    } catch {
      throw applicationError("unavailable");
    }
    if (result.status === "forbidden") throw applicationError("authorization");
    if (result.status === "conflict") throw applicationError("conflict");
    return result.zone;
  }
}

function parseCreationRow(value: unknown): DiningZoneCreationResult {
  const record = exactRecord(value, [
    "status",
    "schema_version",
    "restaurant_id",
    "branch_id",
    "zone_id",
    "zone_name",
    "zone_version",
    "created_at",
    "created_by",
  ]);
  if (record === undefined) throw unavailable();
  const status = dataProperty(record, "status");
  if (status === "conflict" || status === "forbidden") {
    const payloadKeys = [
      "schema_version",
      "restaurant_id",
      "branch_id",
      "zone_id",
      "zone_name",
      "zone_version",
      "created_at",
      "created_by",
    ];
    if (payloadKeys.some((key) => dataProperty(record, key) !== null)) throw unavailable();
    return Object.freeze({ status });
  }
  if (status !== "created" && status !== "replayed") throw unavailable();
  const zone = parseDiningZoneV1({
    createdAt: timestampText(dataProperty(record, "created_at")),
    createdBy: dataProperty(record, "created_by"),
    name: dataProperty(record, "zone_name"),
    replayed: status === "replayed",
    schemaVersion: dataProperty(record, "schema_version"),
    scope: {
      branchId: dataProperty(record, "branch_id"),
      restaurantId: dataProperty(record, "restaurant_id"),
    },
    version: integerValue(dataProperty(record, "zone_version")),
    zoneId: dataProperty(record, "zone_id"),
  });
  if (zone === undefined || zone.schemaVersion !== DINING_ZONE_SCHEMA_VERSION) throw unavailable();
  return Object.freeze({ status, zone });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function timestampText(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function integerValue(value: unknown): unknown {
  return typeof value === "string" && /^[1-9]\d*$/u.test(value) ? Number(value) : value;
}

function unavailable(): DiningZoneApplicationError {
  return applicationError("unavailable");
}

function applicationError(code: DiningZoneApplicationErrorCode): DiningZoneApplicationError {
  return new DiningZoneApplicationError(code);
}
