/**
 * Which view of the cash screens to show. `/app/caja` is Cobrar (collect a payment) and
 * `/app/caja/corte` is Turno y corte (X cut, movements, close). Pure on purpose: the pages only
 * translate the server's register status, the role check and the URL into these inputs.
 */

export const COBRAR_PATH = "/app/caja";
export const CORTE_PATH = "/app/caja/corte";

export type RegisterState = "none" | "open" | "closed" | "unavailable";

interface ReportLike {
  readonly status: string;
  readonly value?: { readonly register: { readonly status: string } };
}

/** `none` when there is no register for this device yet (or the server has none), `unavailable` when the state could not be read. */
export function registerState(report: ReportLike | undefined): RegisterState {
  if (report === undefined || report.status === "not_found") return "none";
  if (report.status !== "ok") return "unavailable";
  const status = report.value?.register.status;
  return status === "open" ? "open" : status === "closed" ? "closed" : "unavailable";
}

export type CobrarView = "no_permission" | "unavailable" | "open_register" | "order" | "list";

/**
 * Cobrar: without an open register only the compact opening form is shown. With one, an `orderId` (or a
 * receipt that follows a payment) shows just that order, and no `orderId` shows the payable list.
 */
export function cobrarView(input: {
  readonly canOperate: boolean;
  readonly register: RegisterState;
  readonly orderId: string | undefined;
  readonly hasReceipt: boolean;
}): CobrarView {
  if (!input.canOperate) return "no_permission";
  if (input.register === "unavailable") return "unavailable";
  if (input.register !== "open") return "open_register";
  return input.orderId !== undefined || input.hasReceipt ? "order" : "list";
}

export type CorteView = "no_permission" | "unavailable" | "no_register" | "open" | "closed";

export function corteView(input: { readonly canOperate: boolean; readonly register: RegisterState }): CorteView {
  if (!input.canOperate) return "no_permission";
  if (input.register === "unavailable") return "unavailable";
  if (input.register === "none") return "no_register";
  return input.register === "open" ? "open" : "closed";
}

export function cobrarHref(orderId?: string): string {
  return orderId === undefined ? COBRAR_PATH : `${COBRAR_PATH}?orderId=${encodeURIComponent(orderId)}#cobrar`;
}
