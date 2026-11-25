"use server";

import { cookies } from "next/headers";
import {
  parseInventoryItemV1,
  parseInventoryWarehouseV1,
  type InventoryItemV1,
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
  | "createWarehouse"
  | "listItems"
  | "listWarehouses"
  | "updateItem"
  | "updateWarehouse";

export type InventoryActionResult =
  | { readonly ok: true; readonly items: readonly InventoryItemV1[] }
  | { readonly ok: true; readonly warehouses: readonly InventoryWarehouseV1[] }
  | { readonly ok: true; readonly item: InventoryItemV1 }
  | { readonly ok: true; readonly warehouse: InventoryWarehouseV1 }
  | { readonly ok: false; readonly error: InventoryError };

const INVENTORY_UNITS: readonly InventoryUnitV1[] = ["g", "ml", "piece"];
const MANAGE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "manager"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;

export async function inventoryAction(
  operation: InventoryOperation,
  input?: unknown,
): Promise<InventoryActionResult> {
  if (operation !== "listItems" && operation !== "listWarehouses" && operation !== "createItem"
    && operation !== "updateItem" && operation !== "createWarehouse" && operation !== "updateWarehouse") {
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
  if (!canManage && operation !== "listItems" && operation !== "listWarehouses") return denied();

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
