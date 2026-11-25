"use client";

import type { InventoryItemV1, RecipeLineV1, RecipeVersionV1 } from "@super-restaurant/shared-types";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Field } from "../../../components/field-hint";
import {
  filterInventoryItems,
  formatInventoryNumber,
  formatInventoryTimestamp,
  formatRecipeVersionLabel,
  inventoryUnitLabel,
  recipeVersionStateLabel,
  validateRecipeLineDrafts,
  type RecipeLineDraft,
} from "../../../lib/inventory-ui";
import { uiButton } from "../../../lib/ui-classes";
import { InventoryModal } from "./inventory-modal";
import type {
  InventoryActionResult,
  InventoryError,
  InventoryOperation,
  RecipeProductV1,
  RecipeSummaryV1,
} from "./actions";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

type LoadStatus = "idle" | "loading" | "error" | "ready";

const LIST_ERRORS: Readonly<Record<InventoryError, string>> = {
  conflict: "La receta cambió en otro dispositivo. Actualiza la lista.",
  denied: "Tu sesión o rol ya no permite consultar el inventario.",
  invalid: "No se pudo leer la solicitud. Actualiza la página e inténtalo de nuevo.",
  missing: "El registro ya no existe. Actualiza la lista.",
  timeout: "El servidor tardó demasiado. Reintenta.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  unavailable: "No se pudo conectar con el inventario. Revisa la conexión e inténtalo de nuevo.",
};

const SAVE_ERRORS: Readonly<Record<InventoryError, string>> = {
  conflict: "La receta chocó con otro cambio. Actualiza e inténtalo de nuevo.",
  denied: "Tu rol ya no permite publicar recetas.",
  invalid: "Revisa las líneas de la receta e inténtalo de nuevo.",
  missing: "El producto ya no existe. Actualiza la lista.",
  timeout: "El servidor tardó demasiado. Reintenta con los mismos datos.",
  unauthenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  unavailable: "No se pudo publicar. Revisa la conexión e inténtalo de nuevo.",
};

interface RecipesPanelProps {
  readonly action: (operation: InventoryOperation, input?: unknown) => Promise<InventoryActionResult>;
  readonly canManage: boolean;
  readonly items: readonly InventoryItemV1[];
  readonly itemsStatus: LoadStatus;
  readonly onRetryCatalog: () => void;
}

