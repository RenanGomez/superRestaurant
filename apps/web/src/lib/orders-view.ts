/**
 * View state of `/app/orders`, kept in the URL so a reload (or the jump from Mesas) reproduces it:
 * `list` (no order open), `detail` (`?orderId=`) and `adding` (`?orderId=&addItem=1`).
 */
export type OrdersView = "list" | "detail" | "adding";

export interface OrdersParamReader {
  get(name: string): string | null;
}

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** The requested order id, only when it is a well-formed UUID; anything else is ignored. */
export function ordersOrderId(params: OrdersParamReader): string | undefined {
  const value = params.get("orderId");
  return value !== null && ORDER_ID_PATTERN.test(value) ? value : undefined;
}

export function ordersView(params: OrdersParamReader): OrdersView {
  if (ordersOrderId(params) === undefined) return "list";
  return params.get("addItem") === "1" ? "adding" : "detail";
}

/** Canonical URL for a view; `orderId` undefined means the plain list. */
export function ordersHref(orderId: string | undefined, adding: boolean): string {
  if (orderId === undefined) return "/app/orders";
  return `/app/orders?orderId=${encodeURIComponent(orderId)}${adding ? "&addItem=1" : ""}`;
}

/** Name of a dining table for display; falls back to the generic «Mesa» when the name is unknown. */
export function tableLabel(tableId: string | null, names: ReadonlyMap<string, string> | undefined): string {
  if (tableId === null || names === undefined) return "Mesa";
  const name = names.get(tableId)?.trim();
  return name === undefined || name === "" ? "Mesa" : name;
}
