"use client";

import type { DiningLayoutV1, DiningTableV1 } from "@super-restaurant/shared-types";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { mergeByVersion, validateTableDetails } from "../../lib/dining-editor";
import { clampTablePosition, firstFreeSlot, moveTableByKeyboard, resizeTableCells, savedTablePosition, type TablePosition } from "../../lib/table-position";
import { createDiningTableAction, saveDiningTableLayoutAction, updateDiningTableDetailsAction, type DiningActionResult } from "./actions";

type Zone = DiningLayoutV1["zones"][number];
interface Geometry { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface Attempt { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string }
type StatusKind = "saving" | "saved" | "conflict" | "error";
interface Status { readonly kind: StatusKind; readonly text: string }

const SAVE_DEBOUNCE_MS = 600;
const SAVED_VISIBLE_MS = 3000;
const CONFLICT_TEXT = "La mesa cambió en otro dispositivo; se recargó.";
const button = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const primary = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-accent bg-accent px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const input = "mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-accent";

function newAttempt(): Attempt {
  return { eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), occurredAt: new Date().toISOString() };
}

function sameGeometry(a: Geometry, b: Geometry): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function without<T>(record: Readonly<Record<string, T>>, id: string): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
}

function cellStep(canvas: HTMLDivElement): { x: number; y: number } {
  const style = getComputedStyle(canvas);
  return { x: Number.parseFloat(style.gridTemplateColumns) + Number.parseFloat(style.columnGap), y: Number.parseFloat(style.gridTemplateRows) + Number.parseFloat(style.rowGap) };
}

function failureText(error: Exclude<DiningActionResult, { ok: true }>["error"]): string {
  return error === "conflict" ? CONFLICT_TEXT
    : error === "denied" ? "Tu rol o sesión ya no permite editar el plano."
    : error === "invalid" ? "Los datos no son válidos; se restauró la mesa."
    : "No se pudo guardar. Se restauró la mesa.";
}

