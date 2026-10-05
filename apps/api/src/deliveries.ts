import {
  parseAssignDeliveryCommandV1,
  parseBranchDeliveriesRequestV1,
  parseBranchDeliveriesV1,
  parseCollectPaymentCommandV1,
  parseCompleteDeliveryCommandV1,
  parseDispatchDeliveryCommandV1,
  parseFailDeliveryCommandV1,
  parseOrderDeliveryResultV1,
  parseOrderDeliveryV1,
  parseOrderFulfillmentSnapshotV1OrV2,
  parsePaymentCollectionSummaryV1,
  parseSettleDeliveryCommandV1,
  parseSettleDeliveryResultV1,
  type BranchDeliveriesV1,
  type BranchDeliveryItemV1,
  type BranchScope,
  type OrderDeliveryResultV1,
  type OrderDeliveryV1,
  type PaymentCollectionSummaryV1,
  type RbacPermissionCode,
  type SettleDeliveryCommandV1,
  type SettleDeliveryResultV1,
} from "@super-restaurant/shared-types";
import { calculateOrderAggregateTotals } from "@super-restaurant/domain";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { rolesGrantPermission } from "./auth/rbac-policy.js";
import { buildAddressLabel, buildCustomerLabel } from "./branch-order-work-tray.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import {
  ORDER_DELIVERY_CONTEXT_PORT,
  type OrderDeliveryContextPort,
} from "./order-delivery-context.js";
import { FinancialApplicationError, FinancialService, type PersistPaymentInput } from "./payments.js";
import {
  encodeCashRegisterRecord,
  encodePaymentRecord,
} from "./persistence/financial-persistence-codec.js";
import { decodeOrderRecord, encodeOrderRecord } from "./persistence/order-persistence-codec.js";

const SQL = {
  assign: "select app_private.assign_delivery($1::uuid, $2::jsonb) as result",
  complete: "select app_private.complete_delivery($1::uuid, $2::jsonb) as result",
  dispatch: "select app_private.dispatch_delivery($1::uuid, $2::jsonb) as result",
  fail: "select app_private.fail_delivery($1::uuid, $2::jsonb) as result",
  list: "select app_private.list_branch_deliveries($1::uuid, $2::uuid, $3::uuid) as result",
  replaySettle: "select app_private.replay_delivery_settlement($1::uuid, $2::jsonb) as result",
  settle: "select app_private.settle_delivery($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::bigint, $8::bigint) as result",
} as const;

export type DeliveryTransitionKind = "assign" | "complete" | "dispatch" | "fail";
export type DeliveryApplicationErrorCode = "authorization" | "conflict" | "not_found" | "request" | "unavailable";

export class DeliveryApplicationError extends Error {
  public constructor(public readonly code: DeliveryApplicationErrorCode) {
    super(`DELIVERY_${code.toUpperCase()}`);
    this.name = "DeliveryApplicationError";
  }
}

export type DeliveryWriteResult<T> = "conflict" | "forbidden" | T;

export interface DeliveryPort {
  list(actorId: string, scope: BranchScope): Promise<unknown>;
  replaySettle(actorId: string, command: SettleDeliveryCommandV1): Promise<DeliveryWriteResult<SettleDeliveryResultV1> | "missing">;
  settle(actorId: string, command: SettleDeliveryCommandV1, input: PersistPaymentInput): Promise<DeliveryWriteResult<SettleDeliveryResultV1>>;
  transition(actorId: string, kind: DeliveryTransitionKind, command: unknown): Promise<DeliveryWriteResult<OrderDeliveryResultV1>>;
}

export const DELIVERY_PORT = Symbol("DELIVERY_PORT");

