"use client";

import type { InventoryItemV1, InventoryWarehouseV1 } from "@super-restaurant/shared-types";
import { useEffect, useState, type ReactNode } from "react";

import { Field } from "../../../components/field-hint";
import {
  formatInventoryNumber,
  formatMinorUnits,
  formatPercentFromMinor,
  inventoryUnitLabel,
  stockAlertSummary,
} from "../../../lib/inventory-ui";
import { uiButton } from "../../../lib/ui-classes";
import type {
  AverageCostV1,
  InventoryActionResult,
  InventoryError,
  InventoryOperation,
  ProductCostV1,
  ProductMarginV1,
  RecipeProductV1,
  StockAlertV1,
} from "./actions";

type CatalogStatus = "idle" | "loading" | "error" | "ready";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

const LOAD_ERRORS: Readonly<Record<InventoryError, string>> = {
  conflict: "Los datos cambiaron en otro dispositivo. Actualiza la consulta.",
  denied: "Tu sesión o rol ya no permite consultar alertas ni costos.",
  invalid: "No se pudo leer la solicitud. Actualiza la página e inténtalo de nuevo.",
  missing: "El producto o el insumo ya no existe. Actualiza la lista.",
  timeout: "El servidor tardó demasiado. Reintenta.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  unavailable: "No se pudo conectar con el inventario. Revisa la conexión e inténtalo de nuevo.",
};

interface AlertsPanelProps {
  readonly action: (operation: InventoryOperation, input?: unknown) => Promise<InventoryActionResult>;
  readonly items: readonly InventoryItemV1[];
  readonly itemsStatus: CatalogStatus;
  readonly warehouses: readonly InventoryWarehouseV1[];
  readonly warehousesStatus: CatalogStatus;
  readonly onRetryCatalog: () => void;
}

