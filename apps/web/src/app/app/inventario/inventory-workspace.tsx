"use client";

import type { BranchScope, InventoryItemV1, InventoryWarehouseV1 } from "@super-restaurant/shared-types";
import { INVENTORY_UNITS } from "@super-restaurant/shared-types";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { Field, FieldHint } from "../../../components/field-hint";
import {
  INVENTORY_TABS,
  INVENTORY_TAB_LABELS,
  filterInventoryItems,
  formatInventoryNumber,
  inventoryTabHref,
  inventoryUnitLabel,
  parseInventoryTab,
  parseInventoryWholeNumber,
  warehouseDefaultLabel,
  type InventoryTab,
} from "../../../lib/inventory-ui";
import { uiButton } from "../../../lib/ui-classes";
import { AlertsPanel } from "./alerts-panel";
import { InventoryModal } from "./inventory-modal";
import { MovementsPanel } from "./movements-panel";
import { PurchasingPanel } from "./purchasing-panel";
import { RecipesPanel } from "./recipes-panel";
import { useInventoryDevice } from "./use-inventory-device";
import type { InventoryActionResult, InventoryError, InventoryOperation } from "./actions";

const panelClass = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const checkboxClass = "h-5 w-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const LIST_ERRORS: Readonly<Record<InventoryError, string>> = {
  conflict: "El inventario cambió en otro dispositivo. Actualiza la lista.",
  denied: "Tu sesión o rol ya no permite consultar el inventario.",
  invalid: "No se pudo leer la solicitud. Actualiza la página e inténtalo de nuevo.",
  missing: "El registro ya no existe. Actualiza la lista.",
  timeout: "El servidor tardó demasiado. Reintenta.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  unavailable: "No se pudo conectar con el inventario. Revisa la conexión e inténtalo de nuevo.",
};

const SAVE_ERRORS: Readonly<Record<InventoryError, string>> = {
  conflict: "La clave interna ya está en uso o el registro cambió en otro dispositivo. Revisa los datos.",
  denied: "Tu rol ya no permite modificar el inventario.",
  invalid: "Revisa los datos del formulario e inténtalo de nuevo.",
  missing: "El registro ya no existe. Cierra el diálogo y actualiza la lista.",
  timeout: "El servidor tardó demasiado. Reintenta.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  unavailable: "No se pudo guardar. Revisa la conexión e inténtalo de nuevo.",
};

type LoadState<T> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: InventoryError }
  | { readonly status: "ready"; readonly value: T };

type DialogState =
  | { readonly kind: "item"; readonly item?: InventoryItemV1 }
  | { readonly kind: "warehouse"; readonly warehouse?: InventoryWarehouseV1 };

interface InventoryWorkspaceProps {
  readonly action: (operation: InventoryOperation, input?: unknown) => Promise<InventoryActionResult>;
  readonly actorId: string;
  readonly canManage: boolean;
  readonly initialTab: InventoryTab;
  readonly scope: BranchScope;
}