export function DiningZone({ zone, canManage }: { readonly zone: Zone; readonly canManage: boolean }): ReactNode {
  const router = useRouter();
  const canvas = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tables, setTables] = useState<Readonly<Record<string, DiningTableV1>>>(() => mergeByVersion({}, zone.tables));
  const [createdIds, setCreatedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [previews, setPreviews] = useState<Readonly<Record<string, Geometry>>>({});
  const [statuses, setStatuses] = useState<Readonly<Record<string, Status>>>({});

  const tablesRef = useRef(tables);
  const previewRef = useRef<Readonly<Record<string, Geometry>>>({});
  const pending = useRef(new Map<string, Geometry>());
  const inFlight = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const attempts = useRef(new Map<string, Attempt>());

  // A refreshed server snapshot replaces a local table only when its version is newer.
  const merged = mergeByVersion(tables, zone.tables, createdIds);
  if (merged !== tables) setTables(merged);
  const list = Object.values(merged);
  useEffect(() => { tablesRef.current = merged; });
  useEffect(() => {
    if (createdIds.size === 0 || !zone.tables.some((table) => createdIds.has(table.tableId))) return;
    setCreatedIds((current) => new Set([...current].filter((id) => !zone.tables.some((table) => table.tableId === id))));
  }, [zone.tables, createdIds]);

  function shown(table: DiningTableV1): Geometry { return previews[table.tableId] ?? table.layout; }
  function setPreview(id: string, geometry: Geometry | null): void {
    const next = { ...previewRef.current };
    if (geometry === null) delete next[id]; else next[id] = geometry;
    previewRef.current = next;
    setPreviews(next);
  }
  function setStatus(id: string, status: Status | null): void {
    setStatuses((current) => status === null ? without(current, id) : { ...current, [id]: status });
    if (status?.kind === "saved") {
      setTimeout(() => setStatuses((current) => current[id]?.kind === "saved" ? without(current, id) : current), SAVED_VISIBLE_MS);
    }
  }
  function applyServerTable(table: DiningTableV1): void {
    tablesRef.current = { ...tablesRef.current, [table.tableId]: table };
    setTables(tablesRef.current);
  }

  async function flush(id: string): Promise<void> {
    inFlight.current.add(id);
    try {
      for (;;) {
        const geometry = pending.current.get(id);
        if (geometry === undefined) return;
        pending.current.delete(id);
        const table = tablesRef.current[id];
        if (table === undefined) return;
        if (sameGeometry(table.layout, geometry)) { if (previewRef.current[id] !== undefined && sameGeometry(previewRef.current[id], geometry)) setPreview(id, null); continue; }
        setStatus(id, { kind: "saving", text: "Guardando…" });
        // One attempt per (table, version, geometry): a retry after a network error reuses it.
        const key = `${id}:${table.version}:${geometry.x}:${geometry.y}:${geometry.width}:${geometry.height}`;
        const attempt = attempts.current.get(key) ?? newAttempt();
        attempts.current.set(key, attempt);
        let result: DiningActionResult;
        try { result = await saveDiningTableLayoutAction({ tableId: id, expectedVersion: table.version, layout: geometry, attempt }); }
        catch { result = { ok: false, error: "unavailable" }; }
        if (result.ok) {
          attempts.current.delete(key);
          applyServerTable(result.table);
          const preview = previewRef.current[id];
          if (preview !== undefined && sameGeometry(preview, geometry)) setPreview(id, null);
          setStatus(id, pending.current.has(id) ? { kind: "saving", text: "Guardando…" } : { kind: "saved", text: "Guardado" });
          continue;
        }
        if (result.error === "conflict" || result.error === "invalid") attempts.current.delete(key);
        pending.current.delete(id);
        const timer = timers.current.get(id);
        if (timer !== undefined) { clearTimeout(timer); timers.current.delete(id); }
        setPreview(id, null);
        setStatus(id, { kind: result.error === "conflict" ? "conflict" : "error", text: failureText(result.error) });
        if (result.error === "conflict" || result.error === "unavailable") router.refresh();
        return;
      }
    } finally { inFlight.current.delete(id); }
  }

  function enqueue(id: string, geometry: Geometry): void {
    pending.current.set(id, geometry);
    if (!inFlight.current.has(id)) void flush(id);
  }

  /** Snaps the live preview to whole cells and saves it: at once after a drag, debounced after keys/buttons. */
  function commit(id: string, delay: number): void {
    const preview = previewRef.current[id];
    if (preview === undefined) return;
    const geometry: Geometry = { ...savedTablePosition({ x: preview.x, y: preview.y }, preview.width, preview.height), width: preview.width, height: preview.height };
    setPreview(id, geometry);
    const existing = timers.current.get(id);
    if (existing !== undefined) { clearTimeout(existing); timers.current.delete(id); }
    if (delay === 0) { enqueue(id, geometry); return; }
    timers.current.set(id, setTimeout(() => { timers.current.delete(id); enqueue(id, geometry); }, delay));
  }

  // Leaving the editor must not lose a change still waiting for its debounce.
  useEffect(() => {
    const waiting = timers.current;
    return () => {
      for (const [id, timer] of waiting) {
        clearTimeout(timer);
        const preview = previewRef.current[id];
        if (preview !== undefined) enqueue(id, { ...savedTablePosition({ x: preview.x, y: preview.y }, preview.width, preview.height), width: preview.width, height: preview.height });
      }
      waiting.clear();
    };
  }, []);

  function move(table: DiningTableV1, position: TablePosition): void {
    const current = shown(table);
    setPreview(table.tableId, { ...current, ...clampTablePosition(position, current.width, current.height) });
  }
  function resizeTo(table: DiningTableV1, size: { width: number; height: number }): void {
    const current = shown(table);
    setPreview(table.tableId, { ...current, ...size });
  }
  function nudgeSize(table: DiningTableV1, deltaCols: number, deltaRows: number): void {
    const current = shown(table);
    const base = { ...savedTablePosition({ x: current.x, y: current.y }, current.width, current.height), width: current.width, height: current.height };
    setPreview(table.tableId, { ...base, ...resizeTableCells(base, deltaCols, deltaRows) });
    commit(table.tableId, SAVE_DEBOUNCE_MS);
  }
  function tableCreated(table: DiningTableV1): void {
    applyServerTable(table);
    setCreatedIds((current) => new Set(current).add(table.tableId));
    setSelectedId(table.tableId);
    setStatus(table.tableId, { kind: "saved", text: "Mesa creada" });
    router.refresh();
  }
  function detailsResult(id: string, status: Status, table?: DiningTableV1): void {
    if (table !== undefined) applyServerTable(table);
    setStatus(id, status);
    if (status.kind === "conflict") router.refresh();
  }

  const selected = selectedId === null ? undefined : merged[selectedId];
  const selectedGeometry = selected === undefined ? undefined : shown(selected);
  const selectedStatus = selected === undefined ? undefined : statuses[selected.tableId];
  const limits = selected === undefined || selectedGeometry === undefined ? undefined : (() => {
    const base = { ...savedTablePosition({ x: selectedGeometry.x, y: selectedGeometry.y }, selectedGeometry.width, selectedGeometry.height), width: selectedGeometry.width, height: selectedGeometry.height };
    return {
      wider: resizeTableCells(base, 1, 0).width !== base.width, narrower: resizeTableCells(base, -1, 0).width !== base.width,
      taller: resizeTableCells(base, 0, 1).height !== base.height, shorter: resizeTableCells(base, 0, -1).height !== base.height,
    };
  })();

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.05)]">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="break-words font-heading text-[16px] font-semibold">{zone.name}</h2><p className="text-[12px] text-text-muted">{list.length} mesa{list.length === 1 ? "" : "s"}</p></div>
        {canManage && <CreateTableDialog zoneId={zone.zoneId} tableCount={list.length} occupied={() => Object.values(tablesRef.current).map((table) => table.layout)} onCreated={tableCreated} />}
      </div>
      <div className="h-[360px] overflow-auto rounded-xl border border-border" aria-label={`Plano de ${zone.name}`}>
        <div ref={canvas} className="grid h-[2100px] min-w-[520px] grid-cols-[repeat(24,minmax(20px,1fr))] grid-rows-[repeat(100,20px)] gap-px bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:calc(100%/24)_21px] p-2">
          {list.map((table) => <TableCard key={table.tableId} table={table} geometry={shown(table)} status={statuses[table.tableId]} selected={selectedId === table.tableId} canManage={canManage} canvas={canvas}
            onSelect={() => setSelectedId(table.tableId)} onMove={(position) => move(table, position)} onResize={(size) => resizeTo(table, size)}
            onCommit={(delay) => commit(table.tableId, delay)} />)}
        </div>
      </div>
      {canManage && <p className="mt-2 text-xs text-text-muted">Selecciona una mesa. Arrástrala para moverla (o usa las flechas; Mayús + flecha: cuatro celdas) y arrastra su esquina inferior derecha para cambiar el tamaño. Los cambios se guardan solos.</p>}
      <div className="mt-3 rounded-xl border border-border bg-bg p-3" aria-label="Mesa seleccionada">
        {selected === undefined || selectedGeometry === undefined || limits === undefined ? (
          <p className="text-sm text-text-muted">Selecciona una mesa del plano para ver sus detalles.</p>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-text">{selected.name} · {selected.capacity} {selected.capacity === 1 ? "persona" : "personas"}</h3>
            <p role="status" aria-live="polite" className={`mt-1 min-h-5 text-sm ${selectedStatus?.kind === "conflict" || selectedStatus?.kind === "error" ? "font-semibold text-error" : "text-text-muted"}`}>{selectedStatus?.text ?? ""}</p>
            {canManage && <>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Tamaño de la mesa">
                <button type="button" className={button} disabled={!limits.wider} onClick={() => nudgeSize(selected, 1, 0)}>Más ancha</button>
                <button type="button" className={button} disabled={!limits.narrower} onClick={() => nudgeSize(selected, -1, 0)}>Más angosta</button>
                <button type="button" className={button} disabled={!limits.taller} onClick={() => nudgeSize(selected, 0, 1)}>Más alta</button>
                <button type="button" className={button} disabled={!limits.shorter} onClick={() => nudgeSize(selected, 0, -1)}>Más baja</button>
              </div>
              <TableDetailsForm key={`${selected.tableId}:${selected.name}:${selected.capacity}:${selected.shape}`} table={selected} busy={selectedStatus?.kind === "saving"} onResult={(status, table) => detailsResult(selected.tableId, status, table)} />
            </>}
          </>
        )}
      </div>
    </section>
  );
}

