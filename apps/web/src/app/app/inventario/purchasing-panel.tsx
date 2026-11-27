"use client";

import type { InventoryItemV1, InventoryWarehouseV1 } from "@super-restaurant/shared-types";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Field } from "../../../components/field-hint";
import type { InventoryDeviceStatus } from "./use-inventory-device";
import {
  ensureInventoryIdempotencyKey,
  formatInventoryNumber,
  formatInventoryTimestamp,
  formatMinorUnits,
  inventoryUnitLabel,
  purchaseOrderStatusLabel,
  validatePurchaseOrderDraft,
  validateSupplierDraft,
  type PurchaseOrderLineDraft,
} from "../../../lib/inventory-ui";
import { uiButton, uiChip } from "../../../lib/ui-classes";
import { InventoryModal } from "./inventory-modal";
import type {
  InventoryActionResult,
  InventoryError,
  InventoryOperation,
  PurchaseOrderCreatedV1,
  PurchaseOrderDetailV1,
  PurchaseOrderLineDetailV1,
  PurchaseOrderReceiptMovementV1,
  PurchaseOrderSummaryV1,
  SupplierV1,
} from "./actions";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const checkboxClass = "h-5 w-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type LoadStatus = "idle" | "loading" | "error" | "ready";

const LIST_ERRORS: Readonly<Record<InventoryError, string>> = {
  conflict: "Las compras cambiaron en otro dispositivo. Actualiza la lista.",
  denied: "Tu sesión o rol ya no permite consultar las compras.",
  invalid: "No se pudo leer la solicitud. Actualiza la página e inténtalo de nuevo.",
  missing: "El registro ya no existe. Actualiza la lista.",
  timeout: "El servidor tardó demasiado. Reintenta.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  unavailable: "No se pudo conectar con las compras. Revisa la conexión e inténtalo de nuevo.",
};

const SAVE_ERRORS: Readonly<Record<InventoryError, string>> = {
  conflict: "La orden chocó con otro registro. Revisa los datos o crea una orden nueva.",
  denied: "Tu rol ya no permite modificar las compras.",
  invalid: "Revisa los datos del formulario e inténtalo de nuevo.",
  missing: "El registro ya no existe. Cierra el diálogo y actualiza la lista.",
  timeout: "El servidor tardó demasiado. Reintenta con los mismos datos.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  unavailable: "No se pudo guardar. Revisa la conexión e inténtalo de nuevo.",
};

const STATUS_FILTERS = [
  { label: "Todas", value: "" },
  { label: "Borrador", value: "draft" },
  { label: "Enviada", value: "sent" },
  { label: "Recibida", value: "received" },
  { label: "Cancelada", value: "cancelled" },
] as const;

type DialogState =
  | { readonly kind: "supplier"; readonly supplier?: SupplierV1 }
  | { readonly kind: "order" }
  | { readonly kind: "receive"; readonly order: PurchaseOrderDetailV1 };

interface PurchasingPanelProps {
  readonly action: (operation: InventoryOperation, input?: unknown) => Promise<InventoryActionResult>;
  readonly canManage: boolean;
  readonly canRead: boolean;
  /** Derived per-actor id; the API rejects receipts from a device it does not know. */
  readonly deviceId: string;
  /** True only after the device is registered for this actor and branch. */
  readonly deviceStatus: InventoryDeviceStatus;
  readonly items: readonly InventoryItemV1[];
  readonly itemsStatus: LoadStatus;
  readonly warehouses: readonly InventoryWarehouseV1[];
  readonly warehousesStatus: LoadStatus;
  readonly onRetryCatalog: () => void;
}

