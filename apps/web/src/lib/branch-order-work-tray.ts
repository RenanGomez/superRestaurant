import {
  parseBranchOrderWorkTrayV1,
  type BranchOrderWorkChannelV1,
  type BranchOrderWorkCursorV1,
  type BranchOrderWorkItemV1,
  type BranchOrderWorkPreparationStatusV1,
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
): Promise<BranchOrderTrayRequestResult> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/branch-orders/tray`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ cursor, limit, schemaVersion: 1, scope }),
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

export type BranchOrderWorkFilter = "all" | "table" | "counter" | "takeout" | "delivery";

export function filterBranchOrderWorkItems(
  items: readonly BranchOrderWorkItemV1[],
  filter: BranchOrderWorkFilter,
): readonly BranchOrderWorkItemV1[] {
  return filter === "all" ? items : items.filter((item) => item.channel === filter);
}
