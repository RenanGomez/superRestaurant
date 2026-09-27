"use client";

import type { DiningLayoutV1, DiningTableV1 } from "@super-restaurant/shared-types";
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { clampTablePosition, savedTablePosition, type TablePosition } from "../../lib/table-position";
import { createDiningTableAction, updateDiningTableLayoutAction } from "./actions";

type Zone = DiningLayoutV1["zones"][number];

export function DiningZone({ zone, canManage }: { readonly zone: Zone; readonly canManage: boolean }): ReactNode {
  const canvas = useRef<HTMLDivElement>(null);

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.05)]">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="break-words font-heading text-[16px] font-semibold">{zone.name}</h2><p className="text-[12px] text-text-muted">{zone.tables.length} mesa{zone.tables.length === 1 ? "" : "s"}</p></div>
        {canManage && <CreateTableForm zoneId={zone.zoneId} />}
      </div>
      <div className="h-[360px] overflow-auto rounded-xl border border-border" aria-label={`Plano de ${zone.name}`}>
        <div ref={canvas} className="grid h-[2100px] min-w-[520px] grid-cols-[repeat(24,minmax(20px,1fr))] grid-rows-[repeat(100,20px)] gap-px bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:calc(100%/24)_21px] p-2">
          {zone.tables.map((table) => <TableCard key={table.tableId} table={table} canManage={canManage} canvas={canvas} />)}
        </div>
      </div>
      {canManage && <p className="mt-2 text-xs text-text-muted">Arrastra una mesa o usa las flechas (8 px por pulsación). Después, guarda su layout.</p>}
    </section>
  );
}

function cellStep(canvas: HTMLDivElement): { x: number; y: number } {
  const style = getComputedStyle(canvas);
  return {
    x: Number.parseFloat(style.gridTemplateColumns) + Number.parseFloat(style.columnGap),
    y: Number.parseFloat(style.gridTemplateRows) + Number.parseFloat(style.rowGap),
  };
}

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