function TableCard({ table, geometry, status, selected, canManage, canvas, onSelect, onMove, onResize, onCommit }: {
  readonly table: DiningTableV1; readonly geometry: Geometry; readonly status: Status | undefined; readonly selected: boolean; readonly canManage: boolean;
  readonly canvas: RefObject<HTMLDivElement | null>; readonly onSelect: () => void; readonly onMove: (position: TablePosition) => void;
  readonly onResize: (size: { width: number; height: number }) => void; readonly onCommit: (delayMs: number) => void;
}): ReactNode {
  const [step, setStep] = useState({ x: 21, y: 21 });
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; start: TablePosition; step: { x: number; y: number }; moved: boolean } | null>(null);
  const resize = useRef<{ pointerId: number; clientX: number; clientY: number; start: Geometry; step: { x: number; y: number } } | null>(null);
  const { width, height } = geometry;
  const position = { x: geometry.x, y: geometry.y };

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return;
    onSelect();
    if (!canManage || canvas.current === null) return;
    event.preventDefault();
    const measured = cellStep(canvas.current);
    setStep(measured);
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: position, step: measured, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.clientX;
    const dy = event.clientY - current.clientY;
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    current.moved = true;
    onMove({ x: current.start.x + dx / current.step.x, y: current.start.y + dy / current.step.y });
  }
  function endDrag(event: PointerEvent<HTMLElement>, save: boolean): void {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (save && current.moved) onCommit(0);
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); return; }
    if (!canManage || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    onSelect();
    onMove(moveTableByKeyboard(position, event.key, event.shiftKey, width, height));
    onCommit(SAVE_DEBOUNCE_MS);
  }

  function onHandleDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0 || canvas.current === null) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const base = { ...savedTablePosition(position, width, height), width, height };
    resize.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: base, step: cellStep(canvas.current) };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onHandleMove(event: PointerEvent<HTMLElement>): void {
    const current = resize.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    onResize(resizeTableCells(current.start, (event.clientX - current.clientX) / current.step.x, (event.clientY - current.clientY) / current.step.y));
  }
  function endResize(event: PointerEvent<HTMLElement>, save: boolean): void {
    const current = resize.current;
    if (current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (save) onCommit(0);
  }
  function stop(event: MouseEvent<HTMLElement>): void { event.stopPropagation(); }

  return (
    <article role="button" tabIndex={0} aria-pressed={selected} aria-label={`Mesa ${table.name}, ${table.capacity} personas. Enter para seleccionar.${canManage ? " Flechas para mover." : ""}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => endDrag(event, true)} onPointerCancel={(event) => endDrag(event, false)} onKeyDown={onKeyDown}
      style={{ gridColumn: `${Math.floor(position.x) + 1} / span ${width}`, gridRow: `${Math.floor(position.y) + 1} / span ${height}`, transform: `translate(${(position.x % 1) * step.x}px, ${(position.y % 1) * step.y}px)` }}
      className={`relative z-10 flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden border-2 bg-[oklch(95%_0.025_230)] p-0.5 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? "border-accent-hover" : "border-accent"} ${canManage ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer"} ${table.shape === "round" ? "rounded-full" : "rounded-lg"}`}>
      <strong className="w-full truncate text-[11px] leading-tight">{table.name}</strong>
      <span className="text-[10px] leading-tight text-text-muted">{table.capacity} pers.</span>
      {status !== undefined && <span className={`w-full truncate text-[9px] leading-tight ${status.kind === "conflict" || status.kind === "error" ? "font-semibold text-error" : "text-text-muted"}`}>{status.kind === "conflict" || status.kind === "error" ? "Sin guardar" : status.text}</span>}
      {canManage && selected && <span aria-hidden="true" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={(event) => endResize(event, true)} onPointerCancel={(event) => endResize(event, false)} onClick={stop}
        className="absolute bottom-0 right-0 h-7 w-7 cursor-nwse-resize touch-none after:absolute after:bottom-1 after:right-1 after:h-3 after:w-3 after:border-b-[3px] after:border-r-[3px] after:border-accent-hover" />}
    </article>
  );
}

function TableDetailsForm({ table, busy, onResult }: {
  readonly table: DiningTableV1; readonly busy: boolean; readonly onResult: (status: Status, table?: DiningTableV1) => void;
}): ReactNode {
  const [name, setName] = useState(table.name);
  const [capacity, setCapacity] = useState(String(table.capacity));
  const [shape, setShape] = useState<string>(table.shape);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ key: string; value: Attempt } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || busy) return;
    const check = validateTableDetails({ name, capacity, shape });
    if (!check.ok) { setProblem(check.message); return; }
    setProblem(null);
    // Same table version + same values = same attempt, so a retry after a network error replays.
    const key = `${table.tableId}:${table.version}:${check.name}|${check.capacity}|${check.shape}`;
    if (attempt.current?.key !== key) attempt.current = { key, value: newAttempt() };
    setSaving(true);
    let result: DiningActionResult;
    try {
      result = await updateDiningTableDetailsAction({ tableId: table.tableId, expectedVersion: table.version, name: check.name, capacity: check.capacity, shape: check.shape, attempt: attempt.current.value });
    } catch { result = { ok: false, error: "unavailable" }; }
    setSaving(false);
    if (result.ok) { attempt.current = null; onResult({ kind: "saved", text: "Datos guardados" }, result.table); return; }
    if (result.error === "conflict" || result.error === "invalid") attempt.current = null;
    if (result.error === "conflict") onResult({ kind: "conflict", text: CONFLICT_TEXT });
    else if (result.error === "denied") onResult({ kind: "error", text: "Tu rol o sesión ya no permite editar mesas." });
    else setProblem("No se pudo guardar. Inténtalo de nuevo.");
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-3 grid max-w-[420px] grid-cols-2 gap-2" aria-label="Datos de la mesa">
      <label className="col-span-2 text-[12px] font-medium">Nombre<input name="name" type="text" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className={input} /></label>
      <label className="text-[12px] font-medium">Capacidad (personas)<input name="capacity" type="text" inputMode="numeric" required value={capacity} onChange={(event) => setCapacity(event.target.value)} className={input} /></label>
      <label className="text-[12px] font-medium">Forma<select name="shape" value={shape} onChange={(event) => setShape(event.target.value)} className={input}>
        <option value="round">Redonda</option><option value="square">Cuadrada</option><option value="rectangle">Rectangular</option></select></label>
      {problem !== null && <p role="alert" className="col-span-2 rounded-lg bg-error-bg p-2 text-sm text-error">{problem}</p>}
      <button type="submit" className={`${primary} col-span-2`} disabled={saving || busy}>{saving ? "Guardando…" : "Guardar datos"}</button>
    </form>
  );
}

