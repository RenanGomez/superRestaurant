"use server";

import { cookies } from "next/headers";
import {
  parseInventoryBalanceV1,
  parseInventoryItemV1,
  parseInventoryMovementV1,
  parseInventoryWarehouseV1,
  type InventoryBalanceV1,
  type InventoryItemV1,
  type InventoryMovementKindV1,
  type InventoryMovementV1,
  type InventoryUnitV1,
  type InventoryWarehouseV1,
} from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import {
  BRANCH_PREFERENCE_COOKIE,
  findMembership,
  listMemberships,
  parseBranchPreference,
} from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

export type InventoryError = "conflict" | "denied" | "invalid" | "missing" | "timeout" | "unauthenticated" | "unavailable";

export type InventoryOperation =
  | "createItem"
  | "createMovement"
  | "createWarehouse"
  | "listBalances"
  | "listItems"
  | "listMovements"
  | "listWarehouses"
  | "updateItem"
  | "updateWarehouse";

export type InventoryActionResult =
  | { readonly ok: true; readonly items: readonly InventoryItemV1[] }
  | { readonly ok: true; readonly warehouses: readonly InventoryWarehouseV1[] }
  | { readonly ok: true; readonly movements: readonly InventoryMovementV1[] }
  | { readonly ok: true; readonly balances: readonly InventoryBalanceV1[] }
  | { readonly ok: true; readonly item: InventoryItemV1 }
  | { readonly ok: true; readonly warehouse: InventoryWarehouseV1 }
  | { readonly ok: true; readonly recorded: true }
  | { readonly ok: false; readonly error: InventoryError };

const INVENTORY_UNITS: readonly InventoryUnitV1[] = ["g", "ml", "piece"];
const MANUAL_MOVEMENT_KINDS: ReadonlySet<InventoryMovementKindV1> = new Set([
  "adjustment",
  "count_adjustment",
  "transfer_out",
  "transfer_in",
  "waste",
]);
const MANAGE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "manager"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;

