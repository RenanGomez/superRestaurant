"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { createPortal } from "react-dom";
import type { BranchScope, DiningLayoutV1, BranchMemberV1, OperationalShiftSummaryV1, OrderDetailV1, TableBoardActiveOrderV1, TableBoardV1 } from "@super-restaurant/shared-types";
import { captureDeviceId } from "../../../lib/capture-workspace";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { watchTabReturn } from "../../../lib/revalidate-on-return";
import { planCanvasStyle, planPlacement, planViewBox } from "../../../lib/floor-plan";
import { uiButton, uiOption } from "../../../lib/ui-classes";
import { tableShapeClass } from "../../../lib/table-shape";
import { accountTabLabel, groupBoardByZone, orderStatusLabel, tableOpenAccountsCount, tableStatusLabel, waiterCardState, waiterLabel, waiterOptions } from "../../../lib/tables-board";

type ErrorCode = "invalid" | "denied" | "conflict" | "no_shift" | "unavailable";
type Failure = { readonly ok: false; readonly error: ErrorCode };
type Attempt = { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string; readonly deviceId: string };
type Snapshot = { readonly ok: true; readonly board: TableBoardV1; readonly layout: DiningLayoutV1; readonly shift: OperationalShiftSummaryV1 | null; readonly timeZone: string };
type Selected = { readonly tableId: string; readonly name: string; readonly orders: readonly TableBoardActiveOrderV1[] };
const button = uiButton();
const primary = uiButton("primary");

interface Props {
  readonly scope: BranchScope;
  readonly branchName: string;
  readonly restaurantName: string;
  readonly actorId: string;
  readonly canManage: boolean;
  readonly canOpenShift: boolean;
  readonly actions: {
    readonly read: () => Promise<Snapshot | Failure>;
    readonly create: (tableId: string, orderId: string, attempt: Attempt, waiterUserId: string | null) => Promise<{ readonly ok: true; readonly orderId: string; readonly waiterAssigned: boolean } | Failure>;
    readonly assign: (orderId: string, expectedVersion: number, attempt: Attempt, waiterUserId: string | null) => Promise<{ readonly ok: true } | Failure>;
    readonly setAccountLabel: (orderId: string, expectedVersion: number, attempt: Attempt, accountLabel: string | null) => Promise<{ readonly ok: true } | Failure>;
    readonly waiters: () => Promise<{ readonly ok: true; readonly members: readonly BranchMemberV1[] } | Failure>;
    readonly openShift: (shiftId: string, attempt: Attempt) => Promise<{ readonly ok: true } | Failure>;
    readonly detail: (orderId: string) => Promise<{ readonly ok: true; readonly value: OrderDetailV1 } | { readonly ok: false; readonly error: string }>;
  };
}

function attempt(): Attempt {
  return { eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), occurredAt: new Date().toISOString(),
    deviceId: captureDeviceId(window.localStorage, () => crypto.randomUUID()) };
}

function time(iso: string, timeZone?: string) { return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso)); }
function totalLabel(detail: OrderDetailV1 | null | undefined) {
  return detail === undefined ? "Cargando total…" : detail === null ? "Total no disponible"
    : formatMinorUnits(detail.totals.totalMinor, detail.totals.currency);
}
function tabTotal(detail: OrderDetailV1 | null | undefined): string | null {
  return detail === undefined ? "Cargando…" : detail === null ? null
    : formatMinorUnits(detail.totals.totalMinor, detail.totals.currency);
}

function message(error: ErrorCode) {
  return error === "no_shift" ? "No hay turno abierto." : error === "conflict" ? "Los datos cambiaron. Se actualizó el tablero."
    : error === "denied" ? "Tu rol o sesión ya no permite esta acción." : error === "invalid" ? "No se pudo enviar la acción." : "No se pudo confirmar el resultado. Actualiza antes de intentar otra acción.";
}

function WaiterPicker({ members, actorId, current, disabled, allowNone, onPick }: {
  readonly members: readonly BranchMemberV1[] | null; readonly actorId: string; readonly current: string | null; readonly disabled: boolean;
  readonly allowNone: boolean; readonly onPick: (userId: string | null) => void;
}) {
  const others = waiterOptions(members ?? [], actorId);
  const option = (id: string | null, label: string) => <button key={id ?? "none"} type="button" className={uiOption(current === id, "min-w-24")}
    aria-pressed={current === id} disabled={disabled || (!allowNone && current === id)} onClick={() => onPick(id)}>{label}</button>;
  return <div>
    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Elegir mesero">
      {allowNone && option(null, "Sin mesero")}
      {option(actorId, "Yo")}
      {waiterOptions(members ?? [], actorId).map((entry) => option(entry.userId, entry.label))}
    </div>
    {members !== null && others.length === 0 && <p className="mt-2 text-xs text-text-muted">Asigna el rol mesero en Accesos para ver más opciones.</p>}
  </div>;
}

