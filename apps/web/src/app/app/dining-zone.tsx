"use client";

import type { DiningLayoutV1, DiningTableV1 } from "@super-restaurant/shared-types";
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

import { clampTablePosition, moveTableByKeyboard, savedTablePosition, type TablePosition } from "../../lib/table-position";
import { createDiningTableAction, updateDiningTableLayoutAction } from "./actions";

type Zone = DiningLayoutV1["zones"][number];
interface TableDraft {
  readonly source: string;
  readonly position: TablePosition;
  readonly widthInput: string;
  readonly heightInput: string;
  readonly dirty: boolean;
  readonly serverUpdated: boolean;
}

function draftFrom(table: DiningTableV1, serverUpdated = false): TableDraft {
  return {
    source: `${table.version}:${table.layout.x}:${table.layout.y}:${table.layout.width}:${table.layout.height}`,
    position: { x: table.layout.x, y: table.layout.y },
    widthInput: String(table.layout.width),
    heightInput: String(table.layout.height),
    dirty: false,
    serverUpdated,
  };
}

function effectiveDimension(input: string, fallback: number): number {
  const parsed = Number(input);
  return /^\d+$/u.test(input) && parsed >= 2 && parsed <= 8 ? parsed : fallback;
}

function dimensions(table: DiningTableV1, draft: TableDraft): { width: number; height: number } {
  return { width: effectiveDimension(draft.widthInput, table.layout.width), height: effectiveDimension(draft.heightInput, table.layout.height) };
}

function cellStep(canvas: HTMLDivElement): { x: number; y: number } {
  const style = getComputedStyle(canvas);
  return { x: Number.parseFloat(style.gridTemplateColumns) + Number.parseFloat(style.columnGap), y: Number.parseFloat(style.gridTemplateRows) + Number.parseFloat(style.rowGap) };
}

