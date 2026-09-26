import { Inject, Injectable } from "@nestjs/common";
import { deriveOrderPreparationStatus } from "@super-restaurant/domain";
import {
  parseCaptureDraftSummaryV1,
  parseOperationalWorkItemV1,
  parseOperationalWorkTrayRequestV1,
  parseOperationalWorkTrayV1,
  type ActiveTableOrderSummaryV2,
  type CaptureDraftSummaryV1,
  type OperationalOrderStatusV1,
  type OperationalPaymentStatusV1,
  type OperationalWorkItemV1,
  type OperationalWorkTrayRequestV1,
  type OperationalWorkTrayV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const listSql = "select app_private.list_operational_work_tray($1::uuid, $2::jsonb) as result";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type OperationalWorkTrayErrorCode = "authorization" | "request" | "unavailable";

export class OperationalWorkTrayError extends Error {
  public constructor(public readonly code: OperationalWorkTrayErrorCode) {
    super(`OPERATIONAL_WORK_TRAY_${code.toUpperCase()}`);
    this.name = "OperationalWorkTrayError";
  }
}

export interface OperationalWorkTrayPort {
  list(actorId: string, request: OperationalWorkTrayRequestV1): Promise<unknown>;
}

export const OPERATIONAL_WORK_TRAY_PORT = Symbol("OPERATIONAL_WORK_TRAY_PORT");

@Injectable()
export class PostgresOperationalWorkTray implements OperationalWorkTrayPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async list(actorId: string, input: OperationalWorkTrayRequestV1): Promise<unknown> {
    const request = parseOperationalWorkTrayRequestV1(input);
    if (!UUID_PATTERN.test(actorId) || request === undefined) throw unavailable();
    let rows: readonly unknown[];
    try {
      rows = (await this.database.query(listSql, [actorId, JSON.stringify(request)])).rows;
    } catch { throw unavailable(); }
    if (rows.length !== 1) throw unavailable();
    const record = exactRecord(rows[0], ["result"]);
    if (record === undefined) throw unavailable();
    return own(record, "result");
  }
}

@Injectable()
export class OperationalWorkTrayService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(OPERATIONAL_WORK_TRAY_PORT) private readonly tray: OperationalWorkTrayPort,
  ) {}

  public async list(principal: AuthenticatedPrincipal, input: unknown): Promise<OperationalWorkTrayV1> {
    const request = parseOperationalWorkTrayRequestV1(input);
    if (request === undefined) throw applicationError("request");
    let actorId: string;
    try {
      const [captureAccess, orderAccess] = await Promise.all([
        this.authorization.authorizeBranch(principal, request.scope, "captures.read"),
        this.authorization.authorizeBranch(principal, request.scope, "orders.read"),
      ]);
      if (captureAccess.principal.actorId !== orderAccess.principal.actorId) throw new Error("ACTOR_MISMATCH");
      actorId = captureAccess.principal.actorId;
    } catch { throw applicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.tray.list(actorId, request); } catch { throw unavailable(); }
    const outcome = exactRecord(raw, ["status"]);
    if (outcome !== undefined) {
      if (own(outcome, "status") === "denied") throw applicationError("authorization");
      if (own(outcome, "status") === "rejected") throw applicationError("request");
      throw unavailable();
    }
    const result = parseOperationalWorkTrayV1(raw);
    if (result === undefined || result.items.length > request.limit
      || result.scope.restaurantId !== request.scope.restaurantId
      || result.scope.branchId !== request.scope.branchId) throw unavailable();
    return result;
  }
}

/**
 * Pure server-side projection only. Source readers remain responsible for
 * authorization and exact Restaurant/Branch scope; commands reauthorize.
 */
export function projectCaptureOperationalWorkItem(summary: CaptureDraftSummaryV1): OperationalWorkItemV1 {
  const source = parseCaptureDraftSummaryV1(summary);
  if (source === undefined || source.status !== "draft") throw new Error("Invalid Capture work item source.");
  const needsAttention = source.attentionStatus === "unclaimed"
    ? ["unclaimed"] as const
    : source.attentionStatus === "held" ? ["held"] as const : [] as const;
  return exactItem({
    attentionStatus: source.attentionStatus,
    availableActions: ["open_capture"],
    captureDraftId: source.captureDraftId,
    customerLabel: null,
    fulfillmentChannel: source.fulfillmentChannel,
    fulfillmentStatus: null,
    humanFolio: source.folio,
    itemType: "capture",
    needsAttention,
    orderId: null,
    orderStatus: null,
    ownerLabel: null,
    paymentStatus: null,
    preparationStatus: null,
    promisedFor: null,
    scheduledFor: null,
    shiftId: null,
    sourceChannel: source.sourceChannel,
    tableId: null,
    updatedAt: source.updatedAt,
    version: source.version,
    workItemId: source.captureDraftId,
  });
}

/**
 * Transitional projection for the existing table-scoped active-order reader.
 * It must not be presented as the future branch-wide paginated S9.1 reader.
 */
export function projectActiveTableOrderOperationalWorkItem(
  summary: ActiveTableOrderSummaryV2,
): OperationalWorkItemV1 {
  const source = summary;
  if ((source.status !== "draft" && source.status !== "open" && source.status !== "partially_paid")
    || source.itemCount !== source.items.length) {
    throw new Error("Invalid active table Order work item source.");
  }
  const orderStatus: OperationalOrderStatusV1 = source.status === "draft" ? "draft" : "confirmed";
  const paymentStatus: OperationalPaymentStatusV1 | null = source.status === "partially_paid"
    ? "partially_paid"
    : null;
  return exactItem({
    attentionStatus: null,
    availableActions: ["open_order"],
    captureDraftId: null,
    customerLabel: null,
    fulfillmentChannel: "dine_in",
    fulfillmentStatus: null,
    humanFolio: null,
    itemType: "order",
    needsAttention: [],
    orderId: source.orderId,
    orderStatus,
    ownerLabel: null,
    paymentStatus,
    preparationStatus: deriveOrderPreparationStatus(source.items.map((item) => item.status)),
    promisedFor: null,
    scheduledFor: null,
    shiftId: source.shiftId,
    sourceChannel: null,
    tableId: source.tableId,
    updatedAt: source.updatedAt,
    version: source.version,
    workItemId: source.orderId,
  });
}

function exactItem(value: unknown): OperationalWorkItemV1 {
  const parsed = parseOperationalWorkItemV1(value);
  if (parsed === undefined) throw new Error("Invalid operational work item projection.");
  return parsed;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function unavailable(): OperationalWorkTrayError { return applicationError("unavailable"); }
function applicationError(code: OperationalWorkTrayErrorCode): OperationalWorkTrayError {
  return new OperationalWorkTrayError(code);
}