export async function inventoryAction(
  operation: InventoryOperation,
  input?: unknown,
): Promise<InventoryActionResult> {
  if (operation !== "listItems" && operation !== "listWarehouses" && operation !== "listMovements"
    && operation !== "listBalances" && operation !== "createItem" && operation !== "updateItem"
    && operation !== "createWarehouse" && operation !== "updateWarehouse" && operation !== "createMovement") {
    return invalid();
  }

  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) return denied();
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return denied();

  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    return denied();
  }
  const canManage = membership.roles.some((role) => MANAGE_ROLES.has(role));
  if (!canManage && operation !== "listItems" && operation !== "listWarehouses"
    && operation !== "listMovements" && operation !== "listBalances") return denied();

  const base = `${env.apiBaseUrl}/api/v1/inventory`;

  if (operation === "listItems") {
    const query = new URLSearchParams({ restaurantId: scope.restaurantId });
    const reply = await send(session.access_token, `${base}/items?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const items = parseItemsList(reply.body, scope.restaurantId);
    return items === undefined ? unavailable() : { ok: true, items };
  }

  if (operation === "listWarehouses") {
    const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
    const reply = await send(session.access_token, `${base}/warehouses?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const warehouses = parseWarehousesList(reply.body, scope.restaurantId, scope.branchId);
    return warehouses === undefined ? unavailable() : { ok: true, warehouses };
  }

  if (operation === "listMovements") {
    const filter = readMovementFilter(input);
    if (filter === undefined) return invalid();
    const query = new URLSearchParams({
      branchId: scope.branchId,
      limit: "100",
      restaurantId: scope.restaurantId,
    });
    if (filter.warehouseId !== undefined) query.set("warehouseId", filter.warehouseId);
    if (filter.itemId !== undefined) query.set("itemId", filter.itemId);
    const reply = await send(session.access_token, `${base}/movements?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const movements = parseMovementsList(reply.body, scope.restaurantId, scope.branchId);
    return movements === undefined ? unavailable() : { ok: true, movements };
  }

  if (operation === "listBalances") {
    const filter = readBalanceFilter(input);
    if (filter === undefined) return invalid();
    const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
    if (filter.warehouseId !== undefined) query.set("warehouseId", filter.warehouseId);
    const reply = await send(session.access_token, `${base}/balances?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const balances = parseBalancesList(reply.body, scope.restaurantId, scope.branchId);
    return balances === undefined ? unavailable() : { ok: true, balances };
  }

  if (operation === "createMovement") {
    const command = readMovementCommand(input);
    if (command === undefined) return invalid();
    const transfer = command.kind === "transfer_out" || command.kind === "transfer_in";
    const reply = await send(session.access_token, `${base}/movements`, "POST", {
      branchId: scope.branchId,
      compensatesMovementId: null,
      currency: null,
      idempotencyKey: command.idempotencyKey,
      itemId: command.itemId,
      kind: command.kind,
      quantityDelta: command.quantityDelta,
      reason: command.reason,
      restaurantId: scope.restaurantId,
      toWarehouseId: transfer ? command.toWarehouseId : null,
      transferPairId: null,
      unitCode: command.unitCode,
      unitCostMinor: null,
      warehouseId: command.warehouseId,
    });
    if (!reply.ok) return reply;
    return plainRecord(reply.body) === undefined ? unavailable() : { ok: true, recorded: true };
  }

  if (operation === "createItem") {
    const command = readCreateItem(input);
    if (command === undefined) return invalid();
    const reply = await send(session.access_token, `${base}/items`, "POST", {
      ...command,
      restaurantId: scope.restaurantId,
    });
    if (!reply.ok) return reply;
    const item = parseInventoryItemV1(reply.body);
    return item === undefined || item.restaurantId !== scope.restaurantId ? unavailable() : { ok: true, item };
  }

  if (operation === "updateItem") {
    const command = readItemPatch(input);
    if (command === undefined) return invalid();
    const reply = await send(
      session.access_token,
      `${base}/items/${encodeURIComponent(command.id)}`,
      "PATCH",
      command.patch,
    );
    if (!reply.ok) return reply;
    const item = parseInventoryItemV1(reply.body);
    return item === undefined || item.id !== command.id || item.restaurantId !== scope.restaurantId
      ? unavailable() : { ok: true, item };
  }

  if (operation === "createWarehouse") {
    const command = readCreateWarehouse(input);
    if (command === undefined) return invalid();
    const reply = await send(session.access_token, `${base}/warehouses`, "POST", {
      ...command,
      branchId: scope.branchId,
      restaurantId: scope.restaurantId,
    });
    if (!reply.ok) return reply;
    const warehouse = parseInventoryWarehouseV1(reply.body);
    return warehouse === undefined || warehouse.restaurantId !== scope.restaurantId
      || warehouse.branchId !== scope.branchId ? unavailable() : { ok: true, warehouse };
  }

  const command = readWarehousePatch(input);
  if (command === undefined) return invalid();
  const reply = await send(
    session.access_token,
    `${base}/warehouses/${encodeURIComponent(command.id)}`,
    "PATCH",
    command.patch,
  );
  if (!reply.ok) return reply;
  const warehouse = parseInventoryWarehouseV1(reply.body);
  return warehouse === undefined || warehouse.id !== command.id || warehouse.restaurantId !== scope.restaurantId
    || warehouse.branchId !== scope.branchId ? unavailable() : { ok: true, warehouse };
}

type CreateItemCommand = {
  readonly sku: string | null;
  readonly name: string;
  readonly unitCode: InventoryUnitV1;
  readonly purchaseUnitFactor: number;
  readonly minQuantity: number;
  readonly active: boolean;
};

function readCreateItem(input: unknown): CreateItemCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const name = readText(own(record, "name"), 160);
  const sku = readOptionalText(own(record, "sku"), 100);
  const unitCode = own(record, "unitCode");
  const purchaseUnitFactor = readWholeNumber(own(record, "purchaseUnitFactor"), 1);
  const minQuantity = readWholeNumber(own(record, "minQuantity"), 0);
  const active = readBoolean(own(record, "active"), true);
  if (name === undefined || sku === undefined || !isInventoryUnit(unitCode)
    || purchaseUnitFactor === undefined || minQuantity === undefined || active === undefined) {
    return undefined;
  }
  return { active, minQuantity, name, purchaseUnitFactor, sku, unitCode };
}

type WarehouseCommand = {
  readonly name: string;
  readonly active: boolean;
};

function readCreateWarehouse(input: unknown): WarehouseCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const name = readText(own(record, "name"), 160);
  const active = readBoolean(own(record, "active"), true);
  return name === undefined || active === undefined ? undefined : { active, name };
}