export function DiningZone({ zone, canManage }: { readonly zone: Zone; readonly canManage: boolean }): ReactNode {
  const canvas = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storedDrafts, setDrafts] = useState<Record<string, TableDraft>>(() => Object.fromEntries(zone.tables.map((table) => [table.tableId, draftFrom(table)])));

  // A refreshed server snapshot replaces the local draft before it can be submitted with a new version.
  let drafts = storedDrafts;
  let changed = Object.keys(storedDrafts).length !== zone.tables.length;
  let updatedId: string | null = null;
  const nextDrafts: Record<string, TableDraft> = {};
  for (const table of zone.tables) {
    const previous = storedDrafts[table.tableId];
    if (previous?.source === draftFrom(table).source) nextDrafts[table.tableId] = previous;
    else {
      nextDrafts[table.tableId] = draftFrom(table, previous?.dirty ?? false);
      changed = true;
      if (previous?.dirty) updatedId = table.tableId;
    }
  }
  if (changed) {
    drafts = nextDrafts;
    setDrafts(nextDrafts);
    if (updatedId !== null) setSelectedId(updatedId);
  }

  const selected = zone.tables.find((table) => table.tableId === selectedId);
  const selectedDraft = selected === undefined ? undefined : drafts[selected.tableId];

  function edit(table: DiningTableV1, change: (draft: TableDraft) => TableDraft): void {
    setDrafts((current) => {
      const old = current[table.tableId];
      const base = old?.source === draftFrom(table).source ? old : draftFrom(table, old?.dirty ?? false);
      return { ...current, [table.tableId]: change(base) };
    });
  }

  function move(table: DiningTableV1, position: TablePosition): void {
    edit(table, (draft) => {
      const { width, height } = dimensions(table, draft);
      return { ...draft, position: clampTablePosition(position, width, height), dirty: true, serverUpdated: false };
    });
  }

  function resize(table: DiningTableV1, axis: "width" | "height", value: string): void {
    edit(table, (draft) => {
      const widthInput = axis === "width" ? value : draft.widthInput;
      const heightInput = axis === "height" ? value : draft.heightInput;
      const current = dimensions(table, draft);
      const width = effectiveDimension(widthInput, current.width);
      const height = effectiveDimension(heightInput, current.height);
      return { ...draft, widthInput, heightInput, position: clampTablePosition(draft.position, width, height), dirty: true, serverUpdated: false };
    });
  }

  const selectedSize = selected !== undefined && selectedDraft !== undefined ? dimensions(selected, selectedDraft) : undefined;
  const saved = selectedDraft !== undefined && selectedSize !== undefined ? savedTablePosition(selectedDraft.position, selectedSize.width, selectedSize.height) : undefined;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.05)]">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="break-words font-heading text-[16px] font-semibold">{zone.name}</h2><p className="text-[12px] text-text-muted">{zone.tables.length} mesa{zone.tables.length === 1 ? "" : "s"}</p></div>
        {canManage && <CreateTableForm zoneId={zone.zoneId} />}
      </div>
      <div className="h-[360px] overflow-auto rounded-xl border border-border" aria-label={`Plano de ${zone.name}`}>
        <div ref={canvas} className="grid h-[2100px] min-w-[520px] grid-cols-[repeat(24,minmax(20px,1fr))] grid-rows-[repeat(100,20px)] gap-px bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:calc(100%/24)_21px] p-2">
          {zone.tables.map((table) => <TableCard key={table.tableId} table={table} draft={drafts[table.tableId] ?? draftFrom(table)} selected={selectedId === table.tableId} canManage={canManage} canvas={canvas} onSelect={() => setSelectedId(table.tableId)} onMove={(position) => move(table, position)} />)}
        </div>
      </div>
      {canManage && <p className="mt-2 text-xs text-text-muted">Selecciona una mesa con clic, toque o Enter. Arrástrala o usa las flechas (una celda; Mayús + flecha: cuatro). Después, guarda su layout.</p>}
      <div className="mt-3 rounded-xl border border-border bg-bg p-3" aria-label="Mesa seleccionada">
        {selected === undefined || selectedDraft === undefined || saved === undefined ? (
          <p className="text-sm text-text-muted">Selecciona una mesa del plano para ver sus detalles.</p>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-text">{selected.name} · {selected.capacity} personas</h3>
            {selectedDraft.serverUpdated && <p role="status" className="mt-2 rounded border border-accent bg-surface px-3 py-2 text-sm text-text">Mesa actualizada en servidor. Se descartó tu cambio local.</p>}
            {canManage && <details className="mt-2" key={selected.tableId}>
              <summary className="flex min-h-11 w-fit min-w-11 cursor-pointer items-center rounded-lg border border-accent px-3 text-sm font-semibold text-accent">Editar</summary>
              <form action={updateDiningTableLayoutAction} className="mt-3 grid max-w-[360px] grid-cols-2 gap-2">
                <input type="hidden" name="tableId" value={selected.tableId} /><input type="hidden" name="expectedVersion" value={selected.version} />
                <Field name="x" label="Columna" value={saved.x} onChange={(value) => move(selected, { ...selectedDraft.position, x: Number(value) })} />
                <Field name="y" label="Fila" value={saved.y} onChange={(value) => move(selected, { ...selectedDraft.position, y: Number(value) })} />
                <Field name="width" label="Ancho" value={selectedDraft.widthInput} onChange={(value) => resize(selected, "width", value)} />
                <Field name="height" label="Alto" value={selectedDraft.heightInput} onChange={(value) => resize(selected, "height", value)} />
                <button className="col-span-2 min-h-11 rounded bg-accent px-3 py-2 text-sm font-semibold text-white" type="submit">Guardar layout</button>
              </form>
            </details>}
          </>
        )}
      </div>
    </section>
  );
}

