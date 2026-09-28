import {
  parseBranchOrderWorkTrayV1,
  type BranchOrderWorkChannelV1,
  type BranchOrderWorkCursorV1,
  type BranchOrderWorkItemV1,
  type BranchOrderWorkPreparationStatusV1,
  type BranchOrderWorkStatusV1,
  type BranchOrderWorkTrayV1,
  type BranchScope,
} from "@super-restaurant/shared-types";

export type BranchOrderTrayRequestResult =
  | { readonly ok: true; readonly value: BranchOrderWorkTrayV1 }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "unavailable" };

export async function requestBranchOrderWorkTray(
  token: string,
  baseUrl: string,
  scope: BranchScope,
  cursor: BranchOrderWorkCursorV1 | null,
  limit: number,
  channel: BranchOrderWorkChannelV1 | null = null,
): Promise<BranchOrderTrayRequestResult> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/branch-orders/tray`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel, cursor, limit, schemaVersion: 1, scope }),
    });
    if (!response.ok) {
      return { error: response.status === 400 ? "invalid" : response.status === 401 || response.status === 403 ? "denied" : "unavailable", ok: false };
    }
    const body: unknown = await response.json();
    const value = parseBranchOrderWorkTrayV1(body);
    if (value === undefined || value.scope.restaurantId !== scope.restaurantId || value.scope.branchId !== scope.branchId) {
      return { error: "unavailable", ok: false };
    }
    return { ok: true, value };
  } catch { return { error: "unavailable", ok: false }; }
}

const CHANNEL_LABELS: Record<BranchOrderWorkChannelV1, string> = {
  counter: "Mostrador", delivery: "Domicilio", table: "Mesa", takeout: "Para llevar",
};

const PREPARATION_LABELS: Record<BranchOrderWorkPreparationStatusV1, string> = {
  cancelled: "Cancelada", not_sent: "Sin enviar", partially_ready: "Parcialmente lista",
  preparing: "En preparación", queued: "En cola", ready: "Lista",
};

export function channelLabel(channel: BranchOrderWorkChannelV1): string {
  return CHANNEL_LABELS[channel];
}

export function preparationLabel(preparation: BranchOrderWorkPreparationStatusV1): string {
  return PREPARATION_LABELS[preparation];
}

/** Money is always formatted from its own frozen minor-unit total; never recomputed here. */
export function formatOrderWorkTotal(totalMinor: number, currency: string, locale = "es-MX"): string {
  return new Intl.NumberFormat(locale, { currency, style: "currency" }).format(totalMinor / 100);
}

export function formatOrderWorkTime(iso: string, timeZone?: string, locale = "es-MX"): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(timeZone === undefined ? {} : { timeZone }) }).format(new Date(iso));
}

/**
 * A focus/visibility refresh, "Actualizar" and "Cargar más" can all be in flight at once; without
 * this guard, an older response can land after a newer one and clobber it. `requestSeq` numbers
 * every load attempt monotonically (only the most recently *issued* request's response applies);
 * additionally, a "Cargar más" (non-replace) response only applies if the cursor it was requested
 * with still matches the tray's current cursor when it resolves -- otherwise a refresh already
 * reset the list underneath it and appending would duplicate or reorder items.
 */
export interface BranchOrderWorkTrayRequestMeta {
  readonly requestSeq: number;
  readonly cursor: BranchOrderWorkCursorV1 | null;
  readonly replace: boolean;
}

export function shouldApplyBranchOrderWorkTrayResponse(
  request: BranchOrderWorkTrayRequestMeta,
  latestRequestSeq: number,
  currentCursor: BranchOrderWorkCursorV1 | null,
): boolean {
  if (request.requestSeq !== latestRequestSeq) return false;
  return request.replace || cursorsEqual(request.cursor, currentCursor);
}

function cursorsEqual(left: BranchOrderWorkCursorV1 | null, right: BranchOrderWorkCursorV1 | null): boolean {
  return left === null ? right === null : right !== null && left.orderId === right.orderId && left.updatedAt === right.updatedAt;
}

export type BranchOrderWorkFilter = "all" | "table" | "counter" | "takeout" | "delivery";

const PAYABLE_STATUSES: readonly BranchOrderWorkStatusV1[] = Object.freeze(["open", "partially_paid"]);

/** A "draft" Order has no cuenta yet; checkout rejects it, so "Cobrar en caja" must never show for it. */
export function isPayableBranchOrderWorkStatus(status: BranchOrderWorkStatusV1): boolean {
  return PAYABLE_STATUSES.includes(status);
}

export function filterBranchOrderWorkItems(
  items: readonly BranchOrderWorkItemV1[],
  filter: BranchOrderWorkFilter,
): readonly BranchOrderWorkItemV1[] {
  return filter === "all" ? items : items.filter((item) => item.channel === filter);
}