export function InventoryWorkspace({ action, actorId, canManage, initialTab, scope }: InventoryWorkspaceProps): ReactNode {
  const device = useInventoryDevice(actorId, scope);
  const [activeTab, setActiveTab] = useState<InventoryTab>(initialTab);
  const [items, setItems] = useState<LoadState<readonly InventoryItemV1[]>>({ status: "idle" });
  const [warehouses, setWarehouses] = useState<LoadState<readonly InventoryWarehouseV1[]>>({ status: "idle" });
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>();
  const [notice, setNotice] = useState<string>();
  const tabRefs = useRef<Partial<Record<InventoryTab, HTMLButtonElement | null>>>({});
  const insumosTabId = useId();
  const recetasTabId = useId();
  const almacenesTabId = useId();
  const movimientosTabId = useId();
  const comprasTabId = useId();
  const alertasTabId = useId();
  const insumosPanelId = useId();
  const recetasPanelId = useId();
  const almacenesPanelId = useId();
  const movimientosPanelId = useId();
  const comprasPanelId = useId();
  const alertasPanelId = useId();
  const tabButtonIds: Readonly<Record<InventoryTab, string>> = {
    alertas: alertasTabId,
    almacenes: almacenesTabId,
    compras: comprasTabId,
    insumos: insumosTabId,
    movimientos: movimientosTabId,
    recetas: recetasTabId,
  };
  const tabPanelIds: Readonly<Record<InventoryTab, string>> = {
    alertas: alertasPanelId,
    almacenes: almacenesPanelId,
    compras: comprasPanelId,
    insumos: insumosPanelId,
    movimientos: movimientosPanelId,
    recetas: recetasPanelId,
  };

  async function loadItems(): Promise<void> {
    setItems({ status: "loading" });
    try {
      const reply = await action("listItems");
      if (reply.ok && "items" in reply) {
        setItems({ status: "ready", value: reply.items });
        return;
      }
      setItems({ error: reply.ok ? "unavailable" : reply.error, status: "error" });
    } catch {
      setItems({ error: "unavailable", status: "error" });
    }
  }

  async function loadWarehouses(): Promise<void> {
    setWarehouses({ status: "loading" });
    try {
      const reply = await action("listWarehouses");
      if (reply.ok && "warehouses" in reply) {
        setWarehouses({ status: "ready", value: reply.warehouses });
        return;
      }
      setWarehouses({ error: reply.ok ? "unavailable" : reply.error, status: "error" });
    } catch {
      setWarehouses({ error: "unavailable", status: "error" });
    }
  }

  useEffect(() => {
    const urlTab = parseInventoryTab(new URL(window.location.href).searchParams.get("tab"));
    if (urlTab !== undefined && urlTab !== initialTab) setActiveTab(urlTab);
    if (urlTab === undefined) {
      window.history.replaceState(null, "", inventoryTabHref(initialTab, window.location.search));
    }
    const onPopState = (): void => {
      const nextTab = parseInventoryTab(new URL(window.location.href).searchParams.get("tab"));
      if (nextTab !== undefined) setActiveTab(nextTab);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialTab]);

  useEffect(() => {
    if ((activeTab === "insumos" || activeTab === "movimientos" || activeTab === "recetas"
      || activeTab === "compras" || activeTab === "alertas") && items.status === "idle") void loadItems();
  }, [activeTab, items.status]);

  useEffect(() => {
    if ((activeTab === "almacenes" || activeTab === "movimientos" || activeTab === "compras"
      || activeTab === "alertas") && warehouses.status === "idle") {
      void loadWarehouses();
    }
  }, [activeTab, warehouses.status]);

  useEffect(() => {
    if (notice === undefined) return undefined;
    const timeout = window.setTimeout(() => setNotice(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function selectTab(tab: InventoryTab): void {
    setActiveTab(tab);
    window.history.replaceState(null, "", inventoryTabHref(tab, window.location.search));
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: InventoryTab): void {
    const currentIndex = INVENTORY_TABS.indexOf(currentTab);
    if (currentIndex === -1) return;
    let targetIndex = -1;
    if (event.key === "ArrowRight") targetIndex = (currentIndex + 1) % INVENTORY_TABS.length;
    else if (event.key === "ArrowLeft") targetIndex = (currentIndex - 1 + INVENTORY_TABS.length) % INVENTORY_TABS.length;
    else if (event.key === "Home") targetIndex = 0;
    else if (event.key === "End") targetIndex = INVENTORY_TABS.length - 1;
    if (targetIndex === -1) return;
    event.preventDefault();
    const nextTab = INVENTORY_TABS[targetIndex];
    if (nextTab === undefined) return;
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  function itemSaved(saved: InventoryItemV1): void {
    setItems((current) => {
      if (current.status !== "ready") return { status: "ready", value: [saved] };
      const exists = current.value.some((item) => item.id === saved.id);
      return {
        status: "ready",
        value: exists ? current.value.map((item) => item.id === saved.id ? saved : item) : [...current.value, saved],
      };
    });
    setDialog(undefined);
    setNotice("Insumo guardado.");
  }

  function warehouseSaved(): void {
    setDialog(undefined);
    setNotice("Almacén guardado.");
    void loadWarehouses();
  }

  const filteredItems = items.status === "ready" ? filterInventoryItems(items.value, query) : [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="tablist" aria-label="Secciones de inventario" className="flex flex-wrap gap-2">
        {INVENTORY_TABS.map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(element) => { tabRefs.current[tab] = element; }}
              type="button"
              role="tab"
              id={tabButtonIds[tab]}
              aria-selected={selected}
              aria-controls={tabPanelIds[tab]}
              tabIndex={selected ? 0 : -1}
              className={uiButton(selected ? "selected" : "secondary", "rounded-full")}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) => onTabKeyDown(event, tab)}
            >
              {INVENTORY_TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      {notice !== undefined && (
        <p role="status" className="rounded-lg border border-success bg-success-bg px-3 py-2 text-sm">{notice}</p>
      )}

      {activeTab === "insumos" && (
        <section role="tabpanel" id={insumosPanelId} aria-labelledby={insumosTabId} tabIndex={0} className={panelClass}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1">
              <Field
                className="grid gap-1 text-sm"
                hint="Escribe parte del nombre o de la clave interna para filtrar la lista."
                label="Buscar insumo"
              >
                {(id) => (
                  <input
                    id={id}
                    type="search"
                    className={inputClass}
                    placeholder="Nombre o clave interna"
                    autoComplete="off"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                )}
              </Field>
            </div>
            {canManage && (
              <button type="button" className={uiButton("primary", "w-full sm:w-auto")}
                onClick={() => setDialog({ kind: "item" })}>
                Nuevo insumo
              </button>
            )}
          </div>

          {items.status === "loading" && <p role="status" className="mt-4 text-sm text-text-muted">Cargando insumos…</p>}
          {items.status === "error" && (
            <LoadError message={LIST_ERRORS[items.error]} onRetry={() => void loadItems()} />
          )}
          {items.status === "ready" && items.value.length === 0 && (
            <p className="mt-4 text-sm text-text-muted">
              Aún no hay insumos registrados en esta sucursal.{canManage ? " Crea el primero." : ""}
            </p>
          )}
          {items.status === "ready" && items.value.length > 0 && filteredItems.length === 0 && (
            <p className="mt-4 text-sm text-text-muted">No hay insumos que coincidan con «{query.trim()}».</p>
          )}
          {items.status === "ready" && filteredItems.length > 0 && (
            <ul className="mt-4 grid gap-2">
              {filteredItems.map((item) => (
                <li key={item.id}>
                  <ItemRow item={item} canManage={canManage} onEdit={() => setDialog({ item, kind: "item" })} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === "recetas" && (
        <section role="tabpanel" id={recetasPanelId} aria-labelledby={recetasTabId} tabIndex={0} className={panelClass}>
          <RecipesPanel
            action={action}
            canManage={canManage}
            items={items.status === "ready" ? items.value : []}
            itemsStatus={items.status}
            onRetryCatalog={() => { void loadItems(); }}
          />
        </section>
      )}

      {activeTab === "almacenes" && (
        <section role="tabpanel" id={almacenesPanelId} aria-labelledby={almacenesTabId} tabIndex={0} className={panelClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold">Almacenes de la sucursal</h2>
            {canManage && (
              <button type="button" className={uiButton("primary", "w-full sm:w-auto")}
                onClick={() => setDialog({ kind: "warehouse" })}>
                Nuevo almacén
              </button>
            )}
          </div>

          {warehouses.status === "loading" && <p role="status" className="mt-4 text-sm text-text-muted">Cargando almacenes…</p>}
          {warehouses.status === "error" && (
            <LoadError message={LIST_ERRORS[warehouses.error]} onRetry={() => void loadWarehouses()} />
          )}
          {warehouses.status === "ready" && warehouses.value.length === 0 && (
            <p className="mt-4 text-sm text-text-muted">
              Aún no hay almacenes registrados en esta sucursal.{canManage ? " Crea el primero." : ""}
            </p>
          )}
          {warehouses.status === "ready" && warehouses.value.length > 0 && (
            <ul className="mt-4 grid gap-2">
              {warehouses.value.map((warehouse) => (
                <li key={warehouse.id}>
                  <WarehouseRow warehouse={warehouse} canManage={canManage}
                    onEdit={() => setDialog({ kind: "warehouse", warehouse })} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === "movimientos" && (
        <section role="tabpanel" id={movimientosPanelId} aria-labelledby={movimientosTabId} tabIndex={0} className={panelClass}>
          <MovementsPanel
            action={action}
            canManage={canManage}
            deviceId={device.deviceId}
            deviceReady={device.ready}
            items={items.status === "ready" ? items.value : []}
            warehouses={warehouses.status === "ready" ? warehouses.value : []}
            itemsStatus={items.status}
            warehousesStatus={warehouses.status}
            onRetryCatalog={() => { void loadItems(); void loadWarehouses(); }}
          />
        </section>
      )}

      {activeTab === "compras" && (
        <section role="tabpanel" id={comprasPanelId} aria-labelledby={comprasTabId} tabIndex={0} className={panelClass}>
          <PurchasingPanel
            action={action}
            canManage={canManage}
            deviceId={device.deviceId}
            deviceReady={device.ready}
            items={items.status === "ready" ? items.value : []}
            itemsStatus={items.status}
            warehouses={warehouses.status === "ready" ? warehouses.value : []}
            warehousesStatus={warehouses.status}
            onRetryCatalog={() => { void loadItems(); void loadWarehouses(); }}
          />
        </section>
      )}

      {activeTab === "alertas" && (
        <section role="tabpanel" id={alertasPanelId} aria-labelledby={alertasTabId} tabIndex={0} className={panelClass}>
          <AlertsPanel
            action={action}
            items={items.status === "ready" ? items.value : []}
            itemsStatus={items.status}
            warehouses={warehouses.status === "ready" ? warehouses.value : []}
            warehousesStatus={warehouses.status}
            onRetryCatalog={() => { void loadItems(); void loadWarehouses(); }}
          />
        </section>
      )}

      {dialog?.kind === "item" && (
        <ItemDialog item={dialog.item} action={action} onClose={() => setDialog(undefined)} onSaved={itemSaved} />
      )}
      {dialog?.kind === "warehouse" && (
        <WarehouseDialog warehouse={dialog.warehouse} action={action}
          onClose={() => setDialog(undefined)} onSaved={warehouseSaved} />
      )}
    </div>
  );
}

function ItemRow({ item, canManage, onEdit }: {
  readonly item: InventoryItemV1;
  readonly canManage: boolean;
  readonly onEdit: () => void;
}): ReactNode {
  if (!canManage) {
    return <div className="rounded-xl border border-border bg-surface p-4"><ItemSummary item={item} /></div>;
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex min-h-11 w-full flex-col rounded-xl border border-border bg-surface p-4 text-left hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <ItemSummary item={item} />
      <span className="mt-2 text-xs font-semibold text-accent">Editar insumo</span>
    </button>
  );
}

function ItemSummary({ item }: { readonly item: InventoryItemV1 }): ReactNode {
  const unit = inventoryUnitLabel(item.unitCode);
  return (
    <>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <strong className="break-words text-base">{item.name}</strong>
        <StatusBadge active={item.active} />
      </span>
      {item.sku !== null && <span className="block break-words text-sm text-text-muted">Clave interna: {item.sku}</span>}
      <span className="mt-1 block text-sm">
        Unidad: {unit} · Factor de compra: {formatInventoryNumber(item.purchaseUnitFactor)}
      </span>
      <span className="block text-sm text-text-muted">Mínimo: {formatInventoryNumber(item.minQuantity)} {unit}</span>
    </>
  );
}

function WarehouseRow({ warehouse, canManage, onEdit }: {
  readonly warehouse: InventoryWarehouseV1;
  readonly canManage: boolean;
  readonly onEdit: () => void;
}): ReactNode {
  const defaultLabel = warehouseDefaultLabel(warehouse.isDefault);
  const content = (
    <>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <strong className="break-words text-base">{warehouse.name}</strong>
        <span className="flex flex-wrap items-center gap-2">
          {defaultLabel !== null && (
            <span className="inline-flex min-h-6 items-center rounded-full border border-accent px-2 text-xs font-semibold text-accent">
              {defaultLabel}
            </span>
          )}
          <StatusBadge active={warehouse.active} />
        </span>
      </span>
      {canManage && <span className="mt-2 text-xs font-semibold text-accent">Editar almacén</span>}
    </>
  );
  if (!canManage) {
    return <div className="rounded-xl border border-border bg-surface p-4">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex min-h-11 w-full flex-col rounded-xl border border-border bg-surface p-4 text-left hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {content}
    </button>
  );
}

function StatusBadge({ active }: { readonly active: boolean }): ReactNode {
  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-xs font-semibold ${
      active ? "border-success text-text" : "border-border text-text-muted"
    }`}>
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

function LoadError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }): ReactNode {
  return (
    <div role="alert" className="mt-4 rounded-lg border border-error bg-error-bg p-3 text-sm">
      <p>{message}</p>
      <button type="button" className={`${uiButton()} mt-2`} onClick={onRetry}>Reintentar</button>
    </div>
  );
}

function ItemDialog({ action, item, onClose, onSaved }: {
  readonly action: InventoryWorkspaceProps["action"];
  readonly item?: InventoryItemV1 | undefined;
  readonly onClose: () => void;
  readonly onSaved: (item: InventoryItemV1) => void;
}): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const editing = item !== undefined;
  const close = (): void => { if (!saving) onClose(); };

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const sku = String(data.get("sku") ?? "").trim();
    const factor = parseInventoryWholeNumber(String(data.get("purchaseUnitFactor") ?? ""), 1);
    const minimum = parseInventoryWholeNumber(String(data.get("minQuantity") ?? ""), 0);
    const active = data.get("active") === "on";
    const unitValue = String(data.get("unitCode") ?? "");
    if (name.length === 0) { setError("Escribe el nombre del insumo."); return; }
    if (name.length > 160) { setError("El nombre no puede pasar de 160 caracteres."); return; }
    if (sku.length > 100) { setError("La clave interna no puede pasar de 100 caracteres."); return; }
    if (factor === undefined) { setError("El factor de compra debe ser un entero mayor o igual a 1."); return; }
    if (minimum === undefined) { setError("El mínimo debe ser un entero mayor o igual a 0."); return; }
    if (!editing && !(INVENTORY_UNITS as readonly string[]).includes(unitValue)) { setError("Elige la unidad base del insumo."); return; }

    setError(undefined);
    setSaving(true);
    const payload = editing
      ? { active, id: item.id, minQuantity: minimum, name, purchaseUnitFactor: factor, sku: sku === "" ? null : sku }
      : { active, minQuantity: minimum, name, purchaseUnitFactor: factor, sku: sku === "" ? null : sku, unitCode: unitValue };
    void (async () => {
      try {
        const reply = editing ? await action("updateItem", payload) : await action("createItem", payload);
        if (reply.ok && "item" in reply) {
          setSaving(false);
          onSaved(reply.item);
          return;
        }
        setError(reply.ok ? SAVE_ERRORS.unavailable : SAVE_ERRORS[reply.error]);
      } catch {
        setError(SAVE_ERRORS.unavailable);
      }
      setSaving(false);
    })();
  }

  return (
    <InventoryModal title={editing ? "Editar insumo" : "Nuevo insumo"} onClose={close}>
      <form onSubmit={submit} className="mt-4 grid gap-3" aria-busy={saving}>
        <Field className="grid gap-1 text-sm" hint="Nombre con el que el equipo reconoce el insumo." label="Nombre">
          {(id) => <input id={id} name="name" className={inputClass} defaultValue={item?.name ?? ""} maxLength={160}
            required autoComplete="off" disabled={saving} />}
        </Field>
        <Field className="grid gap-1 text-sm" hint="Clave del proveedor o interna. Puede quedar vacía." label="Clave interna (opcional)">
          {(id) => <input id={id} name="sku" className={inputClass} defaultValue={item?.sku ?? ""} maxLength={100}
            autoComplete="off" disabled={saving} />}
        </Field>
        {editing ? (
          <p className="text-sm text-text-muted">
            Unidad: {inventoryUnitLabel(item.unitCode)}. No se puede cambiar después de crear el insumo.
          </p>
        ) : (
          <Field className="grid gap-1 text-sm" hint="Unidad base con la que se descuenta el inventario." label="Unidad base">
            {(id) => (
              <select id={id} name="unitCode" className={inputClass} defaultValue="g" disabled={saving}>
                {INVENTORY_UNITS.map((unit) => (
                  <option key={unit} value={unit}>{inventoryUnitLabel(unit)}</option>
                ))}
              </select>
            )}
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field className="grid gap-1 text-sm"
            hint="Cuántas unidades base trae una unidad de compra. Por ejemplo, 1000 si compras por kilo y usas gramos."
            label="Factor de compra">
            {(id) => <input id={id} name="purchaseUnitFactor" className={inputClass} inputMode="numeric" pattern="[0-9]*"
              defaultValue={item === undefined ? "1" : String(item.purchaseUnitFactor)} required disabled={saving} />}
          </Field>
          <Field className="grid gap-1 text-sm"
            hint="Cantidad mínima antes de avisar que hace falta comprar." label="Mínimo">
            {(id) => <input id={id} name="minQuantity" className={inputClass} inputMode="numeric" pattern="[0-9]*"
              defaultValue={item === undefined ? "0" : String(item.minQuantity)} required disabled={saving} />}
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="active" className={checkboxClass} defaultChecked={item?.active ?? true} disabled={saving} />
          <span>Insumo activo</span>
        </label>
        {error !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={uiButton()} onClick={close} disabled={saving}>Cancelar</button>
          <button type="submit" className={uiButton("primary")} disabled={saving}>
            {saving ? "Guardando…" : editing ? "Guardar insumo" : "Crear insumo"}
          </button>
        </div>
      </form>
    </InventoryModal>
  );
}

function WarehouseDialog({ action, warehouse, onClose, onSaved }: {
  readonly action: InventoryWorkspaceProps["action"];
  readonly warehouse?: InventoryWarehouseV1 | undefined;
  readonly onClose: () => void;
  readonly onSaved: (warehouse: InventoryWarehouseV1) => void;
}): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const defaultId = useId();
  const editing = warehouse !== undefined;
  const close = (): void => { if (!saving) onClose(); };

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const active = data.get("active") === "on";
    const isDefault = data.get("isDefault") === "on";
    if (name.length === 0) { setError("Escribe el nombre del almacén."); return; }
    if (name.length > 160) { setError("El nombre no puede pasar de 160 caracteres."); return; }
    if (isDefault && !active) {
      setError("Un almacén inactivo no puede ser el predeterminado para consumo por venta.");
      return;
    }

    setError(undefined);
    setSaving(true);
    const payload = editing ? { active, id: warehouse.id, isDefault, name } : { active, isDefault, name };
    void (async () => {
      try {
        const reply = editing ? await action("updateWarehouse", payload) : await action("createWarehouse", payload);
        if (reply.ok && "warehouse" in reply) {
          setSaving(false);
          onSaved(reply.warehouse);
          return;
        }
        setError(reply.ok ? SAVE_ERRORS.unavailable : SAVE_ERRORS[reply.error]);
      } catch {
        setError(SAVE_ERRORS.unavailable);
      }
      setSaving(false);
    })();
  }

  return (
    <InventoryModal title={editing ? "Editar almacén" : "Nuevo almacén"} onClose={close}>
      <form onSubmit={submit} className="mt-4 grid gap-3" aria-busy={saving}>
        <Field className="grid gap-1 text-sm" hint="Nombre del almacén dentro de esta sucursal, por ejemplo Bodega o Cámara fría." label="Nombre">
          {(id) => <input id={id} name="name" className={inputClass} defaultValue={warehouse?.name ?? ""} maxLength={160}
            required autoComplete="off" disabled={saving} />}
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="active" className={checkboxClass} defaultChecked={warehouse?.active ?? true} disabled={saving} />
          <span>Almacén activo</span>
        </label>
        <div className="flex min-h-11 items-center gap-2 text-sm">
          <input id={defaultId} type="checkbox" name="isDefault" className={checkboxClass}
            defaultChecked={warehouse?.isDefault ?? false} disabled={saving} />
          <label htmlFor={defaultId} className="flex min-h-11 flex-1 items-center">
            Almacén predeterminado para consumo por venta
          </label>
          <FieldHint
            label="Almacén predeterminado para consumo por venta"
            text="Solo puede haber uno por sucursal. Al marcarlo, el almacén anterior deja de serlo y el consumo por venta descuenta de este."
          />
        </div>
        {error !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={uiButton()} onClick={close} disabled={saving}>Cancelar</button>
          <button type="submit" className={uiButton("primary")} disabled={saving}>
            {saving ? "Guardando…" : editing ? "Guardar almacén" : "Crear almacén"}
          </button>
        </div>
      </form>
    </InventoryModal>
  );
}
