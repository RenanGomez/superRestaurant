"use client";

import type { DiningLayoutV1, DiningTableV1 } from "@super-restaurant/shared-types";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type UIEvent } from "react";
import { createPortal } from "react-dom";

import { Field, FieldHint } from "../../components/field-hint";
import { applyDraftShape, draftChanges, draftFromTable, mergeByVersion, validateTableDetails, type TableDraft, type TableGeometry } from "../../lib/dining-editor";
import { clampPan, clampTablePosition, firstFreeSlot, moveTableByKeyboard, resizeTableCells, savedTablePosition, type TablePosition } from "../../lib/table-position";
import { tableShapeClass } from "../../lib/table-shape";
import { createDiningTableAction, saveDiningTableLayoutAction, updateDiningTableDetailsAction, type DiningActionResult } from "./actions";

type Zone = DiningLayoutV1["zones"][number];
type Geometry = TableGeometry;
interface Attempt { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string }
type StatusKind = "saved" | "conflict" | "error";
interface Status { readonly tableId: string; readonly kind: StatusKind; readonly text: string }
/** The one table with unsaved changes in this zone; a new table (isNew) only exists here until «Guardar cambios». */
interface Edit { readonly tableId: string; readonly isNew: boolean; readonly draft: TableDraft }
/** What the plan draws for a table: the server table with its draft applied, or a table that does not exist yet. */
interface Entry { readonly tableId: string; readonly isNew: boolean; readonly saved: DiningTableV1 | undefined; readonly draft: TableDraft }

const SAVED_VISIBLE_MS = 3000;
const CONFLICT_TEXT = "La mesa cambió en otro dispositivo; se recargó.";
const button = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const primary = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-accent bg-accent px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const input = "mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-2 text-center text-sm text-text focus-visible:outline-2 focus-visible:outline-accent";

function newAttempt(): Attempt {
  return { eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), occurredAt: new Date().toISOString() };
}

function cellStep(canvas: HTMLDivElement): { x: number; y: number } {
  const style = getComputedStyle(canvas);
  return { x: Number.parseFloat(style.gridTemplateColumns) + Number.parseFloat(style.columnGap), y: Number.parseFloat(style.gridTemplateRows) + Number.parseFloat(style.rowGap) };
}

function geometryOf(draft: TableDraft): Geometry {
  return { ...savedTablePosition({ x: draft.x, y: draft.y }, draft.width, draft.height), width: draft.width, height: draft.height };
}

function snapped(draft: TableDraft): TableDraft { return { ...draft, ...geometryOf(draft) }; }

function failureText(error: Exclude<DiningActionResult, { ok: true }>["error"]): string {
  return error === "denied" ? "Tu rol o sesión ya no permite editar el plano."
    : error === "invalid" ? "Los datos no son válidos; revísalos e inténtalo de nuevo."
    : "No se pudo guardar. Se conservaron tus cambios; inténtalo de nuevo.";
}

