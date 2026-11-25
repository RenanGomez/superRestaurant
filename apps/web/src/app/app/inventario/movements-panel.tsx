"use client";

import type {
  InventoryBalanceV1,
  InventoryItemV1,
  InventoryMovementV1,
  InventoryWarehouseV1,
} from "@super-restaurant/shared-types";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Field } from "../../../components/field-hint";
import {
  INVENTORY_MOVEMENT_ACTIONS,
  INVENTORY_MOVEMENT_ACTION_LABELS,
  ensureInventoryIdempotencyKey,
  formatInventoryMovementQuantity,
  formatInventoryNumber,
  formatInventoryTimestamp,
  inventoryMovementKindLabel,
  inventoryUnitLabel,
  validateInventoryMovementDraft,
  type InventoryMovementAction,
} from "../../../lib/inventory-ui";
import { uiButton } from "../../../lib/ui-classes";
import { InventoryModal } from "./inventory-modal";
import type { InventoryActionResult, InventoryError, InventoryOperation } from "./actions";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

type LoadStatus = "idle" | "loading" | "error" | "ready";

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
  conflict: "El movimiento chocó con otro registro. Revisa los datos e inténtalo de nuevo.",
  denied: "Tu rol ya no permite modificar el inventario.",
  invalid: "Revisa los datos del formulario e inténtalo de nuevo.",
  missing: "El insumo o el almacén ya no existe. Cierra el diálogo y actualiza la lista.",
  timeout: "El servidor tardó demasiado. Reintenta con los mismos datos.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  unavailable: "No se pudo guardar. Revisa la conexión e inténtalo de nuevo.",
};

const DIALOG_TITLES: Readonly<Record<InventoryMovementAction, string>> = {
  adjustment: "Ajustar inventario",
  transfer: "Transferir inventario",
  waste: "Registrar merma",
};

const DIALOG_SUBMIT_LABELS: Readonly<Record<InventoryMovementAction, string>> = {
  adjustment: "Guardar ajuste",
  transfer: "Guardar transferencia",
  waste: "Guardar merma",
};

interface MovementsPanelProps {
  readonly action: (operation: InventoryOperation, input?: unknown) => Promise<InventoryActionResult>;
  readonly canManage: boolean;
  readonly items: readonly InventoryItemV1[];
  readonly warehouses: readonly InventoryWarehouseV1[];
  readonly itemsStatus: LoadStatus;
  readonly warehousesStatus: LoadStatus;
  readonly onRetryCatalog: () => void;
}

