import type { BranchMemberV1, DiningLayoutV1, TableBoardTableV1, TableBoardV1 } from "@super-restaurant/shared-types";

export function groupBoardByZone(layout: DiningLayoutV1, board: TableBoardV1) {
  const states = new Map(board.tables.map((table) => [table.tableId, table]));
  return layout.zones.map((zone) => ({
    ...zone,
    tables: zone.tables.map((table) => ({ ...table, state: states.get(table.tableId) ?? null })),
  }));
}

export function gridPlacement(layout: { x: number; y: number; width: number; height: number }) {
  return { gridColumn: `${layout.x + 1} / span ${layout.width}`, gridRow: `${layout.y + 1} / span ${layout.height}` };
}

export function tableStatusLabel(state: TableBoardTableV1 | null): string {
  return state === null ? "Sin estado" : state.status === "free" ? "Libre" : "Ocupada";
}

export function orderStatusLabel(status: "draft" | "open" | "partially_paid"): string {
  return status === "draft" ? "Borrador" : status === "open" ? "Abierta" : "Pago parcial";
}

export function waiterCardState(orderId: string, busyOrderId: string | null): { readonly busy: boolean; readonly label: "Guardando…" | "Mesero" } {
  const busy = orderId === busyOrderId;
  return { busy, label: busy ? "Guardando…" : "Mesero" };
}

export function waiterInitials(name: string | null): string {
  if (name === null || name.trim() === "") return "Sin mesero";
  return name.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("es-MX") ?? "").join("");
}

const INVISIBLE = /[​-‍⁠﻿]/gu;

/** Label for a waiter button: name, or an explicit fallback. Never empty. */
export function waiterOptionLabel(member: Pick<BranchMemberV1, "displayName" | "userId">): string {
  const name = member.displayName?.replace(INVISIBLE, "").trim();
  return name ? name : `Mesero sin nombre (${member.userId.slice(0, 4).toLocaleUpperCase("es-MX")})`;
}

/** Waiter options other than the actor, one per user, each with a visible label. */
export function waiterOptions(members: readonly Pick<BranchMemberV1, "displayName" | "userId">[], actorId: string): { userId: string; label: string }[] {
  const seen = new Set<string>([actorId]);
  const options: { userId: string; label: string }[] = [];
  for (const member of members) {
    if (seen.has(member.userId)) continue;
    seen.add(member.userId);
    options.push({ userId: member.userId, label: waiterOptionLabel(member) });
  }
  return options;
}

export function waiterLabel(members: readonly Pick<BranchMemberV1, "displayName" | "userId">[], userId: string | null, actorId?: string): string {
  if (userId === null) return "Sin mesero";
  const name = members.find((member) => member.userId === userId)?.displayName?.trim();
  if (name) return name;
  return userId === actorId ? "Yo" : `Mesero ${userId.slice(0, 4).toLocaleUpperCase("es-MX")}`;
}

/**
 * Tab label for an account in the table dialog.
 * Format: "Cuenta 1 · $130" or "Juan · $130", falling back to "Cuenta 1" or "Juan" when total is absent.
 * Index is 0-based (0 -> "Cuenta 1").
 */
export function accountTabLabel(
  index: number,
  order: { readonly accountLabel?: string | null; readonly total?: string | null } | null | undefined,
  total?: string | null,
): string {
  const cleanLabel = order?.accountLabel?.replace(INVISIBLE, "").trim();
  const base = cleanLabel && cleanLabel.length > 0 ? cleanLabel : `Cuenta ${index + 1}`;
  const effectiveTotal = (total ?? order?.total)?.replace(INVISIBLE, "").trim();
  if (effectiveTotal && effectiveTotal.length > 0) {
    return `${base} · ${effectiveTotal}`;
  }
  return base;
}

/**
 * Returns the number of open accounts for a table, or 0 when free or without state.
 */
export function tableOpenAccountsCount(state: TableBoardTableV1 | null): number {
  return state?.activeOrders.length ?? 0;
}