@Injectable()
export class PostgresDeliveryAdapter implements DeliveryPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async list(actorId: string, scope: BranchScope): Promise<unknown> {
    return this.call(SQL.list, [actorId, scope.restaurantId, scope.branchId]);
  }

  public async transition(
    actorId: string,
    kind: DeliveryTransitionKind,
    command: unknown,
  ): Promise<DeliveryWriteResult<OrderDeliveryResultV1>> {
    const raw = await this.call(SQL[kind], [actorId, JSON.stringify(command)]);
    const minimal = exactRecord(raw, ["status"]);
    if (minimal !== undefined) return refusal(own(minimal, "status"));
    const record = exactRecord(raw, ["status", "replayed", "delivery"]);
    const status = record === undefined ? undefined : own(record, "status");
    if (record === undefined || (status !== "saved" && status !== "replayed")) throw unavailable();
    const parsed = parseOrderDeliveryResultV1({
      delivery: own(record, "delivery"), replayed: own(record, "replayed"), schemaVersion: 1,
    });
    if (parsed === undefined || parsed.replayed !== (status === "replayed")) throw unavailable();
    return parsed;
  }

  public async replaySettle(
    actorId: string,
    command: SettleDeliveryCommandV1,
  ): Promise<DeliveryWriteResult<SettleDeliveryResultV1> | "missing"> {
    const raw = await this.call(SQL.replaySettle, [actorId, JSON.stringify(command)]);
    if (raw === null) return "missing";
    return parseSettlement(raw);
  }

  public async settle(
    actorId: string,
    command: SettleDeliveryCommandV1,
    input: PersistPaymentInput,
  ): Promise<DeliveryWriteResult<SettleDeliveryResultV1>> {
    const raw = await this.call(SQL.settle, [
      actorId,
      JSON.stringify(command),
      JSON.stringify(input.command),
      JSON.stringify(encodePaymentRecord(input.payment)),
      JSON.stringify(encodeOrderRecord(input.order)),
      JSON.stringify(encodeCashRegisterRecord(input.register)),
      input.orderTotalMinor,
      input.priorCapturedAmountMinor,
    ]);
    return parseSettlement(raw);
  }

  private async call(sql: string, parameters: readonly unknown[]): Promise<unknown> {
    const result = await this.database.query(sql, parameters);
    // The SQL is `select fn(...) as result`: the row is `{ result: <jsonb> }`.
    const row = result.rows.length === 1 ? exactRecord(result.rows[0], ["result"]) : undefined;
    if (row === undefined) throw unavailable();
    return own(row, "result");
  }
}