function TableCard({ table, canManage, canvas }: { readonly table: DiningTableV1; readonly canManage: boolean; readonly canvas: React.RefObject<HTMLDivElement | null> }): ReactNode {
  const [storedDraft, setDraft] = useState<TableDraft>(() => draftFrom(table));
  const incoming = draftFrom(table);
  const draft = storedDraft.source === incoming.source ? storedDraft : draftFrom(table, storedDraft.dirty);
  if (draft !== storedDraft) setDraft(draft);
  const { position } = draft;
  const width = effectiveDimension(draft.widthInput, table.layout.width);
  const height = effectiveDimension(draft.heightInput, table.layout.height);
  const [step, setStep] = useState({ x: 21, y: 21 });
  const drag = useRef<{ pointerId: number; source: string; clientX: number; clientY: number; start: TablePosition; step: { x: number; y: number } } | null>(null);
  const round = table.shape === "round";
  const saved = savedTablePosition(position, width, height);
  const update = (next: TablePosition): void => setDraft({ ...draft, position: clampTablePosition(next, width, height), dirty: true, serverUpdated: false });

  function updateDimension(axis: "width" | "height", value: string): void {
    const widthInput = axis === "width" ? value : draft.widthInput;
    const heightInput = axis === "height" ? value : draft.heightInput;
    const nextWidth = effectiveDimension(widthInput, width);
    const nextHeight = effectiveDimension(heightInput, height);
    setDraft({ ...draft, widthInput, heightInput, position: clampTablePosition(position, nextWidth, nextHeight), dirty: true, serverUpdated: false });
  }

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (!canManage || event.button !== 0 || !(event.target instanceof Element) || event.target.closest("details")) return;
    const surface = canvas.current;
    if (surface === null) return;
    event.preventDefault();
    const measured = cellStep(surface);
    setStep(measured);
    drag.current = { pointerId: event.pointerId, source: draft.source, clientX: event.clientX, clientY: event.clientY, start: position, step: measured };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    if (current.source !== draft.source) {
      endDrag(event);
      return;
    }
    update({ x: current.start.x + (event.clientX - current.clientX) / current.step.x, y: current.start.y + (event.clientY - current.clientY) / current.step.y });
  }

  function endDrag(event: PointerEvent<HTMLElement>): void {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!canManage || event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const surface = canvas.current;
    if (surface === null) return;
    const measured = cellStep(surface);
    setStep(measured);
    const directions: Record<string, TablePosition> = {
      ArrowLeft: { x: -8 / measured.x, y: 0 }, ArrowRight: { x: 8 / measured.x, y: 0 },
      ArrowUp: { x: 0, y: -8 / measured.y }, ArrowDown: { x: 0, y: 8 / measured.y },
    };
    const delta = directions[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    update({ x: position.x + delta.x, y: position.y + delta.y });
  }

  return (
    <article tabIndex={0} aria-label={`Mesa ${table.name}. ${canManage ? "Arrastra o usa las flechas para moverla; después guarda el layout." : ""}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown}
      style={{ gridColumn: `${Math.floor(position.x) + 1} / span ${width}`, gridRow: `${Math.floor(position.y) + 1} / span ${height}`, transform: `translate(${(position.x % 1) * step.x}px, ${(position.y % 1) * step.y}px)` }}
      className={`relative z-10 flex min-h-11 min-w-11 flex-col items-center justify-center border-2 border-accent bg-[oklch(95%_0.025_230)] p-1 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${canManage ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${round ? "rounded-full" : "rounded-lg"}`}>
      {draft.serverUpdated && <span role="status" className="absolute left-0 top-full z-20 w-44 rounded border border-accent bg-surface px-2 py-1 text-left text-[11px] text-text shadow-lg">Mesa actualizada en servidor. Se descartó tu cambio local.</span>}
      <strong className="truncate text-[12px]">{table.name}</strong><span className="text-[10px] text-text-muted">{table.capacity} personas · v{table.version}</span>
      {canManage && <details className="mt-1 text-[10px]"><summary className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center font-semibold text-accent">Editar</summary>
        <form action={updateDiningTableLayoutAction} className="mt-1 grid w-[180px] grid-cols-2 gap-1 rounded-lg bg-surface p-2 shadow-lg">
          <input type="hidden" name="tableId" value={table.tableId} /><input type="hidden" name="expectedVersion" value={table.version} />
          <Field name="x" label="Columna" value={saved.x} onChange={(value) => update({ ...position, x: Number(value) })} />
          <Field name="y" label="Fila" value={saved.y} onChange={(value) => update({ ...position, y: Number(value) })} />
          <Field name="width" label="Ancho" value={draft.widthInput} onChange={(value) => updateDimension("width", value)} />
          <Field name="height" label="Alto" value={draft.heightInput} onChange={(value) => updateDimension("height", value)} />
          <button className="col-span-2 min-h-11 rounded bg-accent px-2 py-1 text-white" type="submit">Guardar layout</button>
        </form>
      </details>}
    </article>
  );
}

function CreateTableForm({ zoneId }: { readonly zoneId: string }): ReactNode {
  return <details className="relative"><summary className="flex min-h-11 cursor-pointer items-center rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-white">Nueva mesa</summary><form action={createDiningTableAction} className="absolute right-0 z-30 mt-2 grid w-[300px] grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 shadow-xl"><input type="hidden" name="zoneId" value={zoneId} /><Field name="name" label="Nombre" defaultValue="Mesa nueva" type="text" /><Field name="capacity" label="Capacidad" defaultValue={4} /><label className="col-span-2 text-[11px] font-medium">Forma<select name="shape" className="mt-1 min-h-11 w-full rounded border border-border p-2"><option value="round">Redonda</option><option value="square">Cuadrada</option><option value="rectangle">Rectangular</option></select></label><Field name="x" label="Columna" defaultValue={0} /><Field name="y" label="Fila" defaultValue={0} /><Field name="width" label="Ancho" defaultValue={4} /><Field name="height" label="Alto" defaultValue={4} /><button className="col-span-2 min-h-11 rounded bg-accent px-3 py-2 text-[12px] font-semibold text-white" type="submit">Crear mesa</button></form></details>;
}

function Field({ name, label, defaultValue, value, onChange, type = "number" }: { readonly name: string; readonly label: string; readonly defaultValue?: number | string; readonly value?: number | string; readonly onChange?: (value: string) => void; readonly type?: string }): ReactNode {
  return <label className="text-[11px] font-medium">{label}<input required name={name} type={type} defaultValue={defaultValue} value={value} onChange={onChange === undefined ? undefined : (event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded border border-border p-1.5" /></label>;
}