function readItemPatch(input: unknown): { readonly id: string; readonly patch: Readonly<Record<string, unknown>> } | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  const patch: Record<string, unknown> = {};
  if (Object.hasOwn(record, "name")) {
    const name = readText(own(record, "name"), 160);
    if (name === undefined) return undefined;
    patch["name"] = name;
  }
  if (Object.hasOwn(record, "sku")) {
    const sku = readOptionalText(own(record, "sku"), 100);
    if (sku === undefined) return undefined;
    patch["sku"] = sku;
  }
  if (Object.hasOwn(record, "minQuantity")) {
    const minQuantity = readWholeNumber(own(record, "minQuantity"), 0);
    if (minQuantity === undefined) return undefined;
    patch["minQuantity"] = minQuantity;
  }
  if (Object.hasOwn(record, "purchaseUnitFactor")) {
    const purchaseUnitFactor = readWholeNumber(own(record, "purchaseUnitFactor"), 1);
    if (purchaseUnitFactor === undefined) return undefined;
    patch["purchaseUnitFactor"] = purchaseUnitFactor;
  }
  if (Object.hasOwn(record, "active")) {
    const active = readBoolean(own(record, "active"));
    if (active === undefined) return undefined;
    patch["active"] = active;
  }
  return Object.keys(patch).length === 0 ? undefined : { id, patch: Object.freeze(patch) };
}

function readWarehousePatch(input: unknown): { readonly id: string; readonly patch: Readonly<Record<string, unknown>> } | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  const patch: Record<string, unknown> = {};
  if (Object.hasOwn(record, "name")) {
    const name = readText(own(record, "name"), 160);
    if (name === undefined) return undefined;
    patch["name"] = name;
  }
  if (Object.hasOwn(record, "active")) {
    const active = readBoolean(own(record, "active"));
    if (active === undefined) return undefined;
    patch["active"] = active;
  }
  return Object.keys(patch).length === 0 ? undefined : { id, patch: Object.freeze(patch) };
}

function parseItemsList(value: unknown, restaurantId: string): readonly InventoryItemV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1 || own(record, "restaurantId") !== restaurantId) {
    return undefined;
  }
  const rawItems = own(record, "items");
  if (!Array.isArray(rawItems)) return undefined;
  const items: InventoryItemV1[] = [];
  for (const rawItem of rawItems) {
    const item = parseInventoryItemV1(rawItem);
    if (item === undefined || item.restaurantId !== restaurantId) return undefined;
    items.push(item);
  }
  return items;
}

function parseWarehousesList(
  value: unknown,
  restaurantId: string,
  branchId: string,
): readonly InventoryWarehouseV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  const rawWarehouses = own(record, "warehouses");
  if (!Array.isArray(rawWarehouses)) return undefined;
  const warehouses: InventoryWarehouseV1[] = [];
  for (const rawWarehouse of rawWarehouses) {
    const warehouse = parseInventoryWarehouseV1(rawWarehouse);
    if (warehouse === undefined || warehouse.restaurantId !== restaurantId || warehouse.branchId !== branchId) {
      return undefined;
    }
    warehouses.push(warehouse);
  }
  return warehouses;
}

function parseMovementsList(
  value: unknown,
  restaurantId: string,
  branchId: string,
): readonly InventoryMovementV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  const rawMovements = own(record, "movements");
  if (!Array.isArray(rawMovements)) return undefined;
  const movements: InventoryMovementV1[] = [];
  for (const rawMovement of rawMovements) {
    const movement = parseInventoryMovementV1(rawMovement);
    if (movement === undefined || movement.restaurantId !== restaurantId || movement.branchId !== branchId) {
      return undefined;
    }
    movements.push(movement);
  }
  return movements;
}

function parseBalancesList(
  value: unknown,
  restaurantId: string,
  branchId: string,
): readonly InventoryBalanceV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  const rawBalances = own(record, "balances");
  if (!Array.isArray(rawBalances)) return undefined;
  const balances: InventoryBalanceV1[] = [];
  for (const rawBalance of rawBalances) {
    const balance = parseInventoryBalanceV1(rawBalance);
    if (balance === undefined || balance.restaurantId !== restaurantId || balance.branchId !== branchId) {
      return undefined;
    }
    balances.push(balance);
  }
  return balances;
}

interface MovementFilter {
  readonly warehouseId?: string;
  readonly itemId?: string;
}

function readMovementFilter(input: unknown): MovementFilter | undefined {
  if (input === undefined) return {};
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const warehouseId = readFilterUuid(own(record, "warehouseId"));
  const itemId = readFilterUuid(own(record, "itemId"));
  if (warehouseId === null || itemId === null) return undefined;
  return {
    ...(warehouseId === undefined ? {} : { warehouseId }),
    ...(itemId === undefined ? {} : { itemId }),
  };
}