export function PurchasingPanel({
  action,
  canManage,
  canRead,
  deviceId,
  deviceStatus,
  items,
  itemsStatus,
  warehouses,
  warehousesStatus,
  onRetryCatalog,
}: PurchasingPanelProps): ReactNode {
  const [suppliers, setSuppliers] = useState<readonly SupplierV1[]>();
  const [suppliersError, setSuppliersError] = useState<InventoryError>();
  const [suppliersReload, setSuppliersReload] = useState(0);
  const [busySupplierId, setBusySupplierId] = useState<string>();

  const [orders, setOrders] = useState<readonly PurchaseOrderSummaryV1[]>();
  const [ordersError, setOrdersError] = useState<InventoryError>();
  const [ordersReload, setOrdersReload] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");

  const [orderId, setOrderId] = useState("");
  const [detail, setDetail] = useState<PurchaseOrderDetailV1>();
  const [detailError, setDetailError] = useState<InventoryError>();
  const [detailReload, setDetailReload] = useState(0);

  const [dialog, setDialog] = useState<DialogState>();
  const [notice, setNotice] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  useEffect(() => {
    if (!canRead) {
      setSuppliers(undefined);
      setSuppliersError(undefined);
      return undefined;
    }
    let cancelled = false;
    setSuppliers(undefined);
    setSuppliersError(undefined);
    void (async () => {
      try {
        const reply = await action("listSuppliers", { includeInactive: true });
        if (cancelled) return;
        if (reply.ok && "suppliers" in reply) {
          setSuppliers(reply.suppliers);
          return;
        }
        setSuppliersError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setSuppliersError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, canRead, suppliersReload]);

  useEffect(() => {
    if (!canRead) {
      setOrders(undefined);
      setOrdersError(undefined);
      return undefined;
    }
    let cancelled = false;
    setOrders(undefined);
    setOrdersError(undefined);
    void (async () => {
      try {
        const reply = await action("listPurchaseOrders", statusFilter === "" ? {} : { status: statusFilter });
        if (cancelled) return;
        if (reply.ok && "orders" in reply) {
          setOrders(reply.orders);
          return;
        }
        setOrdersError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setOrdersError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, canRead, ordersReload, statusFilter]);

  useEffect(() => {
    if (!canRead || orderId === "") {
      setDetail(undefined);
      setDetailError(undefined);
      return undefined;
    }
    let cancelled = false;
    setDetail(undefined);
    setDetailError(undefined);
    void (async () => {
      try {
        const reply = await action("readPurchaseOrder", { id: orderId });
        if (cancelled) return;
        if (reply.ok && "order" in reply) {
          setDetail(reply.order);
          return;
        }
        setDetailError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setDetailError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, canRead, detailReload, orderId]);

  useEffect(() => {
    if (notice === undefined) return undefined;
    const timeout = window.setTimeout(() => setNotice(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const activeSuppliers = suppliers?.filter((supplier) => supplier.active) ?? [];
  const catalogReady = itemsStatus === "ready" && items.length > 0
    && suppliers !== undefined && activeSuppliers.length > 0;
  const receiveReady = deviceStatus === "ready" && warehousesStatus === "ready" && warehouses.length > 0 && deviceId !== "";

  function supplierSaved(saved: SupplierV1): void {
    setSuppliers((current) => {
      if (current === undefined) return [saved];
      const exists = current.some((supplier) => supplier.id === saved.id);
      return exists
        ? current.map((supplier) => supplier.id === saved.id ? saved : supplier)
        : [...current, saved];
    });
    setDialog(undefined);
    setNotice("Proveedor guardado.");
  }

  async function toggleSupplier(supplier: SupplierV1): Promise<void> {
    if (busySupplierId !== undefined) return;
    setBusySupplierId(supplier.id);
    setActionError(undefined);
    try {
      const reply = await action("updateSupplier", { active: !supplier.active, id: supplier.id });
      if (reply.ok && "supplier" in reply) {
        setSuppliers((current) => current?.map((entry) => entry.id === reply.supplier.id ? reply.supplier : entry));
        setNotice(reply.supplier.active ? "Proveedor activado." : "Proveedor desactivado.");
      } else {
        setActionError(reply.ok ? SAVE_ERRORS.unavailable : SAVE_ERRORS[reply.error]);
      }
    } catch {
      setActionError(SAVE_ERRORS.unavailable);
    }
    setBusySupplierId(undefined);
  }

  function orderCreated(created: PurchaseOrderCreatedV1): void {
    setDialog(undefined);
    setNotice(created.replayed ? "La orden ya existía y se recuperó." : "Orden de compra creada.");
    setOrdersReload((current) => current + 1);
    setOrderId(created.orderId);
    setDetailReload((current) => current + 1);
  }

  function orderReceived(movements: readonly PurchaseOrderReceiptMovementV1[]): void {
    setDialog(undefined);
    setNotice(`Recepción registrada · ${formatInventoryNumber(movements.length)} ${
      movements.length === 1 ? "movimiento" : "movimientos"
    } de inventario.`);
    setOrdersReload((current) => current + 1);
    setDetailReload((current) => current + 1);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="break-words font-heading text-lg font-semibold">Compras</h2>
        {canManage ? (
          <p className="text-sm text-text-muted">Registra proveedores, crea órdenes y recíbelas contra un almacén.</p>
        ) : canRead ? (
          <p className="text-sm text-text-muted">
            Puedes consultar proveedores y órdenes de compra. Solo un encargado puede crearlos, editarlos o recibirlos.
          </p>
        ) : (
          <p role="status" className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-muted">
            Tu rol no permite administrar compras. Pide a un encargado que registre proveedores y órdenes.
          </p>
        )}
      </div>

      {notice !== undefined && (
        <p role="status" className="rounded-lg border border-success bg-success-bg px-3 py-2 text-sm">{notice}</p>
      )}
      {actionError !== undefined && (
        <p role="alert" className="rounded-lg border border-error bg-error-bg px-3 py-2 text-sm">{actionError}</p>
      )}

      {canRead && (
        <>
          <section className="grid gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="break-words font-heading text-base font-semibold">Proveedores</h3>
              {canManage && (
                <button type="button" className={uiButton("primary", "w-full sm:w-auto")}
                  onClick={() => setDialog({ kind: "supplier" })}>
                  Nuevo proveedor
                </button>
              )}
            </div>

        {suppliers === undefined && suppliersError === undefined && (
          <p role="status" className="text-sm text-text-muted">Cargando proveedores…</p>
        )}
        {suppliersError !== undefined && (
          <LoadError message={LIST_ERRORS[suppliersError]} onRetry={() => setSuppliersReload((current) => current + 1)} />
        )}
        {suppliers !== undefined && suppliers.length === 0 && (
          <p className="text-sm text-text-muted">
            Aún no hay proveedores registrados.{canManage ? " Crea el primero para poder comprar." : ""}
          </p>
        )}
        {suppliers !== undefined && suppliers.length > 0 && (
          <ul className="grid gap-2">
            {suppliers.map((supplier) => (
              <li key={supplier.id}>
                <SupplierRow
                  busy={busySupplierId === supplier.id}
                  canManage={canManage}
                  supplier={supplier}
                  onEdit={() => setDialog({ kind: "supplier", supplier })}
                  onToggle={() => { void toggleSupplier(supplier); }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="break-words font-heading text-base font-semibold">Órdenes de compra</h3>
          {canManage && (
            <button type="button" className={uiButton("primary", "w-full sm:w-auto")}
              disabled={!catalogReady}
              onClick={() => setDialog({ kind: "order" })}>
              Nueva orden
            </button>
          )}
        </div>

        {(itemsStatus === "error" || warehousesStatus === "error") && (
          <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
            <p>No se pudieron cargar los insumos o almacenes.</p>
            <button type="button" className={`${uiButton()} mt-2`} onClick={onRetryCatalog}>Reintentar</button>
          </div>
        )}

        {canManage && catalogReady === false
          && itemsStatus !== "error" && warehousesStatus !== "error" && (
          <p className="text-sm text-text-muted">
            Necesitas al menos un insumo, un proveedor activo y un almacén para crear y recibir órdenes.
          </p>
        )}

        <div role="group" aria-label="Filtrar órdenes por estado" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={uiChip(statusFilter === filter.value)}
              aria-pressed={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {orders === undefined && ordersError === undefined && (
          <p role="status" className="text-sm text-text-muted">Cargando órdenes…</p>
        )}
        {ordersError !== undefined && (
          <LoadError message={LIST_ERRORS[ordersError]} onRetry={() => setOrdersReload((current) => current + 1)} />
        )}
        {orders !== undefined && orders.length === 0 && (
          <p className="text-sm text-text-muted">
            {statusFilter === "" ? "Aún no hay órdenes de compra." : "No hay órdenes con ese estado."}
          </p>
        )}
        {orders !== undefined && orders.length > 0 && (
          <ul className="grid gap-2">
            {orders.map((order) => (
              <li key={order.id}>
                <OrderRow
                  order={order}
                  selected={orderId === order.id}
                  timeZone={timeZone}
                  onSelect={() => setOrderId(order.id)}
                />
              </li>
            ))}
          </ul>
        )}

        {orderId !== "" && (
          <section aria-label="Detalle de la orden" className="grid gap-2">
            <h4 className="font-heading text-base font-semibold">Detalle de la orden</h4>
            {detail === undefined && detailError === undefined && (
              <p role="status" className="text-sm text-text-muted">Cargando detalle…</p>
            )}
            {detailError !== undefined && (
              <LoadError message={LIST_ERRORS[detailError]} onRetry={() => setDetailReload((current) => current + 1)} />
            )}
            {detail !== undefined && (
              <OrderDetail
                canManage={canManage && receiveReady}
                order={detail}
                timeZone={timeZone}
                onReceive={() => setDialog({ kind: "receive", order: detail })}
              />
            )}
          </section>
        )}
      </section>
        </>
      )}

      {dialog?.kind === "supplier" && (
        <SupplierDialog
          action={action}
          supplier={dialog.supplier}
          onClose={() => setDialog(undefined)}
          onSaved={supplierSaved}
        />
      )}
      {dialog?.kind === "order" && (
        <PurchaseOrderDialog
          action={action}
          items={items}
          onClose={() => setDialog(undefined)}
          onCreated={orderCreated}
          suppliers={activeSuppliers}
        />
      )}
      {dialog?.kind === "receive" && (
        <ReceiveDialog
          action={action}
          deviceId={deviceId}
          order={dialog.order}
          warehouses={warehouses}
          onClose={() => setDialog(undefined)}
          onReceived={orderReceived}
        />
      )}
    </div>
  );
}

function SupplierRow({ supplier, canManage, busy, onEdit, onToggle }: {
  readonly supplier: SupplierV1;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <strong className="break-words text-base">{supplier.name}</strong>
        <span className="block break-words text-sm text-text-muted">
          {supplier.contact === null ? "Sin contacto registrado" : supplier.contact}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge active={supplier.active} />
        {canManage && (
          <>
            <button type="button" className={uiButton()} onClick={onEdit} disabled={busy}>Editar</button>
            <button type="button" className={uiButton(supplier.active ? "danger" : "secondary")}
              disabled={busy} onClick={onToggle}>
              {busy ? "Guardando…" : supplier.active ? "Desactivar" : "Activar"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function OrderRow({ order, selected, timeZone, onSelect }: {
  readonly order: PurchaseOrderSummaryV1;
  readonly selected: boolean;
  readonly timeZone: string;
  readonly onSelect: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-11 w-full flex-col rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        selected ? "border-accent bg-bg" : "border-border bg-surface hover:bg-bg"
      }`}
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <strong className="break-words text-base">{order.supplierName}</strong>
        <span className="whitespace-nowrap text-sm font-semibold">{formatMinorUnits(order.totalMinor, order.currency)}</span>
      </span>
      <span className="block text-sm text-text-muted">
        {purchaseOrderStatusLabel(order.status)} · {formatInventoryTimestamp(order.orderedAt, timeZone)}
      </span>
    </button>
  );
}

function OrderDetail({ order, canManage, timeZone, onReceive }: {
  readonly order: PurchaseOrderDetailV1;
  readonly canManage: boolean;
  readonly timeZone: string;
  readonly onReceive: () => void;
}): ReactNode {
  const receivable = order.status !== "received" && order.status !== "cancelled";
  return (
    <article className="grid gap-3 rounded-xl border border-accent bg-surface p-4">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <strong className="break-words text-base">{order.supplierName}</strong>
        <span className="text-sm font-semibold">{formatMinorUnits(order.totalMinor, order.currency)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
        <OrderStatusBadge status={order.status} />
        <span>Pedida el {formatInventoryTimestamp(order.orderedAt, timeZone)}</span>
      </span>
      {order.receivedAt !== null && (
        <span className="block text-sm text-text-muted">
          Recibida el {formatInventoryTimestamp(order.receivedAt, timeZone)}
        </span>
      )}
      <ul className="grid gap-2">
        {order.lines.map((line, index) => <li key={`${line.itemId}-${index}`}><OrderLine line={line} currency={order.currency} /></li>)}
      </ul>
      <p className="text-sm font-semibold">Total de la orden: {formatMinorUnits(order.totalMinor, order.currency)}</p>
      {receivable && canManage && (
        <div className="flex justify-end">
          <button type="button" className={uiButton("primary")} onClick={onReceive}>Recibir orden</button>
        </div>
      )}
    </article>
  );
}

function OrderLine({ line, currency }: {
  readonly line: PurchaseOrderLineDetailV1;
  readonly currency: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-bg p-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="break-words text-sm">
        <strong>{line.itemName}</strong>
        <span className="block text-text-muted">
          {formatInventoryNumber(line.quantity)} {inventoryUnitLabel(line.unitCode)} ·
          {" "}{formatMinorUnits(line.unitCostMinor, currency)} por {inventoryUnitLabel(line.unitCode)}
        </span>
      </span>
    </div>
  );
}

function OrderStatusBadge({ status }: { readonly status: string }): ReactNode {
  const tone = status === "received"
    ? "border-success text-text"
    : status === "cancelled"
      ? "border-error text-error"
      : "border-border text-text-muted";
  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-xs font-semibold ${tone}`}>
      {purchaseOrderStatusLabel(status)}
    </span>
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
    <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
      <p>{message}</p>
      <button type="button" className={`${uiButton()} mt-2`} onClick={onRetry}>Reintentar</button>
    </div>
  );
}

function SupplierDialog({ action, supplier, onClose, onSaved }: {
  readonly action: PurchasingPanelProps["action"];
  readonly supplier?: SupplierV1 | undefined;
  readonly onClose: () => void;
  readonly onSaved: (supplier: SupplierV1) => void;
}): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const editing = supplier !== undefined;
  const close = (): void => { if (!saving) onClose(); };

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const validation = validateSupplierDraft({
      contact: String(data.get("contact") ?? ""),
      name: String(data.get("name") ?? ""),
    });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    const active = data.get("active") === "on";
    setError(undefined);
    setSaving(true);
    void (async () => {
      try {
        const reply = editing
          ? await action("updateSupplier", {
            active,
            contact: validation.contact,
            id: supplier.id,
            name: validation.name,
          })
          : await action("createSupplier", {
            active,
            contact: validation.contact,
            name: validation.name,
          });
        if (reply.ok && "supplier" in reply) {
          setSaving(false);
          onSaved(reply.supplier);
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
    <InventoryModal title={editing ? "Editar proveedor" : "Nuevo proveedor"} onClose={close}>
      <form onSubmit={submit} className="mt-4 grid gap-3" aria-busy={saving}>
        <Field className="grid gap-1 text-sm" hint="Nombre con el que el equipo reconoce al proveedor." label="Nombre">
          {(id) => <input id={id} name="name" className={inputClass} defaultValue={supplier?.name ?? ""} maxLength={160}
            required autoComplete="off" disabled={saving} />}
        </Field>
        <Field className="grid gap-1 text-sm"
          hint="Teléfono, correo o persona de contacto. Puede quedar vacío." label="Contacto (opcional)">
          {(id) => <input id={id} name="contact" className={inputClass} defaultValue={supplier?.contact ?? ""}
            maxLength={200} autoComplete="off" disabled={saving} />}
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="active" className={checkboxClass}
            defaultChecked={supplier?.active ?? true} disabled={saving} />
          <span>Proveedor activo</span>
        </label>
        {error !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={uiButton()} onClick={close} disabled={saving}>Cancelar</button>
          <button type="submit" className={uiButton("primary")} disabled={saving}>
            {saving ? "Guardando…" : editing ? "Guardar proveedor" : "Crear proveedor"}
          </button>
        </div>
      </form>
    </InventoryModal>
  );
}

function PurchaseOrderDialog({ action, items, suppliers, onClose, onCreated }: {
  readonly action: PurchasingPanelProps["action"];
  readonly items: readonly InventoryItemV1[];
  readonly suppliers: readonly SupplierV1[];
  readonly onClose: () => void;
  readonly onCreated: (created: PurchaseOrderCreatedV1) => void;
}): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [currency, setCurrency] = useState("MXN");
  const [orderedAt, setOrderedAt] = useState("");
  const [lines, setLines] = useState<readonly PurchaseOrderLineDraft[]>([
    { itemId: "", quantity: "1", unitCode: "g", unitCostMinor: "0" },
  ]);
  const [idempotencyKey] = useState(() => ensureInventoryIdempotencyKey(undefined, () => crypto.randomUUID()));
  const close = (): void => { if (!saving) onClose(); };

  function updateLine(index: number, patch: Partial<PurchaseOrderLineDraft>): void {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function addLine(): void {
    setLines((current) => [...current, { itemId: "", quantity: "1", unitCode: "g", unitCostMinor: "0" }]);
  }

  function removeLine(index: number): void {
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    const validation = validatePurchaseOrderDraft({ currency, lines, supplierId });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    let orderedAtIso: string | undefined;
    if (orderedAt !== "") {
      const parsed = new Date(orderedAt);
      if (Number.isNaN(parsed.getTime())) {
        setError("La fecha del pedido no es válida.");
        return;
      }
      orderedAtIso = parsed.toISOString();
    }
    setError(undefined);
    setSaving(true);
    void (async () => {
      try {
        const reply = await action("createPurchaseOrder", {
          currency: validation.currency,
          idempotencyKey,
          lines: validation.lines,
          supplierId,
          ...(orderedAtIso === undefined ? {} : { orderedAt: orderedAtIso }),
        });
        if (reply.ok && "created" in reply) {
          setSaving(false);
          onCreated(reply.created);
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
    <InventoryModal title="Nueva orden de compra" onClose={close}>
      <form onSubmit={submit} className="mt-4 grid gap-3" aria-busy={saving}>
        <Field className="grid gap-1 text-sm" hint="Proveedor activo al que se le compra." label="Proveedor">
          {(id) => (
            <select id={id} className={inputClass} value={supplierId} required disabled={saving}
              onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Elige un proveedor</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field className="grid gap-1 text-sm"
            hint="Código ISO de 3 letras, por ejemplo MXN." label="Moneda">
            {(id) => <input id={id} className={inputClass} value={currency} maxLength={3} required
              autoComplete="off" disabled={saving}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())} />}
          </Field>
          <Field className="grid gap-1 text-sm"
            hint="Opcional. Si lo dejas vacío se usa la fecha del registro." label="Fecha del pedido (opcional)">
            {(id) => <input id={id} type="datetime-local" className={inputClass} value={orderedAt}
              disabled={saving} onChange={(event) => setOrderedAt(event.target.value)} />}
          </Field>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-heading text-base font-semibold">Insumos de la orden</h3>
          <button type="button" className={uiButton()} onClick={addLine} disabled={saving}>Agregar insumo</button>
        </div>

        {lines.length === 0 && (
          <p className="text-sm text-text-muted">Agrega al menos un insumo para armar la orden.</p>
        )}

        {lines.length > 0 && (
          <ul className="grid gap-2">
            {lines.map((line, index) => {
              const selectedItem = items.find((item) => item.id === line.itemId);
              return (
                <li key={index} className="grid gap-2 rounded-xl border border-border bg-bg p-3">
                  <Field className="grid gap-1 text-sm" hint="Insumo que se compra con esta orden." label={`Insumo ${index + 1}`}>
                    {(id) => (
                      <select id={id} className={inputClass} value={line.itemId} disabled={saving}
                        onChange={(event) => {
                          const item = items.find((candidate) => candidate.id === event.target.value);
                          updateLine(index, {
                            itemId: event.target.value,
                            unitCode: item === undefined ? line.unitCode : item.unitCode,
                          });
                        }}>
                        <option value="">Elige un insumo</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <Field className="grid gap-1 text-sm" hint="Cantidad entera mayor o igual a 1." label="Cantidad">
                      {(id) => <input id={id} className={inputClass} inputMode="numeric" pattern="[0-9]*"
                        value={line.quantity} disabled={saving} autoComplete="off"
                        onChange={(event) => updateLine(index, { quantity: event.target.value })} />}
                    </Field>
                    <Field className="grid gap-1 text-sm"
                      hint="Entero en la unidad menor de la moneda; por ejemplo 1250 son 12.50 en MXN."
                      label="Costo unitario (unidad menor)">
                      {(id) => <input id={id} className={inputClass} inputMode="numeric" pattern="[0-9]*"
                        value={line.unitCostMinor} disabled={saving} autoComplete="off"
                        onChange={(event) => updateLine(index, { unitCostMinor: event.target.value })} />}
                    </Field>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-text-muted">
                        {selectedItem === undefined ? "Unidad del insumo" : inventoryUnitLabel(selectedItem.unitCode)}
                      </span>
                      <button type="button" className={uiButton("danger")} disabled={saving}
                        onClick={() => removeLine(index)}>Quitar</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {error !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={uiButton()} onClick={close} disabled={saving}>Cancelar</button>
          <button type="submit" className={uiButton("primary")} disabled={saving}>
            {saving ? "Guardando…" : "Crear orden"}
          </button>
        </div>
      </form>
    </InventoryModal>
  );
}

function ReceiveDialog({ action, deviceId, order, warehouses, onClose, onReceived }: {
  readonly action: PurchasingPanelProps["action"];
  readonly deviceId: string;
  readonly order: PurchaseOrderDetailV1;
  readonly warehouses: readonly InventoryWarehouseV1[];
  readonly onClose: () => void;
  readonly onReceived: (movements: readonly PurchaseOrderReceiptMovementV1[]) => void;
}): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const close = (): void => { if (!saving) onClose(); };

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    if (warehouseId === "") {
      setError("Elige el almacén que recibe la mercancía.");
      return;
    }
    if (deviceId === "") {
      setError("El dispositivo aún no está listo. Espera un momento e inténtalo de nuevo.");
      return;
    }
    setError(undefined);
    setSaving(true);
    void (async () => {
      try {
        const reply = await action("receivePurchaseOrder", { deviceId, id: order.id, warehouseId });
        if (reply.ok && "receipt" in reply) {
          setSaving(false);
          onReceived(reply.receipt);
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
    <InventoryModal title="Recibir orden de compra" onClose={close}>
      <form onSubmit={submit} className="mt-4 grid gap-3" aria-busy={saving}>
        <p className="break-words text-sm">
          Se recibirá la orden de <strong>{order.supplierName}</strong> por
          {" "}{formatMinorUnits(order.totalMinor, order.currency)} en el almacén elegido.
          Se generará un movimiento de inventario por cada línea.
        </p>
        <Field className="grid gap-1 text-sm" hint="Almacén al que entra la mercancía." label="Almacén">
          {(id) => (
            <select id={id} className={inputClass} value={warehouseId} required disabled={saving || warehouses.length === 0}
              onChange={(event) => setWarehouseId(event.target.value)}>
              <option value="">Elige un almacén</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
          )}
        </Field>
        {warehouses.length === 0 && (
          <p className="text-sm text-text-muted">Necesitas al menos un almacén en esta sucursal para recibir la orden.</p>
        )}
        {error !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={uiButton()} onClick={close} disabled={saving}>Cancelar</button>
          <button type="submit" className={uiButton("primary")} disabled={saving || warehouses.length === 0}>
            {saving ? "Recibiendo…" : "Recibir orden"}
          </button>
        </div>
      </form>
    </InventoryModal>
  );
}