export function MovementsPanel({
  action,
  canManage,
  items,
  warehouses,
  itemsStatus,
  warehousesStatus,
  onRetryCatalog,
}: MovementsPanelProps): ReactNode {
  const [movements, setMovements] = useState<readonly InventoryMovementV1[]>();
  const [movementsError, setMovementsError] = useState<InventoryError>();
  const [balances, setBalances] = useState<readonly InventoryBalanceV1[]>();
  const [balancesError, setBalancesError] = useState<InventoryError>();
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [dialog, setDialog] = useState<InventoryMovementAction>();
  const [notice, setNotice] = useState<string>();
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  useEffect(() => {
    let cancelled = false;
    setMovements(undefined);
    setMovementsError(undefined);
    void (async () => {
      try {
        const reply = await action("listMovements", {
          itemId: itemFilter === "" ? undefined : itemFilter,
          warehouseId: warehouseFilter === "" ? undefined : warehouseFilter,
        });
        if (cancelled) return;
        if (reply.ok && "movements" in reply) {
          setMovements(reply.movements);
          return;
        }
        setMovementsError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setMovementsError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, itemFilter, warehouseFilter, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setBalances(undefined);
    setBalancesError(undefined);
    void (async () => {
      try {
        const reply = await action("listBalances", {
          warehouseId: warehouseFilter === "" ? undefined : warehouseFilter,
        });
        if (cancelled) return;
        if (reply.ok && "balances" in reply) {
          setBalances(reply.balances);
          return;
        }
        setBalancesError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setBalancesError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, warehouseFilter, reloadToken]);

  useEffect(() => {
    if (notice === undefined) return undefined;
    const timeout = window.setTimeout(() => setNotice(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const catalogReady = itemsStatus === "ready" && warehousesStatus === "ready"
    && items.length > 0 && warehouses.length > 0;
  const catalogLoading = itemsStatus === "idle" || itemsStatus === "loading"
    || warehousesStatus === "idle" || warehousesStatus === "loading";
  const catalogError = itemsStatus === "error" || warehousesStatus === "error";

  function itemName(itemId: string): string {
    return items.find((item) => item.id === itemId)?.name ?? "Insumo";
  }

  function itemUnit(itemId: string): string {
    const unit = items.find((item) => item.id === itemId)?.unitCode;
    return unit === undefined ? "" : inventoryUnitLabel(unit);
  }

  function warehouseName(warehouseId: string): string {
    return warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? "Almacén";
  }

  function movementSaved(): void {
    setDialog(undefined);
    setNotice("Movimiento registrado.");
    setReloadToken((current) => current + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="font-heading text-lg font-semibold">Movimientos y saldos</h2>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {INVENTORY_MOVEMENT_ACTIONS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={uiButton(kind === "waste" ? "danger" : "primary")}
                disabled={!catalogReady}
                onClick={() => setDialog(kind)}
              >
                {INVENTORY_MOVEMENT_ACTION_LABELS[kind]}
              </button>
            ))}
          </div>
        )}
      </div>

      {notice !== undefined && (
        <p role="status" className="rounded-lg border border-success bg-success-bg px-3 py-2 text-sm">{notice}</p>
      )}

      {catalogLoading && <p role="status" className="text-sm text-text-muted">Cargando insumos y almacenes…</p>}
      {catalogError && (
        <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
          <p>No se pudieron cargar los insumos y almacenes.</p>
          <button type="button" className={`${uiButton()} mt-2`} onClick={onRetryCatalog}>Reintentar</button>
        </div>
      )}
      {catalogReady === false && catalogLoading === false && catalogError === false && (
        <p className="text-sm text-text-muted">
          Necesitas al menos un insumo y un almacén en esta sucursal para registrar movimientos.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field className="grid gap-1 text-sm" hint="Muestra solo los movimientos y saldos de un almacén." label="Almacén">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={warehouseFilter}
              onChange={(event) => setWarehouseFilter(event.target.value)}
            >
              <option value="">Todos los almacenes</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
          )}
        </Field>
        <Field className="grid gap-1 text-sm" hint="Muestra solo los movimientos de un insumo." label="Insumo">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={itemFilter}
              onChange={(event) => setItemFilter(event.target.value)}
            >
              <option value="">Todos los insumos</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <section className="grid gap-2">
        <h3 className="font-heading text-base font-semibold">Movimientos</h3>
        {movements === undefined && movementsError === undefined && (
          <p role="status" className="text-sm text-text-muted">Cargando movimientos…</p>
        )}
        {movementsError !== undefined && (
          <LoadError message={LIST_ERRORS[movementsError]} onRetry={() => setReloadToken((current) => current + 1)} />
        )}
        {movements !== undefined && movements.length === 0 && (
          <p className="text-sm text-text-muted">Sin movimientos todavía.</p>
        )}
        {movements !== undefined && movements.length > 0 && (
          <ul className="grid gap-2">
            {movements.map((movement) => (
              <li key={movement.id} className="rounded-xl border border-border bg-surface p-4">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="break-words text-base">{inventoryMovementKindLabel(movement.kind)}</strong>
                  <span className="text-sm font-semibold">{formatInventoryMovementQuantity(movement.quantityDelta, movement.unitCode)}</span>
                </span>
                <span className="mt-1 block break-words text-sm">
                  {itemName(movement.itemId)} · {warehouseName(movement.warehouseId)}
                </span>
                <span className="block text-sm text-text-muted">
                  {formatInventoryTimestamp(movement.occurredAt, timeZone)}
                </span>
                <span className="mt-1 block break-words text-sm text-text-muted">
                  Motivo: {movement.reason === null ? "sin motivo registrado" : movement.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2">
        <h3 className="font-heading text-base font-semibold">Saldos por almacén</h3>
        {balances === undefined && balancesError === undefined && (
          <p role="status" className="text-sm text-text-muted">Cargando saldos…</p>
        )}
        {balancesError !== undefined && (
          <LoadError message={LIST_ERRORS[balancesError]} onRetry={() => setReloadToken((current) => current + 1)} />
        )}
        {balances !== undefined && balances.length === 0 && (
          <p className="text-sm text-text-muted">Sin saldos registrados todavía.</p>
        )}
        {balances !== undefined && balances.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-80 border-collapse text-sm">
              <caption className="sr-only">Saldo de cada insumo por almacén</caption>
              <thead>
                <tr className="text-left text-text-muted">
                  <th scope="col" className="px-2 py-2 font-semibold">Insumo</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Almacén</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((balance) => (
                  <tr key={`${balance.warehouseId}-${balance.itemId}`} className="border-t border-border">
                    <td className="break-words px-2 py-2">{itemName(balance.itemId)}</td>
                    <td className="break-words px-2 py-2">{warehouseName(balance.warehouseId)}</td>
                    <td className="px-2 py-2 text-right">
                      {formatInventoryNumber(balance.quantity)} {itemUnit(balance.itemId)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog !== undefined && (
        <MovementDialog
          action={action}
          items={items}
          kind={dialog}
          warehouses={warehouses}
          onClose={() => setDialog(undefined)}
          onSaved={movementSaved}
        />
      )}
    </div>
  );
}

function LoadError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }): ReactNode {
  return (
    <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
      <p>{message}</p>
      <button type="button" className={`${uiButton()} mt-2`} onClick={onRetry}>Reintentar</button>
    </div>
  );
}

function MovementDialog({ action, items, kind, warehouses, onClose, onSaved }: {
  readonly action: MovementsPanelProps["action"];
  readonly items: readonly InventoryItemV1[];
  readonly kind: InventoryMovementAction;
  readonly warehouses: readonly InventoryWarehouseV1[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [warehouseId, setWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [idempotencyKey] = useState(() => ensureInventoryIdempotencyKey(undefined, () => crypto.randomUUID()));
  const selectedItem = items.find((item) => item.id === itemId);
  const close = (): void => { if (!saving) onClose(); };

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const validation = validateInventoryMovementDraft({
      itemId,
      kind,
      quantity: String(data.get("quantity") ?? ""),
      reason: String(data.get("reason") ?? ""),
      toWarehouseId,
      warehouseId,
    });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (selectedItem === undefined) {
      setError("Elige el insumo.");
      return;
    }

    setError(undefined);
    setSaving(true);
    void (async () => {
      try {
        const reply = await action("createMovement", {
          idempotencyKey,
          itemId,
          kind: validation.kind,
          quantityDelta: validation.quantityDelta,
          reason: validation.reason,
          toWarehouseId: kind === "transfer" ? toWarehouseId : null,
          unitCode: selectedItem.unitCode,
          warehouseId,
        });
        if (reply.ok && "recorded" in reply) {
          setSaving(false);
          onSaved();
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
    <InventoryModal title={DIALOG_TITLES[kind]} onClose={close}>
      <form onSubmit={submit} className="mt-4 grid gap-3" aria-busy={saving}>
        <Field className="grid gap-1 text-sm" hint="Almacén del que sale o al que entra la cantidad." label="Almacén de origen">
          {(id) => (
            <select id={id} className={inputClass} value={warehouseId} required disabled={saving}
              onChange={(event) => setWarehouseId(event.target.value)}>
              <option value="">Elige un almacén</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
          )}
        </Field>
        <Field className="grid gap-1 text-sm" hint="Insumo que se ajusta, se merma o se transfiere." label="Insumo">
          {(id) => (
            <select id={id} className={inputClass} value={itemId} required disabled={saving}
              onChange={(event) => setItemId(event.target.value)}>
              <option value="">Elige un insumo</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          )}
        </Field>
        <Field className="grid gap-1 text-sm"
          hint="Cantidad entera positiva, en la unidad base del insumo seleccionado." label="Cantidad">
          {(id) => (
            <input id={id} name="quantity" className={inputClass} inputMode="numeric" pattern="[0-9]*"
              required disabled={saving} autoComplete="off" />
          )}
        </Field>
        {selectedItem !== undefined && (
          <p className="text-sm text-text-muted">Unidad: {inventoryUnitLabel(selectedItem.unitCode)}.</p>
        )}
        {kind === "transfer" && (
          <Field className="grid gap-1 text-sm" hint="Almacén que recibe la cantidad; debe ser distinto al de origen." label="Almacén destino">
            {(id) => (
              <select id={id} className={inputClass} value={toWarehouseId} required disabled={saving}
                onChange={(event) => setToWarehouseId(event.target.value)}>
                <option value="">Elige un almacén</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field className="grid gap-1 text-sm" hint="Motivo visible en el historial; al menos 3 caracteres." label="Motivo">
          {(id) => (
            <input id={id} name="reason" className={inputClass} maxLength={500} minLength={3}
              required disabled={saving} autoComplete="off" />
          )}
        </Field>
        {error !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={uiButton()} onClick={close} disabled={saving}>Cancelar</button>
          <button type="submit" className={uiButton("primary")} disabled={saving}>
            {saving ? "Guardando…" : DIALOG_SUBMIT_LABELS[kind]}
          </button>
        </div>
      </form>
    </InventoryModal>
  );
}
