"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BranchScope, DiningLayoutV1, OperationalShiftSummaryV1, OrderDetailV1, TableBoardActiveOrderV1, TableBoardV1 } from "@super-restaurant/shared-types";
import { captureDeviceId } from "../../../lib/capture-workspace";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { gridPlacement, groupBoardByZone, tableStatusLabel, waiterInitials } from "../../../lib/tables-board";

type ErrorCode = "invalid" | "denied" | "conflict" | "no_shift" | "unavailable";
type Failure = { readonly ok: false; readonly error: ErrorCode };
type Attempt = { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string; readonly deviceId: string };
type Snapshot = { readonly ok: true; readonly board: TableBoardV1; readonly layout: DiningLayoutV1; readonly shift: OperationalShiftSummaryV1 | null; readonly timeZone: string };
type Selected = { readonly tableId: string; readonly name: string; readonly orders: readonly TableBoardActiveOrderV1[] };
const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const primary = `${button} border-accent bg-accent text-white`;

interface Props {
  readonly scope: BranchScope;
  readonly branchName: string;
  readonly restaurantName: string;
  readonly actorId: string;
  readonly actorName: string | null;
  readonly canManage: boolean;
  readonly canOpenShift: boolean;
  readonly actions: {
    readonly read: () => Promise<Snapshot | Failure>;
    readonly create: (tableId: string, orderId: string, attempt: Attempt, assignSelf: boolean) => Promise<{ readonly ok: true; readonly orderId: string; readonly waiterAssigned: boolean } | Failure>;
    readonly assign: (orderId: string, expectedVersion: number, attempt: Attempt) => Promise<{ readonly ok: true } | Failure>;
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
function message(error: ErrorCode) {
  return error === "no_shift" ? "No hay turno abierto." : error === "conflict" ? "Los datos cambiaron. Se actualizó el tablero."
    : error === "denied" ? "Tu rol o sesión ya no permite esta acción." : error === "invalid" ? "No se pudo enviar la acción." : "No se pudo confirmar el resultado. Actualiza antes de intentar otra acción.";
}

export function TablesBoard({ scope, branchName, restaurantName, actorId, actorName, canManage, canOpenShift, actions }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [details, setDetails] = useState<Record<string, OrderDetailV1 | null>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assignSelf, setAssignSelf] = useState(false);
  const seq = useRef(0);
  const selectedRef = useRef<Selected | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  function loadDetails(orders: readonly TableBoardActiveOrderV1[]) {
    setDetails({});
    for (const order of orders) {
      void actions.detail(order.orderId).then((result) => {
        setDetails((current) => ({ ...current, [order.orderId]: result.ok ? result.value : null }));
      }).catch(() => setDetails((current) => ({ ...current, [order.orderId]: null })));
    }
  }

  async function refresh() {
    const current = ++seq.current;
    setLoading(true);
    let result: Snapshot | Failure;
    try { result = await actions.read(); } catch { result = { ok: false, error: "unavailable" }; }
    if (current !== seq.current) return;
    setLoading(false);
    if (!result.ok) { setSnapshot(null); setError(result.error); setSelected(null); return; }
    setSnapshot(result);
    const active = selectedRef.current === null ? undefined : result.board.tables.find((entry) => entry.tableId === selectedRef.current?.tableId);
    if (active !== undefined) loadDetails(active.activeOrders);
    setSelected((previous) => {
      if (previous === null) return null;
      const table = result.board.tables.find((entry) => entry.tableId === previous.tableId);
      if (table === undefined) { selectedRef.current = null; return null; }
      selectedRef.current = { ...previous, orders: table.activeOrders };
      return selectedRef.current;
    });
  }

  useEffect(() => { void refresh(); }, [scope.branchId, scope.restaurantId]);
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus); document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, [scope.branchId, scope.restaurantId]);

  async function select(tableId: string, name: string, orders: readonly TableBoardActiveOrderV1[]) {
    selectedRef.current = { tableId, name, orders };
    setSelected(selectedRef.current); setError(null); setNotice(null); setAssignSelf(false);
    loadDetails(orders);
  }

  useEffect(() => {
    if (selected === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [selected?.tableId]);

  function dialogKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { selectedRef.current = null; setSelected(null); return; }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])'));
    if (controls.length === 0) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function create() {
    if (selected === null || busy) return;
    setBusy(true); setError(null); setNotice(null);
    const orderId = crypto.randomUUID();
    let result: Awaited<ReturnType<Props["actions"]["create"]>>;
    try { result = await actions.create(selected.tableId, orderId, attempt(), assignSelf); }
    catch { result = { ok: false, error: "unavailable" }; }
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      if (result.error === "conflict" || result.error === "unavailable") {
        const latest = await actions.read().catch(() => ({ ok: false, error: "unavailable" } as Failure));
        if (latest.ok) {
          setSnapshot(latest); setSelected(null);
          const created = latest.board.tables.some((table) => table.activeOrders.some((order) => order.orderId === orderId))
            || latest.board.unassignedOrders.some((order) => order.orderId === orderId);
          if (created) { setNotice("Cuenta abierta."); router.push(`/app/orders?orderId=${orderId}`); return; }
          if (result.error === "conflict" && latest.shift === null) setError("no_shift");
        }
      }
      return;
    }
    if (assignSelf && !result.waiterAssigned) setNotice("Cuenta abierta, pero no se pudo asignar el mesero.");
    else setNotice("Cuenta abierta.");
    await refresh();
    router.push(`/app/orders?orderId=${result.orderId}`);
  }

  async function assign(order: TableBoardActiveOrderV1) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    let result: Awaited<ReturnType<Props["actions"]["assign"]>>;
    try { result = await actions.assign(order.orderId, order.version, attempt()); }
    catch { result = { ok: false, error: "unavailable" }; }
    setBusy(false);
    if (!result.ok) { setError(result.error); if (result.error === "conflict" || result.error === "unavailable") void refresh(); return; }
    setNotice("Mesero asignado."); void refresh();
  }

  async function openShift() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    let result: Awaited<ReturnType<Props["actions"]["openShift"]>>;
    try { result = await actions.openShift(crypto.randomUUID(), attempt()); }
    catch { result = { ok: false, error: "unavailable" }; }
    setBusy(false);
    if (!result.ok) { setError(result.error); if (result.error === "conflict" || result.error === "unavailable") void refresh(); return; }
    setNotice("Turno abierto."); void refresh();
  }

  const zones = snapshot === null ? [] : groupBoardByZone(snapshot.layout, snapshot.board);
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Mesas · {restaurantName}</p>
        <h1 className="font-heading text-2xl font-bold">{branchName}</h1>
        <p className="mt-1 text-sm text-text-muted">{snapshot?.shift ? `Turno abierto desde ${time(snapshot.shift.openedAt, snapshot.timeZone)}` : "Sin turno abierto"}</p></div>
      <div className="flex flex-wrap gap-2"><a href="/app?change=1" className={button}>Cambiar sucursal</a>
        {canManage && <a href="/app/tables/edit" className={button}>Editar plano</a>}
        <button type="button" className={button} disabled={loading} onClick={() => void refresh()}>{loading ? "Actualizando…" : "Actualizar"}</button>
        {snapshot !== null && snapshot.shift === null && canOpenShift && <button type="button" className={primary} disabled={busy} onClick={() => void openShift()}>{busy ? "Guardando…" : "Abrir turno"}</button>}</div>
    </header>
    {error !== null && <div role="alert" className="rounded-lg bg-error-bg p-3 text-sm text-error">{message(error)} {error === "no_shift" && canOpenShift && <button className={button} onClick={() => void openShift()} disabled={busy}>Abrir turno</button>}</div>}
    {notice !== null && <p role="status" className="rounded-lg border border-success bg-surface p-3 text-sm">{notice}</p>}
    {snapshot === null ? <p className="text-sm text-text-muted">{loading ? "Cargando plano…" : "Plano no disponible. Pulsa Actualizar para reintentar."}</p>
      : zones.length === 0 ? <p className="text-sm text-text-muted">No hay zonas configuradas.</p>
      : zones.map((zone) => <section key={zone.zoneId} className="min-w-0 rounded-xl border border-border bg-surface p-3 sm:p-4">
        <h2 className="mb-3 font-heading text-base font-semibold">{zone.name} · {zone.tables.length} mesas</h2>
        <div className="max-h-[min(65vh,520px)] max-w-full overflow-auto rounded-lg border border-border" aria-label={`Plano de ${zone.name}`}>
          <div className="grid h-[2308px] w-[584px] grid-cols-[repeat(24,23px)] grid-rows-[repeat(100,22px)] gap-px bg-bg p-1">
            {zone.tables.map((table) => <button key={table.tableId} type="button" style={gridPlacement(table.layout)}
              onClick={() => { if (table.state !== null) void select(table.tableId, table.name, table.state.activeOrders); }}
              disabled={table.state === null}
              className={`z-10 flex min-h-11 min-w-11 flex-col items-center justify-center overflow-hidden border-2 px-1 text-center text-xs font-semibold focus-visible:outline-2 focus-visible:outline-accent ${table.state?.status === "occupied" ? "border-accent bg-accent text-white" : "border-success bg-surface text-text"} ${table.shape === "round" ? "rounded-full" : "rounded-lg"}`}
              aria-label={`${table.name}, ${table.capacity} personas, ${tableStatusLabel(table.state)}`}>
              <span className="w-full truncate">{table.name}</span><span className="text-[10px]">{table.capacity} pers.</span>
              {table.state?.status === "occupied" && <span className="truncate text-[10px]">{time(table.state.activeOrders[0]!.openedAt, snapshot.timeZone)} · {table.state.activeOrders[0]!.waiterUserId === actorId ? waiterInitials(actorName) : table.state.activeOrders[0]!.waiterUserId === null ? "Sin mesero" : "Mesero asignado"}</span>}
            </button>)}
          </div>
        </div>
      </section>)}
    {snapshot !== null && snapshot.board.unassignedOrders.length > 0 && <section className="rounded-xl border border-border bg-surface p-4"><h2 className="font-heading font-semibold">Mesas eliminadas</h2>
      <ul className="mt-3 grid gap-2">{snapshot.board.unassignedOrders.map((order) => <li key={order.orderId} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm">Cuenta {order.orderId.slice(0, 8)} · {time(order.openedAt, snapshot.timeZone)} · {order.status}<a className={button} href={`/app/orders?orderId=${order.orderId}`}>Ver cuenta</a></li>)}</ul></section>}
    {selected !== null && <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => { selectedRef.current = null; setSelected(null); }}>
      <section role="dialog" aria-modal="true" aria-label={`${selected.name}: cuentas`} ref={dialogRef} tabIndex={-1} onKeyDown={dialogKeys} onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:mx-auto sm:max-w-xl">
        <div className="flex items-center justify-between gap-2"><h2 className="font-heading text-xl font-bold">{selected.name}</h2><button type="button" className={button} onClick={() => { selectedRef.current = null; setSelected(null); }}>Cerrar</button></div>
        {error !== null && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm text-error">{message(error)} {error === "no_shift" && canOpenShift && <button className={button} disabled={busy} onClick={() => void openShift()}>Abrir turno</button>}</p>}
        {notice !== null && <p role="status" className="mt-3 rounded-lg border border-success p-3 text-sm">{notice}</p>}
        {selected.orders.length > 0 && <ul className="mt-4 grid gap-3">{selected.orders.map((order) => <li key={order.orderId} className="rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold">{order.status} · {time(order.openedAt, snapshot?.timeZone)}</p><p>Mesero: {order.waiterUserId === actorId ? waiterInitials(actorName) : order.waiterUserId === null ? "Sin mesero" : "Asignado"}</p>
          <p>{totalLabel(details[order.orderId])}</p>
          <div className="mt-2 flex flex-wrap gap-2"><a className={primary} href={`/app/orders?orderId=${order.orderId}`}>Ver cuenta</a>
            <button type="button" className={button} disabled={busy || order.waiterUserId === actorId} onClick={() => void assign(order)}>{busy ? "Guardando…" : "Asignarme"}</button></div>
        </li>)}</ul>}
        {selected.orders.length === 0 && <p className="mt-3 text-sm text-text-muted">Mesa libre.</p>}
        <div className="mt-4 border-t border-border pt-4"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={assignSelf} onChange={(event) => setAssignSelf(event.target.checked)} />Asignarme como mesero</label>
          <button type="button" className={`${primary} mt-2 w-full`} disabled={busy} onClick={() => void create()}>{busy ? "Guardando…" : selected.orders.length ? "Abrir otra cuenta" : "Abrir cuenta"}</button></div>
      </section>
    </div>}
  </div>;
}
