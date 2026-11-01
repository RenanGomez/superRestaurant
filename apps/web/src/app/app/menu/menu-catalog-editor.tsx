"use client";

import { MENU_CATEGORY_COLORS, MENU_PRODUCT_MAX_VARIANTS, MENU_VARIANT_MAX_EXCLUDABLE_INGREDIENTS } from "@super-restaurant/shared-types";
import type {
  MenuCategoryV1,
  MenuCatalogStateV1,
  MenuModifierGroupV1,
  MenuModifierOptionV1,
  MenuProductV1,
  MenuProductVariantV1,
  MenuProductFractionV1,
} from "@super-restaurant/shared-types";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CheckField, Field, FieldHint } from "../../../components/field-hint";
import { MENU_DEFAULT_UNIT, MENU_OTHER_STATION, MENU_STATION_MAX_LENGTH, stationValues, unitOptions } from "../../../lib/menu-fields";
import { shrinkMenuImage } from "../../../lib/menu-image-resize";
import { applyRemoval, removalNeedsConfirmation, type Removal } from "../../../lib/menu-removal";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { DEFAULT_PESO_CURRENCY, formatMinorForMoneyInput, parseMoneyInputToMinor } from "../../../lib/capture-payment";
import { currencyFractionDigits } from "../../../lib/money-scale";
import { isMenuImageContentType, menuImageAttempt, menuImagePublicUrl, publishDisabledReason, shouldDownscaleMenuImage, validateMenuImageFile, type MenuImageAttempt } from "../../../lib/menu-images";
import { editorProductFraction, legacyFractionNotice, migrateLegacyFraction } from "../../../lib/menu-fraction";
import { variantValidationError } from "../../../lib/menu-variants";
import { reorder, reorderSubset } from "../../../lib/menu-reorder";
import { duplicateProduct } from "../../../lib/menu-duplicate";
import { menuDraftKey, menuDraftSnapshot, parseMenuDraft, serializeMenuDraft, staleMenuDraftKeys, type LocalMenuDraft } from "../../../lib/menu-draft-storage";
import { MENU_CATEGORY_COLOR_LABELS, menuCategoryColorClasses } from "../../../lib/menu-category-color";
import { collectUsedImagePaths, imagePathsOfEntity, retainImagePaths } from "../../../lib/menu-used-images";
import { DragReorderList, ReorderButtons, ReorderHandle, reorderRowProps } from "./reorder-controls";

import { saveMenuCatalogAction, uploadMenuImageAction } from "./actions";

interface Draft {
  readonly categories: readonly MenuCategoryV1[];
  readonly currency: string;
  readonly expectedVersion: number;
  readonly modifierGroups: readonly MenuModifierGroupV1[];
  readonly products: readonly MenuProductV1[];
}