@Injectable()
export class DeliveryService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(DELIVERY_PORT) private readonly deliveries: DeliveryPort,
    @Inject(ORDER_DELIVERY_CONTEXT_PORT) private readonly context: OrderDeliveryContextPort,
    @Inject(FinancialService) private readonly finances: FinancialService,
  ) {}

  public async list(principal: AuthenticatedPrincipal, input: unknown): Promise<BranchDeliveriesV1> {
    const request = parseBranchDeliveriesRequestV1(input);
    if (request === undefined) throw applicationError("request");
    const { actorId, roles } = await this.authorize(principal, request.scope, "deliveries.read");
    // `customers.read` is optional here, never a gate; a courier sees addresses only through it.
    const canReadCustomers = rolesGrantPermission(roles, "customers.read");
    let raw: unknown;
    try { raw = await this.deliveries.list(actorId, request.scope); } catch { throw unavailable(); }
    const minimal = exactRecord(raw, ["status"]);
    if (minimal !== undefined) throw applicationError(own(minimal, "status") === "forbidden" ? "authorization" : "unavailable");
    const envelope = exactRecord(raw, ["schemaVersion", "scope", "deliveries"]);
    const rows = envelope === undefined ? undefined : own(envelope, "deliveries");
    if (envelope === undefined || own(envelope, "schemaVersion") !== 1 || !Array.isArray(rows) || rows.length > 200) {
      throw unavailable();
    }
    const items: BranchDeliveryItemV1[] = [];
    for (const row of rows) items.push(projectItem(row, request.scope, canReadCustomers));
    const parsed = parseBranchDeliveriesV1({ items, schemaVersion: 1, scope: request.scope });
    if (parsed === undefined) throw unavailable();
    return parsed;
  }

  public async assign(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderDeliveryResultV1> {
    const command = parseAssignDeliveryCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const { actorId } = await this.authorize(principal, command.scope, "deliveries.manage");
    return this.transition(actorId, "assign", command);
  }

  public async dispatch(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderDeliveryResultV1> {
    const command = parseDispatchDeliveryCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const { actorId } = await this.authorize(principal, command.scope, "deliveries.update.own");
    return this.transition(actorId, "dispatch", command);
  }

  public async complete(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderDeliveryResultV1> {
    const command = parseCompleteDeliveryCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const { actorId } = await this.authorize(principal, command.scope, "deliveries.update.own");
    return this.transition(actorId, "complete", command);
  }

  public async fail(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderDeliveryResultV1> {
    const command = parseFailDeliveryCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const { actorId } = await this.authorize(principal, command.scope, "deliveries.update.own");
    return this.transition(actorId, "fail", command);
  }

  /**
   * Settles a delivered Order in cash: the full remaining balance (never client money), with the
   * frozen intent's tender/tip unless the command overrides them. Aggregates are built by
   * packages/domain through `FinancialService.prepareCollection`; SQL runs the existing collect
   * authority and the delivery transition in one transaction.
   */
  public async settle(principal: AuthenticatedPrincipal, input: unknown): Promise<SettleDeliveryResultV1> {
    const command = parseSettleDeliveryCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const { actorId } = await this.authorize(principal, command.scope, "deliveries.manage");
    await this.authorize(principal, command.scope, "payments.collect");
    let replay: DeliveryWriteResult<SettleDeliveryResultV1> | "missing";
    try { replay = await this.deliveries.replaySettle(actorId, command); } catch { throw unavailable(); }
    if (replay === "forbidden") throw applicationError("authorization");
    if (replay === "conflict") throw applicationError("conflict");
    if (replay !== "missing") return replay;

    let intent: { readonly method: string; readonly tenderedAmountMinor: number | null; readonly tipMinor: number } | null = null;
    try {
      const read = await this.context.read(actorId, command.scope, command.orderId);
      if (read === "forbidden") throw applicationError("authorization");
      if (read === "missing") throw applicationError("not_found");
      const snapshot = read.snapshot;
      if (snapshot !== null && "paymentIntent" in snapshot && snapshot.paymentIntent !== null) intent = snapshot.paymentIntent;
    } catch (error: unknown) {
      if (error instanceof DeliveryApplicationError) throw error;
      throw unavailable();
    }
    // Only cash settles through a delivery; card/transfer intents are collected the normal way.
    if (intent !== null && intent.method !== "cash") throw applicationError("conflict");

    let amountMinor: number;
    try {
      amountMinor = await this.finances.remainingBalance(actorId, command.scope, command.orderId, command.cashRegisterSessionId);
    } catch (error: unknown) { throw fromFinancial(error); }
    const tip = command.tipMinor ?? intent?.tipMinor ?? 0;
    let tender = command.tenderedAmountMinor ?? intent?.tenderedAmountMinor ?? null;
    // A stale or exact intent tender (0, or below the balance) means "exact cash"; an explicit one is validated.
    if (command.tenderedAmountMinor === null && tender !== null && tender < amountMinor) tender = null;
    if (tender === 0) tender = null;
    const collect = parseCollectPaymentCommandV1({
      amountMinor,
      cardManualEvidence: null,
      cashRegisterExpectedVersion: command.cashRegisterExpectedVersion,
      cashRegisterSessionId: command.cashRegisterSessionId,
      deviceId: command.deviceId,
      eventId: command.eventId,
      idempotencyKey: command.idempotencyKey,
      localSequence: command.localSequence,
      method: "cash",
      occurredAt: command.occurredAt,
      orderExpectedVersion: command.orderExpectedVersion,
      orderId: command.orderId,
      paymentId: command.paymentId,
      schemaVersion: 1,
      scope: command.scope,
      ...(tender === null ? {} : { tenderedAmountMinor: tender }),
      tipMinor: tip,
    });
    if (collect === undefined) throw applicationError("request");
    let prepared: PersistPaymentInput;
    try { prepared = await this.finances.prepareCollection(actorId, collect); }
    catch (error: unknown) { throw fromFinancial(error); }
    let result: DeliveryWriteResult<SettleDeliveryResultV1>;
    try { result = await this.deliveries.settle(actorId, command, prepared); } catch { throw unavailable(); }
    if (result === "forbidden") throw applicationError("authorization");
    if (result === "conflict") throw applicationError("conflict");
    return result;
  }

  private async transition(
    actorId: string,
    kind: DeliveryTransitionKind,
    command: Parameters<DeliveryPort["transition"]>[2],
  ): Promise<OrderDeliveryResultV1> {
    let result: DeliveryWriteResult<OrderDeliveryResultV1>;
    try { result = await this.deliveries.transition(actorId, kind, command); } catch { throw unavailable(); }
    if (result === "forbidden") throw applicationError("authorization");
    if (result === "conflict") throw applicationError("conflict");
    return result;
  }

  private async authorize(
    principal: AuthenticatedPrincipal,
    scope: BranchScope,
    permission: RbacPermissionCode,
  ): Promise<{ actorId: string; roles: readonly string[] }> {
    try {
      const authorized = await this.authorization.authorizeBranch(principal, scope, permission);
      return { actorId: authorized.principal.actorId, roles: authorized.roles };
    } catch { throw applicationError("authorization"); }
  }
}

function projectItem(raw: unknown, scope: BranchScope, canReadCustomers: boolean): BranchDeliveryItemV1 {
  const record = exactRecord(raw, ["delivery", "courierName", "orderStatus", "order", "snapshot"]);
  if (record === undefined) throw unavailable();
  const delivery = parseOrderDeliveryV1(own(record, "delivery"));
  const orderStatus = own(record, "orderStatus");
  const rawName = own(record, "courierName");
  if (delivery === undefined || delivery.scope.restaurantId !== scope.restaurantId
    || delivery.scope.branchId !== scope.branchId || (orderStatus !== "open" && orderStatus !== "partially_paid")
    || (rawName !== null && typeof rawName !== "string")) throw unavailable();
  let order;
  try { order = decodeOrderRecord(own(record, "order")); } catch { throw unavailable(); }
  if (order.orderId !== delivery.orderId || order.channel !== "delivery") throw unavailable();
  const rawSnapshot = own(record, "snapshot");
  const snapshot = rawSnapshot === null ? null : parseOrderFulfillmentSnapshotV1OrV2(rawSnapshot);
  if (snapshot === undefined || (snapshot !== null && snapshot.orderId !== delivery.orderId)) throw unavailable();
  let totalMinor: number;
  let currency: string;
  try {
    const totals = calculateOrderAggregateTotals(order);
    totalMinor = totals.total.amountMinor;
    currency = totals.total.currency;
  } catch { throw unavailable(); }
  const quote = snapshot !== null && "deliveryQuote" in snapshot ? snapshot.deliveryQuote : null;
  const intent = snapshot !== null && "paymentIntent" in snapshot && snapshot.paymentIntent !== null
    ? {
      method: snapshot.paymentIntent.method,
      tenderedAmountMinor: snapshot.paymentIntent.tenderedAmountMinor,
      tipMinor: snapshot.paymentIntent.tipMinor,
    }
    : null;
  const item = parseBranchDeliveriesItem({
    addressLabel: canReadCustomers ? buildAddressLabel(snapshot) : null,
    // A label the contract cannot carry (empty or hostile) degrades to "unknown" rather than failing the list.
    courierLabel: rawName === null ? null : rawName.length >= 1 && rawName.length <= 120 && rawName === rawName.trim()
      && !/[\p{Cc}\p{Cf}]/u.test(rawName) ? rawName : null,
    currency,
    customerLabel: canReadCustomers ? buildCustomerLabel(snapshot) : null,
    delivery,
    orderStatus,
    paymentIntent: intent,
    promiseEnd: quote?.promiseEnd ?? null,
    promiseStart: quote?.promiseStart ?? null,
    totalMinor,
  });
  if (item === undefined) throw unavailable();
  return item;
}

function parseBranchDeliveriesItem(value: unknown): BranchDeliveryItemV1 | undefined {
  // Reuse the list parser so one item is validated with exactly the contract the client will apply.
  const envelope = parseBranchDeliveriesV1({
    items: [value], schemaVersion: 1,
    scope: (value as { delivery: OrderDeliveryV1 }).delivery.scope,
  });
  return envelope?.items[0];
}

function parseSettlement(raw: unknown): DeliveryWriteResult<SettleDeliveryResultV1> {
  const minimal = exactRecord(raw, ["status"]);
  if (minimal !== undefined) return refusal(own(minimal, "status"));
  const record = exactRecord(raw, ["status", "replayed", "delivery", "payment"]);
  const status = record === undefined ? undefined : own(record, "status");
  if (record === undefined || (status !== "saved" && status !== "replayed")) throw unavailable();
  const payment: PaymentCollectionSummaryV1 | undefined = parsePaymentCollectionSummaryV1(own(record, "payment"));
  const parsed = parseSettleDeliveryResultV1({
    delivery: own(record, "delivery"), payment, replayed: own(record, "replayed"), schemaVersion: 1,
  });
  if (parsed === undefined || parsed.replayed !== (status === "replayed")) throw unavailable();
  return parsed;
}

function fromFinancial(error: unknown): DeliveryApplicationError {
  return error instanceof FinancialApplicationError ? applicationError(error.code) : unavailable();
}

function refusal(status: unknown): "conflict" | "forbidden" {
  if (status === "conflict" || status === "forbidden") return status;
  throw unavailable();
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
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

function unavailable(): DeliveryApplicationError { return applicationError("unavailable"); }
function applicationError(code: DeliveryApplicationErrorCode): DeliveryApplicationError {
  return new DeliveryApplicationError(code);
}