function CreateTableDialog({ zoneId, tableCount, occupied, onCreated }: {
  readonly zoneId: string; readonly tableCount: number; readonly occupied: () => readonly Geometry[]; readonly onCreated: (table: DiningTableV1) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [shape, setShape] = useState("round");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ key: string; tableId: string; value: Attempt } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  function show(): void {
    setName(`Mesa ${tableCount + 1}`); setCapacity("4"); setShape("round"); setProblem(null); attempt.current = null; setOpen(true);
  }
  function close(): void {
    if (saving) return;
    setOpen(false);
    opener.current?.focus();
  }
  useEffect(() => { if (open) nameField.current?.focus(); }, [open]);

  function keys(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") { event.stopPropagation(); close(); return; }
    if (event.key !== "Tab" || dialog.current === null) return;
    const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])"));
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const check = validateTableDetails({ name, capacity, shape });
    if (!check.ok) { setProblem(check.message); return; }
    const slot = firstFreeSlot(occupied());
    if (slot === undefined) { setProblem("No hay espacio libre en el plano para una mesa de 4×4."); return; }
    setProblem(null);
    // One attempt per form content: retrying the same form after a network error replays the same table.
    const key = `${zoneId}|${check.name}|${check.capacity}|${check.shape}|${slot.x},${slot.y}`;
    if (attempt.current?.key !== key) attempt.current = { key, tableId: crypto.randomUUID(), value: newAttempt() };
    setSaving(true);
    let result: DiningActionResult;
    try {
      result = await createDiningTableAction({ tableId: attempt.current.tableId, zoneId, name: check.name, capacity: check.capacity, shape: check.shape, layout: { x: slot.x, y: slot.y, width: 4, height: 4 }, attempt: attempt.current.value });
    } catch { result = { ok: false, error: "unavailable" }; }
    setSaving(false);
    if (result.ok) { attempt.current = null; setOpen(false); onCreated(result.table); return; }
    if (result.error !== "unavailable") attempt.current = null;
    setProblem(result.error === "conflict" ? "Ya existe una mesa con ese nombre. Elige otro nombre."
      : result.error === "denied" ? "Tu rol o sesión ya no permite crear mesas."
      : result.error === "invalid" ? "Revisa los datos de la mesa; no se pudo crear."
      : "No se pudo crear la mesa. Inténtalo de nuevo.");
  }

  return <>
    <button ref={opener} type="button" className={primary} aria-haspopup="dialog" onClick={show}>Nueva mesa</button>
    {open && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div ref={dialog} role="dialog" aria-modal="true" aria-label="Nueva mesa" onKeyDown={keys} className="flex max-h-full w-full max-w-sm flex-col rounded-2xl border border-border bg-surface shadow-xl">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4">
            <h2 className="font-heading text-lg font-bold">Nueva mesa</h2>
            <button type="button" className={button} aria-label="Cerrar" disabled={saving} onClick={close}>✕</button>
          </div>
          <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4">
              <label className="text-[12px] font-medium">Nombre<input ref={nameField} name="name" type="text" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className={input} /></label>
              <label className="text-[12px] font-medium">Capacidad (personas)<input name="capacity" type="text" inputMode="numeric" required value={capacity} onChange={(event) => setCapacity(event.target.value)} className={input} /></label>
              <label className="text-[12px] font-medium">Forma<select name="shape" value={shape} onChange={(event) => setShape(event.target.value)} className={input}>
                <option value="round">Redonda</option><option value="square">Cuadrada</option><option value="rectangle">Rectangular</option></select></label>
              <p className="text-xs text-text-muted">La mesa se coloca en el primer espacio libre del plano; después puedes arrastrarla y cambiar su tamaño.</p>
              {problem !== null && <p role="alert" className="rounded-lg bg-error-bg p-2 text-sm text-error">{problem}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border p-4">
              <button type="button" className={button} disabled={saving} onClick={close}>Cancelar</button>
              <button type="submit" className={primary} disabled={saving}>{saving ? "Creando…" : "Crear mesa"}</button>
            </div>
          </form>
        </div>
      </div>, document.body)}
  </>;
}