export function MenuCatalogEditor({ branchId, canManage, restaurantId, state, supabaseUrl }: {
  readonly branchId: string;
  readonly canManage: boolean;
  readonly restaurantId: string;
  readonly state: MenuCatalogStateV1;
  readonly supabaseUrl: string;
}): ReactNode {
  const currency = state.catalog?.currency ?? DEFAULT_PESO_CURRENCY;
  const [categories, setCategories] = useState<readonly MenuCategoryV1[]>(() =>
    state.catalog?.categories.map((category) => ({ ...category })) ?? [],
  );
  const [products, setProducts] = useState<readonly MenuProductV1[]>(() =>
    state.catalog?.products.map((product) => ({ ...product, variants: product.variants?.map((variant) => ({ ...variant })) ?? [], tax: product.tax === null ? null : { ...product.tax } })) ?? [],
  );
  const [groups, setGroups] = useState<readonly MenuModifierGroupV1[]>(() =>
    state.catalog?.modifierGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option })),
    })) ?? [],
  );
  const [removal, setRemoval] = useState<Removal | null>(null);
  // Legacy per-size halves move to the product on save (the server rejects both at once); validate and send that shape.
  const savedProducts = useMemo(() => products.map(migrateLegacyFraction), [products]);
  const variantIssue = savedProducts.map((product) => variantValidationError(product.productId, product.variants ?? [], new Set(groups.filter((group) => group.productId === product.productId).map((group) => group.groupId)), product.fraction)).find((issue) => issue !== null) ?? null;
  const variantError = variantIssue === null ? null : `${products.find((product) => product.productId === variantIssue.productId)?.name || "Producto sin nombre"}: ${variantIssue.message}`;
  const [pendingUploads, setPendingUploads] = useState(0);
  const onUploadPendingChange = (pending: boolean): void => setPendingUploads((current) => current + (pending ? 1 : -1));
  const expectedVersion = state.catalog?.version ?? 0;
  const draft = useMemo(() => JSON.stringify({ categories, currency, expectedVersion, modifierGroups: groups, products: savedProducts } satisfies Draft), [categories, currency, expectedVersion, groups, savedProducts]);

  // Local draft: edits are kept in this browser (never published automatically) and offered back after a reload.
  const storageKey = menuDraftKey(restaurantId, branchId, expectedVersion);
  const snapshot = useMemo(() => menuDraftSnapshot({ categories, groups, products }), [categories, groups, products]);
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = snapshot !== baseline;
  const [recovery, setRecovery] = useState<LocalMenuDraft | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const latest = useRef({ baseline, snapshot });
  const knownVersion = useRef<number | null>(null);
  useEffect(() => { latest.current = { baseline, snapshot }; }, [baseline, snapshot]);
  useEffect(() => {
    const published = knownVersion.current !== null && knownVersion.current !== expectedVersion;
    knownVersion.current = expectedVersion;
    try {
      for (const key of staleMenuDraftKeys(Object.keys(window.localStorage), restaurantId, branchId, expectedVersion)) window.localStorage.removeItem(key);
      const stored = published ? null : parseMenuDraft(window.localStorage.getItem(storageKey), expectedVersion);
      if (stored !== null && menuDraftSnapshot(stored) !== latest.current.baseline) setRecovery(stored);
      else if (stored !== null) window.localStorage.removeItem(storageKey);
    } catch { setStorageFailed(true); }
    // A new published version makes the current edits the new baseline.
    if (published) setBaseline(latest.current.snapshot);
    setStorageReady(true);
  }, [branchId, expectedVersion, restaurantId, storageKey]);
  useEffect(() => {
    if (!storageReady || recovery !== null || !canManage) return;
    const timer = window.setTimeout(() => {
      try {
        if (snapshot === baseline) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, serializeMenuDraft({ categories, expectedVersion, groups, products }));
        setStorageFailed(false);
      } catch { setStorageFailed(true); }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [baseline, canManage, categories, expectedVersion, groups, products, recovery, snapshot, storageKey, storageReady]);
  const recoverDraft = (): void => {
    if (recovery === null) return;
    setCategories(recovery.categories);
    setProducts(recovery.products);
    setGroups(recovery.groups);
    setRecovery(null);
  };
  const discardRecovery = (): void => {
    try { window.localStorage.removeItem(storageKey); } catch { setStorageFailed(true); }
    setRecovery(null);
  };

  // Photos in use now plus the ones removed during this session, so a mistaken «Quitar» can be undone.
  const currentImagePaths = useMemo(() => collectUsedImagePaths(products, groups, categories), [products, groups, categories]);
  const [retainedImagePaths, setRetainedImagePaths] = useState<readonly string[]>([]);
  useEffect(() => { setRetainedImagePaths((previous) => retainImagePaths(previous, currentImagePaths)); }, [currentImagePaths]);
  const usedImagePaths = useMemo(() => retainImagePaths(retainedImagePaths, currentImagePaths), [retainedImagePaths, currentImagePaths]);

  const [copiedProductIds, setCopiedProductIds] = useState<readonly string[]>([]);
  const focusAfterCopy = useRef<string | null>(null);
  useEffect(() => {
    const productId = focusAfterCopy.current;
    if (productId === null) return;
    const card = document.querySelector<HTMLElement>(`[data-product-id="${CSS.escape(productId)}"]`);
    if (card === null) return;
    focusAfterCopy.current = null;
    card.scrollIntoView({ block: "center" });
    card.querySelector<HTMLInputElement>("input[type=text]")?.focus({ preventScroll: true });
  }, [products]);
  const copyProduct = (productId: string): void => {
    const source = products.find((entry) => entry.productId === productId);
    if (source === undefined) return;
    const copy = duplicateProduct(source, groups, () => crypto.randomUUID(), nextDisplayOrder(products.filter((entry) => entry.categoryId === source.categoryId)));
    focusAfterCopy.current = copy.product.productId;
    setCopiedProductIds((current) => [...current, copy.product.productId]);
    setProducts((current) => [...current, copy.product]);
    setGroups((current) => [...current, ...copy.groups]);
  };

  const addCategory = (): void => {
    setCategories((current) => [...current, {
      active: true,
      categoryId: crypto.randomUUID(),
      color: null,
      displayOrder: nextDisplayOrder(current),
      imagePath: null,
      name: "Nueva categoría",
    }]);
  };
  const addProduct = (): void => {
    const category = categories[0];
    if (category === undefined) return;
    setProducts((current) => [...current, {
      active: true,
      categoryId: category.categoryId,
      displayOrder: nextDisplayOrder(current),
      imagePath: null,
      name: "Nuevo producto",
      productId: crypto.randomUUID(),
      sku: null,
      stationId: "general",
      tax: null,
      unit: MENU_DEFAULT_UNIT,
      unitPriceMinor: 0,
      variants: [],
    }]);
  };
  const addGroup = (productId: string): void => {
    setGroups((current) => [...current, {
      active: true,
      displayOrder: nextDisplayOrder(current.filter((group) => group.productId === productId)),
      groupId: crypto.randomUUID(),
      maximumQuantity: 1,
      minimumQuantity: 0,
      name: "Nuevo grupo",
      options: [{ active: true, imagePath: null, maximumQuantity: null, name: "Nueva opción", optionId: crypto.randomUUID(), unitPriceMinor: 0 }],
      productId,
    }]);
  };
  const addOption = (groupId: string): void => {
    setGroups((current) => current.map((group) => group.groupId === groupId ? {
      ...group,
      options: [...group.options, {
        active: true,
        imagePath: null,
        maximumQuantity: null,
        name: "Nueva opción",
        optionId: crypto.randomUUID(),
        unitPriceMinor: 0,
      }],
    } : group));
  };

  const performRemoval = (target: Removal): void => {
    const next = applyRemoval({ categories, groups, products }, target);
    setCategories(next.categories);
    setProducts(next.products);
    setGroups(next.groups);
  };
  const requestRemoval = (request: Removal): void => {
    if (removalNeedsConfirmation(request)) setRemoval(request);
    else performRemoval(request);
  };
  const confirmRemoval = (): void => {
    if (removal === null) return;
    performRemoval(removal);
    setRemoval(null);
  };

  return (
    <form action={saveMenuCatalogAction} onSubmit={(event) => { if (publishDisabledReason(pendingUploads, false) !== null || variantError !== null) event.preventDefault(); }} className="flex min-w-0 flex-col gap-5">
      <input type="hidden" name="draft" value={draft} />
      <section className="sticky top-0 z-20 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-surface/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">Versión actual</p>
            <p className="font-heading text-[18px] font-bold">{expectedVersion === 0 ? "Sin publicar" : `v${expectedVersion}`}</p>
          </div>
          <p className="pb-2 text-[12px] text-text-muted">
            {categories.length} categorías · {products.length} productos · {groups.length} grupos
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p role="status" className={`text-[12px] ${dirty ? "font-semibold text-accent-hover" : "text-text-muted"}`}>
              {dirty ? (storageFailed ? "Cambios sin publicar · no se pudieron guardar en este navegador" : "Cambios sin publicar · guardados localmente") : "Todo publicado"}
            </p>
            <PublishButton dirty={dirty} pendingUploads={pendingUploads} variantError={variantError} />
          </div>
        ) : (
          <p className="rounded-lg bg-bg px-3 py-2 text-[12px] text-text-muted">Vista de solo lectura</p>
        )}
      </section>
      {variantError !== null && <p role="alert" className="text-sm text-error">{variantError}</p>}
      {recovery !== null && canManage && (
        <section role="status" aria-label="Cambios sin publicar" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent bg-accent-soft p-4">
          <p className="min-w-0 text-[13px]">Hay cambios sin publicar de una sesión anterior guardados en este navegador. Aún no se han publicado.</p>
          <div className="flex gap-2">
            <button type="button" onClick={recoverDraft} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Recuperar cambios sin publicar</button>
            <button type="button" onClick={discardRecovery} className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent">Descartar</button>
          </div>
        </section>
      )}

      {removal !== null && <RemovalDialog removal={removal} onCancel={() => setRemoval(null)} onConfirm={confirmRemoval} />}

      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <SectionHeader title="Categorías" description="Organizan la carta y controlan su orden de aparición.">
          {canManage && <AddButton label="Agregar categoría" onClick={addCategory} />}
        </SectionHeader>
        {categories.length === 0 ? <EmptyText text="Agrega una categoría para comenzar el menú." /> : (
          <DragReorderList className="mt-4 flex flex-col gap-3" disabled={!canManage} getKey={(category) => category.categoryId} items={categories} itemLabel={(category) => category.name} label="Categorías" onMove={(from, to) => setCategories((current) => reorder(current, from, to))}
            renderRow={(category, _index, handle) => (
              <article className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 ${menuCategoryColorClasses(category.color)?.card ?? "border-border bg-bg/50"}`}>
                {handle}
                <MenuPhoto canManage={canManage} imagePath={category.imagePath} name={category.name} supabaseUrl={supabaseUrl} target="category" targetId={category.categoryId} usedImagePaths={usedImagePaths}
                  onChange={(imagePath) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, imagePath } : entry))} onUploadPendingChange={onUploadPendingChange} />
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="flex min-w-0 flex-col gap-2">
                    <TextInput disabled={!canManage} hint="Nombre de la sección de la carta, por ejemplo Pizzas o Bebidas. El operador navega por estas categorías." label="Nombre" maxLength={80} value={category.name} onChange={(name) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, name } : entry))} />
                    <CategoryColorPicker disabled={!canManage} name={category.name} value={category.color} onChange={(color) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, color } : entry))} />
                  </div>
                  <div className="flex items-end gap-2 pb-1">
                    <ActiveInput disabled={!canManage} checked={category.active} onChange={(active) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, active } : entry))} />
                    {canManage && <RemoveButton label={`Quitar ${category.name}`} onClick={() => setRemoval({ id: category.categoryId, kind: "category", label: category.name })} />}
                  </div>
                </div>
              </article>
            )} />

        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <SectionHeader title="Productos y modificadores" description="Captura precios en la moneda del restaurante; los grupos pertenecen a un solo producto.">
          {canManage && <AddButton disabled={categories.length === 0} label="Agregar producto" onClick={addProduct} />}
        </SectionHeader>
        {products.length === 0 ? <EmptyText text="No hay productos en este borrador." /> : (
          <div className="mt-4 flex flex-col gap-5">
            {categories.map((category) => {
              const inCategory = products.filter((entry) => entry.categoryId === category.categoryId);
              if (inCategory.length === 0) return null;
              return (
                <div key={category.categoryId} className="flex min-w-0 flex-col gap-2">
                  <h3 className="font-heading text-[13px] font-semibold text-text-muted">{category.name.trim() === "" ? "Categoría sin nombre" : category.name}</h3>
                  <DragReorderList className="flex flex-col gap-4" disabled={!canManage} getKey={(entry) => entry.productId} items={inCategory} itemLabel={(entry) => entry.name}
                    label={`Productos de ${category.name}`}
                    onMove={(from, to) => setProducts((current) => reorderSubset(current, (entry) => entry.categoryId === category.categoryId, from, to))}
                    renderRow={(product, _index, handle) => (
              <ProductEditor handle={handle} copyNotice={copiedProductIds.includes(product.productId) && product.imagePath === null}usedStations={products.map((entry) => entry.stationId)} usedImagePaths={usedImagePaths} variantInvalid={variantIssue?.productId === product.productId}
                canManage={canManage}
                categories={categories}
                currency={currency}
                groups={groups.filter((group) => group.productId === product.productId)}
                product={product}
                supabaseUrl={supabaseUrl}
                onAddGroup={() => addGroup(product.productId)}
                onAddOption={addOption}
                onDuplicate={() => copyProduct(product.productId)}
                onGroupsChange={setGroups}
                onProductChange={(changed) => setProducts((current) => current.map((entry) => entry.productId === changed.productId ? changed : entry))}
                onProductImageChange={(imagePath) => setProducts((current) => current.map((entry) => entry.productId === product.productId ? { ...entry, imagePath } : entry))}
                onOptionImageChange={(groupId, optionId, imagePath) => setGroups((current) => current.map((entry) => entry.groupId === groupId ? { ...entry, options: entry.options.map((option) => option.optionId === optionId ? { ...option, imagePath } : option) } : entry))}
                onRemove={requestRemoval}
                onUploadPendingChange={onUploadPendingChange}
              />
                    )} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </form>
  );
}

/**
 * Confirmation pinned to the bottom of the viewport. It used to render at the top of the form, so with the
 * list scrolled down the «×» seemed to do nothing: the question was open but off screen.
 */
function RemovalDialog({ removal, onCancel, onConfirm }: { readonly removal: Removal; readonly onCancel: () => void; readonly onConfirm: () => void }): ReactNode {
  // Initial focus on the safe choice: an accidental Enter cancels instead of removing.
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelButton.current?.focus(); }, [removal]);
  return (
    <section role="alertdialog" aria-labelledby="remove-title" aria-describedby="remove-description"
      onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg rounded-xl border border-[oklch(80%_0.09_45)] bg-[oklch(97%_0.025_70)] p-4 shadow-xl">
      <h2 id="remove-title" className="font-heading text-[14px] font-semibold">¿Quitar “{removal.label}” del borrador?</h2>
      <p id="remove-description" className="mt-1 text-[12px] text-text-muted">La publicación anterior seguirá intacta. Si contiene elementos dependientes, también se quitarán de esta nueva versión.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onConfirm} className="min-h-11 rounded-lg bg-error px-4 py-2 text-[13px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Sí, quitar</button>
        <button ref={cancelButton} type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent">Cancelar</button>
      </div>
    </section>
  );
}

function PublishButton({ dirty, pendingUploads, variantError }: { readonly dirty: boolean; readonly pendingUploads: number; readonly variantError: string | null }): ReactNode {
  const { pending: saving } = useFormStatus();
  const disabledReason = variantError ?? publishDisabledReason(pendingUploads, saving);
  return <span className="relative inline-flex">
    {/* Pulsing ring only while there are unpublished changes; it does not animate with reduced motion. */}
    {dirty && <span aria-hidden="true" data-testid="publish-pulse" className="pointer-events-none absolute -inset-1 rounded-2xl ring-2 ring-accent/60 motion-safe:animate-pulse" />}
    <button type="submit" disabled={disabledReason !== null}
      className="relative min-h-11 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60">
      {disabledReason ?? "Publicar nueva versión"}
    </button>
  </span>;
}

function taxNote(tax: MenuProductV1["tax"], formattedPrice: string): string | undefined {
  if (tax === null) return undefined;
  const percent = (tax.rateNumerator * 100) / tax.rateDenominator;
  const rate = Number.isInteger(percent) ? `${percent} %` : `${percent.toFixed(2)} %`;
  const name = tax.name.trim() === "" ? "Impuesto" : tax.name.trim();
  // Display only: the server computes taxes and totals when the order is charged.
  return tax.inclusion === "included" ? `Total con ${name} (${rate}) incluido: ${formattedPrice}` : `${formattedPrice} + ${name} ${rate}; se calcula al cobrar`;
}

/**
 * Product card in three rows: (1) photo, name, price, unit, active, remove; (2) category, internal key, station;
 * (3) switches for modifier groups, halves and tax plus «+ Añadir tamaño». Each section shows only while its
 * switch is on (or it already has data), so a plain product takes three rows.
 */
function ProductEditor({ copyNotice, handle, usedStations, usedImagePaths, variantInvalid, canManage, categories, currency, groups, product, supabaseUrl, onAddGroup, onAddOption, onDuplicate, onGroupsChange, onProductChange, onProductImageChange, onOptionImageChange, onRemove, onUploadPendingChange }: {
  readonly copyNotice: boolean;
  readonly handle: ReactNode;
  readonly usedStations: readonly string[];
  readonly usedImagePaths: readonly string[];
  readonly variantInvalid: boolean;
  readonly canManage: boolean;
  readonly categories: readonly MenuCategoryV1[];
  readonly currency: string;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly product: MenuProductV1;
  readonly supabaseUrl: string;
  readonly onAddGroup: () => void;
  readonly onAddOption: (groupId: string) => void;
  readonly onDuplicate: () => void;
  readonly onGroupsChange: (updater: (current: readonly MenuModifierGroupV1[]) => readonly MenuModifierGroupV1[]) => void;
  readonly onProductChange: (product: MenuProductV1) => void;
  readonly onProductImageChange: (imagePath: string | null) => void;
  readonly onOptionImageChange: (groupId: string, optionId: string, imagePath: string | null) => void;
  readonly onRemove: (removal: Removal) => void;
  readonly onUploadPendingChange: (pending: boolean) => void;
}): ReactNode {
  const change = (patch: Partial<MenuProductV1>): void => onProductChange({ ...product, ...patch });
  const tax = product.tax;
  const variants = product.variants ?? [];
  const fraction = editorProductFraction(product);
  // The groups switch is open by choice or because the product already has groups (cancelling a removal keeps them visible).
  const [groupsOpen, setGroupsOpen] = useState(false);
  const showGroups = groupsOpen || groups.length > 0;
  const changeVariant = (variantId: string, patch: Partial<MenuProductVariantV1>): void =>
    change({ variants: variants.map((variant) => variant.variantId === variantId ? { ...variant, ...patch } : variant) });
  const switchClass = "inline-flex min-h-11 items-center gap-2 text-[12px] font-semibold";
  return (
    <article data-product-id={product.productId} className="flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-bg/40 p-3 sm:p-4">
      {handle}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="grid items-end gap-3 lg:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
        <MenuPhoto canManage={canManage} imagePath={product.imagePath} name={product.name} supabaseUrl={supabaseUrl} target="product" targetId={product.productId} usedImagePaths={usedImagePaths} onChange={onProductImageChange} onUploadPendingChange={onUploadPendingChange} />
        <TextInput disabled={!canManage} hint="Nombre que ve el operador al tomar el pedido y que se imprime en la comanda." label="Producto" maxLength={120} value={product.name} onChange={(name) => change({ name })} />
        <MoneyInput hint="Precio de venta por unidad en la moneda del restaurante. Si el producto tiene tamaños, cada tamaño usa su propio precio." disabled={!canManage} currency={currency} note={taxNote(tax, formatMinorUnits(product.unitPriceMinor, currency))} value={product.unitPriceMinor} onChange={(unitPriceMinor) => change({ unitPriceMinor })} />
        <Field className="flex min-w-0 flex-col gap-1 text-[11px] font-medium" hint="Cómo se mide o se sirve el producto (pieza, porción, g, ml…). Sólo informativa en el ticket." label="Unidad">{(id) =>
          <select id={id} disabled={!canManage} value={product.unit} onChange={(event) => change({ unit: event.target.value })} className="min-h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70">
            {unitOptions(product.unit).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>}</Field>
        <div className="flex items-end gap-2 pb-1">
          <ActiveInput disabled={!canManage} checked={product.active} onChange={(active) => change({ active })} />
          {canManage && <RemoveButton label={`Quitar ${product.name}`} onClick={() => onRemove({ id: product.productId, kind: "product", label: product.name })} />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field className="flex min-w-0 flex-col gap-1 text-[11px] font-medium" hint="Sección de la carta donde aparece este producto; el operador navega por categorías." label="Categoría">{(id) =>
          <select id={id} disabled={!canManage} value={product.categoryId} onChange={(event) => change({ categoryId: event.target.value })} className="min-h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70">
            {categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
          </select>}</Field>
        <TextInput disabled={!canManage} hint="Código corto propio (SKU) para inventario o reportes. Puedes dejarlo vacío." label="Clave interna (opcional)" help="Código que usas en inventario o en tu impresora; puedes dejarlo vacío" required={false} maxLength={64} value={product.sku ?? ""} onChange={(sku) => change({ sku: sku.trim() === "" ? null : sku })} />
        <StationSelect disabled={!canManage} usedStations={usedStations} value={product.stationId} onChange={(stationId) => change({ stationId })} />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <CheckField labelClassName="flex min-h-11 items-center" className={switchClass} hint="Listas de opciones que el cliente puede elegir para este producto: sabores, extras, término de cocción, etc." label="Grupos de modificadores">{(id) =>
          <input id={id} disabled={!canManage} type="checkbox" className="h-5 w-5" checked={showGroups}
            onChange={(event) => {
              if (event.target.checked) { setGroupsOpen(true); return; }
              setGroupsOpen(false);
              if (groups.length > 0) onRemove({ id: product.productId, kind: "groups", label: `todos los grupos de modificadores de ${product.name.trim() === "" ? "este producto" : product.name}` });
            }} />}</CheckField>
        <CheckField labelClassName="flex min-h-11 items-center" className={switchClass} label="Permitir mitades"
          hint="Cada mitad lleva un sabor del grupo de sabores; una de las dos puede armarse con ingredientes si eliges un grupo de ingredientes. Aplica a todos los tamaños.">{(id) =>
          <input id={id} type="checkbox" className="h-5 w-5" disabled={!canManage} checked={fraction.enabled}
            onChange={(event) => change({ fraction: { ...fraction, enabled: event.target.checked } })} />}</CheckField>
        <CheckField labelClassName="flex min-h-11 items-center" className={switchClass} hint="Marca si este producto causa IVA u otro impuesto. El impuesto se calcula siempre en el servidor con la regla indicada aquí." label="Aplicar impuesto">{(id) =>
          <input id={id} disabled={!canManage} type="checkbox" className="h-5 w-5" checked={tax !== null} onChange={(event) => change({ tax: event.target.checked ? { inclusion: "included", name: "IVA", rateDenominator: 100, rateNumerator: 16, taxId: "iva", taxRuleVersion: "1" } : null })} />}</CheckField>
        {canManage && <AddButton label="Añadir tamaño" disabled={variants.length >= MENU_PRODUCT_MAX_VARIANTS} onClick={() => change({ variants: [...variants, {
          active: true, displayOrder: nextDisplayOrder(variants), name: "", sku: null,
          unitPriceMinor: 0, variantId: crypto.randomUUID(),
        }] })} />}
        {canManage && <button type="button" onClick={onDuplicate} title={`Crear una copia de ${product.name}`} aria-label={`Duplicar ${product.name}`}
          className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold hover:border-accent focus-visible:outline-2 focus-visible:outline-accent sm:ml-auto">Duplicar</button>}
      </div>

      {copyNotice && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-[12px]">Copia de otro producto. La foto no se copia; súbela de nuevo.</p>}

      {variants.length > 0 && <section className="rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="flex items-center gap-1.5 font-heading text-[13px] font-semibold">Tamaños<FieldHint text="Presentaciones del mismo producto (chica, mediana, grande), cada una con su precio. Si no hay tamaños se cobra el precio del producto." /></h3>
            <p className="text-[12px] text-text-muted">Cada tamaño tiene su propio precio.</p></div>
        </div>
        <div className="mt-3 grid gap-3">{variants.map((variant, variantIndex) => <div key={variant.variantId} {...reorderRowProps(`variants-${product.productId}`, variantIndex)}
            className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-bg/50 p-3">
            <ReorderHandle count={variants.length} disabled={!canManage} index={variantIndex} listKey={`variants-${product.productId}`}
              onMove={(from, to) => change({ variants: reorder(variants, from, to) })} />
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)auto_auto]">
            <TextInput disabled={!canManage} hint="Cómo se llama esta presentación, por ejemplo Chica, Mediana o Familiar. No se puede repetir en el mismo producto." invalid={variantInvalid} label="Nombre del tamaño" maxLength={80} value={variant.name}
              onChange={(name) => changeVariant(variant.variantId, { name })} />
            <MoneyInput key={variant.variantId} hint="Precio de venta de este tamaño." label="Precio del tamaño" disabled={!canManage} currency={currency}
              value={variant.unitPriceMinor} onChange={(unitPriceMinor) => changeVariant(variant.variantId, { unitPriceMinor })} />
            <div className="flex items-end"><ReorderButtons count={variants.length} disabled={!canManage} index={variantIndex} label={variant.name || "tamaño nuevo"}
              onMove={(from, to) => change({ variants: reorder(variants, from, to) })} /></div>
            <div className="flex items-end gap-2 pb-1"><ActiveInput disabled={!canManage} checked={variant.active}
              onChange={(active) => changeVariant(variant.variantId, { active })} />
              {canManage && <RemoveButton label={`Quitar tamaño ${variant.name || "nuevo"}`}
                onClick={() => onRemove({ id: variant.variantId, groupId: product.productId, kind: "variant", label: variant.name || "tamaño nuevo", unnamed: variant.name.trim() === "" })} />}
            </div>
            </div>
          </div>)}</div>
      </section>}

      {fraction.enabled && <section className="rounded-xl border border-border bg-surface p-3">
        <FractionEditor canManage={canManage} groups={groups} notice={legacyFractionNotice(product)} productName={product.name}
          fraction={fraction} onChange={(next) => change({ fraction: next })} />
      </section>}

      {tax !== null && <section className="rounded-xl border border-border bg-surface p-3">
        <h3 className="mb-2 font-heading text-[13px] font-semibold">Impuesto</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <TextInput disabled={!canManage} hint="Identificador corto del impuesto, por ejemplo iva. Sirve para agrupar impuestos en reportes." label="Clave" maxLength={64} value={tax.taxId} onChange={(taxId) => change({ tax: { ...tax, taxId } })} />
          <TextInput disabled={!canManage} hint="Nombre que se imprime en el ticket, por ejemplo IVA." label="Nombre fiscal" maxLength={80} value={tax.name} onChange={(name) => change({ tax: { ...tax, name } })} />
          <TextInput disabled={!canManage} hint="Versión de la regla de cálculo. Cámbiala sólo si el impuesto cambia; las ventas anteriores conservan la suya." label="Versión regla" maxLength={64} value={tax.taxRuleVersion} onChange={(taxRuleVersion) => change({ tax: { ...tax, taxRuleVersion } })} />
          <NumberInput disabled={!canManage} hint="Parte de arriba de la tasa como fracción. Para 16 % escribe 16." label="Numerador" min={0} max={1_000_000} value={tax.rateNumerator} onChange={(rateNumerator) => change({ tax: { ...tax, rateNumerator } })} />
          <NumberInput disabled={!canManage} hint="Parte de abajo de la tasa como fracción. Para 16 % escribe 100." label="Denominador" min={1} max={1_000_000} value={tax.rateDenominator} onChange={(rateDenominator) => change({ tax: { ...tax, rateDenominator } })} />
          <Field className="flex flex-col gap-1 text-[11px] font-medium" hint="Incluido: el precio ya trae el impuesto. Adicional: el impuesto se suma al precio al cobrar." label="Tratamiento">{(id) =>
            <select id={id} disabled={!canManage} value={tax.inclusion} onChange={(event) => change({ tax: { ...tax, inclusion: event.target.value as "excluded" | "included" } })} className="min-h-11 rounded-lg border border-border bg-surface px-2 text-[13px]">
              <option value="included">Incluido</option><option value="excluded">Adicional</option>
            </select>}</Field>
        </div>
      </section>}

      {showGroups && <section className="rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 font-heading text-[13px] font-semibold">Grupos de modificadores<FieldHint text="Listas de opciones que el cliente puede elegir para este producto: sabores, extras, término de cocción, etc." /></h3>
          {canManage && <AddButton label="Agregar grupo" onClick={onAddGroup} />}
        </div>
        {groups.length === 0 ? <p className="mt-2 text-[12px] text-text-muted">Sin modificadores.</p> : groups.map((group, groupIndex) => (
          <ModifierGroupEditor key={group.groupId} siblingCount={groups.length} siblingIndex={groupIndex} usedImagePaths={usedImagePaths} onMoveGroup={(from, to) => onGroupsChange((current) => reorderSubset(current, (entry) => entry.productId === product.productId, from, to))} canManage={canManage} currency={currency} group={group} supabaseUrl={supabaseUrl} onAddOption={() => onAddOption(group.groupId)} onChange={(changed) => onGroupsChange((current) => current.map((entry) => entry.groupId === changed.groupId ? changed : entry))} onOptionImageChange={(optionId, imagePath) => onOptionImageChange(group.groupId, optionId, imagePath)} onRemove={onRemove} onUploadPendingChange={onUploadPendingChange} />
        ))}
      </section>}
      </div>
    </article>
  );
}

const GROUP_CHOICE_HINTS = {
  flavors: "Cada opción del grupo es un sabor: una combinación ya definida con su precio fijo (por ejemplo Hawaiana). El operador elige un sabor por mitad.",
  ingredients: "Sus opciones sirven para armar una mitad ingrediente por ingrediente y como extras de una mitad con sabor; cada ingrediente cuesta media porción. Déjalo vacío si no ofreces armar ni extras.",
} as const;

/**
 * «Permitir mitades» once per product (every size, or the product itself without sizes): switch, flavor group,
 * ingredient group (to build a half and for extras) and removable ingredients.
 */
function FractionEditor({ canManage, fraction, groups, notice, productName, onChange }: {
  readonly canManage: boolean;
  readonly fraction: MenuProductFractionV1;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly notice: string | null;
  readonly productName: string;
  readonly onChange: (fraction: MenuProductFractionV1) => void;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const label = productName.trim() === "" ? "este producto" : productName;
  const update = (patch: Partial<MenuProductFractionV1>): void => onChange({ ...fraction, ...patch });
  const groupName = (group: MenuModifierGroupV1): string => group.name || "Grupo sin nombre";
  const flavorEligible = groups.filter((group) => group.groupId !== fraction.extraGroupId);
  const usedAsIngredients = groups.find((group) => group.groupId === fraction.extraGroupId);
  const ingredients = fraction.excludableIngredientIds;
  const addIngredient = (): void => {
    const name = draft.trim();
    if (name.length === 0 || name.length > 80 || ingredients.length >= MENU_VARIANT_MAX_EXCLUDABLE_INGREDIENTS
      || ingredients.some((entry) => entry.toLowerCase() === name.toLowerCase())) return;
    update({ excludableIngredientIds: [...ingredients, name] });
    setDraft("");
  };
  const select = "min-h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70";
  return <div className="grid gap-3 border-t border-border pt-3 sm:col-span-full">
    <h3 className="font-heading text-[13px] font-semibold">Mitades</h3>
    <p className="-mt-2 text-[12px] text-text-muted">El operador podrá armar {label} mitad y mitad, en cualquier tamaño o sin tamaños.</p>
    {notice !== null && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-[12px]">{notice}</p>}
    {fraction.enabled && <div className="grid gap-3 sm:grid-cols-2">
      {groups.length === 0 && <p role="status" className="text-[12px] text-text-muted sm:col-span-2">Primero marca «Grupos de modificadores» y crea un grupo con los sabores.</p>}
      <Field className="flex flex-col gap-1 text-[11px] font-medium" hint={GROUP_CHOICE_HINTS.flavors} label="Grupo de sabores">{(id) => <>
        <select id={id} className={select} disabled={!canManage} value={fraction.flavorGroupId ?? ""}
          onChange={(event) => update({ flavorGroupId: event.target.value === "" ? null : event.target.value })}>
          <option value="">Elige un grupo</option>
          {groups.map((group) => {
            const taken = group.groupId === fraction.extraGroupId;
            return <option key={group.groupId} value={group.groupId} disabled={taken}>{groupName(group)}{taken ? " (ya usado como ingredientes)" : ""}</option>;
          })}
        </select>
        {flavorEligible.length === 0 && usedAsIngredients !== undefined && <span role="status" className="text-[12px] font-normal text-text-muted">
          “{groupName(usedAsIngredients)}” ya está usado como ingredientes; crea un grupo de sabores en Modificadores.</span>}</>}</Field>
      <Field className="flex flex-col gap-1 text-[11px] font-medium" hint={GROUP_CHOICE_HINTS.ingredients} label="Grupo de ingredientes (para armar y extras, opcional)">{(id) =>
        <select id={id} className={select} disabled={!canManage} value={fraction.extraGroupId ?? ""}
          onChange={(event) => update({ extraGroupId: event.target.value === "" ? null : event.target.value })}>
          <option value="">Sin ingredientes</option>
          {groups.map((group) => {
            const taken = group.groupId === fraction.flavorGroupId;
            return <option key={group.groupId} value={group.groupId} disabled={taken}>{groupName(group)}{taken ? " (ya usado como sabores)" : ""}</option>;
          })}
        </select>}</Field>
      <div className="grid gap-2 sm:col-span-2">
        <span className="text-[11px] font-medium">Ingredientes que se pueden quitar</span>
        {ingredients.length > 0 && <ul className="flex flex-wrap gap-2" aria-label="Ingredientes que se pueden quitar">
          {ingredients.map((ingredient) => <li key={ingredient}>
            <button type="button" disabled={!canManage} aria-label={`Quitar ingrediente ${ingredient} de la lista`}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px] hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
              onClick={() => update({ excludableIngredientIds: ingredients.filter((entry) => entry !== ingredient) })}>
              {ingredient} ✕
            </button>
          </li>)}
        </ul>}
        {canManage && <div className="flex gap-2">
          <input aria-label="Nuevo ingrediente" maxLength={80} value={draft} placeholder="Ej. cebolla"
            className="min-h-11 min-w-0 grow rounded-lg border border-border bg-surface px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-accent"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addIngredient(); } }} />
          <button type="button" onClick={addIngredient} disabled={draft.trim().length === 0}
            className="min-h-11 rounded-lg border border-accent px-3 text-[12px] font-semibold text-accent disabled:opacity-40">+ Ingrediente</button>
        </div>}
      </div>
    </div>}
  </div>;
}

function ModifierGroupEditor({ siblingCount, siblingIndex, usedImagePaths, onMoveGroup, canManage, currency, group, supabaseUrl, onAddOption, onChange, onOptionImageChange, onRemove, onUploadPendingChange }: {
  readonly siblingCount: number;
  readonly siblingIndex: number;
  readonly usedImagePaths: readonly string[];
  readonly onMoveGroup: (from: number, to: number) => void;
  readonly canManage: boolean;
  readonly currency: string;
  readonly group: MenuModifierGroupV1;
  readonly supabaseUrl: string;
  readonly onAddOption: () => void;
  readonly onChange: (group: MenuModifierGroupV1) => void;
  readonly onOptionImageChange: (optionId: string, imagePath: string | null) => void;
  readonly onRemove: (removal: Removal) => void;
  readonly onUploadPendingChange: (pending: boolean) => void;
}): ReactNode {
  const change = (patch: Partial<MenuModifierGroupV1>): void => onChange({ ...group, ...patch });
  return (
    <section {...reorderRowProps(`groups-${group.productId}`, siblingIndex)} className="mt-3 flex min-w-0 items-start gap-3 rounded-xl border border-border bg-surface p-3">
      <ReorderHandle align="start" count={siblingCount} disabled={!canManage} index={siblingIndex} listKey={`groups-${group.productId}`} onMove={onMoveGroup} />
      <div className="min-w-0 flex-1">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <TextInput disabled={!canManage} hint="Nombre de la lista de opciones, por ejemplo Sabores o Extras." label="Grupo" maxLength={80} value={group.name} onChange={(name) => change({ name })} />
        <NumberInput disabled={!canManage} hint="Cuántas opciones debe elegir el operador como mínimo en este grupo. 0 = la elección es opcional." label="Mínimo total" min={0} max={1_000} value={group.minimumQuantity} onChange={(minimumQuantity) => change({ minimumQuantity })} />
        <NumberInput disabled={!canManage} hint="Cuántas opciones puede elegir como máximo en total, contando repeticiones de una misma opción." label="Máximo total" min={0} max={1_000} value={group.maximumQuantity} onChange={(maximumQuantity) => change({ maximumQuantity })} />
        <div className="flex items-end"><ReorderButtons count={siblingCount} disabled={!canManage} index={siblingIndex} label={group.name} onMove={onMoveGroup} /></div>
        <div className="flex items-end gap-2 pb-1"><ActiveInput disabled={!canManage} checked={group.active} onChange={(active) => change({ active })} />{canManage && <RemoveButton label={`Quitar ${group.name}`} onClick={() => onRemove({ id: group.groupId, kind: "group", label: group.name })} />}</div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted"><span className="inline-flex flex-wrap items-center gap-1.5">Opciones<FieldHint label="Opciones" text="Cada opción es una alternativa del grupo (por ejemplo Pepperoni) con su precio extra, que puede ser 0." /></span></p>{canManage && <AddButton label="Agregar opción" onClick={onAddOption} />}</div>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        {group.options.map((option) => (
          <div key={option.optionId} className="grid items-end gap-2 rounded-lg border border-border bg-bg/50 p-2 sm:grid-cols-[auto_minmax(0,1fr)_170px_140px_auto]">
            <MenuPhoto canManage={canManage} imagePath={option.imagePath} name={option.name} supabaseUrl={supabaseUrl} target="option" targetId={option.optionId} usedImagePaths={usedImagePaths} onChange={(imagePath) => onOptionImageChange(option.optionId, imagePath)} onUploadPendingChange={onUploadPendingChange} />
            <TextInput disabled={!canManage} hint="Nombre de la opción tal como la ve el operador." label="Opción" maxLength={80} value={option.name} onChange={(name) => changeOption(group, option.optionId, { name }, onChange)} />
            <MoneyInput hint="Cargo adicional por elegir esta opción; 0 si no cuesta extra." disabled={!canManage} currency={currency} value={option.unitPriceMinor} onChange={(unitPriceMinor) => changeOption(group, option.optionId, { unitPriceMinor }, onChange)} />
            <NullableNumberInput hint="Cantidad máxima de veces que se puede elegir esta misma opción (por ejemplo 2 porciones de queso). Vacío = sin límite propio." disabled={!canManage} label="Máximo opcional" min={1} max={1_000} value={option.maximumQuantity} onChange={(maximumQuantity) => changeOption(group, option.optionId, { maximumQuantity }, onChange)} />
            <div className="flex items-end gap-2 pb-1"><ActiveInput disabled={!canManage} checked={option.active} onChange={(active) => changeOption(group, option.optionId, { active }, onChange)} />{canManage && group.options.length > 1 && <RemoveButton label={`Quitar ${option.name}`} onClick={() => onRemove({ groupId: group.groupId, id: option.optionId, kind: "option", label: option.name })} />}</div>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}

function changeOption(group: MenuModifierGroupV1, optionId: string, patch: Partial<MenuModifierOptionV1>, onChange: (group: MenuModifierGroupV1) => void): void {
  onChange({ ...group, options: group.options.map((option) => option.optionId === optionId ? { ...option, ...patch } : option) });
}

/**
 * Round photo thumbnail that is itself the control. Without a photo, a click opens the file picker; with one it opens
 * a modal (blurred page behind) with the big photo and «Reemplazar», «Quitar» and «Cancelar». Both show the photos
 * already used in this menu so a removed one can be picked again without uploading it. Choosing one only assigns its path.
 */
function MenuPhoto({ canManage, imagePath, name, supabaseUrl, target, targetId, usedImagePaths, onChange, onUploadPendingChange }: {
  readonly canManage: boolean;
  readonly imagePath: string | null;
  readonly name: string;
  readonly supabaseUrl: string;
  readonly target: "category" | "option" | "product";
  readonly targetId: string;
  readonly usedImagePaths: readonly string[];
  readonly onChange: (imagePath: string | null) => void;
  readonly onUploadPendingChange: (pending: boolean) => void;
}): ReactNode {
  const fileInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<MenuImageAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [panel, setPanel] = useState<"photo" | "used" | null>(null);
  const url = menuImagePublicUrl(supabaseUrl, imagePath);
  const entityWord = target === "product" ? "producto" : target === "category" ? "categoría" : "opción";
  const label = `Foto de ${name.trim() === "" ? `${entityWord} sin nombre` : name}`;
  // Only this entity's own removed photos: the database rejects a path that embeds another entity's id.
  const otherPaths = imagePathsOfEntity(usedImagePaths, targetId).filter((path) => path !== imagePath);
  const showsPhoto = url !== null && failedPath !== imagePath;

  // A success note fades after a few seconds; errors stay until the next action.
  useEffect(() => {
    if (message === null || message.startsWith("No se pudo") || message === "Subiendo…" || message.startsWith("Reduciendo")) return;
    const timer = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const upload = async (selected: MenuImageAttempt): Promise<void> => {
    setMessage("Subiendo…");
    try {
      const result = await uploadMenuImageAction(target, targetId, selected);
      if (result.imagePath === undefined) { setMessage(result.error ?? "No se pudo subir la foto."); return; }
      onChange(result.imagePath);
      setFailedPath(null);
      setMessage("Foto lista. Publica la nueva versión para mostrarla en captura.");
    } catch (error: unknown) {
      // The action itself never throws; reaching here means the request did not complete (offline, server restart, body too large).
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message.slice(0, 120)})` : "";
      setMessage(offline
        ? "No se pudo subir la foto: sin conexión a internet. Revisa la red e inténtalo de nuevo."
        : `No se pudo subir la foto: el servidor no respondió${detail}. Inténtalo de nuevo.`);
    }
  };

  const retry = async (): Promise<void> => {
    if (attempt.current === null) return;
    setBusy(true);
    onUploadPendingChange(true);
    try {
      await upload(attempt.current);
    } finally {
      setBusy(false);
      onUploadPendingChange(false);
    }
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    const validation = validateMenuImageFile(file);
    if (validation !== null) { setMessage(validation); return; }
    setBusy(true);
    onUploadPendingChange(true);
    try {
      let source: Blob = file;
      let contentType: string = file.type;
      if (shouldDownscaleMenuImage(file.size)) {
        setMessage("Reduciendo el tamaño de la foto…");
        const shrunk = await shrinkMenuImage(file);
        if (shrunk === null) { setMessage("La foto es demasiado grande y no se pudo reducir a menos de 2 MB. Prueba con otra imagen."); return; }
        source = shrunk.blob;
        contentType = shrunk.contentType;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read"));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(source);
      });
      const dataBase64 = dataUrl.split(",", 2)[1];
      if (dataBase64 === undefined || !isMenuImageContentType(contentType)) throw new Error("read");
      const selected = menuImageAttempt(attempt.current, { contentType, dataBase64, fileName: file.name, lastModified: file.lastModified }, () => crypto.randomUUID(), () => new Date().toISOString());
      attempt.current = selected;
      await upload(selected);
    } catch {
      setMessage("No se pudo leer la foto. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
      onUploadPendingChange(false);
    }
  };

  const openPicker = (): void => { setMessage(null); fileInput.current?.click(); };
  const onThumbnail = (): void => {
    if (imagePath === null || !showsPhoto) openPicker();
    else setPanel("photo");
  };
  const assign = (path: string | null, note: string): void => { onChange(path); setFailedPath(null); setPanel(null); setMessage(note); };
  const thumb = "inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border";

  return <div className="relative flex min-w-0 flex-col items-start gap-1">
    <button type="button" disabled={!canManage || busy} aria-label={label} title={imagePath === null ? "Tocar para subir una foto" : "Tocar para ver o cambiar la foto"} onClick={onThumbnail}
      className={`${thumb} min-h-11 min-w-11 bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-70 ${canManage ? "hover:border-accent" : ""}`}>
      {showsPhoto
        ? <img key={url} src={url} alt="" loading="lazy" onError={() => setFailedPath(imagePath)} className="size-full object-cover" />
        : busy ? <span aria-hidden="true" className="text-[10px] font-semibold text-accent-hover">…</span>
          : <span aria-hidden="true" className="text-lg font-bold text-accent-hover">{name.trim() === "" ? "+" : name.trim().charAt(0).toLocaleUpperCase("es-MX")}</span>}
    </button>
    {canManage && <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true" className="sr-only" onChange={(event) => { void choose(event); }} />}
    {canManage && imagePath === null && otherPaths.length > 0 && !busy &&
      <button type="button" onClick={() => setPanel("used")} className="min-h-6 text-[11px] font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent">Fotos quitadas</button>}
    {message !== null && <div role="status" className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-2 text-[12px] text-text-muted shadow-lg">
      <p>{message}</p>
      {attempt.current !== null && message.startsWith("No se pudo subir") && <button type="button" disabled={busy} onClick={() => { void retry(); }} className="mt-1 min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-text focus-visible:outline-2 focus-visible:outline-accent">Reintentar</button>}
    </div>}
    {panel !== null && <PhotoDialog title={panel === "photo" ? label : `Fotos quitadas de este ${entityWord}`} onClose={() => setPanel(null)}>
      {panel === "photo" && url !== null && <img src={url} alt={label} className="max-h-[55vh] w-full rounded-xl border border-border bg-bg object-contain" />}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setPanel(null); openPicker(); }} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{panel === "photo" ? "Reemplazar" : "Subir una foto nueva"}</button>
        {panel === "photo" && <button type="button" onClick={() => assign(null, "Foto quitada del borrador.")} className="min-h-11 rounded-lg border border-[oklch(85%_0.06_25)] px-4 py-2 text-[13px] font-semibold text-error focus-visible:outline-2 focus-visible:outline-accent">Quitar</button>}
        <button type="button" autoFocus onClick={() => setPanel(null)} className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent">Cancelar</button>
      </div>
      <UsedPhotos title={`Fotos quitadas de este ${entityWord}`} paths={otherPaths} supabaseUrl={supabaseUrl} onPick={(path) => assign(path, "Foto elegida. Publica la nueva versión para mostrarla en captura.")} />
    </PhotoDialog>}
  </div>;
}

/** Closed pastel palette as toggle buttons (44 px targets); «Automático» clears the choice. */
function CategoryColorPicker({ disabled, name, value, onChange }: {
  readonly disabled: boolean;
  readonly name: string;
  readonly value: MenuCategoryV1["color"];
  readonly onChange: (color: MenuCategoryV1["color"]) => void;
}): ReactNode {
  const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const categoryName = name.trim() === "" ? "categoría sin nombre" : name;
  return <div role="group" aria-label={`Color de ${categoryName}`} className="flex flex-wrap items-center gap-1">
    <button type="button" disabled={disabled} aria-pressed={value === null} onClick={() => onChange(null)}
      className={`min-h-11 rounded-lg border px-3 text-[12px] font-medium disabled:opacity-70 ${focus} ${value === null ? "border-accent bg-accent-soft font-semibold" : "border-border bg-surface"}`}>Automático</button>
    {MENU_CATEGORY_COLORS.map((color) => {
      const selected = value === color;
      return <button key={color} type="button" disabled={disabled} aria-pressed={selected} aria-label={`Color ${MENU_CATEGORY_COLOR_LABELS[color]}`} title={MENU_CATEGORY_COLOR_LABELS[color]}
        onClick={() => onChange(color)}
        className={`inline-flex size-11 items-center justify-center rounded-full border-2 disabled:opacity-70 ${focus} ${menuCategoryColorClasses(color)?.swatch ?? ""} ${selected ? "ring-2 ring-accent ring-offset-1" : ""}`}>
        {selected && <span aria-hidden="true" className="text-[14px] font-bold">✓</span>}
      </button>;
    })}
  </div>;
}

/** Modal `<dialog>`: the page behind is blurred and inert, Escape closes. */
function PhotoDialog({ children, title, onClose }: { readonly children: ReactNode; readonly title: string; readonly onClose: () => void }): ReactNode {
  return <dialog aria-label={title} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    ref={(element) => { if (element !== null && !element.open) element.showModal(); }}
    className="m-auto w-[min(34rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-md">
    <div className="flex max-h-[calc(100vh-2rem)] flex-col gap-3 overflow-y-auto p-4">
      <h2 className="break-words font-heading text-[14px] font-semibold">{title}</h2>
      {children}
    </div>
  </dialog>;
}

function UsedPhotos({ onPick, paths, supabaseUrl, title }: { readonly onPick: (path: string) => void; readonly paths: readonly string[]; readonly supabaseUrl: string; readonly title: string }): ReactNode {
  if (paths.length === 0) return null;
  return <section aria-label={title} className="border-t border-border pt-3">
    <h3 className="text-[12px] font-semibold">{title}</h3>
    <ul className="mt-2 flex flex-wrap gap-2">
      {paths.map((path, index) => {
        const source = menuImagePublicUrl(supabaseUrl, path);
        return <li key={path}>
          <button type="button" aria-label={`Usar la foto ${index + 1}`} onClick={() => onPick(path)}
            className="inline-flex size-14 min-h-11 min-w-11 items-center justify-center overflow-hidden rounded-xl border border-border bg-bg hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">
            {source === null ? <span aria-hidden="true" className="text-[11px] text-text-muted">?</span> : <img src={source} alt="" loading="lazy" className="size-full object-cover" />}
          </button>
        </li>;
      })}
    </ul>
  </section>;
}

function SectionHeader({ children, description, title }: { readonly children?: ReactNode; readonly description: string; readonly title: string }): ReactNode {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-heading text-[16px] font-semibold">{title}</h2><p className="mt-1 text-[12px] text-text-muted">{description}</p></div>{children}</div>;
}

const ACTIVE_HINT = "Si lo desmarcas, deja de aparecer en la captura de pedidos pero se conserva en el menú para volver a activarlo.";

function StationSelect({ disabled, onChange, usedStations, value }: { readonly disabled: boolean; readonly onChange: (value: string) => void; readonly usedStations: readonly string[]; readonly value: string }): ReactNode {
  const [other, setOther] = useState(false);
  const [draft, setDraft] = useState("");
  // The station the product had before «Otra estación…»: an emptied field goes back to it instead of leaving a stray value.
  const [before, setBefore] = useState(value);
  const values = stationValues(usedStations, value);
  const field = "min-h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70";
  return <div className="flex min-w-0 flex-col gap-1">
    <Field className="flex flex-col gap-1 text-[11px] font-medium" hint="Pantalla de cocina (KDS) donde aparece este producto al enviarlo a preparar; p. ej. cocina, barra, pizzas." label="Estación">{(id) =>
      <select id={id} disabled={disabled} value={other ? MENU_OTHER_STATION : value}
        onChange={(event) => { if (event.target.value === MENU_OTHER_STATION) { setBefore(value); setOther(true); } else { setOther(false); setDraft(""); onChange(event.target.value); } }}
        className={field}>
        {values.map((station) => <option key={station} value={station}>{station}</option>)}
        <option value={MENU_OTHER_STATION}>Otra estación…</option>
      </select>}</Field>
    {other && <input aria-label="Nombre de la nueva estación" autoFocus required disabled={disabled} maxLength={MENU_STATION_MAX_LENGTH} placeholder="Ej. pizzas"
      value={draft}
      onChange={(event) => { setDraft(event.target.value); onChange(event.target.value.trim() === "" ? before : event.target.value.trim()); }} className={field} />}
  </div>;
}

function TextInput({ disabled, help, hint, invalid = false, label, maxLength, onChange, required = true, value, width = "w-full" }: { readonly disabled: boolean; readonly help?: string; readonly hint?: string; readonly invalid?: boolean; readonly label: string; readonly maxLength: number; readonly onChange: (value: string) => void; readonly required?: boolean; readonly value: string; readonly width?: string }): ReactNode {
  return <Field className={`flex min-w-0 flex-col gap-1 text-[11px] font-medium ${width}`} hint={hint} label={label}>{(id) => <>
    <input id={id} required={required} aria-invalid={invalid || undefined} disabled={disabled} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70" />
    {help && <span className="text-[11px] font-normal text-text-muted">{help}</span>}</>}</Field>;
}

function MoneyInput({ currency, disabled, hint, label = "Precio", note, onChange, value }: {
  readonly currency: string;
  readonly disabled: boolean;
  readonly hint?: string;
  readonly label?: string;
  /** Replaces the formatted amount shown under the field (for example the tax treatment). */
  readonly note?: string | undefined;
  readonly onChange: (value: number) => void;
  readonly value: number;
}): ReactNode {
  const [text, setText] = useState(() => formatMinorForMoneyInput(value, currency) ?? "");
  const hintId = useId();
  const digits = currencyFractionDigits(currency);
  const parsed = parseMoneyInputToMinor(text, currency);
  const pattern = digits === 0 ? "[0-9]+" : digits === null ? "(?!)" : `[0-9]+([.,][0-9]{1,${digits}})?`;
  const errorText = digits === null ? "La moneda de este catálogo no está admitida; avisa al administrador."
    : `Escribe un precio válido${digits === 0 ? " sin decimales" : ` con máximo ${digits} decimales`}.`;
  return <Field className="flex min-w-0 flex-col gap-1 text-[11px] font-medium" hint={hint} label={label}>{(id) => <>
    <input
      id={id} required disabled={disabled} type="text" inputMode="decimal" pattern={pattern}
      value={text} aria-invalid={parsed === null} aria-describedby={hintId}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const amount = parseMoneyInputToMinor(next, currency);
        event.target.setCustomValidity(amount === null ? errorText : "");
        if (amount !== null) onChange(amount);
      }}
      onBlur={() => { if (parsed !== null) setText(formatMinorForMoneyInput(parsed, currency) ?? ""); }}
      className="min-h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70"
    />
    <span id={hintId} className={parsed === null ? "text-error" : "text-text-muted"}>
      {parsed === null ? errorText : note ?? formatMinorUnits(value, currency)}
    </span></>}</Field>;
}