function readBalanceFilter(input: unknown): { readonly warehouseId?: string } | undefined {
  if (input === undefined) return {};
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const warehouseId = readFilterUuid(own(record, "warehouseId"));
  if (warehouseId === null) return undefined;
  return warehouseId === undefined ? {} : { warehouseId };
}

/** Blank or absent means «all»; anything that is not a UUID is invalid (`null`). */
function readFilterUuid(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

interface ManualMovementCommand {
  readonly warehouseId: string;
  readonly itemId: string;
  readonly kind: InventoryMovementKindV1;
  readonly quantityDelta: number;
  readonly unitCode: InventoryUnitV1;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly toWarehouseId: string | null;
}

function readMovementCommand(input: unknown): ManualMovementCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const warehouseId = readFilterUuid(own(record, "warehouseId"));
  const itemId = readFilterUuid(own(record, "itemId"));
  const kindValue = own(record, "kind");
  const kind = typeof kindValue === "string" && MANUAL_MOVEMENT_KINDS.has(kindValue as InventoryMovementKindV1)
    ? kindValue as InventoryMovementKindV1 : undefined;
  const quantityDelta = own(record, "quantityDelta");
  const unitCode = own(record, "unitCode");
  const reason = readText(own(record, "reason"), 500);
  const idempotencyKey = own(record, "idempotencyKey");
  const rawTarget = own(record, "toWarehouseId");
  if (rawTarget !== undefined && rawTarget !== null
    && (typeof rawTarget !== "string" || !UUID_PATTERN.test(rawTarget))) {
    return undefined;
  }
  const toWarehouseId = typeof rawTarget === "string" ? rawTarget : null;

  if (warehouseId === undefined || warehouseId === null
    || itemId === undefined || itemId === null
    || kind === undefined
    || typeof quantityDelta !== "number" || !Number.isSafeInteger(quantityDelta) || quantityDelta === 0
    || !isInventoryUnit(unitCode)
    || reason === undefined || reason.length < 3
    || typeof idempotencyKey !== "string" || !UUID_PATTERN.test(idempotencyKey)) {
    return undefined;
  }
  if ((kind === "waste" || kind === "transfer_out") && quantityDelta > 0) return undefined;
  if (kind === "transfer_in" && quantityDelta < 0) return undefined;
  if (kind === "transfer_out" || kind === "transfer_in") {
    if (toWarehouseId === null || toWarehouseId === warehouseId) return undefined;
  } else if (toWarehouseId !== null) {
    return undefined;
  }

  return Object.freeze({
    idempotencyKey,
    itemId,
    kind,
    quantityDelta,
    reason,
    toWarehouseId,
    unitCode,
    warehouseId,
  });
}

async function send(
  accessToken: string,
  url: string,
  method: "GET" | "PATCH" | "POST",
  body?: unknown,
): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly error: InventoryError }> {
  let response: Response;
  try {
    const init: RequestInit = {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method,
      signal: AbortSignal.timeout(10_000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(url, init);
  } catch (error) {
    return requestTimedOut(error) ? timedOut() : unavailable();
  }
  if (response.status === 400) return invalid();
  if (response.status === 401) return unauthenticated();
  if (response.status === 403) return denied();
  if (response.status === 404) return { ok: false, error: "missing" };
  if (response.status === 409) return { ok: false, error: "conflict" };
  if (!response.ok) return unavailable();
  try {
    return { body: await response.json(), ok: true };
  } catch {
    return unavailable();
  }
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function own(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function readText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maximumLength && !CONTROL_CHARACTER_PATTERN.test(trimmed)
    ? trimmed
    : undefined;
}

function readOptionalText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() === "" ? null : readText(value, maximumLength);
}

function readWholeNumber(value: unknown, minimum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}

function readBoolean(value: unknown, fallback?: boolean): boolean | undefined {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : undefined;
}

function isInventoryUnit(value: unknown): value is InventoryUnitV1 {
  return typeof value === "string" && (INVENTORY_UNITS as readonly string[]).includes(value);
}

function requestTimedOut(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error
    && (error.name === "TimeoutError" || error.name === "AbortError");
}

function invalid(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "invalid", ok: false };
}

function denied(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "denied", ok: false };
}

function unauthenticated(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "unauthenticated", ok: false };
}

function timedOut(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "timeout", ok: false };
}

function unavailable(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "unavailable", ok: false };
}