export function AlertsPanel({
  action,
  items,
  itemsStatus,
  warehouses,
  warehousesStatus,
  onRetryCatalog,
}: AlertsPanelProps): ReactNode {
  const [alerts, setAlerts] = useState<readonly StockAlertV1[]>();
  const [alertsError, setAlertsError] = useState<InventoryError>();
  const [alertsReload, setAlertsReload] = useState(0);

  const [costItemId, setCostItemId] = useState("");
  const [costWarehouseId, setCostWarehouseId] = useState("");
  const [cost, setCost] = useState<AverageCostV1>();
  const [costError, setCostError] = useState<InventoryError>();
  const [costReload, setCostReload] = useState(0);

  const [products, setProducts] = useState<readonly RecipeProductV1[]>();
  const [productsError, setProductsError] = useState<InventoryError>();
  const [productsReload, setProductsReload] = useState(0);
  const [productId, setProductId] = useState("");
  const [productCosts, setProductCosts] = useState<readonly ProductCostV1[]>();
  const [productCostsError, setProductCostsError] = useState<InventoryError>();
  const [margin, setMargin] = useState<ProductMarginV1>();
  const [marginError, setMarginError] = useState<InventoryError>();
  const [productReload, setProductReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAlerts(undefined);
    setAlertsError(undefined);
    void (async () => {
      try {
        const reply = await action("listStockAlerts");
        if (cancelled) return;
        if (reply.ok && "alerts" in reply) {
          setAlerts(reply.alerts);
          return;
        }
        setAlertsError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setAlertsError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, alertsReload]);

  useEffect(() => {
    let cancelled = false;
    setProducts(undefined);
    setProductsError(undefined);
    void (async () => {
      try {
        const reply = await action("listProducts");
        if (cancelled) return;
        if (reply.ok && "products" in reply) {
          setProducts(reply.products);
          return;
        }
        setProductsError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setProductsError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, productsReload]);

  useEffect(() => {
    if (costItemId === "" || costWarehouseId === "") {
      setCost(undefined);
      setCostError(undefined);
      return undefined;
    }
    let cancelled = false;
    setCost(undefined);
    setCostError(undefined);
    void (async () => {
      try {
        const reply = await action("readAverageCost", { itemId: costItemId, warehouseId: costWarehouseId });
        if (cancelled) return;
        if (reply.ok && "cost" in reply) {
          setCost(reply.cost);
          return;
        }
        setCostError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setCostError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, costItemId, costReload, costWarehouseId]);

  useEffect(() => {
    if (productId === "") {
      setProductCosts(undefined);
      setProductCostsError(undefined);
      setMargin(undefined);
      setMarginError(undefined);
      return undefined;
    }
    let cancelled = false;
    setProductCosts(undefined);
    setProductCostsError(undefined);
    setMargin(undefined);
    setMarginError(undefined);
    void (async () => {
      try {
        const [costsReply, marginReply] = await Promise.all([
          action("listProductCosts", { productId }),
          action("readProductMargin", { productId }),
        ]);
        if (cancelled) return;
        if (costsReply.ok && "costs" in costsReply) setProductCosts(costsReply.costs);
        else setProductCostsError(costsReply.ok ? "unavailable" : costsReply.error);
        if (marginReply.ok && "margin" in marginReply) setMargin(marginReply.margin);
        else setMarginError(marginReply.ok ? "unavailable" : marginReply.error);
      } catch {
        if (!cancelled) {
          setProductCostsError("unavailable");
          setMarginError("unavailable");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [action, productId, productReload]);

  const denied = alertsError === "denied" || costError === "denied"
    || productsError === "denied" || productCostsError === "denied" || marginError === "denied";
  const catalogReady = itemsStatus === "ready" && items.length > 0
    && warehousesStatus === "ready" && warehouses.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="break-words font-heading text-lg font-semibold">Alertas y costos</h2>
        <p className="text-sm text-text-muted">
          Consulta el saldo bajo mínimo, el costo promedio por almacén y el costo y margen de un producto.
        </p>
      </div>

      {denied && (
        <p role="status" className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-muted">
          Tu rol no permite consultar alertas ni costos. Pide a un encargado que revise tus permisos.
        </p>
      )}

      <section className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="break-words font-heading text-base font-semibold">Saldo bajo mínimo</h3>
            <p className="text-sm text-text-muted">Insumos por debajo de su mínimo en algún almacén.</p>
          </div>
          <button
            type="button"
            className={uiButton("secondary", "w-full sm:w-auto")}
            onClick={() => setAlertsReload((current) => current + 1)}
          >
            Actualizar
          </button>
        </div>

        {alerts === undefined && alertsError === undefined && (
          <p role="status" className="text-sm text-text-muted">Cargando alertas…</p>
        )}
        {alertsError !== undefined && (
          <LoadError message={LOAD_ERRORS[alertsError]} onRetry={() => setAlertsReload((current) => current + 1)} />
        )}
        {alerts !== undefined && alerts.length === 0 && (
          <p className="text-sm text-text-muted">Todo el inventario está por encima del mínimo.</p>
        )}
        {alerts !== undefined && alerts.length > 0 && (
          <ul className="grid gap-2">
            {alerts.map((alert) => (
              <li key={`${alert.warehouseId}-${alert.itemId}`}>
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <strong className="break-words text-base">{alert.itemName}</strong>
                    <span className="block break-words text-sm text-text-muted">{alert.warehouseName}</span>
                    <span className="mt-1 block text-sm">
                      Saldo: {formatInventoryNumber(alert.quantity)} {inventoryUnitLabel(alert.unitCode)}
                      {" "}· Mínimo: {formatInventoryNumber(alert.minQuantity)} {inventoryUnitLabel(alert.unitCode)}
                    </span>
                  </div>
                  <span className="whitespace-nowrap rounded-full border border-error px-3 py-1 text-sm font-semibold text-error">
                    {stockAlertSummary(alert)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <h3 className="break-words font-heading text-base font-semibold">Costo promedio</h3>
        <p className="text-sm text-text-muted">Elige un insumo y un almacén para ver su costo medio.</p>

        {!catalogReady && (
          <CatalogNotice
            itemsStatus={itemsStatus}
            warehousesStatus={warehousesStatus}
            onRetry={onRetryCatalog}
          />
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Field className="grid flex-1 gap-1 text-sm" hint="Insumo cuyo costo quieres consultar." label="Insumo">
            {(id) => (
              <select id={id} className={inputClass} value={costItemId} disabled={itemsStatus !== "ready"}
                onChange={(event) => setCostItemId(event.target.value)}>
                <option value="">Elige un insumo</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field className="grid flex-1 gap-1 text-sm" hint="Almacén donde se calcula el costo medio." label="Almacén">
            {(id) => (
              <select id={id} className={inputClass} value={costWarehouseId} disabled={warehousesStatus !== "ready"}
                onChange={(event) => setCostWarehouseId(event.target.value)}>
                <option value="">Elige un almacén</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            )}
          </Field>
        </div>

        {costItemId !== "" && costWarehouseId !== "" && cost === undefined && costError === undefined && (
          <p role="status" className="text-sm text-text-muted">Consultando costo medio…</p>
        )}
        {costError !== undefined && (
          <LoadError message={LOAD_ERRORS[costError]} onRetry={() => setCostReload((current) => current + 1)} />
        )}
        {cost !== undefined && <CostCard cost={cost} />}
      </section>

      <section className="grid gap-3">
        <h3 className="break-words font-heading text-base font-semibold">Costo de receta y margen</h3>
        <p className="text-sm text-text-muted">Elige un producto del menú para ver el costo de su receta y su margen.</p>

        <Field className="grid gap-1 text-sm" hint="Producto del menú cuyo costo y margen quieres consultar." label="Producto">
          {(id) => (
            <select id={id} className={inputClass} value={productId}
              disabled={products === undefined || productsError !== undefined}
              onChange={(event) => setProductId(event.target.value)}>
              <option value="">Elige un producto</option>
              {(products ?? []).map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.active ? product.name : `${product.name} · Inactivo`}
                </option>
              ))}
            </select>
          )}
        </Field>

        {products === undefined && productsError === undefined && (
          <p role="status" className="text-sm text-text-muted">Cargando productos del menú…</p>
        )}
        {productsError !== undefined && (
          <LoadError message={LOAD_ERRORS[productsError]} onRetry={() => setProductsReload((current) => current + 1)} />
        )}
        {products !== undefined && products.length === 0 && (
          <p className="text-sm text-text-muted">Aún no hay productos en el menú. Crea uno para consultar su costo.</p>
        )}

        {productId !== "" && (
          <div className="grid gap-3">
            {productCostsError !== undefined && (
              <LoadError message={LOAD_ERRORS[productCostsError]} onRetry={() => setProductReload((current) => current + 1)} />
            )}
            {marginError !== undefined && (
              <LoadError message={LOAD_ERRORS[marginError]} onRetry={() => setProductReload((current) => current + 1)} />
            )}
            {(productCosts === undefined || margin === undefined)
              && productCostsError === undefined && marginError === undefined && (
              <p role="status" className="text-sm text-text-muted">Consultando costo y margen…</p>
            )}

            {margin !== undefined && <MarginCard margin={margin} />}

            {productCosts !== undefined && (
              productCosts.length === 0 ? (
                <p className="text-sm text-text-muted">Este producto aún no tiene una receta con costo.</p>
              ) : (
                <ul className="grid gap-2">
                  {productCosts.map((line) => (
                    <li key={line.itemId}>
                      <RecipeLineCard line={line} />
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CatalogNotice({ itemsStatus, warehousesStatus, onRetry }: {
  readonly itemsStatus: CatalogStatus;
  readonly warehousesStatus: CatalogStatus;
  readonly onRetry: () => void;
}): ReactNode {
  if (itemsStatus === "error" || warehousesStatus === "error") {
    return (
      <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
        <p>No se pudieron cargar los insumos o almacenes.</p>
        <button type="button" className={`${uiButton()} mt-2`} onClick={onRetry}>Reintentar</button>
      </div>
    );
  }
  if (itemsStatus === "ready" && warehousesStatus === "ready") {
    return (
      <p className="text-sm text-text-muted">
        Necesitas al menos un insumo y un almacén en esta sucursal para consultar el costo medio.
      </p>
    );
  }
  return <p role="status" className="text-sm text-text-muted">Cargando insumos y almacenes…</p>;
}

function CostCard({ cost }: { readonly cost: AverageCostV1 }): ReactNode {
  return (
    <div className="grid gap-1 rounded-xl border border-border bg-surface p-4 text-sm">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <strong className="break-words text-base">Costo medio del insumo</strong>
        <span className="whitespace-nowrap font-semibold">{formatMoney(cost.valueMinor, cost.currency)}</span>
      </span>
      <span className="text-text-muted">
        Cantidad en existencia: {formatInventoryNumber(cost.quantity)}
      </span>
      <span>Costo unitario: {formatMoney(cost.unitCostMinor, cost.currency)}</span>
      <span className="text-text-muted">Resto de redondeo: {formatInventoryNumber(cost.roundingRemainder)}</span>
      {cost.currency === null && (
        <p className="text-text-muted">Aún no hay compras que fijen el costo. Los importes se muestran sin moneda.</p>
      )}
    </div>
  );
}

function MarginCard({ margin }: { readonly margin: ProductMarginV1 }): ReactNode {
  const percent = formatPercentFromMinor(margin.marginMinor, margin.priceMinor);
  return (
    <div className="grid gap-1 rounded-xl border border-border bg-surface p-4 text-sm">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <strong className="break-words text-base">Margen estimado</strong>
        <span className="whitespace-nowrap font-semibold">{percent}</span>
      </span>
      <span>Precio: {formatMinorUnits(margin.priceMinor, margin.currency)}</span>
      <span>Costo: {formatMinorUnits(margin.costMinor, margin.currency)}</span>
      <span>Margen: {formatMinorUnits(margin.marginMinor, margin.currency)}</span>
      {margin.costMinor === 0 && (
        <p className="text-text-muted">Sin costo registrado todavía.</p>
      )}
    </div>
  );
}

function RecipeLineCard({ line }: { readonly line: ProductCostV1 }): ReactNode {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0 break-words">
        <strong>{line.itemName}</strong>
        <span className="block text-text-muted">
          {formatInventoryNumber(line.quantity)} {inventoryUnitLabel(line.unitCode)}
          {" "}· Costo unitario: {formatMoney(line.unitCostMinor, line.currency)}
        </span>
      </span>
      <span className="whitespace-nowrap font-semibold">
        {line.lineCostMinor === 0 && line.currency === null
          ? "Sin costo registrado todavía"
          : formatMoney(line.lineCostMinor, line.currency)}
      </span>
    </div>
  );
}

function formatMoney(amountMinor: number, currency: string | null): string {
  if (currency === null) return `${formatInventoryNumber(amountMinor)} (unidad menor)`;
  return formatMinorUnits(amountMinor, currency);
}

function LoadError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }): ReactNode {
  return (
    <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
      <p>{message}</p>
      <button type="button" className={`${uiButton()} mt-2`} onClick={onRetry}>Reintentar</button>
    </div>
  );
}