function NumberInput({ disabled, hint, label, max, min, onChange, value }: { readonly disabled: boolean; readonly hint: string; readonly label: string; readonly max: number; readonly min: number; readonly onChange: (value: number) => void; readonly value: number }): ReactNode {
  return <Field className="flex min-w-0 flex-col gap-1 text-[11px] font-medium" hint={hint} label={label}>{(id) => <input id={id} required disabled={disabled} type="number" min={min} max={max} step="1" value={value} onChange={(event) => onChange(integerFrom(event.target.value, min, max))} className="min-h-10 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70" />}</Field>;
}


function NullableNumberInput({ disabled, hint, label, max, min, onChange, value }: { readonly disabled: boolean; readonly hint: string; readonly label: string; readonly max: number; readonly min: number; readonly onChange: (value: number | null) => void; readonly value: number | null }): ReactNode {
  return <Field className="flex min-w-0 flex-col gap-1 text-[11px] font-medium" hint={hint} label={label}>{(id) => <input id={id} disabled={disabled} type="number" min={min} max={max} step="1" value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : integerFrom(event.target.value, min, max))} className="min-h-10 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70" />}</Field>;
}

function ActiveInput({ checked, disabled, onChange }: { readonly checked: boolean; readonly disabled: boolean; readonly onChange: (value: boolean) => void }): ReactNode {
  return <CheckField labelClassName="flex min-h-11 items-center" className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium" hint={ACTIVE_HINT} label="Activo">{(id) => <input id={id} type="checkbox" className="h-5 w-5" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} />}</CheckField>;
}

function AddButton({ disabled = false, label, onClick }: { readonly disabled?: boolean; readonly label: string; readonly onClick: () => void }): ReactNode {
  return <button type="button" disabled={disabled} onClick={onClick} className="min-h-11 rounded-lg border border-accent px-3 py-2 text-[12px] font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-40">+ {label}</button>;
}

function RemoveButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }): ReactNode {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="min-h-10 rounded-lg border border-[oklch(85%_0.06_25)] px-2 text-[15px] text-error">×</button>;
}

function EmptyText({ text }: { readonly text: string }): ReactNode {
  return <p className="mt-4 rounded-xl border border-dashed border-border p-5 text-center text-[13px] text-text-muted">{text}</p>;
}

function integerFrom(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : minimum;
}

function nextDisplayOrder(values: readonly { readonly displayOrder: number }[]): number {
  return values.reduce((maximum, value) => Math.max(maximum, value.displayOrder), 0) + 1;
}