export function DiningZone({ zone, canManage }: { readonly zone: Zone; readonly canManage: boolean }): ReactNode {
  const router = useRouter();
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ pointerId: number; clientX: number; clientY: number; start: TablePosition } | null>(null);
  const [pan, setPan] = useState<TablePosition>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tables, setTables] = useState<Readonly<Record<string, DiningTableV1>>>(() => mergeByVersion({}, zone.tables));
  const [createdIds, setCreatedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [edit, setEdit] = useState<Edit | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tablesRef = useRef(tables);
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

  const entries: Entry[] = list.map((table) => ({ tableId: table.tableId, isNew: false, saved: table, draft: edit?.tableId === table.tableId && !edit.isNew ? edit.draft : draftFromTable(table) }));
  if (edit?.isNew) entries.push({ tableId: edit.tableId, isNew: true, saved: undefined, draft: edit.draft });
  const selected = selectedId === null ? undefined : entries.find((entry) => entry.tableId === selectedId);
  const editedSaved = edit === null || edit.isNew ? undefined : merged[edit.tableId];
  const changes = edit === null ? undefined : edit.isNew ? { layout: true, details: true } : editedSaved === undefined ? undefined : draftChanges(editedSaved, edit.draft);
  const dirty = edit !== null && changes !== undefined && (changes.layout || changes.details);
  const blockedBy = edit === null ? "" : (edit.draft.name.trim() === "" ? editedSaved?.name ?? "la mesa" : edit.draft.name.trim());

  function applyServerTable(table: DiningTableV1): void {
    tablesRef.current = { ...tablesRef.current, [table.tableId]: table };
    setTables(tablesRef.current);
  }
  function report(next: Status | null): void {
    setStatus(next);
    if (next?.kind === "saved") setTimeout(() => setStatus((current) => current === next ? null : current), SAVED_VISIBLE_MS);
  }
  function clearFeedback(): void { setProblem(null); setBlocked(null); setStatus(null); }

  /** Selection never discards a draft: with unsaved changes the panel asks to save or cancel first. */
  function select(tableId: string): boolean {
    if (tableId === selectedId) return true;
    if (dirty) { setBlocked(`Guarda o cancela los cambios de ${blockedBy} antes de continuar.`); return false; }
    setEdit(null);
    setSelectedId(tableId);
    clearFeedback();
    return true;
  }
  function canStartNew(): boolean {
    if (!dirty) return true;
    setBlocked(`Guarda o cancela los cambios de ${blockedBy} antes de continuar.`);
    return false;
  }
  function setDraft(entry: Entry, draft: TableDraft): void {
    if (saving) return;
    setEdit({ tableId: entry.tableId, isNew: entry.isNew, draft });
    setProblem(null);
    setStatus(null);
  }

  function move(entry: Entry, position: TablePosition): void {
    setDraft(entry, { ...entry.draft, ...clampTablePosition(position, entry.draft.width, entry.draft.height) });
  }
  function resizeTo(entry: Entry, size: { width: number; height: number }): void { setDraft(entry, { ...entry.draft, ...size }); }
  /** Drag, key or button ends on whole cells: the draft is what «Guardar cambios» will send. */
  function snapDraft(entry: Entry): void { setDraft(entry, snapped(entry.draft)); }
  function nudgeSize(entry: Entry, deltaCols: number, deltaRows: number): void {
    const base = snapped(entry.draft);
    setDraft(entry, { ...base, ...resizeTableCells(base, deltaCols, deltaRows) });
  }
  function startNew(name: string, capacity: string, shape: string): string | undefined {
    const slot = firstFreeSlot(entries.map((entry) => entry.draft));
    if (slot === undefined) return "No hay espacio libre en el plano para una mesa de 4×4.";
    const tableId = crypto.randomUUID();
    setEdit({ tableId, isNew: true, draft: applyDraftShape({ name, capacity, shape: "rectangle", x: slot.x, y: slot.y, width: 4, height: 4 }, shape) });
    setSelectedId(tableId);
    clearFeedback();
    return undefined;
  }
  function cancel(): void {
    if (saving || edit === null) return;
    if (edit.isNew) setSelectedId(null);
    setEdit(null);
    clearFeedback();
  }

  function failed(result: Exclude<DiningActionResult, { ok: true }>, key: string): void {
    if (result.error !== "unavailable") attempts.current.delete(key);
    if (result.error === "conflict") {
      if (edit?.isNew) { setProblem("Ya existe una mesa con ese nombre. Elige otro nombre."); return; }
      setEdit(null);
      report({ tableId: selectedId ?? "", kind: "conflict", text: CONFLICT_TEXT });
      router.refresh();
      return;
    }
    setProblem(failureText(result.error));
  }

  function attemptFor(key: string): Attempt {
    const attempt = attempts.current.get(key) ?? newAttempt();
    attempts.current.set(key, attempt);
    return attempt;
  }

  async function save(): Promise<void> {
    if (saving || edit === null || !dirty) return;
    const check = validateTableDetails(edit.draft);
    if (!check.ok) { setProblem(check.message); return; }
    const draft = snapped(edit.draft);
    const geometry: Geometry = { x: draft.x, y: draft.y, width: draft.width, height: draft.height };
    const geometryKey = `${geometry.x}:${geometry.y}:${geometry.width}:${geometry.height}`;
    setProblem(null);
    setSaving(true);
    try {
      if (edit.isNew) {
        // One attempt per draft content: retrying after a network error replays the same table id and attempt.
        const key = `new:${edit.tableId}|${zone.zoneId}|${check.name}|${check.capacity}|${check.shape}|${geometryKey}`;
        let result: DiningActionResult;
        try { result = await createDiningTableAction({ tableId: edit.tableId, zoneId: zone.zoneId, name: check.name, capacity: check.capacity, shape: check.shape, layout: geometry, attempt: attemptFor(key) }); }
        catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
        if (!result.ok) { failed(result, key); return; }
        attempts.current.delete(key);
        applyServerTable(result.table);
        setCreatedIds((current) => new Set(current).add(result.table.tableId));
        setEdit(null);
        report({ tableId: result.table.tableId, kind: "saved", text: "Mesa creada" });
        router.refresh();
        return;
      }
      let current = tablesRef.current[edit.tableId];
      if (current === undefined) return;
      const pendingChanges = draftChanges(current, draft);
      if (pendingChanges.layout) {
        const key = `${current.tableId}:${current.version}:layout:${geometryKey}`;
        let result: DiningActionResult;
        try { result = await saveDiningTableLayoutAction({ tableId: current.tableId, expectedVersion: current.version, layout: geometry, attempt: attemptFor(key) }); }
        catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
        if (!result.ok) { failed(result, key); return; }
        attempts.current.delete(key);
        applyServerTable(result.table);
        current = result.table;
      }
      if (pendingChanges.details) {
        const key = `${current.tableId}:${current.version}:details:${check.name}|${check.capacity}|${check.shape}`;
        let result: DiningActionResult;
        try { result = await updateDiningTableDetailsAction({ tableId: current.tableId, expectedVersion: current.version, name: check.name, capacity: check.capacity, shape: check.shape, attempt: attemptFor(key) }); }
        catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
        if (!result.ok) { failed(result, key); return; }
        attempts.current.delete(key);
        applyServerTable(result.table);
      }
      setEdit(null);
      report({ tableId: edit.tableId, kind: "saved", text: "Cambios guardados" });
    } finally { setSaving(false); }
  }

  function onPanDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget || (event.pointerType === "mouse" && event.button !== 0)) return;
    panDrag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: pan };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function clampedPan(offset: TablePosition): TablePosition {
    const view = viewport.current;
    const content = canvas.current;
    if (view === null || content === null) return offset;
    return clampPan(offset, { width: view.clientWidth, height: view.clientHeight }, { width: content.offsetWidth, height: content.offsetHeight });
  }
  function onPanMove(event: PointerEvent<HTMLDivElement>): void {
    const current = panDrag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    setPan(clampedPan({ x: current.start.x + event.clientX - current.clientX, y: current.start.y + event.clientY - current.clientY }));
  }
  function onPanEnd(event: PointerEvent<HTMLDivElement>): void {
    if (panDrag.current?.pointerId !== event.pointerId) return;
    panDrag.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  /** Focus can scroll an overflow-hidden box; fold that scroll back into the pan so the table stays in view. */
  function onViewportScroll(event: UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget;
    if (element.scrollLeft === 0 && element.scrollTop === 0) return;
    const offset = { x: pan.x - element.scrollLeft, y: pan.y - element.scrollTop };
    element.scrollLeft = 0;
    element.scrollTop = 0;
    setPan(clampedPan(offset));
  }

  const limits = selected === undefined ? undefined : (() => {
    const base = snapped(selected.draft);
    return {
      wider: resizeTableCells(base, 1, 0).width !== base.width, narrower: resizeTableCells(base, -1, 0).width !== base.width,
      taller: resizeTableCells(base, 0, 1).height !== base.height, shorter: resizeTableCells(base, 0, -1).height !== base.height,
    };
  })();
  const selectedStatus = status !== null && status.tableId === selectedId ? status : undefined;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.05)]">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="break-words font-heading text-[16px] font-semibold">{zone.name}</h2><p className="text-[12px] text-text-muted">{entries.length} mesa{entries.length === 1 ? "" : "s"}</p></div>
        {canManage && <CreateTableDialog tableCount={entries.length} canStart={canStartNew} onAdd={startNew} />}
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4">
        <div className="min-w-0">
          <div ref={viewport} onScroll={onViewportScroll} className="relative h-[420px] overflow-hidden rounded-xl border border-border lg:h-[640px]" role="group" aria-label={`Plano de ${zone.name}`}>
            <div ref={canvas} onPointerDown={onPanDown} onPointerMove={onPanMove} onPointerUp={onPanEnd} onPointerCancel={onPanEnd}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
              className={`grid h-[2100px] w-full min-w-[520px] touch-none select-none grid-cols-[repeat(24,minmax(20px,1fr))] grid-rows-[repeat(100,20px)] gap-px bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:calc(100%/24)_21px] p-2 ${panning ? "cursor-grabbing" : "cursor-grab"}`}>
              {entries.map((entry) => <TableCard key={entry.tableId} entry={entry} status={status?.tableId === entry.tableId ? status : undefined} selected={selectedId === entry.tableId} canManage={canManage} canvas={canvas}
                onSelect={() => select(entry.tableId)} onMove={(position) => move(entry, position)} onResize={(size) => resizeTo(entry, size)}
                onCommit={() => snapDraft(entry)} />)}
            </div>
          </div>
          {canManage && <p className="mt-2 text-xs text-text-muted">Arrastra para mover, usa la esquina para cambiar el tamaño y pulsa Guardar cambios. Con una mesa seleccionada también puedes usar las flechas (Mayús + flecha: cuatro celdas). Arrastra el fondo para desplazar el plano.</p>}
        </div>
        <aside className="mt-3 rounded-xl border border-border bg-bg p-3 lg:sticky lg:top-4 lg:mt-0" aria-label="Mesa seleccionada">
          {selected === undefined || limits === undefined ? (
            <p className="text-center text-sm text-text-muted">Selecciona una mesa del plano para ver sus detalles.</p>
          ) : (
            <div className="mx-auto w-full max-w-[320px] text-center">
              <h3 className="break-words text-sm font-semibold text-text">{selected.draft.name} · {selected.draft.capacity} {selected.draft.capacity.trim() === "1" ? "persona" : "personas"}</h3>
              {dirty && <p className="mt-1 text-sm font-semibold text-text">{selected.isNew ? "Mesa nueva sin guardar" : "Cambios sin guardar"}</p>}
              <p role="status" aria-live="polite" className={`mt-1 min-h-5 text-sm ${selectedStatus?.kind === "conflict" || selectedStatus?.kind === "error" ? "font-semibold text-error" : "text-text-muted"}`}>{selectedStatus?.text ?? ""}</p>
              {blocked !== null && <p role="alert" className="mt-1 rounded-lg bg-error-bg p-2 text-sm text-error">{blocked}</p>}
              {canManage && <>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium"><span aria-hidden="true">Tamaño</span><FieldHint label="Tamaño de la mesa" text="Ancho y largo de la mesa en el plano, en celdas. Usa los botones para hacerla más grande o más chica; no cambia la capacidad." /></div>
                <div className="mt-1 grid gap-2" role="group" aria-label="Tamaño de la mesa">
                  <div role="group" aria-label="Ancho"><p className="text-[12px] font-medium text-text-muted">Ancho</p>
                    <div className="mt-1 flex justify-center gap-2">
                      <button type="button" className={button} disabled={saving || !limits.narrower} onClick={() => nudgeSize(selected, -1, 0)}>Más angosta</button>
                      <button type="button" className={button} disabled={saving || !limits.wider} onClick={() => nudgeSize(selected, 1, 0)}>Más ancha</button>
                    </div></div>
                  <div role="group" aria-label="Largo"><p className="text-[12px] font-medium text-text-muted">Largo</p>
                    <div className="mt-1 flex justify-center gap-2">
                      <button type="button" className={button} disabled={saving || !limits.shorter} onClick={() => nudgeSize(selected, 0, -1)}>Más corta</button>
                      <button type="button" className={button} disabled={saving || !limits.taller} onClick={() => nudgeSize(selected, 0, 1)}>Más larga</button>
                    </div></div>
                </div>
                <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="mt-3 grid gap-2" aria-label="Datos de la mesa">
                  <Field className="text-[12px] font-medium" hint="Cómo se llama la mesa en el plano y al tomar pedidos, por ejemplo Mesa 4 o Terraza 2. Debe ser única en la sucursal." label="Nombre">{(id) => <input id={id} name="name" type="text" required maxLength={40} value={selected.draft.name} onChange={(event) => setDraft(selected, { ...selected.draft, name: event.target.value })} className={input} />}</Field>
                  <Field className="text-[12px] font-medium" hint="Cuántas personas caben; se usa para sugerir mesa, no limita la cuenta." label="Capacidad (personas)">{(id) => <input id={id} name="capacity" type="text" inputMode="numeric" required value={selected.draft.capacity} onChange={(event) => setDraft(selected, { ...selected.draft, capacity: event.target.value })} className={input} />}</Field>
                  <Field className="text-[12px] font-medium" hint="Cómo se dibuja la mesa en el plano. Es sólo visual; no cambia la capacidad. Cuadrada iguala el largo al ancho." label="Forma">{(id) => <select id={id} name="shape" value={selected.draft.shape} onChange={(event) => setDraft(selected, applyDraftShape(selected.draft, event.target.value))} className={input}>
                    <option value="round">Redonda</option><option value="square">Cuadrada</option><option value="rectangle">Rectangular</option></select>}</Field>
                  {problem !== null && <p role="alert" className="rounded-lg bg-error-bg p-2 text-sm text-error">{problem}</p>}
                  <button type="submit" className={primary} disabled={saving || !dirty}>{saving ? "Guardando…" : "Guardar cambios"}</button>
                  <button type="button" className={button} disabled={saving || !dirty} onClick={cancel}>Cancelar</button>
                </form>
              </>}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function TableCard({ entry, status, selected, canManage, canvas, onSelect, onMove, onResize, onCommit }: {
  readonly entry: Entry; readonly status: Status | undefined; readonly selected: boolean; readonly canManage: boolean;
  readonly canvas: RefObject<HTMLDivElement | null>; readonly onSelect: () => boolean; readonly onMove: (position: TablePosition) => void;
  readonly onResize: (size: { width: number; height: number }) => void; readonly onCommit: () => void;
}): ReactNode {
  const [step, setStep] = useState({ x: 21, y: 21 });
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; start: TablePosition; step: { x: number; y: number }; moved: boolean } | null>(null);
  const resize = useRef<{ pointerId: number; clientX: number; clientY: number; start: Geometry; step: { x: number; y: number } } | null>(null);
  const { draft } = entry;
  const { width, height } = draft;
  const position = { x: draft.x, y: draft.y };
  const round = draft.shape === "round";

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return;
    if (!onSelect()) return;
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
    if (save && current.moved) onCommit();
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); return; }
    if (!canManage || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    if (!onSelect()) return;
    onMove(moveTableByKeyboard(position, event.key, event.shiftKey, width, height));
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
    if (save) onCommit();
  }
  function stop(event: MouseEvent<HTMLElement>): void { event.stopPropagation(); }

  return (
    <article role="button" tabIndex={0} aria-pressed={selected} aria-label={`Mesa ${draft.name}, ${draft.capacity} personas. Enter para seleccionar.${canManage ? " Flechas para mover." : ""}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => endDrag(event, true)} onPointerCancel={(event) => endDrag(event, false)} onKeyDown={onKeyDown}
      style={{ gridColumn: `${Math.floor(position.x) + 1} / span ${width}`, gridRow: `${Math.floor(position.y) + 1} / span ${height}`, transform: `translate(${(position.x % 1) * step.x}px, ${(position.y % 1) * step.y}px)`, ...(selected ? { boxShadow: "0 0 0 3px var(--color-selected)" } : {}) }}
      className={`relative z-10 flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden bg-[oklch(95%_0.025_230)] p-0.5 text-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${selected ? "border-[3px] border-selected" : "border-2 border-accent"} ${canManage ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer"} ${tableShapeClass(draft.shape)}`}>
      <strong className="w-full truncate text-[11px] leading-tight">{draft.name}</strong>
      <span className="text-[10px] leading-tight text-text-muted">{draft.capacity} pers.</span>
      {entry.isNew ? <span className="w-full truncate text-[9px] leading-tight text-text-muted">Sin guardar</span>
        : status !== undefined && <span className={`w-full truncate text-[9px] leading-tight ${status.kind === "conflict" || status.kind === "error" ? "font-semibold text-error" : "text-text-muted"}`}>{status.kind === "conflict" || status.kind === "error" ? "Sin guardar" : status.text}</span>}
      {canManage && selected && <span aria-hidden="true" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={(event) => endResize(event, true)} onPointerCancel={(event) => endResize(event, false)} onClick={stop}
        className={`absolute h-7 w-7 cursor-nwse-resize touch-none after:absolute after:bottom-1 after:right-1 after:h-3 after:w-3 after:border-b-[3px] after:border-r-[3px] after:border-accent-hover ${round ? "bottom-[14%] right-[14%]" : "bottom-0 right-0"}`} />}
    </article>
  );
}

function CreateTableDialog({ tableCount, canStart, onAdd }: {
  readonly tableCount: number; readonly canStart: () => boolean; readonly onAdd: (name: string, capacity: string, shape: string) => string | undefined;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [shape, setShape] = useState("round");
  const [problem, setProblem] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  function show(): void {
    if (!canStart()) return;
    setName(`Mesa ${tableCount + 1}`); setCapacity("4"); setShape("round"); setProblem(null); setOpen(true);
  }
  function close(): void {
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

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const check = validateTableDetails({ name, capacity, shape });
    if (!check.ok) { setProblem(check.message); return; }
    const refused = onAdd(check.name, String(check.capacity), check.shape);
    if (refused !== undefined) { setProblem(refused); return; }
    setOpen(false);
  }

  return <>
    <button ref={opener} type="button" className={primary} aria-haspopup="dialog" onClick={show}>Nueva mesa</button>
    {open && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div ref={dialog} role="dialog" aria-modal="true" aria-label="Nueva mesa" onKeyDown={keys} className="flex max-h-full w-full max-w-sm flex-col rounded-2xl border border-border bg-surface shadow-xl">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4">
            <h2 className="font-heading text-lg font-bold">Nueva mesa</h2>
            <button type="button" className={button} aria-label="Cerrar" onClick={close}>✕</button>
          </div>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4">
              <Field className="text-[12px] font-medium" hint="Cómo se llama la mesa en el plano y al tomar pedidos, por ejemplo Mesa 4 o Terraza 2. Debe ser única en la sucursal." label="Nombre">{(id) => <input id={id} ref={nameField} name="name" type="text" required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} className={input} />}</Field>
              <Field className="text-[12px] font-medium" hint="Cuántas personas caben; se usa para sugerir mesa, no limita la cuenta." label="Capacidad (personas)">{(id) => <input id={id} name="capacity" type="text" inputMode="numeric" required value={capacity} onChange={(event) => setCapacity(event.target.value)} className={input} />}</Field>
              <Field className="text-[12px] font-medium" hint="Cómo se dibuja la mesa en el plano. Es sólo visual; no cambia la capacidad." label="Forma">{(id) => <select id={id} name="shape" value={shape} onChange={(event) => setShape(event.target.value)} className={input}>
                <option value="round">Redonda</option><option value="square">Cuadrada</option><option value="rectangle">Rectangular</option></select>}</Field>
              <p className="text-xs text-text-muted">La mesa se agrega al plano como borrador en el primer espacio libre; muévela, ajusta su tamaño y pulsa Guardar cambios para crearla.</p>
              {problem !== null && <p role="alert" className="rounded-lg bg-error-bg p-2 text-sm text-error">{problem}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border p-4">
              <button type="button" className={button} onClick={close}>Cancelar</button>
              <button type="submit" className={primary}>Agregar al plano</button>
            </div>
          </form>
        </div>
      </div>, document.body)}
  </>;
}