export function RecipesPanel({
  action,
  canManage,
  items,
  itemsStatus,
  onRetryCatalog,
}: RecipesPanelProps): ReactNode {
  const [products, setProducts] = useState<readonly RecipeProductV1[]>();
  const [productsError, setProductsError] = useState<InventoryError>();
  const [productsReload, setProductsReload] = useState(0);
  const [productQuery, setProductQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [versions, setVersions] = useState<readonly RecipeSummaryV1[]>();
  const [versionsError, setVersionsError] = useState<InventoryError>();
  const [versionsReload, setVersionsReload] = useState(0);
  const [activeVersion, setActiveVersion] = useState<RecipeVersionV1>();
  const [detailError, setDetailError] = useState<InventoryError>();
  const [draftLines, setDraftLines] = useState<readonly RecipeLineDraft[]>([]);
  const [editorError, setEditorError] = useState<string>();
  const [publishLines, setPublishLines] = useState<readonly RecipeLineV1[]>();
  const [notice, setNotice] = useState<string>();
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

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
    if (productId === "") {
      setVersions(undefined);
      setVersionsError(undefined);
      setActiveVersion(undefined);
      setDetailError(undefined);
      setDraftLines([]);
      return undefined;
    }
    let cancelled = false;
    setVersions(undefined);
    setVersionsError(undefined);
    setActiveVersion(undefined);
    setDetailError(undefined);
    setDraftLines([]);
    void (async () => {
      try {
        const reply = await action("listRecipes", { productId });
        if (cancelled) return;
        if (!(reply.ok && "recipes" in reply)) {
          setVersionsError(reply.ok ? "unavailable" : reply.error);
          return;
        }
        setVersions(reply.recipes);
        const active = reply.recipes.find((recipe) => recipe.active);
        if (active === undefined) return;
        const detail = await action("readRecipe", { recipeId: active.recipeId });
        if (cancelled) return;
        if (detail.ok && "recipe" in detail) {
          setActiveVersion(detail.recipe);
          setDraftLines(detail.recipe.lines.map((line) => ({
            itemId: line.itemId,
            quantity: String(line.quantity),
            unitCode: line.unitCode,
          })));
          return;
        }
        setDetailError(detail.ok ? "unavailable" : detail.error);
      } catch {
        if (!cancelled) setVersionsError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, productId, versionsReload]);

  useEffect(() => {
    if (notice === undefined) return undefined;
    const timeout = window.setTimeout(() => setNotice(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selectedProduct = products?.find((product) => product.productId === productId);
  const filteredProducts = products === undefined ? [] : filterInventoryItems(products, productQuery);
  const selectableProducts = selectedProduct !== undefined
    && !filteredProducts.some((product) => product.productId === selectedProduct.productId)
    ? [selectedProduct, ...filteredProducts]
    : filteredProducts;
  const sortedVersions = versions === undefined
    ? undefined
    : [...versions].sort((left, right) => right.version - left.version);
  const activeSummary = sortedVersions?.find((recipe) => recipe.active);
  const historical = sortedVersions?.filter((recipe) => !recipe.active) ?? [];

  function selectProduct(nextProductId: string): void {
    setProductId(nextProductId);
    setEditorError(undefined);
  }

  function addLine(): void {
    setDraftLines((current) => [...current, { itemId: "", quantity: "1", unitCode: "g" }]);
  }

  function updateLine(index: number, patch: Partial<RecipeLineDraft>): void {
    setDraftLines((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, ...patch } : line
    )));
  }

  function removeLine(index: number): void {
    setDraftLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }

  function openPublish(): void {
    const validation = validateRecipeLineDrafts(draftLines);
    if (!validation.ok) {
      setEditorError(validation.error);
      return;
    }
    setEditorError(undefined);
    setPublishLines(validation.lines);
  }

  function published(): void {
    setPublishLines(undefined);
    setNotice("Receta publicada.");
    setVersionsReload((current) => current + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Recetas por producto</h2>
      </div>

      {notice !== undefined && (
        <p role="status" className="rounded-lg border border-success bg-success-bg px-3 py-2 text-sm">{notice}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field className="grid gap-1 text-sm" hint="Escribe parte del nombre o de la clave para filtrar productos." label="Buscar producto">
          {(id) => (
            <input
              id={id}
              type="search"
              className={inputClass}
              placeholder="Nombre o clave del producto"
              autoComplete="off"
              value={productQuery}
              onChange={(event) => setProductQuery(event.target.value)}
            />
          )}
        </Field>
        <Field className="grid gap-1 text-sm" hint="Producto del menú cuya receta quieres consultar o cambiar." label="Producto">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={productId}
              disabled={products === undefined || productsError !== undefined}
              onChange={(event) => selectProduct(event.target.value)}
            >
              <option value="">Elige un producto</option>
              {selectableProducts.map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.active ? product.name : `${product.name} · Inactivo`}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {products === undefined && productsError === undefined && (
        <p role="status" className="text-sm text-text-muted">Cargando productos del menú…</p>
      )}
      {productsError !== undefined && (
        <LoadError message={LIST_ERRORS[productsError]} onRetry={() => setProductsReload((current) => current + 1)} />
      )}
      {products !== undefined && products.length === 0 && (
        <p className="text-sm text-text-muted">Aún no hay productos en el menú. Crea uno en Menú para asignarle una receta.</p>
      )}
      {products !== undefined && products.length > 0 && selectableProducts.length === 0 && (
        <p className="text-sm text-text-muted">No hay productos que coincidan con «{productQuery.trim()}».</p>
      )}

      {productId !== "" && (
        <>
          {sortedVersions === undefined && versionsError === undefined && (
            <p role="status" className="text-sm text-text-muted">Cargando versiones de la receta…</p>
          )}
          {versionsError !== undefined && (
            <LoadError message={LIST_ERRORS[versionsError]} onRetry={() => setVersionsReload((current) => current + 1)} />
          )}
          {sortedVersions !== undefined && sortedVersions.length === 0 && (
            <p className="text-sm text-text-muted">Este producto aún no tiene receta.</p>
          )}

          {activeSummary !== undefined && (
            <section className="rounded-xl border border-accent bg-surface p-4">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong className="break-words text-base">{formatRecipeVersionLabel(activeSummary.version)}</strong>
                <span className="inline-flex min-h-6 items-center rounded-full border border-success px-2 text-xs font-semibold">
                  {recipeVersionStateLabel(true)}
                </span>
              </span>
              <span className="mt-1 block text-sm text-text-muted">
                Publicada el {formatInventoryTimestamp(activeSummary.createdAt, timeZone)}
              </span>
              {activeSummary.notes !== null && (
                <span className="mt-1 block break-words text-sm text-text-muted">Notas: {activeSummary.notes}</span>
              )}
              {activeVersion === undefined && detailError === undefined && (
                <p role="status" className="mt-2 text-sm text-text-muted">Cargando líneas de la receta…</p>
              )}
              {detailError !== undefined && (
                <LoadError message={LIST_ERRORS[detailError]} onRetry={() => setVersionsReload((current) => current + 1)} />
              )}
              {activeVersion !== undefined && <RecipeLines lines={activeVersion.lines} items={items} />}
            </section>
          )}

          {historical.length > 0 && (
            <details className="rounded-xl border border-border bg-surface p-4">
              <summary className="flex min-h-11 cursor-pointer items-center font-heading text-base font-semibold">
                Versiones anteriores ({historical.length})
              </summary>
              <ul className="mt-2 grid gap-2">
                {historical.map((summary) => (
                  <li key={summary.recipeId}>
                    <HistoricalVersion
                      action={action}
                      items={items}
                      summary={summary}
                      timeZone={timeZone}
                    />
                  </li>
                ))}
              </ul>
            </details>
          )}

          {sortedVersions !== undefined && (
            <section className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-heading text-base font-semibold">Receta en edición</h3>
                {canManage && (
                  <button type="button" className={uiButton()} disabled={itemsStatus !== "ready"}
                    onClick={addLine}>
                    Agregar insumo
                  </button>
                )}
              </div>

              {itemsStatus === "loading" || itemsStatus === "idle" ? (
                <p role="status" className="text-sm text-text-muted">Cargando insumos…</p>
              ) : itemsStatus === "error" ? (
                <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
                  <p>No se pudieron cargar los insumos.</p>
                  <button type="button" className={`${uiButton()} mt-2`} onClick={onRetryCatalog}>Reintentar</button>
                </div>
              ) : null}

              {draftLines.length === 0 && (
                <p className="text-sm text-text-muted">Agrega al menos un insumo para armar la receta.</p>
              )}

              {draftLines.length > 0 && (
                <ul className="grid gap-2">
                  {draftLines.map((line, index) => {
                    const selectedItem = items.find((item) => item.id === line.itemId);
                    return (
                      <li key={index} className="grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
                        <Field className="grid gap-1 text-sm" hint="Insumo que se descuenta al vender este producto." label={`Insumo ${index + 1}`}>
                          {(id) => (
                            <select
                              id={id}
                              className={inputClass}
                              value={line.itemId}
                              disabled={!canManage}
                              onChange={(event) => {
                                const item = items.find((candidate) => candidate.id === event.target.value);
                                updateLine(index, {
                                  itemId: event.target.value,
                                  unitCode: item === undefined ? line.unitCode : item.unitCode,
                                });
                              }}
                            >
                              <option value="">Elige un insumo</option>
                              {items.map((item) => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                              ))}
                            </select>
                          )}
                        </Field>
                        <Field className="grid gap-1 text-sm" hint="Cantidad entera positiva en la unidad del insumo." label="Cantidad">
                          {(id) => (
                            <input
                              id={id}
                              className={inputClass}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              value={line.quantity}
                              disabled={!canManage}
                              onChange={(event) => updateLine(index, { quantity: event.target.value })}
                            />
                          )}
                        </Field>
                        <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-stretch">
                          <span className="text-sm text-text-muted">
                            {selectedItem === undefined ? "Unidad del insumo" : inventoryUnitLabel(selectedItem.unitCode)}
                          </span>
                          {canManage && (
                            <button type="button" className={uiButton("danger")}
                              onClick={() => removeLine(index)}>
                              Quitar
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {editorError !== undefined && (
                <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{editorError}</p>
              )}

              {canManage && (
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className={uiButton("primary")} disabled={itemsStatus !== "ready"}
                    onClick={openPublish}>
                    Publicar versión
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {publishLines !== undefined && selectedProduct !== undefined && (
        <PublishDialog
          action={action}
          items={items}
          lines={publishLines}
          product={selectedProduct}
          onClose={() => setPublishLines(undefined)}
          onPublished={published}
        />
      )}
    </div>
  );
}

function RecipeLines({ items, lines }: {
  readonly items: readonly InventoryItemV1[];
  readonly lines: readonly RecipeLineV1[];
}): ReactNode {
  if (lines.length === 0) return <p className="mt-2 text-sm text-text-muted">Esta versión no tiene líneas.</p>;
  return (
    <ul className="mt-2 grid gap-1">
      {lines.map((line, index) => (
        <li key={`${line.itemId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="break-words">{itemName(items, line.itemId)}</span>
          <span className="font-semibold">
            {formatInventoryNumber(line.quantity)} {inventoryUnitLabel(line.unitCode)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function HistoricalVersion({ action, items, summary, timeZone }: {
  readonly action: RecipesPanelProps["action"];
  readonly items: readonly InventoryItemV1[];
  readonly summary: RecipeSummaryV1;
  readonly timeZone: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<RecipeVersionV1>();
  const [error, setError] = useState<InventoryError>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError(undefined);
    void (async () => {
      try {
        const reply = await action("readRecipe", { recipeId: summary.recipeId });
        if (cancelled) return;
        if (reply.ok && "recipe" in reply) {
          setVersion(reply.recipe);
          return;
        }
        setError(reply.ok ? "unavailable" : reply.error);
      } catch {
        if (!cancelled) setError("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [action, open, reload, summary.recipeId]);

  return (
    <details className="rounded-lg border border-border bg-bg p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{formatRecipeVersionLabel(summary.version)}</span>
        <span className="text-sm text-text-muted">
          {recipeVersionStateLabel(false)} · {formatInventoryTimestamp(summary.createdAt, timeZone)}
        </span>
      </summary>
      {open && version === undefined && error === undefined && (
        <p role="status" className="mt-2 text-sm text-text-muted">Cargando líneas…</p>
      )}
      {open && error !== undefined && (
        <LoadError message={LIST_ERRORS[error]} onRetry={() => setReload((current) => current + 1)} />
      )}
      {open && version !== undefined && <RecipeLines items={items} lines={version.lines} />}
    </details>
  );
}

function PublishDialog({ action, items, lines, product, onClose, onPublished }: {
  readonly action: RecipesPanelProps["action"];
  readonly items: readonly InventoryItemV1[];
  readonly lines: readonly RecipeLineV1[];
  readonly product: RecipeProductV1;
  readonly onClose: () => void;
  readonly onPublished: () => void;
}): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const close = (): void => { if (!saving) onClose(); };

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    setError(undefined);
    setSaving(true);
    void (async () => {
      try {
        const reply = await action("publishRecipe", {
          lines,
          productId: product.productId,
        });
        if (reply.ok && "published" in reply) {
          setSaving(false);
          onPublished();
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
    <InventoryModal title="Publicar nueva versión de receta" onClose={close}>
      <form onSubmit={submit} className="mt-4 grid gap-3" aria-busy={saving}>
        <p className="break-words text-sm">
          Se publicará una nueva versión activa de <strong>{product.name}</strong> con {lines.length}
          {lines.length === 1 ? " insumo" : " insumos"}. La versión actual quedará como histórica.
        </p>
        <ul className="grid gap-1 rounded-lg border border-border bg-bg p-3">
          {lines.map((line, index) => (
            <li key={`${line.itemId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="break-words">{itemName(items, line.itemId)}</span>
              <span className="font-semibold">
                {formatInventoryNumber(line.quantity)} {inventoryUnitLabel(line.unitCode)}
              </span>
            </li>
          ))}
        </ul>
        {error !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={uiButton()} onClick={close} disabled={saving}>Cancelar</button>
          <button type="submit" className={uiButton("primary")} disabled={saving}>
            {saving ? "Publicando…" : "Publicar versión"}
          </button>
        </div>
      </form>
    </InventoryModal>
  );
}

function itemName(items: readonly InventoryItemV1[], itemId: string): string {
  return items.find((item) => item.id === itemId)?.name ?? "Insumo";
}

function LoadError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }): ReactNode {
  return (
    <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
      <p>{message}</p>
      <button type="button" className={`${uiButton()} mt-2`} onClick={onRetry}>Reintentar</button>
    </div>
  );
}
