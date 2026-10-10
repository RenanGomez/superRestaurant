"use client";

import type { DiningLayoutV1, DiningTableV1 } from "@super-restaurant/shared-types";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type UIEvent } from "react";
import { createPortal } from "react-dom";

import { Field, FieldHint } from "../../components/field-hint";
import { applyDraftShape, draftFromTable, draftIsStale, mergeByVersion, validateTableDetails, type TableDraft, type TableGeometry } from "../../lib/dining-editor";
import { applyPlanOutcome, clampPlanMove, commitPlanMove, layoutAttemptKey, movePlanTable, panelChanges, panelLayout, pendingMoveIds, planSaveCommands, rebasePlanMove, rebaseVersion, withoutMove, type PlanDraft } from "../../lib/plan-draft";
import { clampPan, clampTablePosition, firstFreeSlot, moveTableByKeyboard, resizeSquareCells, resizeTableCells, savedTablePosition, type TablePosition } from "../../lib/table-position";
import { tableShapeClass } from "../../lib/table-shape";
import { createDiningTableAction, saveDiningTableLayoutAction, updateDiningTableDetailsAction, type DiningActionResult } from "./actions";

type Zone = DiningLayoutV1["zones"][number];
type Geometry = TableGeometry;
interface Attempt { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string }
type StatusKind = "saved" | "conflict" | "error";
interface Status { readonly tableId: string; readonly kind: StatusKind; readonly text: string }
/** Panel draft: size and details of the ONE selected table (the position of a created table lives in the plan draft); a new table (isNew) only exists here until «Guardar cambios». */
interface Edit { readonly tableId: string; readonly isNew: boolean; readonly baseVersion: number; readonly draft: TableDraft }
/** What the plan draws for a table: `draft` is the panel draft, `view` is what is drawn (panel size with the pending plan position), or a table that does not exist yet. */
interface Entry { readonly tableId: string; readonly isNew: boolean; readonly saved: DiningTableV1 | undefined; readonly draft: TableDraft; readonly view: TableDraft; readonly pending: boolean }
interface PlanIssue { readonly tableId: string; readonly text: string }

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
  const [plan, setPlan] = useState<PlanDraft>({});
  const [planSaving, setPlanSaving] = useState(false);
  const [planIssues, setPlanIssues] = useState<readonly PlanIssue[]>([]);
  const busy = saving || planSaving;

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

  const pendingIds = pendingMoveIds(plan, merged);
  const entries: Entry[] = list.map((table) => {
    const draft = edit?.tableId === table.tableId && !edit.isNew ? edit.draft : draftFromTable(table);
    const move = pendingIds.includes(table.tableId) ? plan[table.tableId] : undefined;
    return { tableId: table.tableId, isNew: false, saved: table, draft, view: { ...draft, x: move?.x ?? table.layout.x, y: move?.y ?? table.layout.y }, pending: move !== undefined };
  });
  if (edit?.isNew) entries.push({ tableId: edit.tableId, isNew: true, saved: undefined, draft: edit.draft, view: edit.draft, pending: false });
  const selected = selectedId === null ? undefined : entries.find((entry) => entry.tableId === selectedId);
  const editedSaved = edit === null || edit.isNew ? undefined : merged[edit.tableId];
  const changes = edit === null ? undefined : edit.isNew ? { layout: true, details: true } : editedSaved === undefined ? undefined : panelChanges(editedSaved, edit.draft);
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
    if (busy) return;
    const baseVersion = entry.isNew ? 0 : edit?.tableId === entry.tableId ? edit.baseVersion : entry.saved?.version ?? 0;
    setEdit({ tableId: entry.tableId, isNew: entry.isNew, baseVersion, draft });
    setProblem(null);
    setStatus(null);
  }

  /** Dragging or arrows: a created table accumulates in the plan draft; a new table moves inside its own panel draft. */
  function move(entry: Entry, position: TablePosition): void {
    if (busy) return;
    if (entry.isNew || entry.saved === undefined) {
      setDraft(entry, { ...entry.draft, ...clampTablePosition(position, entry.draft.width, entry.draft.height) });
      return;
    }
    const table = entry.saved;
    setPlan((current) => movePlanTable(current, table, position, entry.view.width, entry.view.height));
    setPlanIssues([]);
    setStatus(null);
  }
  /** A new size is a panel change; a pending position of the same table is kept inside the grid for it. */
  function resizeTo(entry: Entry, size: { width: number; height: number }): void {
    if (busy) return;
    setDraft(entry, { ...entry.draft, ...size });
    if (!entry.isNew) setPlan((current) => clampPlanMove(current, entry.tableId, size.width, size.height));
  }
  const square = selected?.draft.shape === "square";
  /** A drag or key press ends on whole cells; a pending position equal to the saved one leaves the plan draft. */
  function commitMove(entry: Entry): void {
    if (entry.isNew || entry.saved === undefined) { setDraft(entry, snapped(entry.draft)); return; }
    const table = entry.saved;
    setPlan((current) => commitPlanMove(current, table, entry.view.width, entry.view.height));
  }
  /** A size drag or button ends on whole cells. */
  function commitResize(entry: Entry): void {
    const base = snapped(entry.view);
    setDraft(entry, { ...entry.draft, width: base.width, height: base.height, ...(entry.isNew ? { x: base.x, y: base.y } : {}) });
  }
  function nudgeSize(entry: Entry, deltaCols: number, deltaRows: number): void {
    const base = snapped(entry.view);
    resizeTo(entry, base.shape === "square" ? resizeSquareCells(base, deltaCols, deltaRows) : resizeTableCells(base, deltaCols, deltaRows));
  }
  function changeShape(entry: Entry, shape: string): void {
    if (busy) return;
    const shaped = applyDraftShape(entry.view, shape);
    setDraft(entry, { ...entry.draft, shape: shaped.shape, width: shaped.width, height: shaped.height });
    if (!entry.isNew) setPlan((current) => clampPlanMove(current, entry.tableId, shaped.width, shaped.height));
  }
  function startNew(name: string, capacity: string, shape: string): string | undefined {
    const slot = firstFreeSlot(entries.map((entry) => entry.view));
    if (slot === undefined) return "No hay espacio libre en el plano para una mesa de 4×4.";
    const tableId = crypto.randomUUID();
    setEdit({ tableId, isNew: true, baseVersion: 0, draft: applyDraftShape({ name, capacity, shape: "rectangle", x: slot.x, y: slot.y, width: 4, height: 4 }, shape) });
    setSelectedId(tableId);
    clearFeedback();
    return undefined;
  }
  function cancel(): void {
    if (busy || edit === null) return;
    if (edit.isNew) setSelectedId(null);
    setEdit(null);
    clearFeedback();
  }
  function cancelPlan(): void {
    if (busy) return;
    setPlan({});
    setPlanIssues([]);
  }

  /** This editor's own save moved a table between versions: drafts based on the old one follow it instead of turning into conflicts. */
  function followOwnSave(tableId: string, fromVersion: number, toVersion: number): void {
    setPlan((current) => rebasePlanMove(current, tableId, fromVersion, toVersion));
    setEdit((current) => current !== null && current.tableId === tableId && !current.isNew ? { ...current, baseVersion: rebaseVersion(current.baseVersion, fromVersion, toVersion) } : current);
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
    if (busy || edit === null || !dirty) return;
    const check = validateTableDetails(edit.draft);
    if (!check.ok) { setProblem(check.message); return; }
    const draft = snapped(edit.draft);
    setProblem(null);
    setSaving(true);
    try {
      if (edit.isNew) {
        const geometry: Geometry = { x: draft.x, y: draft.y, width: draft.width, height: draft.height };
        const geometryKey = `${geometry.x}:${geometry.y}:${geometry.width}:${geometry.height}`;
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
      // The draft was made on baseVersion: if the server table moved on, nothing is sent and the server copy wins.
      if (draftIsStale(edit.baseVersion, current.version)) {
        setEdit(null);
        report({ tableId: edit.tableId, kind: "conflict", text: CONFLICT_TEXT });
        router.refresh();
        return;
      }
      let version = edit.baseVersion;
      const pendingChanges = panelChanges(current, draft);
      if (pendingChanges.layout) {
        // Only the size changes here: the position sent is the SAVED one, never a pending plan position.
        const geometry = panelLayout(current.layout, draft);
        const key = `${current.tableId}:${version}:layout:${geometry.x}:${geometry.y}:${geometry.width}:${geometry.height}`;
        let result: DiningActionResult;
        try { result = await saveDiningTableLayoutAction({ tableId: current.tableId, expectedVersion: version, layout: geometry, attempt: attemptFor(key) }); }
        catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
        if (!result.ok) { failed(result, key); return; }
        attempts.current.delete(key);
        applyServerTable(result.table);
        followOwnSave(current.tableId, version, result.table.version);
        current = result.table;
        version = result.table.version;
      }
      if (pendingChanges.details) {
        const key = `${current.tableId}:${version}:details:${check.name}|${check.capacity}|${check.shape}`;
        let result: DiningActionResult;
        try { result = await updateDiningTableDetailsAction({ tableId: current.tableId, expectedVersion: version, name: check.name, capacity: check.capacity, shape: check.shape, attempt: attemptFor(key) }); }
        catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
        if (!result.ok) { failed(result, key); return; }
        attempts.current.delete(key);
        applyServerTable(result.table);
        followOwnSave(current.tableId, version, result.table.version);
      }
      setEdit(null);
      report({ tableId: edit.tableId, kind: "saved", text: "Cambios guardados" });
    } finally { setSaving(false); }
  }

  /** «Guardar plano»: one layout command per moved table, in sequence; failures stay pending with their reason. */
  async function savePlan(): Promise<void> {
    if (busy) return;
    const { commands, conflicts } = planSaveCommands(plan, tablesRef.current);
    if (commands.length === 0 && conflicts.length === 0) return;
    const nameOf = (tableId: string): string => tablesRef.current[tableId]?.name ?? "La mesa";
    const issues: PlanIssue[] = [];
    let remaining = plan;
    let refresh = false;
    setPlanIssues([]);
    setPlanSaving(true);
    try {
      for (const tableId of conflicts) {
        remaining = applyPlanOutcome(remaining, tableId, "conflict");
        issues.push({ tableId, text: `${nameOf(tableId)}: cambió en otro dispositivo; se restauró su posición.` });
        refresh = true;
      }
      for (const command of commands) {
        const key = layoutAttemptKey(command);
        let result: DiningActionResult;
        try { result = await saveDiningTableLayoutAction({ tableId: command.tableId, expectedVersion: command.expectedVersion, layout: command.layout, attempt: attemptFor(key) }); }
        catch (error) { unstable_rethrow(error); result = { ok: false, error: "unavailable" }; }
        if (result.ok) {
          attempts.current.delete(key);
          applyServerTable(result.table);
          followOwnSave(command.tableId, command.expectedVersion, result.table.version);
          remaining = applyPlanOutcome(remaining, command.tableId, "saved");
          continue;
        }
        if (result.error !== "unavailable") attempts.current.delete(key);
        if (result.error === "conflict") {
          remaining = applyPlanOutcome(remaining, command.tableId, "conflict");
          issues.push({ tableId: command.tableId, text: `${nameOf(command.tableId)}: cambió en otro dispositivo; se restauró su posición.` });
          refresh = true;
          continue;
        }
        issues.push({ tableId: command.tableId, text: `${nameOf(command.tableId)}: ${failureText(result.error)}` });
        // Without a session or a connection the rest would fail the same way; they stay pending untouched.
        if (result.error === "denied" || result.error === "unavailable") break;
      }
      setPlan((current) => Object.keys(current).reduce((next, tableId) => remaining[tableId] === undefined ? withoutMove(next, tableId) : next, current));
      setPlanIssues(issues);
      if (issues.length === 0) report({ tableId: "", kind: "saved", text: "Plano guardado" });
      if (refresh) router.refresh();
    } finally { setPlanSaving(false); }
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
    const base = snapped(selected.view);
    const bigger = resizeSquareCells(base, 1, 1).width !== base.width;
    const smaller = resizeSquareCells(base, -1, -1).width !== base.width;
    return {
      bigger, smaller,
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
          {(pendingIds.length > 0 || planIssues.length > 0 || planSaving) && (
            <div className="mb-2 rounded-xl border border-border bg-bg p-2" aria-label="Cambios del plano">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="status" aria-live="polite" className="text-sm font-semibold text-text">{planSaving ? "Guardando plano…" : `${pendingIds.length} mesa${pendingIds.length === 1 ? "" : "s"} movida${pendingIds.length === 1 ? "" : "s"} sin guardar`}</p>
                <div className="flex gap-2">
                  <button type="button" className={primary} disabled={busy || pendingIds.length === 0} onClick={() => void savePlan()}>Guardar plano</button>
                  <button type="button" className={button} disabled={busy || pendingIds.length === 0} onClick={cancelPlan}>Cancelar</button>
                </div>
              </div>
              {planIssues.length > 0 && <ul role="alert" className="mt-2 grid gap-1 rounded-lg bg-error-bg p-2 text-sm text-error">{planIssues.map((issue) => <li key={issue.tableId}>{issue.text}</li>)}</ul>}
            </div>
          )}
          {status?.tableId === "" && <p role="status" aria-live="polite" className="mb-2 text-sm text-text-muted">{status.text}</p>}
          <div ref={viewport} onScroll={onViewportScroll} className="relative h-[420px] overflow-hidden rounded-xl border border-border lg:h-[640px]" role="group" aria-label={`Plano de ${zone.name}`}>
            <div ref={canvas} onPointerDown={onPanDown} onPointerMove={onPanMove} onPointerUp={onPanEnd} onPointerCancel={onPanEnd}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
              className={`grid h-[2100px] w-full min-w-[520px] touch-none select-none grid-cols-[repeat(24,minmax(20px,1fr))] grid-rows-[repeat(100,20px)] gap-px bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:calc(100%/24)_21px] p-2 ${panning ? "cursor-grabbing" : "cursor-grab"}`}>
              {entries.map((entry) => <TableCard key={entry.tableId} entry={entry} status={status?.tableId === entry.tableId ? status : undefined} selected={selectedId === entry.tableId} canManage={canManage} canvas={canvas}
                onSelect={() => select(entry.tableId)} onMove={(position) => move(entry, position)} onResize={(size) => resizeTo(entry, size)}
                onCommitMove={() => commitMove(entry)} onCommitResize={() => commitResize(entry)} />)}
            </div>
          </div>
          {canManage && <p className="mt-2 text-xs text-text-muted">Arrastra para mover varias mesas y pulsa Guardar plano; el tamaño y los datos de una mesa se guardan aparte con Guardar cambios. Con una mesa seleccionada también puedes usar las flechas (Mayús + flecha: cuatro celdas). Arrastra el fondo para desplazar el plano.</p>}
        </div>
        <aside className="mt-3 rounded-xl border border-border bg-bg p-3 lg:sticky lg:top-4 lg:mt-0" aria-label="Mesa seleccionada">
          {selected === undefined || limits === undefined ? (
            <p className="text-center text-sm text-text-muted">Selecciona una mesa del plano para ver sus detalles.</p>
          ) : (
            <div className="mx-auto w-full max-w-[320px] text-center">
              <h3 className="break-words text-sm font-semibold text-text">{selected.draft.name} · {selected.draft.capacity} {selected.draft.capacity.trim() === "1" ? "persona" : "personas"}</h3>
              {dirty && <p className="mt-1 text-sm font-semibold text-text">{selected.isNew ? "Mesa nueva sin guardar" : "Cambios sin guardar"}</p>}
              {selected.pending && <p className="mt-1 text-[12px] text-text-muted">Posición pendiente: se guarda con «Guardar plano».</p>}
              <p role="status" aria-live="polite" className={`mt-1 min-h-5 text-sm ${selectedStatus?.kind === "conflict" || selectedStatus?.kind === "error" ? "font-semibold text-error" : "text-text-muted"}`}>{selectedStatus?.text ?? ""}</p>
              {blocked !== null && <p role="alert" className="mt-1 rounded-lg bg-error-bg p-2 text-sm text-error">{blocked}</p>}
              {canManage && <>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium"><span aria-hidden="true">Tamaño</span><FieldHint label="Tamaño de la mesa" text="Ancho y largo de la mesa en el plano, en celdas. Usa los botones para hacerla más grande o más chica; no cambia la capacidad." /></div>
                <div className="mt-1 grid gap-2" role="group" aria-label="Tamaño de la mesa">
                  {square ? (
                    <div className="flex justify-center gap-2">
                      <button type="button" className={button} disabled={busy || !limits.smaller} onClick={() => nudgeSize(selected, -1, -1)}>Más chica</button>
                      <button type="button" className={button} disabled={busy || !limits.bigger} onClick={() => nudgeSize(selected, 1, 1)}>Más grande</button>
                    </div>
                  ) : <>
                  <div role="group" aria-label="Ancho"><p className="text-[12px] font-medium text-text-muted">Ancho</p>
                    <div className="mt-1 flex justify-center gap-2">
                      <button type="button" className={button} disabled={busy || !limits.narrower} onClick={() => nudgeSize(selected, -1, 0)}>Más angosta</button>
                      <button type="button" className={button} disabled={busy || !limits.wider} onClick={() => nudgeSize(selected, 1, 0)}>Más ancha</button>
                    </div></div>
                  <div role="group" aria-label="Largo"><p className="text-[12px] font-medium text-text-muted">Largo</p>
                    <div className="mt-1 flex justify-center gap-2">
                      <button type="button" className={button} disabled={busy || !limits.shorter} onClick={() => nudgeSize(selected, 0, -1)}>Más corta</button>
                      <button type="button" className={button} disabled={busy || !limits.taller} onClick={() => nudgeSize(selected, 0, 1)}>Más larga</button>
                    </div></div>
                  </>}
                </div>
                <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="mt-3 grid gap-2" aria-label="Datos de la mesa">
                  <Field className="text-[12px] font-medium" hint="Cómo se llama la mesa en el plano y al tomar pedidos, por ejemplo Mesa 4 o Terraza 2. Debe ser única en la sucursal." label="Nombre">{(id) => <input id={id} name="name" type="text" required maxLength={40} value={selected.draft.name} onChange={(event) => setDraft(selected, { ...selected.draft, name: event.target.value })} className={input} />}</Field>
                  <Field className="text-[12px] font-medium" hint="Cuántas personas caben; se usa para sugerir mesa, no limita la cuenta." label="Capacidad (personas)">{(id) => <input id={id} name="capacity" type="text" inputMode="numeric" required value={selected.draft.capacity} onChange={(event) => setDraft(selected, { ...selected.draft, capacity: event.target.value })} className={input} />}</Field>
                  <Field className="text-[12px] font-medium" hint="Cómo se dibuja la mesa en el plano. Es sólo visual; no cambia la capacidad. Cuadrada iguala el largo al ancho." label="Forma">{(id) => <select id={id} name="shape" value={selected.draft.shape} onChange={(event) => changeShape(selected, event.target.value)} className={input}>
                    <option value="round">Redonda</option><option value="square">Cuadrada</option><option value="rectangle">Rectangular</option></select>}</Field>
                  {problem !== null && <p role="alert" className="rounded-lg bg-error-bg p-2 text-sm text-error">{problem}</p>}
                  <button type="submit" className={primary} disabled={busy || !dirty}>{saving ? "Guardando…" : "Guardar cambios"}</button>
                  <button type="button" className={button} disabled={busy || !dirty} onClick={cancel}>Cancelar</button>
                </form>
              </>}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function TableCard({ entry, status, selected, canManage, canvas, onSelect, onMove, onResize, onCommitMove, onCommitResize }: {
  readonly entry: Entry; readonly status: Status | undefined; readonly selected: boolean; readonly canManage: boolean;
  readonly canvas: RefObject<HTMLDivElement | null>; readonly onSelect: () => boolean; readonly onMove: (position: TablePosition) => void;
  readonly onResize: (size: { width: number; height: number }) => void; readonly onCommitMove: () => void; readonly onCommitResize: () => void;
}): ReactNode {
  const [step, setStep] = useState({ x: 21, y: 21 });
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; start: TablePosition; step: { x: number; y: number }; moved: boolean } | null>(null);
  const resize = useRef<{ pointerId: number; clientX: number; clientY: number; start: Geometry; step: { x: number; y: number } } | null>(null);
  const draft = entry.view;
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
    if (save && current.moved) onCommitMove();
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
    const deltaCols = (event.clientX - current.clientX) / current.step.x;
    const deltaRows = (event.clientY - current.clientY) / current.step.y;
    onResize(draft.shape === "square" ? resizeSquareCells(current.start, deltaCols, deltaRows) : resizeTableCells(current.start, deltaCols, deltaRows));
  }
  function endResize(event: PointerEvent<HTMLElement>, save: boolean): void {
    const current = resize.current;
    if (current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (save) onCommitResize();
  }
  function stop(event: MouseEvent<HTMLElement>): void { event.stopPropagation(); }

  return (
    <article role="button" tabIndex={0} aria-pressed={selected} aria-label={`Mesa ${draft.name}, ${draft.capacity} personas. Enter para seleccionar.${canManage ? " Flechas para mover." : ""}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => endDrag(event, true)} onPointerCancel={(event) => endDrag(event, false)} onKeyDown={onKeyDown}
      style={{ gridColumn: `${Math.floor(position.x) + 1} / span ${width}`, gridRow: `${Math.floor(position.y) + 1} / span ${height}`, transform: `translate(${(position.x % 1) * step.x}px, ${(position.y % 1) * step.y}px)`, ...(selected ? { boxShadow: "0 0 0 3px var(--color-selected)" } : {}) }}
      className={`relative z-10 flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden bg-[oklch(95%_0.025_230)] p-0.5 text-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${selected ? "border-[3px] border-selected" : "border-2 border-accent"} ${entry.pending ? "border-dashed" : ""}${canManage ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer"} ${tableShapeClass(draft.shape)}`}>
      <strong className="w-full truncate text-[11px] leading-tight">{draft.name}</strong>
      <span className="text-[10px] leading-tight text-text-muted">{draft.capacity} pers.</span>
      {entry.isNew ? <span className="w-full truncate text-[9px] leading-tight text-text-muted">Sin guardar</span>
        : entry.pending ? <span className="w-full truncate text-[9px] leading-tight font-semibold text-text-muted">Movida</span>
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