function TableCard({ table, draft, selected, canManage, canvas, onSelect, onMove }: {
  readonly table: DiningTableV1; readonly draft: TableDraft; readonly selected: boolean; readonly canManage: boolean;
  readonly canvas: RefObject<HTMLDivElement | null>; readonly onSelect: () => void; readonly onMove: (position: TablePosition) => void;
}): ReactNode {
  const [step, setStep] = useState({ x: 21, y: 21 });
  const drag = useRef<{ pointerId: number; source: string; clientX: number; clientY: number; start: TablePosition; step: { x: number; y: number } } | null>(null);
  const { width, height } = dimensions(table, draft);
  const { position } = draft;

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return;
    onSelect();
    if (!canManage || canvas.current === null) return;
    event.preventDefault();
    const measured = cellStep(canvas.current);
    setStep(measured);
    drag.current = { pointerId: event.pointerId, source: draft.source, clientX: event.clientX, clientY: event.clientY, start: position, step: measured };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    if (current.source !== draft.source) { endDrag(event); return; }
    onMove({ x: current.start.x + (event.clientX - current.clientX) / current.step.x, y: current.start.y + (event.clientY - current.clientY) / current.step.y });
  }
  function endDrag(event: PointerEvent<HTMLElement>): void {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); return; }
    if (!canManage || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    onSelect();
    onMove(moveTableByKeyboard(position, event.key, event.shiftKey, width, height));
  }

  return (
    <article role="button" tabIndex={0} aria-pressed={selected} aria-label={`Mesa ${table.name}, ${table.capacity} personas. Enter para seleccionar.${canManage ? " Flechas para mover." : ""}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown}
      style={{ gridColumn: `${Math.floor(position.x) + 1} / span ${width}`, gridRow: `${Math.floor(position.y) + 1} / span ${height}`, transform: `translate(${(position.x % 1) * step.x}px, ${(position.y % 1) * step.y}px)` }}
      className={`z-10 flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden border-2 bg-[oklch(95%_0.025_230)] p-0.5 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? "border-accent-hover" : "border-accent"} ${canManage ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer"} ${table.shape === "round" ? "rounded-full" : "rounded-lg"}`}>
      <strong className="w-full truncate text-[11px] leading-tight">{table.name}</strong>
      <span className="text-[10px] leading-tight text-text-muted">{table.capacity} pers.</span>
    </article>
  );
}

function CreateTableForm({ zoneId }: { readonly zoneId: string }): ReactNode {
  return <details className="relative"><summary className="flex min-h-11 cursor-pointer items-center rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-white">Nueva mesa</summary><form action={createDiningTableAction} className="absolute right-0 z-30 mt-2 grid w-[300px] grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 shadow-xl"><input type="hidden" name="zoneId" value={zoneId} /><Field name="name" label="Nombre" defaultValue="Mesa nueva" type="text" /><Field name="capacity" label="Capacidad" defaultValue={4} /><label className="col-span-2 text-[11px] font-medium">Forma<select name="shape" className="mt-1 min-h-11 w-full rounded border border-border p-2"><option value="round">Redonda</option><option value="square">Cuadrada</option><option value="rectangle">Rectangular</option></select></label><Field name="x" label="Columna" defaultValue={0} /><Field name="y" label="Fila" defaultValue={0} /><Field name="width" label="Ancho" defaultValue={4} /><Field name="height" label="Alto" defaultValue={4} /><button className="col-span-2 min-h-11 rounded bg-accent px-3 py-2 text-[12px] font-semibold text-white" type="submit">Crear mesa</button></form></details>;
}
function Field({ name, label, defaultValue, value, onChange, type = "number" }: { readonly name: string; readonly label: string; readonly defaultValue?: number | string; readonly value?: number | string; readonly onChange?: (value: string) => void; readonly type?: string }): ReactNode {
  return <label className="text-[11px] font-medium">{label}<input required name={name} type={type} defaultValue={defaultValue} value={value} onChange={onChange === undefined ? undefined : (event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-border p-1.5" /></label>;
}
