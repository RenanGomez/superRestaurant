import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SupabaseDirectReadConfig } from "./config.js";

export interface SupabaseDirectScope {
  readonly restaurantId: string;
  readonly branchId: string;
}

export interface SupabaseDirectOrderRead {
  readonly id: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface SupabaseDirectKdsRead {
  readonly cursor: number;
  readonly id: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly eventType: string;
  readonly createdAt: string;
}

type OrderRow = {
  id: string;
  restaurant_id: string;
  branch_id: string;
  status: string;
  created_at: string;
};

type KdsRow = {
  cursor: number | string;
  id: string;
  restaurant_id: string;
  branch_id: string;
  order_id: string;
  event_type: string;
  created_at: string;
};

/**
 * Option C's intentionally narrow public boundary. It exposes scoped reads only
 * and deliberately does not implement Adr010Adapter or any financial mutation.
 */
export class SupabaseDirectReadClient {
  readonly #client: SupabaseClient;

  public constructor(config: SupabaseDirectReadConfig) {
    this.#client = createClient(config.url, config.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  public async readOrders(
    scope: SupabaseDirectScope,
    afterOrderId?: string,
    limit = 100,
  ): Promise<readonly SupabaseDirectOrderRead[]> {
    assertScope(scope);
    assertLimit(limit);
    let query = this.#client
      .schema("adr010_b")
      .from("orders")
      .select("id,restaurant_id,branch_id,status,created_at")
      .eq("restaurant_id", scope.restaurantId)
      .eq("branch_id", scope.branchId)
      .order("id", { ascending: true })
      .limit(limit);
    // UUID ordering is only deterministic keyset pagination. It is not an event,
    // version, realtime-recovery, or causal cursor and must never be used as one.
    if (afterOrderId !== undefined) query = query.gt("id", requireOrderPaginationId(afterOrderId));
    const { data, error } = await query;
    if (error !== null) throw new Error(`Option-C scoped order read failed: ${error.message}`);
    return (data as OrderRow[]).map((row) => {
      assertReturnedScope(scope, row.restaurant_id, row.branch_id);
      return {
        id: row.id,
        restaurantId: row.restaurant_id,
        branchId: row.branch_id,
        status: row.status,
        createdAt: row.created_at,
      };
    });
  }

  public async readKdsEvents(
    scope: SupabaseDirectScope,
    afterCursor: number,
    limit = 100,
  ): Promise<readonly SupabaseDirectKdsRead[]> {
    assertScope(scope);
    assertCursor(afterCursor);
    assertLimit(limit);
    const { data, error } = await this.#client
      .schema("adr010_b")
      .from("kds_events")
      .select("cursor,id,restaurant_id,branch_id,order_id,event_type,created_at")
      .eq("restaurant_id", scope.restaurantId)
      .eq("branch_id", scope.branchId)
      .gt("cursor", afterCursor)
      .order("cursor", { ascending: true })
      .limit(limit);
    if (error !== null) throw new Error(`Option-C scoped KDS read failed: ${error.message}`);
    let previousCursor = afterCursor;
    return (data as KdsRow[]).map((row) => {
      assertReturnedScope(scope, row.restaurant_id, row.branch_id);
      const cursor = Number(row.cursor);
      if (!Number.isSafeInteger(cursor) || cursor <= previousCursor) {
        throw new Error("Option-C KDS recovery returned a non-monotonic or unsafe cursor.");
      }
      previousCursor = cursor;
      return {
        cursor,
        id: row.id,
        restaurantId: row.restaurant_id,
        branchId: row.branch_id,
        orderId: row.order_id,
        eventType: row.event_type,
        createdAt: row.created_at,
      };
    });
  }
}

const assertScope = (scope: SupabaseDirectScope): void => {
  if (scope.restaurantId.trim() === "" || scope.branchId.trim() === "") throw new Error("Option-C reads require an explicit scope.");
};

const assertCursor = (cursor: number): void => {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("KDS cursor must be a non-negative safe integer.");
};

const assertLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("Read limit must be an integer from 1 to 500.");
};

const assertReturnedScope = (expected: SupabaseDirectScope, restaurantId: string, branchId: string): void => {
  if (restaurantId !== expected.restaurantId || branchId !== expected.branchId) {
    throw new Error("Option-C read returned a row outside the requested scope.");
  }
};

const requireOrderPaginationId = (value: string): string => {
  if (value.trim() === "") throw new Error("Order pagination ID cannot be empty.");
  return value;
};