export function TablesBoard({ scope, branchName, restaurantName, actorId, canManage, canOpenShift, actions }: Props) {
  const [waiters, setWaiters] = useState<readonly BranchMemberV1[] | null>(null);
  const [pickOrder, setPickOrder] = useState<string | null>(null);
  const [editingAccountOrderId, setEditingAccountOrderId] = useState<string | null>(null);
  const [editingAccountText, setEditingAccountText] = useState("");
  const waiterSeq = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [details, setDetails] = useState<Record<string, OrderDetailV1 | null>>({});
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [busy, setBusy] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [orderFeedback, setOrderFeedback] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);
  const detailSeq = useRef(0);
  const selectedRef = useRef<Selected | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  function loadDetails(orders: readonly TableBoardActiveOrderV1[]) {
    const current = ++detailSeq.current;
    setDetails({});
    for (const order of orders) {
      void actions.detail(order.orderId).then((result) => {
        if (current !== detailSeq.current) return;
        setDetails((current) => ({ ...current, [order.orderId]: result.ok ? result.value : null }));
      }).catch(() => { if (current === detailSeq.current) setDetails((values) => ({ ...values, [order.orderId]: null })); });
    }
  }

  async function refresh(preserveFeedback = false): Promise<Snapshot | null> {
    const current = ++seq.current;
    setLoading(true);
    let result: Snapshot | Failure;
    try { result = await actions.read(); } catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
    if (current !== seq.current) return null;
    setLoading(false);
    if (!result.ok) {
      detailSeq.current += 1;
      selectedRef.current = null;
      setDetails({}); setSnapshot(null); setError(result.error); setSelected(null); setActiveOrderId(null);
      return null;
    }
    setSnapshot(result);
    if (!preserveFeedback) setError(null);
    const active = selectedRef.current === null ? undefined : result.board.tables.find((entry) => entry.tableId === selectedRef.current?.tableId);
    if (active !== undefined) loadDetails(active.activeOrders);
    setSelected((previous) => {
      if (previous === null) return null;
      const table = result.board.tables.find((entry) => entry.tableId === previous.tableId);
      if (table === undefined) { selectedRef.current = null; setActiveOrderId(null); return null; }
      selectedRef.current = { ...previous, orders: table.activeOrders };
      return selectedRef.current;
    });
    return result;
  }

  async function loadWaiters() {
    const current = ++waiterSeq.current;
    let result: Awaited<ReturnType<Props["actions"]["waiters"]>>;
    try { result = await actions.waiters(); } catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
    if (current === waiterSeq.current) setWaiters(result.ok ? result.members : null);
  }

  useEffect(() => { void refresh(); void loadWaiters(); }, [scope.branchId, scope.restaurantId]);
  // One re-read per real return to the tab (hidden >= 15 s, at most every 30 s). Reads go through server
  // actions, so no router.refresh() (which would re-render the whole route) is needed here.
  useEffect(() => watchTabReturn(() => { void refresh(); void loadWaiters(); }), [scope.branchId, scope.restaurantId]);

  async function select(tableId: string, name: string, orders: readonly TableBoardActiveOrderV1[]) {
    selectedRef.current = { tableId, name, orders };
    setSelected(selectedRef.current);
    setActiveOrderId(orders[0]?.orderId ?? null);
    setError(null); setNotice(null); setPickOrder(null); setEditingAccountOrderId(null); setEditingAccountText(""); setOrderFeedback({});
    loadDetails(orders);
  }

  useEffect(() => {
    if (selected === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [selected?.tableId]);

  function dialogKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (editingAccountOrderId !== null) {
        event.stopPropagation();
        setEditingAccountOrderId(null);
        return;
      }
      if (!busy && busyOrderId === null) { selectedRef.current = null; setSelected(null); setActiveOrderId(null); }
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled])'));
    if (controls.length === 0) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (selected === null || selected.orders.length === 0) return;
    const orders = selected.orders;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const nextIndex = (currentIndex + 1) % orders.length;
      const nextOrder = orders[nextIndex]!;
      setActiveOrderId(nextOrder.orderId);
      setEditingAccountOrderId(null);
      setPickOrder(null);
      tabRefs.current[nextOrder.orderId]?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const prevIndex = (currentIndex - 1 + orders.length) % orders.length;
      const prevOrder = orders[prevIndex]!;
      setActiveOrderId(prevOrder.orderId);
      setEditingAccountOrderId(null);
      setPickOrder(null);
      tabRefs.current[prevOrder.orderId]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      const firstOrder = orders[0]!;
      setActiveOrderId(firstOrder.orderId);
      setEditingAccountOrderId(null);
      setPickOrder(null);
      tabRefs.current[firstOrder.orderId]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      const lastOrder = orders[orders.length - 1]!;
      setActiveOrderId(lastOrder.orderId);
      setEditingAccountOrderId(null);
      setPickOrder(null);
      tabRefs.current[lastOrder.orderId]?.focus();
    }
  }

  async function create() {
    if (selected === null || busy || busyOrderId !== null) return;
    if (snapshot?.shift === null) { setError("no_shift"); return; }
    setBusy(true); setError(null); setNotice(null);
    const orderId = crypto.randomUUID();
    let result: Awaited<ReturnType<Props["actions"]["create"]>>;
    try { result = await actions.create(selected.tableId, orderId, attempt(), null); }
    catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
    if (!result.ok) {
      setError(result.error);
      if (result.error === "conflict" || result.error === "unavailable") {
        const latest = await refresh(true);
        if (latest !== null) {
          const created = latest.board.tables.flatMap((table) => table.activeOrders).find((order) => order.orderId === orderId)
            ?? latest.board.unassignedOrders.find((order) => order.orderId === orderId);
          if (created !== undefined) {
            setError(null);
            setOrderFeedback((current) => ({ ...current, [orderId]: created.status === "draft"
              ? "La cuenta se creó en borrador. Al enviar el primer producto a cocina se abrirá automáticamente."
              : "Cuenta abierta." }));
            setActiveOrderId(orderId);
            setBusy(false); return;
          }
          if (result.error === "conflict" && latest.shift === null) setError("no_shift");
        }
      }
      setBusy(false);
      return;
    }
    await refresh(true);
    setActiveOrderId(result.orderId);
    setBusy(false);
    setOrderFeedback((current) => ({ ...current, [result.orderId]: "Cuenta abierta." }));
  }

  async function assign(order: TableBoardActiveOrderV1, waiterUserId: string | null) {
    if (busy || busyOrderId !== null) return;
    setPickOrder(null);
    setBusyOrderId(order.orderId); setError(null); setNotice(null);
    setOrderFeedback((current) => ({ ...current, [order.orderId]: "" }));
    let result: Awaited<ReturnType<Props["actions"]["assign"]>>;
    try { result = await actions.assign(order.orderId, order.version, attempt(), waiterUserId); }
    catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
    if (!result.ok) {
      if (result.error === "conflict" || result.error === "unavailable") {
        const latest = await refresh(true);
        const currentOrder = latest?.board.tables.flatMap((table) => table.activeOrders).find((entry) => entry.orderId === order.orderId);
        if (result.error === "unavailable" && currentOrder?.waiterUserId === waiterUserId) {
          setOrderFeedback((current) => ({ ...current, [order.orderId]: waiterUserId === null ? "Mesero quitado." : "Mesero actualizado." }));
          setBusyOrderId(null); return;
        }
      }
      setOrderFeedback((current) => ({ ...current, [order.orderId]: message(result.error) }));
      setBusyOrderId(null); return;
    }
    await refresh(true);
    setOrderFeedback((current) => ({ ...current, [order.orderId]: waiterUserId === null ? "Mesero quitado." : "Mesero actualizado." }));
    setBusyOrderId(null);
  }

  async function saveAccountLabel(order: TableBoardActiveOrderV1, nextLabel: string) {
    if (busy || busyOrderId !== null) return;
    const trimmed = nextLabel.trim();
    const normalized = trimmed.length === 0 ? null : trimmed;
    if (normalized === (order.accountLabel ?? null)) {
      setEditingAccountOrderId(null);
      return;
    }
    setBusyOrderId(order.orderId);
    setError(null);
    setNotice(null);
    setOrderFeedback((current) => ({ ...current, [order.orderId]: "" }));
    let result: Awaited<ReturnType<Props["actions"]["setAccountLabel"]>>;
    try {
      result = await actions.setAccountLabel(order.orderId, order.version, attempt(), normalized);
    } catch (error) {
      unstable_rethrow(error);
      result = { ok: false, error: "unavailable" };
    }
    if (!result.ok) {
      if (result.error === "conflict" || result.error === "unavailable") {
        const latest = await refresh(true);
        const currentOrder = latest?.board.tables
          .flatMap((table) => table.activeOrders)
          .find((entry) => entry.orderId === order.orderId);
        if (result.error === "unavailable" && (currentOrder?.accountLabel ?? null) === normalized) {
          setOrderFeedback((current) => ({
            ...current,
            [order.orderId]: normalized === null ? "Nombre de cuenta eliminado." : "Nombre de cuenta actualizado.",
          }));
          setBusyOrderId(null);
          setEditingAccountOrderId(null);
          return;
        }
      }
      setOrderFeedback((current) => ({ ...current, [order.orderId]: message(result.error) }));
      setBusyOrderId(null);
      return;
    }
    await refresh(true);
    setOrderFeedback((current) => ({
      ...current,
      [order.orderId]: normalized === null ? "Nombre de cuenta eliminado." : "Nombre de cuenta actualizado.",
    }));
    setBusyOrderId(null);
    setEditingAccountOrderId(null);
  }

  async function openShift() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    const shiftId = crypto.randomUUID();
    let result: Awaited<ReturnType<Props["actions"]["openShift"]>>;
    try { result = await actions.openShift(shiftId, attempt()); }
    catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
    if (!result.ok) {
      if (result.error === "conflict" || result.error === "unavailable") {
        const latest = await refresh(true);
        if (latest?.shift?.shiftId === shiftId) { setNotice("Turno abierto."); setBusy(false); return; }
      }
      setError(result.error); setBusy(false); return;
    }
    await refresh(true);
    setNotice("Turno abierto."); setBusy(false);
  }

  const zones = snapshot === null ? [] : groupBoardByZone(snapshot.layout, snapshot.board);
  const activeOrder = selected !== null && selected.orders.length > 0
    ? (selected.orders.find((order) => order.orderId === activeOrderId) ?? selected.orders[0]!)
    : null;

  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Mesas · {restaurantName}</p>
        <h1 className="font-heading text-2xl font-bold">{branchName}</h1>
        <p className="mt-1 text-sm text-text-muted">{snapshot?.shift ? `Turno abierto desde ${time(snapshot.shift.openedAt, snapshot.timeZone)}` : "Sin turno abierto"}</p></div>
      <div className="flex flex-wrap gap-2">
        {canManage && <Link href="/app/tables/edit" prefetch className={`${button} inline-flex items-center link-text`}>Editar plano</Link>}
        <button type="button" className={button} disabled={loading} onClick={() => void refresh()}>{loading ? "Actualizando…" : "Actualizar"}</button>
        {snapshot !== null && snapshot.shift === null && canOpenShift && <button type="button" className={primary} disabled={busy} onClick={() => void openShift()}>{busy ? "Guardando…" : "Abrir turno"}</button>}</div>
    </header>
    {error !== null && <div role="alert" className="rounded-lg bg-error-bg p-3 text-sm text-error">{message(error)} {error === "no_shift" && canOpenShift && <button className={button} onClick={() => void openShift()} disabled={busy}>Abrir turno</button>}</div>}
    {notice !== null && <p role="status" className="rounded-lg border border-success bg-surface p-3 text-sm">{notice}</p>}
    {snapshot === null ? <p className="text-sm text-text-muted">{loading ? "Cargando plano…" : "Plano no disponible. Pulsa Actualizar para reintentar."}</p>
      : zones.length === 0 ? <p className="text-sm text-text-muted">No hay zonas configuradas.</p>
      : zones.map((zone) => {
        const box = planViewBox(zone.tables.map((table) => table.layout));
        return <section key={zone.zoneId} className="min-w-0 rounded-xl border border-border bg-surface p-3 sm:p-4">
        <h2 className="mb-3 font-heading text-base font-semibold">{zone.name} · {zone.tables.length} mesas</h2>
        <div className="max-h-[75vh] max-w-full overflow-auto rounded-lg border border-border bg-bg p-2" role="group" aria-label={`Plano de ${zone.name}`}>
          <div className="relative" style={planCanvasStyle(box)}>
            {zone.tables.map((table) => {
              const openCount = tableOpenAccountsCount(table.state);
              return <button key={table.tableId} type="button" style={{ position: "absolute", ...planPlacement(table.layout, box) }}
                onClick={() => { if (table.state !== null) void select(table.tableId, table.name, table.state.activeOrders); }}
                disabled={table.state === null}
                className={`relative z-10 flex min-h-11 min-w-11 flex-col items-center justify-center overflow-hidden border-2 p-1 text-center text-xs font-semibold leading-tight focus-visible:outline-2 focus-visible:outline-accent ${table.state === null ? "border-border bg-bg text-text-muted" : table.state.status === "occupied" ? "border-accent bg-accent text-white" : "border-success bg-surface text-text"} ${tableShapeClass(table.shape)}`}
                aria-label={`${table.name}, ${table.capacity} personas, ${tableStatusLabel(table.state)}${openCount > 0 ? `, ${openCount} ${openCount === 1 ? "cuenta abierta" : "cuentas abiertas"}` : ""}`}>
                {openCount > 0 && <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-surface px-1 text-[10px] font-bold text-accent shadow-sm" aria-hidden="true">{openCount}</span>}
                <span className="line-clamp-2 w-full break-words">{table.name}</span><span className="text-[10px]">{table.capacity} pers.</span>
                {table.state?.status === "occupied" && <span className="truncate text-[10px]">{time(table.state.activeOrders[0]!.openedAt, snapshot.timeZone)} · {waiterLabel(waiters ?? [], table.state.activeOrders[0]!.waiterUserId, actorId)}</span>}
              </button>;
            })}
          </div>
        </div>
      </section>;
      })}
    {snapshot !== null && snapshot.board.unassignedOrders.length > 0 && <section className="rounded-xl border border-border bg-surface p-4"><h2 className="font-heading font-semibold">Mesas eliminadas</h2>
      <ul className="mt-3 grid gap-2">{snapshot.board.unassignedOrders.map((order) => <li key={order.orderId} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm"><span>Cuenta {order.orderId.slice(0, 8)} · {time(order.openedAt, snapshot.timeZone)} · {orderStatusLabel(order.status)} · Mesero: {waiterLabel(waiters ?? [], order.waiterUserId, actorId)}</span><Link className={`${button} inline-flex items-center link-text`} href={`/app/orders?orderId=${order.orderId}`}>Ver cuenta</Link></li>)}</ul></section>}
    {selected !== null && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={() => { if (!busy && busyOrderId === null) { selectedRef.current = null; setSelected(null); setActiveOrderId(null); } }}>
      <section role="dialog" aria-modal="true" aria-label={`${selected.name}: cuentas`} ref={dialogRef} tabIndex={-1} onKeyDown={dialogKeys} onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full flex-col rounded-2xl border border-border bg-surface shadow-xl sm:max-w-xl">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4 sm:px-5"><h2 className="font-heading text-xl font-bold">{selected.name}</h2><button type="button" className={button} disabled={busy || busyOrderId !== null} onClick={() => { selectedRef.current = null; setSelected(null); setActiveOrderId(null); }}>Cerrar</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-5">
        {error !== null && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm text-error">{message(error)} {error === "no_shift" && canOpenShift && <button className={button} disabled={busy} onClick={() => void openShift()}>Abrir turno</button>}</p>}
        {notice !== null && <p role="status" className="mt-3 rounded-lg border border-success p-3 text-sm">{notice}</p>}
        {selected.orders.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-border pb-3">
          <div role="tablist" aria-label="Cuentas" className="flex flex-wrap items-center gap-2">
            {selected.orders.map((order, index) => {
              const isActive = activeOrder?.orderId === order.orderId;
              const label = accountTabLabel(index, order, tabTotal(details[order.orderId]));
              return <button key={order.orderId} ref={(el) => { tabRefs.current[order.orderId] = el; }} type="button" role="tab" id={`tab-${order.orderId}`}
                aria-controls={`tabpanel-${order.orderId}`} aria-selected={isActive} tabIndex={isActive ? 0 : -1} className={uiOption(isActive)}
                onClick={() => { setActiveOrderId(order.orderId); setEditingAccountOrderId(null); setPickOrder(null); }}
                onKeyDown={(e) => onTabKeyDown(e, index)}>
                {label}
              </button>;
            })}
          </div>
          <button type="button" className={button} aria-label="Abrir otra cuenta" disabled={busy || busyOrderId !== null} onClick={() => void create()}>
            {busy ? "Abriendo…" : "+ Nueva"}
          </button>
        </div>}
        {activeOrder !== null && (() => {
          const waiterState = waiterCardState(activeOrder.orderId, busyOrderId);
          const isEditingAccount = editingAccountOrderId === activeOrder.orderId;
          const isBusyWithOrder = busyOrderId === activeOrder.orderId;
          return <div role="tabpanel" id={`tabpanel-${activeOrder.orderId}`} aria-labelledby={`tab-${activeOrder.orderId}`} tabIndex={0}
            className="mt-4 rounded-lg border border-border p-3 text-sm focus-visible:outline-2 focus-visible:outline-accent">
            <p className="font-semibold">{orderStatusLabel(activeOrder.status)} · {time(activeOrder.openedAt, snapshot?.timeZone)} · {totalLabel(details[activeOrder.orderId])}</p>
            {activeOrder.accountLabel !== null && activeOrder.accountLabel !== "" && (
              <p className="mt-1 font-medium text-accent">Cuenta: {activeOrder.accountLabel}</p>
            )}
            <p className="mt-1">Mesero: {waiterLabel(waiters ?? [], activeOrder.waiterUserId, actorId)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link className={`${primary} inline-flex items-center link-white`} href={`/app/orders?orderId=${activeOrder.orderId}`}>Ver cuenta</Link>
              <button type="button" className={button} disabled={busy || busyOrderId !== null} aria-expanded={pickOrder === activeOrder.orderId}
                onClick={() => { setEditingAccountOrderId(null); setPickOrder(pickOrder === activeOrder.orderId ? null : activeOrder.orderId); }}>{waiterState.label}</button>
              <button type="button" className={button} disabled={busy || busyOrderId !== null} aria-expanded={isEditingAccount}
                onClick={() => {
                  if (isEditingAccount) {
                    setEditingAccountOrderId(null);
                  } else {
                    setPickOrder(null);
                    setEditingAccountOrderId(activeOrder.orderId);
                    setEditingAccountText(activeOrder.accountLabel ?? "");
                  }
                }}>
                Nombre
              </button>
            </div>
            {isEditingAccount && (
              <div className="mt-3 rounded-lg border border-border bg-bg p-3" role="group" aria-label="Editar nombre de cuenta">
                <label htmlFor={`account-label-${activeOrder.orderId}`} className="block text-xs font-semibold text-text-muted">
                  Nombre de la cuenta (máx. 60 caracteres, vacío para eliminar)
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input
                    id={`account-label-${activeOrder.orderId}`}
                    type="text"
                    maxLength={60}
                    disabled={isBusyWithOrder}
                    value={editingAccountText}
                    onChange={(e) => setEditingAccountText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveAccountLabel(activeOrder, editingAccountText);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditingAccountOrderId(null);
                      }
                    }}
                    placeholder="Ej. Juan, Familia Pérez"
                    className="min-h-11 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-70"
                    autoFocus
                  />
                  <button
                    type="button"
                    className={primary}
                    disabled={isBusyWithOrder}
                    onClick={() => void saveAccountLabel(activeOrder, editingAccountText)}>
                    {isBusyWithOrder ? "Guardando…" : "Guardar"}
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={isBusyWithOrder}
                    onClick={() => setEditingAccountOrderId(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {pickOrder === activeOrder.orderId && <WaiterPicker members={waiters} actorId={actorId} current={activeOrder.waiterUserId}
              disabled={waiterState.busy} allowNone onPick={(id) => void assign(activeOrder, id)} />}
            {orderFeedback[activeOrder.orderId] && <p role="status" aria-live="polite" className="mt-2 text-xs text-text-muted">{orderFeedback[activeOrder.orderId]}</p>}
          </div>;
        })()}
        {selected.orders.length === 0 && <p className="mt-3 text-sm text-text-muted">Mesa libre.</p>}
        </div>
        {selected.orders.length === 0 && <div className="shrink-0 border-t border-border bg-surface p-4 sm:px-5">
          <button type="button" className={`${primary} w-full`} disabled={busy || busyOrderId !== null} onClick={() => void create()}>{busy ? "Abriendo…" : "Abrir cuenta"}</button></div>}
      </section>
    </div>, document.body)}
  </div>;
}
