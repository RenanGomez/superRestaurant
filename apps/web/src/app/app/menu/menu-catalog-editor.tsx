"use client";

import { MENU_CATEGORY_COLORS, MENU_PRODUCT_MAX_VARIANTS, MENU_VARIANT_MAX_LOCKED_INGREDIENTS } from "@super-restaurant/shared-types";
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
import { CheckField, FieldHint } from "../../../components/field-hint";
import { MENU_DEFAULT_UNIT, MENU_FIELD_AUXILIARY_CLASS, MENU_FIELD_CONTROL_CLASS, MENU_FIELD_LABEL_CLASS, MENU_OTHER_STATION, MENU_STATION_MAX_LENGTH, stationValues, unitOptions } from "../../../lib/menu-fields";
import { shrinkMenuImage } from "../../../lib/menu-image-resize";
import { applyRemoval, removalNeedsConfirmation, unassignGroup, type Removal } from "../../../lib/menu-removal";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { DEFAULT_PESO_CURRENCY, formatMinorForMoneyInput, parseMoneyInputToMinor } from "../../../lib/capture-payment";
import { currencyFractionDigits } from "../../../lib/money-scale";
import { isMenuImageContentType, menuImageAttempt, menuImagePublicUrl, publishDisabledReason, shouldDownscaleMenuImage, validateMenuImageFile, type MenuImageAttempt } from "../../../lib/menu-images";
import { editorProductFraction, legacyFractionNotice, migrateLegacyFraction } from "../../../lib/menu-fraction";
import { variantValidationError } from "../../../lib/menu-variants";
import { reorder, reorderSubset } from "../../../lib/menu-reorder";
import { duplicateProduct } from "../../../lib/menu-duplicate";
import { duplicateGroup, groupAssignmentCount, groupsForProduct, toggleGroupAssignment, withDerivedAssignments, withLegacyOwners } from "../../../lib/menu-groups";
import { menuDraftKey, menuDraftSnapshot, parseMenuDraft, serializeMenuDraft, staleMenuDraftKeys, type LocalMenuDraft } from "../../../lib/menu-draft-storage";
import { MENU_CATEGORY_COLOR_LABELS, menuCategoryColorClasses } from "../../../lib/menu-category-color";
import { DEFAULT_MENU_TAB, MENU_TAB_LABELS, MENU_TABS, menuTabHref, parseMenuTab, readStoredMenuTab, writeStoredMenuTab, type MenuTab } from "../../../lib/menu-tabs";
import { uiOption } from "../../../lib/ui-classes";
import { collectUsedImagePaths, imagePathsOfEntity, retainImagePaths } from "../../../lib/menu-used-images";
import { DragReorderList, ReorderButtons, ReorderHandle, reorderRowProps } from "./reorder-controls";

import { copyMenuImageAction, saveMenuCatalogAction, uploadMenuImageAction } from "./actions";

interface Draft {
  readonly categories: readonly MenuCategoryV1[];
  readonly currency: string;
  readonly expectedVersion: number;
  readonly modifierGroups: readonly MenuModifierGroupV1[];
  readonly products: readonly MenuProductV1[];
}

export function MenuCatalogEditor({ branchId, canManage, initialTab, restaurantId, state, supabaseUrl }: {
  readonly branchId: string;
  readonly canManage: boolean;
  readonly initialTab?: MenuTab | undefined;
  readonly restaurantId: string;
  readonly state: MenuCatalogStateV1;
  readonly supabaseUrl: string;
}): ReactNode {
  const currency = state.catalog?.currency ?? DEFAULT_PESO_CURRENCY;
  const [activeTab, setActiveTab] = useState<MenuTab>(() => initialTab ?? DEFAULT_MENU_TAB);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [groupFilter, setGroupFilter] = useState("");
  const [categories, setCategories] = useState<readonly MenuCategoryV1[]>(() =>
    state.catalog?.categories.map((category) => ({ ...category })) ?? [],
  );
  const [products, setProducts] = useState<readonly MenuProductV1[]>(() =>
    withDerivedAssignments(state.catalog?.products ?? [], state.catalog?.modifierGroups ?? []).map((product) => ({ ...product, variants: product.variants?.map((variant) => ({ ...variant })) ?? [], tax: product.tax === null ? null : { ...product.tax } })) ?? [],
  );
  const [groups, setGroups] = useState<readonly MenuModifierGroupV1[]>(() =>
    state.catalog?.modifierGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option })),
    })) ?? [],
  );
  const [removal, setRemoval] = useState<Removal | null>(null);
  // Legacy per-size halves move to the product on save (the server rejects both at once); validate and send that shape.
  const savedProducts = useMemo(() => products.map((product) => migrateLegacyFraction(product, groups)), [products, groups]);
  // Older clients read the legacy single owner: send it only while exactly one product offers the group.
  const savedGroups = useMemo(() => withLegacyOwners(savedProducts, groups), [savedProducts, groups]);
  const variantIssue = savedProducts.map((product) => variantValidationError(product.productId, product.variants ?? [], new Set(product.modifierGroupIds ?? []), product.fraction)).find((issue) => issue !== null) ?? null;
  const variantError = variantIssue === null ? null : `${products.find((product) => product.productId === variantIssue.productId)?.name || "Producto sin nombre"}: ${variantIssue.message}`;
  const [pendingUploads, setPendingUploads] = useState(0);
  const onUploadPendingChange = (pending: boolean): void => setPendingUploads((current) => current + (pending ? 1 : -1));
  const expectedVersion = state.catalog?.version ?? 0;
  const draft = useMemo(() => JSON.stringify({ categories, currency, expectedVersion, modifierGroups: savedGroups, products: savedProducts } satisfies Draft), [categories, currency, expectedVersion, savedGroups, savedProducts]);

  // Tab sync with URL (?tab=) and localStorage
  useEffect(() => {
    const urlTab = parseMenuTab(new URL(window.location.href).searchParams.get("tab"));
    if (urlTab !== undefined) {
      setActiveTab(urlTab);
      writeStoredMenuTab(window.localStorage, urlTab);
    } else {
      const stored = readStoredMenuTab(window.localStorage);
      if (stored !== null) {
        setActiveTab(stored);
        window.history.replaceState(null, "", menuTabHref(stored, window.location.search));
      }
    }

    const onPopState = (): void => {
      const popTab = parseMenuTab(new URL(window.location.href).searchParams.get("tab"));
      if (popTab !== undefined) setActiveTab(popTab);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectTab = (tab: MenuTab): void => {
    setActiveTab(tab);
    writeStoredMenuTab(window.localStorage, tab);
    window.history.replaceState(null, "", menuTabHref(tab, window.location.search));
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentTab: MenuTab): void => {
    const currentIndex = MENU_TABS.indexOf(currentTab);
    if (currentIndex === -1) return;
    let targetIndex = -1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      targetIndex = (currentIndex + 1) % MENU_TABS.length;
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      targetIndex = (currentIndex - 1 + MENU_TABS.length) % MENU_TABS.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      targetIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      targetIndex = MENU_TABS.length - 1;
    }
    if (targetIndex !== -1) {
      const nextTab = MENU_TABS[targetIndex];
      if (nextTab !== undefined) {
        selectTab(nextTab);
        tabRefs.current[nextTab]?.focus();
      }
    }
  };

  const normalizedGroupFilter = groupFilter.trim().toLocaleLowerCase("es-MX");
  const filteredGroups = useMemo(() => normalizedGroupFilter === "" ? groups : groups.filter((group) => group.name.toLocaleLowerCase("es-MX").includes(normalizedGroupFilter)), [groups, normalizedGroupFilter]);

  const productsWithSizes = useMemo(() => products.filter((p) => (p.variants?.length ?? 0) > 0), [products]);
  const sizeSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const prod of products) {
      for (const variant of prod.variants ?? []) {
        const name = variant.name.trim() === "" ? "Tamaño sin nombre" : variant.name.trim();
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [products]);

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
    setProducts(withDerivedAssignments(recovery.products, recovery.groups));
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
  const copyProduct = async (productId: string): Promise<void> => {
    const source = products.find((entry) => entry.productId === productId);
    if (source === undefined) return;
    // The copy lists the same shared groups; no group is cloned, so only the product's own photo is copied.
    const copy = duplicateProduct(source, () => crypto.randomUUID(), nextDisplayOrder(products.filter((entry) => entry.categoryId === source.categoryId)));
    focusAfterCopy.current = copy.product.productId;
    setProducts((current) => [...current, copy.product]);
    if (source.imagePath === null) return;
    onUploadPendingChange(true);
    try {
      const result = await copyMenuImageAction("product", copy.product.productId, source.imagePath);
      if (result.imagePath !== undefined) {
        const copiedPath = result.imagePath;
        setProducts((current) => current.map((entry) => entry.productId === copy.product.productId ? { ...entry, imagePath: copiedPath } : entry));
      } else {
        setCopiedProductIds((current) => current.includes(copy.product.productId) ? current : [...current, copy.product.productId]);
      }
    } finally {
      onUploadPendingChange(false);
    }
  };
  const copyGroup = (groupId: string): void => {
    const source = groups.find((entry) => entry.groupId === groupId);
    if (source === undefined) return;
    setGroups((current) => [...current, duplicateGroup(source, () => crypto.randomUUID(), nextDisplayOrder(current))]);
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
      modifierGroupIds: [],
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
  const addGroup = (): void => {
    setGroups((current) => [...current, {
      active: true,
      displayOrder: nextDisplayOrder(current),
      groupId: crypto.randomUUID(),
      maximumQuantity: 1,
      minimumQuantity: 0,
      name: "Nuevo grupo",
      options: [{ active: true, imagePath: null, maximumQuantity: null, name: "Nueva opción", optionId: crypto.randomUUID(), unitPriceMinor: 0 }],
      productId: null,
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

      <nav role="tablist" aria-label="Secciones del menú" className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        {MENU_TABS.map((tab) => {
          const isSelected = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(el) => { tabRefs.current[tab] = el; }}
              type="button"
              role="tab"
              id={`menu-tab-${tab}`}
              aria-selected={isSelected}
              aria-controls={`menu-panel-${tab}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) => onTabKeyDown(event, tab)}
              className={uiOption(isSelected, "min-w-28 text-center")}
            >
              {MENU_TAB_LABELS[tab]}
            </button>
          );
        })}
      </nav>

      <div
        role="tabpanel"
        id="menu-panel-categorias"
        aria-labelledby="menu-tab-categorias"
        tabIndex={0}
        hidden={activeTab !== "categorias"}
        className={activeTab === "categorias" ? "flex flex-col gap-5 focus-visible:outline-none" : "hidden"}
      >
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <SectionHeader title="Categorías" description="Organizan la carta y controlan su orden de aparición.">
            {canManage && <AddButton label="Agregar categoría" onClick={addCategory} />}
          </SectionHeader>
          {categories.length === 0 ? <EmptyText text="Agrega una categoría para comenzar el menú." /> : (
            <DragReorderList className="mt-4 flex flex-col gap-3" disabled={!canManage} getKey={(category) => category.categoryId} items={categories} itemLabel={(category) => category.name} label="Categorías" onMove={(from, to) => setCategories((current) => reorder(current, from, to))}
              renderRow={(category, _index, handle) => (
                <article className={`flex min-w-0 items-start gap-3 rounded-xl border p-3 ${menuCategoryColorClasses(category.color)?.card ?? "border-border bg-bg/50"}`}>
                  {handle !== null && (
                    <EditorRowActions>
                      {handle}
                    </EditorRowActions>
                  )}
                  <div className="flex flex-col items-center">
                    <div className="hidden h-5 min-h-5 sm:block" aria-hidden="true" />
                    <div className="mt-1 flex h-11 min-h-11 w-12 items-center justify-center">
                      <MenuPhoto canManage={canManage} imagePath={category.imagePath} name={category.name} supabaseUrl={supabaseUrl} target="category" targetId={category.categoryId} usedImagePaths={usedImagePaths}
                        onChange={(imagePath) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, imagePath } : entry))} onUploadPendingChange={onUploadPendingChange} />
                    </div>
                    <div className="hidden min-h-4 sm:block" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="hidden h-5 min-h-5 sm:block" aria-hidden="true" />
                    <div className="mt-1 flex h-11 min-h-11 items-center justify-center">
                      <CategoryColorPicker disabled={!canManage} name={category.name} value={category.color} onChange={(color) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, color } : entry))} />
                    </div>
                    <div className="hidden min-h-4 sm:block" aria-hidden="true" />
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <TextInput disabled={!canManage} hint="Nombre de la sección de la carta, por ejemplo Pizzas o Bebidas. El operador navega por estas categorías." label="Nombre" maxLength={80} value={category.name} onChange={(name) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, name } : entry))} />
                    <EditorRowActions>
                      <div className="flex items-center justify-end gap-2">
                        <ActiveInput disabled={!canManage} checked={category.active} onChange={(active) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, active } : entry))} />
                        {canManage && <RemoveButton label={`Quitar ${category.name}`} onClick={() => setRemoval({ id: category.categoryId, kind: "category", label: category.name })} />}
                      </div>
                    </EditorRowActions>
                  </div>
                </article>
              )} />
          )}
        </section>
      </div>

      <div
        role="tabpanel"
        id="menu-panel-productos"
        aria-labelledby="menu-tab-productos"
        tabIndex={0}
        hidden={activeTab !== "productos"}
        className={activeTab === "productos" ? "flex flex-col gap-5 focus-visible:outline-none" : "hidden"}
      >
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <SectionHeader title="Productos" description="Captura precios en la moneda del restaurante y elige qué grupos de modificadores ofrece cada producto.">
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
                        <ProductEditor handle={handle} copyNotice={copiedProductIds.includes(product.productId)} usedStations={products.map((entry) => entry.stationId)} usedImagePaths={usedImagePaths} variantInvalid={variantIssue?.productId === product.productId}
                          canManage={canManage}
                          categories={categories}
                          currency={currency}
                          catalogGroups={groups}
                          groups={groupsForProduct(product, groups)}
                          product={product}
                          supabaseUrl={supabaseUrl}
                          onDuplicate={() => { void copyProduct(product.productId); }}
                          onManageGroups={() => selectTab("modificadores")}
                          onProductChange={(changed) => setProducts((current) => current.map((entry) => entry.productId === changed.productId ? changed : entry))}
                          onProductImageChange={(imagePath) => setProducts((current) => current.map((entry) => entry.productId === product.productId ? { ...entry, imagePath } : entry))}
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
      </div>

      <div
        role="tabpanel"
        id="menu-panel-modificadores"
        aria-labelledby="menu-tab-modificadores"
        tabIndex={0}
        hidden={activeTab !== "modificadores"}
        className={activeTab === "modificadores" ? "flex flex-col gap-5 focus-visible:outline-none" : "hidden"}
      >
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <SectionHeader title="Modificadores" description="Configura grupos de ingredientes, opciones con sus precios y especialidades. Los grupos pueden fungir como especialidades o variantes de preparación para tus productos; asígnalos desde la pestaña Productos.">
            {canManage && <AddButton label="Agregar grupo" onClick={addGroup} />}
          </SectionHeader>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <input
                type="search"
                aria-label="Buscar grupo por nombre"
                placeholder="Buscar grupo por nombre…"
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                className="h-11 min-h-11 w-full max-w-sm rounded-lg border border-border bg-surface px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
            {normalizedGroupFilter !== "" && (
              <p className="text-[12px] text-text-muted">
                Mostrando {filteredGroups.length} de {groups.length} grupos
              </p>
            )}
          </div>
          {groups.length === 0 ? <EmptyText text="Aún no hay grupos de modificadores. Crea uno y asígnalo a tus productos." /> : (
            filteredGroups.length === 0 ? <EmptyText text="No hay grupos que coincidan con la búsqueda." /> : (
              <div className="mt-4 flex flex-col gap-1">
                {filteredGroups.map((group, groupIndex) => (
                  <ModifierGroupEditor key={group.groupId} siblingCount={filteredGroups.length} siblingIndex={groupIndex} usedImagePaths={usedImagePaths}
                    assignedCount={groupAssignmentCount(products, group)}
                    onMoveGroup={(from, to) => setGroups((current) => reorder(current, from, to))} canManage={canManage} currency={currency} group={group} supabaseUrl={supabaseUrl}
                    onAddOption={() => addOption(group.groupId)} onChange={(changed) => setGroups((current) => current.map((entry) => entry.groupId === changed.groupId ? changed : entry))}
                    onDuplicate={() => copyGroup(group.groupId)}
                    onOptionImageChange={(optionId, imagePath) => setGroups((current) => current.map((entry) => entry.groupId === group.groupId ? { ...entry, options: entry.options.map((option) => option.optionId === optionId ? { ...option, imagePath } : option) } : entry))}
                    onRemove={requestRemoval} onUploadPendingChange={onUploadPendingChange} />
                ))}
              </div>
            )
          )}
        </section>
      </div>

      <div
        role="tabpanel"
        id="menu-panel-tamanos"
        aria-labelledby="menu-tab-tamanos"
        tabIndex={0}
        hidden={activeTab !== "tamanos"}
        className={activeTab === "tamanos" ? "flex flex-col gap-5 focus-visible:outline-none" : "hidden"}
      >
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <SectionHeader title="Tamaños y presets" description="Presentaciones y porciones de tus productos. Cada producto define sus propios tamaños y precios.">
            <button
              type="button"
              onClick={() => selectTab("productos")}
              className="inline-flex min-h-11 items-center rounded-lg border border-accent px-4 py-2 text-[12px] font-semibold text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
            >
              Configurar en Productos →
            </button>
          </SectionHeader>

          <div role="status" className="mt-4 rounded-xl border border-accent/40 bg-accent-soft p-4 text-[13px] text-text">
            <p className="font-semibold text-accent-hover">Pronto podrás definir tamaños una sola vez y elegirlos en cada producto.</p>
            <p className="mt-1 text-text-muted">Por ahora, cada producto define sus propias presentaciones y precios. Aquí puedes consultar los tamaños configurados actualmente en tu carta, agrupados por producto.</p>
          </div>

          {sizeSummary.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-text-muted">Presentaciones en uso:</span>
              {sizeSummary.map((item) => (
                <span key={item.name} className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-text">
                  <span className="font-medium">{item.name}</span>
                  <span className="ml-1.5 text-text-muted">({item.count} {item.count === 1 ? "producto" : "productos"})</span>
                </span>
              ))}
            </div>
          )}

          {productsWithSizes.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-[13px] text-text-muted">No hay productos con tamaños configurados en este borrador.</p>
              <p className="mt-1 text-[12px] text-text-muted">Puedes agregar tamaños (chica, mediana, grande…) directamente en la tarjeta de cada producto en la pestaña Productos.</p>
              <button
                type="button"
                onClick={() => selectTab("productos")}
                className="mt-3 min-h-11 rounded-lg border border-accent px-4 py-2 text-[13px] font-semibold text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
              >
                Ir a Productos →
              </button>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {productsWithSizes.map((prod) => {
                const category = categories.find((c) => c.categoryId === prod.categoryId);
                const variants = prod.variants ?? [];
                return (
                  <article key={prod.productId} className="flex flex-col gap-3 rounded-xl border border-border bg-bg/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                      <div>
                        <h3 className="font-heading text-[14px] font-bold text-text">{prod.name || "Producto sin nombre"}</h3>
                        <p className="text-[12px] text-text-muted">{category?.name ?? "Sin categoría"} · {variants.length} {variants.length === 1 ? "tamaño" : "tamaños"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => selectTab("productos")}
                        className="inline-flex min-h-9 items-center text-[12px] font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        Editar en Productos →
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {variants.map((variant) => (
                        <div key={variant.variantId} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-2.5 text-[13px]">
                          <div className="min-w-0 flex-1 truncate">
                            <span className="font-semibold text-text">{variant.name || "Tamaño sin nombre"}</span>
                            {variant.sku && <span className="ml-1.5 text-[11px] text-text-muted">({variant.sku})</span>}
                          </div>
                          <span className="font-bold text-text">{formatMinorUnits(variant.unitPriceMinor, currency)}</span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${variant.active ? "bg-accent-soft text-accent" : "bg-bg text-text-muted"}`}>
                            {variant.active ? "Activo" : "Inactivo"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
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
      <p id="remove-description" className="mt-1 text-[12px] text-text-muted">La publicación anterior seguirá intacta. {removal.kind === "group" ? "El grupo también dejará de ofrecerse en todos los productos que lo tienen asignado." : "Si contiene elementos dependientes, también se quitarán de esta nueva versión."}</p>
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
function ProductEditor({ copyNotice, handle, usedStations, usedImagePaths, variantInvalid, canManage, categories, currency, catalogGroups, groups, product, supabaseUrl, onDuplicate, onManageGroups, onProductChange, onProductImageChange, onRemove, onUploadPendingChange }: {
  readonly copyNotice: boolean;
  readonly handle: ReactNode;
  readonly usedStations: readonly string[];
  readonly usedImagePaths: readonly string[];
  readonly variantInvalid: boolean;
  readonly canManage: boolean;
  readonly categories: readonly MenuCategoryV1[];
  readonly currency: string;
  /** Every group of the restaurant catalog (the multiselect lists them all). */
  readonly catalogGroups: readonly MenuModifierGroupV1[];
  /** The groups this product currently offers. */
  readonly groups: readonly MenuModifierGroupV1[];
  readonly product: MenuProductV1;
  readonly supabaseUrl: string;
  readonly onDuplicate: () => void;
  readonly onManageGroups?: (() => void) | undefined;
  readonly onProductChange: (product: MenuProductV1) => void;
  readonly onProductImageChange: (imagePath: string | null) => void;
  readonly onRemove: (removal: Removal) => void;
  readonly onUploadPendingChange: (pending: boolean) => void;
}): ReactNode {
  const change = (patch: Partial<MenuProductV1>): void => onProductChange({ ...product, ...patch });
  const tax = product.tax;
  const variants = product.variants ?? [];
  const fraction = editorProductFraction(product);
  const changeVariant = (variantId: string, patch: Partial<MenuProductVariantV1>): void =>
    change({ variants: variants.map((variant) => variant.variantId === variantId ? { ...variant, ...patch } : variant) });
  const switchClass = "inline-flex min-h-11 items-center gap-2 text-[12px] font-semibold";
  return (
    <article data-product-id={product.productId} className="flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-bg/40 p-3 sm:p-4">
      {handle !== null && (
        <EditorRowActions>
          {handle}
        </EditorRowActions>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[auto_minmax(0,1fr)_7.5rem_9rem_auto]">
          <div className="flex flex-col items-center">
            <div className="hidden h-5 min-h-5 sm:block" aria-hidden="true" />
            <div className="mt-1 flex h-11 min-h-11 w-12 items-center justify-center">
              <MenuPhoto canManage={canManage} imagePath={product.imagePath} name={product.name} supabaseUrl={supabaseUrl} target="product" targetId={product.productId} usedImagePaths={usedImagePaths} onChange={onProductImageChange} onUploadPendingChange={onUploadPendingChange} />
            </div>
            <div className="hidden min-h-4 sm:block" aria-hidden="true" />
          </div>
          <TextInput disabled={!canManage} hint="Nombre que ve el operador al tomar el pedido y que se imprime en la comanda." label="Producto" maxLength={120} value={product.name} onChange={(name) => change({ name })} />
          <MoneyInput hint="Precio de venta por unidad en la moneda del restaurante. Si el producto tiene tamaños, cada tamaño usa su propio precio." disabled={!canManage} currency={currency} note={taxNote(tax, formatMinorUnits(product.unitPriceMinor, currency))} value={product.unitPriceMinor} onChange={(unitPriceMinor) => change({ unitPriceMinor })} />
          <EditorField hint="Cómo se mide o se sirve el producto (pieza, porción, g, ml…). Sólo informativa en el ticket." label="Unidad">
            {(id) => (
              <select id={id} disabled={!canManage} value={product.unit} onChange={(event) => change({ unit: event.target.value })} className={MENU_FIELD_CONTROL_CLASS}>
                {unitOptions(product.unit).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )}
          </EditorField>
          <EditorRowActions>
            <div className="flex items-center justify-end gap-2">
              {canManage && (
                <button
                  type="button"
                  onClick={onDuplicate}
                  title={`Crear una copia de ${product.name}`}
                  aria-label={`Duplicar ${product.name}`}
                  className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Duplicar
                </button>
              )}
              <ActiveInput disabled={!canManage} checked={product.active} onChange={(active) => change({ active })} />
              {canManage && <RemoveButton label={`Quitar ${product.name}`} onClick={() => onRemove({ id: product.productId, kind: "product", label: product.name })} />}
            </div>
          </EditorRowActions>
        </div>

        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem]">
          <EditorField hint="Sección de la carta donde aparece este producto; el operador navega por categorías." label="Categoría">
            {(id) => (
              <select id={id} disabled={!canManage} value={product.categoryId} onChange={(event) => change({ categoryId: event.target.value })} className={MENU_FIELD_CONTROL_CLASS}>
                {categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
              </select>
            )}
          </EditorField>
          <TextInput disabled={!canManage} hint="Código corto propio (SKU) para inventario o reportes. Puedes dejarlo vacío." label="Clave interna (opcional)" help="Código que usas en inventario o en tu impresora; puedes dejarlo vacío" required={false} maxLength={64} value={product.sku ?? ""} onChange={(sku) => change({ sku: sku.trim() === "" ? null : sku })} />
          <StationSelect disabled={!canManage} usedStations={usedStations} value={product.stationId} onChange={(stationId) => change({ stationId })} />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <GroupMultiSelect canManage={canManage} catalogGroups={catalogGroups} product={product} onManageGroups={onManageGroups}
            onChange={(groupId, assigned) => onProductChange(assigned
              ? toggleGroupAssignment(product, groupId, true, catalogGroups)
              // Unassigning a group that the halves setup points at must not leave a dangling reference.
              : unassignGroup(product, groupId))} />
          {onManageGroups !== undefined && (
            <button
              type="button"
              onClick={onManageGroups}
              className="inline-flex min-h-11 items-center px-1 text-[12px] font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Gestionar grupos →
            </button>
          )}
          <CheckField labelClassName="flex min-h-11 items-center" className={switchClass} label="Permitir mitades"
            hint="Cada mitad lleva un sabor del grupo de sabores; una de las dos puede armarse con ingredientes si eliges un grupo de ingredientes. Aplica a todos los tamaños.">{(id) =>
            <input id={id} type="checkbox" className="size-5" disabled={!canManage} checked={fraction.enabled}
              onChange={(event) => change({ fraction: { ...fraction, enabled: event.target.checked } })} />}</CheckField>
          <CheckField labelClassName="flex min-h-11 items-center" className={switchClass} hint="Marca si este producto causa IVA u otro impuesto. El impuesto se calcula siempre en el servidor con la regla indicada aquí." label="Aplicar impuesto">{(id) =>
            <input id={id} disabled={!canManage} type="checkbox" className="size-5" checked={tax !== null} onChange={(event) => change({ tax: event.target.checked ? { inclusion: "included", name: "IVA", rateDenominator: 100, rateNumerator: 16, taxId: "iva", taxRuleVersion: "1" } : null })} />}</CheckField>
          {canManage && <AddButton label="Añadir tamaño" disabled={variants.length >= MENU_PRODUCT_MAX_VARIANTS} onClick={() => change({ variants: [...variants, {
            active: true, displayOrder: nextDisplayOrder(variants), name: "", sku: null,
            unitPriceMinor: 0, variantId: crypto.randomUUID(),
          }] })} />}
        </div>

        {copyNotice && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-[12px]">Copia de otro producto. La foto no se copia; súbela de nuevo.</p>}

        {variants.length > 0 && <section className="rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="flex items-center gap-1.5 font-heading text-[13px] font-semibold">Tamaños<FieldHint text="Presentaciones del mismo producto (chica, mediana, grande), cada una con su precio. Si no hay tamaños se cobra el precio del producto." /></h3>
              <p className="text-[12px] text-text-muted">Cada tamaño tiene su propio precio.</p></div>
          </div>
          <div className="mt-3 grid gap-3">{variants.map((variant, variantIndex) => <div key={variant.variantId} {...reorderRowProps(`variants-${product.productId}`, variantIndex)}
              className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-bg/50 p-3">
              <EditorRowActions>
                <ReorderHandle count={variants.length} disabled={!canManage} index={variantIndex} listKey={`variants-${product.productId}`}
                  onMove={(from, to) => change({ variants: reorder(variants, from, to) })} />
              </EditorRowActions>
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
              <TextInput disabled={!canManage} hint="Cómo se llama esta presentación, por ejemplo Chica, Mediana o Familiar. No se puede repetir en el mismo producto." invalid={variantInvalid} label="Nombre del tamaño" maxLength={80} value={variant.name}
                onChange={(name) => changeVariant(variant.variantId, { name })} />
              <MoneyInput key={variant.variantId} hint="Precio de venta de este tamaño." label="Precio del tamaño" disabled={!canManage} currency={currency}
                value={variant.unitPriceMinor} onChange={(unitPriceMinor) => changeVariant(variant.variantId, { unitPriceMinor })} />
              <EditorRowActions>
                <ReorderButtons count={variants.length} disabled={!canManage} index={variantIndex} label={variant.name || "tamaño nuevo"}
                  onMove={(from, to) => change({ variants: reorder(variants, from, to) })} />
              </EditorRowActions>
              <EditorRowActions>
                <div className="flex items-center justify-end gap-2">
                  <ActiveInput disabled={!canManage} checked={variant.active}
                    onChange={(active) => changeVariant(variant.variantId, { active })} />
                  {canManage && <RemoveButton label={`Quitar tamaño ${variant.name || "nuevo"}`}
                    onClick={() => onRemove({ id: variant.variantId, groupId: product.productId, kind: "variant", label: variant.name || "tamaño nuevo", unnamed: variant.name.trim() === "" })} />}
                </div>
              </EditorRowActions>
              </div>
            </div>)}</div>
        </section>}

        {fraction.enabled && <section className="rounded-xl border border-border bg-surface p-3">
          <FractionEditor canManage={canManage} groups={groups} notice={legacyFractionNotice(product)} productName={product.name}
            fraction={fraction} onChange={(next) => change({ fraction: next })} />
        </section>}

        {tax !== null && <section className="rounded-xl border border-border bg-surface p-3">
          <h3 className="mb-2 font-heading text-[13px] font-semibold">Impuesto</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <TextInput disabled={!canManage} hint="Identificador corto del impuesto, por ejemplo iva. Sirve para agrupar impuestos en reportes." label="Clave" maxLength={64} value={tax.taxId} onChange={(taxId) => change({ tax: { ...tax, taxId } })} />
            <TextInput disabled={!canManage} hint="Nombre que se imprime en el ticket, por ejemplo IVA." label="Nombre fiscal" maxLength={80} value={tax.name} onChange={(name) => change({ tax: { ...tax, name } })} />
            <TextInput disabled={!canManage} hint="Versión de la regla de cálculo. Cámbiala sólo si el impuesto cambia; las ventas anteriores conservan la suya." label="Versión regla" maxLength={64} value={tax.taxRuleVersion} onChange={(taxRuleVersion) => change({ tax: { ...tax, taxRuleVersion } })} />
            <NumberInput disabled={!canManage} hint="Parte de arriba de la tasa como fracción. Para 16 % escribe 16." label="Numerador" min={0} max={1_000_000} value={tax.rateNumerator} onChange={(rateNumerator) => change({ tax: { ...tax, rateNumerator } })} />
            <NumberInput disabled={!canManage} hint="Parte de abajo de la tasa como fracción. Para 16 % escribe 100." label="Denominador" min={1} max={1_000_000} value={tax.rateDenominator} onChange={(rateDenominator) => change({ tax: { ...tax, rateDenominator } })} />
            <EditorField hint="Incluido: el precio ya trae el impuesto. Adicional: el impuesto se suma al precio al cobrar." label="Tratamiento">{(id) =>
              <select id={id} disabled={!canManage} value={tax.inclusion} onChange={(event) => change({ tax: { ...tax, inclusion: event.target.value as "excluded" | "included" } })} className={MENU_FIELD_CONTROL_CLASS}>
                <option value="included">Incluido</option><option value="excluded">Adicional</option>
              </select>}</EditorField>
          </div>
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
  const label = productName.trim() === "" ? "este producto" : productName;
  const update = (patch: Partial<MenuProductFractionV1>): void => onChange({ ...fraction, ...patch });
  const groupName = (group: MenuModifierGroupV1): string => group.name || "Grupo sin nombre";
  const flavorEligible = groups.filter((group) => group.groupId !== fraction.extraGroupId);
  const usedAsIngredients = groups.find((group) => group.groupId === fraction.extraGroupId);
  const select = MENU_FIELD_CONTROL_CLASS;
  return <div className="grid gap-3 sm:col-span-full">
    <h3 className="font-heading text-[13px] font-semibold">Mitades</h3>
    <p className="-mt-2 text-[12px] text-text-muted">El operador podrá armar {label} mitad y mitad, en cualquier tamaño o sin tamaños.</p>
    {notice !== null && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-[12px]">{notice}</p>}
    {fraction.enabled && <div className="grid gap-3 sm:grid-cols-2">
      {groups.length === 0 && <p role="status" className="text-[12px] text-text-muted sm:col-span-2">Primero asigna a este producto un grupo con los sabores (campo «Grupos de modificadores»).</p>}
      <EditorField hint={GROUP_CHOICE_HINTS.flavors} label="Grupo de sabores"
        help={flavorEligible.length === 0 && usedAsIngredients !== undefined ? `“${groupName(usedAsIngredients)}” ya está usado como ingredientes; crea un grupo de sabores en Modificadores.` : undefined}>
        {(id) => (
          <select id={id} className={select} disabled={!canManage} value={fraction.flavorGroupId ?? ""}
            onChange={(event) => update({ flavorGroupId: event.target.value === "" ? null : event.target.value })}>
            <option value="">Elige un grupo</option>
            {groups.map((group) => {
              const taken = group.groupId === fraction.extraGroupId;
              return <option key={group.groupId} value={group.groupId} disabled={taken}>{groupName(group)}{taken ? " (ya usado como ingredientes)" : ""}</option>;
            })}
          </select>
        )}
      </EditorField>
      <EditorField hint={GROUP_CHOICE_HINTS.ingredients} label="Grupo de ingredientes (para armar y extras, opcional)">
        {(id) => (
          <select id={id} className={select} disabled={!canManage} value={fraction.extraGroupId ?? ""}
            onChange={(event) => {
              const nextExtraGroupId = event.target.value === "" ? null : event.target.value;
              const nextGroup = groups.find((g) => g.groupId === nextExtraGroupId);
              const nextOptionIds = new Set(nextGroup?.options.map((o) => o.optionId) ?? []);
              const prunedLocked = (fraction.lockedIngredientOptionIds ?? []).filter((optId) => nextOptionIds.has(optId));
              update({
                extraGroupId: nextExtraGroupId,
                lockedIngredientOptionIds: prunedLocked,
              });
            }}>
            <option value="">Sin ingredientes</option>
            {groups.map((group) => {
              const taken = group.groupId === fraction.flavorGroupId;
              return <option key={group.groupId} value={group.groupId} disabled={taken}>{groupName(group)}{taken ? " (ya usado como sabores)" : ""}</option>;
            })}
          </select>
        )}
      </EditorField>
      <div className="grid gap-2 sm:col-span-2">
        <span className={MENU_FIELD_LABEL_CLASS}>
          <span className="text-[11px] font-medium">Ingredientes que no se pueden quitar</span>
          <FieldHint
            label="Ingredientes que no se pueden quitar"
            text="Los ingredientes marcados aquí no podrán ser excluidos por el operador al capturar mitades (ej. queso, salsa base). Los no marcados se podrán excluir («Sin ...»)."
          />
        </span>
        {usedAsIngredients === undefined ? (
          <p role="status" className="text-[12px] text-text-muted">
            Selecciona un grupo de ingredientes arriba para configurar ingredientes bloqueados.
          </p>
        ) : usedAsIngredients.options.length === 0 ? (
          <p role="status" className="text-[12px] text-text-muted">
            El grupo seleccionado no tiene opciones. Agrega opciones en la sección Modificadores.
          </p>
        ) : (
          <div className="grid gap-2" role="group" aria-label="Ingredientes que no se pueden quitar">
            <p className="text-[12px] text-text-muted">
              Marca los ingredientes que son indispensables y que el cliente no puede retirar.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {usedAsIngredients.options.map((option) => {
                const isLocked = (fraction.lockedIngredientOptionIds ?? []).includes(option.optionId);
                const toggleLocked = (): void => {
                  if (!canManage) return;
                  const current = fraction.lockedIngredientOptionIds ?? [];
                  const next = isLocked
                    ? current.filter((id) => id !== option.optionId)
                    : current.length < MENU_VARIANT_MAX_LOCKED_INGREDIENTS
                    ? [...current, option.optionId]
                    : current;
                  update({ lockedIngredientOptionIds: next });
                };
                return (
                  <label
                    key={option.optionId}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] hover:bg-bg has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                  >
                    <input
                      type="checkbox"
                      className="size-4 rounded border-border text-accent focus:ring-accent"
                      checked={isLocked}
                      disabled={!canManage}
                      onChange={toggleLocked}
                    />
                    <span className="font-medium text-text">{option.name || "Opción sin nombre"}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>}
  </div>;
}

/**
 * «Grupos de modificadores» of a product: a button that opens a checklist of every group of the catalog. Each row is a
 * 44 px `menuitemcheckbox`; the choice is applied immediately to the draft (nothing is published until «Publicar»).
 */
function GroupMultiSelect({ canManage, catalogGroups, onManageGroups, product, onChange }: {
  readonly canManage: boolean;
  readonly catalogGroups: readonly MenuModifierGroupV1[];
  readonly onManageGroups?: (() => void) | undefined;
  readonly product: MenuProductV1;
  readonly onChange: (groupId: string, assigned: boolean) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const assigned = new Set(groupsForProduct(product, catalogGroups).map((group) => group.groupId));
  const summary = assigned.size === 0 ? "Sin grupos" : assigned.size === 1 ? "1 grupo" : `${assigned.size} grupos`;
  const normalizedQuery = query.trim().toLocaleLowerCase("es-MX");
  const visibleGroups = normalizedQuery === "" ? catalogGroups : catalogGroups.filter((group) => group.name.toLocaleLowerCase("es-MX").includes(normalizedQuery));
  const close = (): void => { setOpen(false); setQuery(""); };
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (container.current !== null && !container.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  return (
    <div ref={container} className="relative inline-flex"
      onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); close(); trigger.current?.focus(); } }}>
      <button ref={trigger} type="button" disabled={!canManage && assigned.size === 0} aria-haspopup="menu" aria-expanded={open} aria-controls={panelId}
        aria-label={`Grupos de modificadores de ${product.name.trim() === "" ? "este producto" : product.name}: ${summary}`}
        onClick={() => { if (open) close(); else setOpen(true); }}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[12px] font-semibold hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60">
        Grupos de modificadores · {summary} <span aria-hidden="true">▾</span>
      </button>
      {open && <div id={panelId} role="menu" aria-label="Grupos de modificadores del catálogo" aria-multiselectable="true"
        className="absolute left-0 top-full z-30 mt-1 flex max-h-72 w-72 max-w-[85vw] flex-col overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl">
        {catalogGroups.length > 8 && <input type="search" autoFocus aria-label="Buscar grupo de modificadores" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="Buscar grupo…"
          className="mb-1 min-h-11 rounded-lg border border-border bg-bg px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-accent" />}
        {catalogGroups.length === 0
          ? <p role="status" className="p-3 text-[12px] text-text-muted">Aún no hay grupos. Créalos en la sección «Grupos de modificadores».</p>
          : visibleGroups.length === 0 ? <p role="status" className="p-3 text-[12px] text-text-muted">No hay grupos que coincidan.</p>
            : visibleGroups.map((group) => {
            const checked = assigned.has(group.groupId);
            return <button key={group.groupId} type="button" role="menuitemcheckbox" aria-checked={checked} disabled={!canManage}
              onClick={() => onChange(group.groupId, !checked)}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-[13px] hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60">
              <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${checked ? "border-accent bg-accent text-white" : "border-border bg-surface"}`}>{checked ? "✓" : ""}</span>
              <span className="min-w-0 flex-1 truncate">{group.name.trim() === "" ? "Grupo sin nombre" : group.name}{group.active ? "" : " (inactivo)"}</span>
            </button>;
          })}
        {onManageGroups !== undefined && (
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => { close(); onManageGroups(); }}
              className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-[12px] font-semibold text-accent hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span>Gestionar grupos</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </div>}
    </div>
  );
}

function ModifierGroupEditor({ assignedCount, siblingCount, siblingIndex, usedImagePaths, onMoveGroup, canManage, currency, group, supabaseUrl, onAddOption, onChange, onDuplicate, onOptionImageChange, onRemove, onUploadPendingChange }: {
  readonly assignedCount: number;
  readonly onDuplicate: () => void;
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
    <section {...reorderRowProps("groups-catalog", siblingIndex)} className="mt-3 flex min-w-0 items-start gap-3 rounded-xl border border-border bg-bg/40 p-3">
      <EditorRowActions>
        <ReorderHandle align="start" count={siblingCount} disabled={!canManage} index={siblingIndex} listKey="groups-catalog" onMove={onMoveGroup} />
      </EditorRowActions>
      <div className="min-w-0 flex-1">
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <TextInput disabled={!canManage} hint="Nombre de la lista de opciones, por ejemplo Sabores o Extras." label="Grupo" maxLength={80} value={group.name} onChange={(name) => change({ name })} />
        <NumberInput disabled={!canManage} hint="Cuántas opciones debe elegir el operador como mínimo en este grupo. 0 = la elección es opcional." label="Mínimo total" min={0} max={1_000} value={group.minimumQuantity} onChange={(minimumQuantity) => change({ minimumQuantity })} />
        <NumberInput disabled={!canManage} hint="Cuántas opciones puede elegir como máximo en total, contando repeticiones de una misma opción." label="Máximo total" min={0} max={1_000} value={group.maximumQuantity} onChange={(maximumQuantity) => change({ maximumQuantity })} />
        <EditorRowActions>
          <ReorderButtons count={siblingCount} disabled={!canManage} index={siblingIndex} label={group.name} onMove={onMoveGroup} />
        </EditorRowActions>
        <EditorRowActions className="sm:ml-auto">
          <div className="flex items-center justify-end gap-2">
            {canManage && <button type="button" onClick={onDuplicate} aria-label={`Duplicar ${group.name}`} title={`Crear una copia de ${group.name}`}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">Duplicar</button>}
            <ActiveInput disabled={!canManage} checked={group.active} onChange={(active) => change({ active })} />
            {canManage && <RemoveButton label={`Quitar ${group.name}`} onClick={() => onRemove({ id: group.groupId, kind: "group", label: group.name })} />}
          </div>
        </EditorRowActions>
      </div>
      <p role="status" className="mt-2 text-[12px] text-text-muted">{assignedCount === 1 ? "Asignado a 1 producto." : `Asignado a ${assignedCount} productos.`}{assignedCount === 0 ? " (sin asignar)" : ""}</p>
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted"><span className="inline-flex flex-wrap items-center gap-1.5">Opciones<FieldHint label="Opciones" text="Cada opción es una alternativa del grupo (por ejemplo Pepperoni) con su precio extra, que puede ser 0." /></span></p>{canManage && <AddButton label="Agregar opción" onClick={onAddOption} />}</div>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        {group.options.map((option) => (
          <div key={option.optionId} className="grid grid-cols-1 items-start gap-2 rounded-lg border border-border bg-bg/50 p-2 sm:grid-cols-[3rem_minmax(0,1fr)_7.5rem_6rem_auto]">
            <div className="flex flex-col items-center">
              <div className="hidden h-5 min-h-5 sm:block" aria-hidden="true" />
              <div className="mt-1 flex h-11 min-h-11 w-12 items-center justify-center">
                <MenuPhoto canManage={canManage} imagePath={option.imagePath} name={option.name} supabaseUrl={supabaseUrl} target="option" targetId={option.optionId} usedImagePaths={usedImagePaths} onChange={(imagePath) => onOptionImageChange(option.optionId, imagePath)} onUploadPendingChange={onUploadPendingChange} />
              </div>
              <div className="hidden min-h-4 sm:block" aria-hidden="true" />
            </div>
            <TextInput disabled={!canManage} hint="Nombre de la opción tal como la ve el operador." label="Opción" maxLength={80} value={option.name} onChange={(name) => changeOption(group, option.optionId, { name }, onChange)} />
            <MoneyInput hint="Cargo adicional por elegir esta opción; 0 si no cuesta extra." disabled={!canManage} currency={currency} value={option.unitPriceMinor} onChange={(unitPriceMinor) => changeOption(group, option.optionId, { unitPriceMinor }, onChange)} />
            <NullableNumberInput hint="Cantidad máxima de veces que se puede elegir esta misma opción (por ejemplo 2 porciones de queso). Vacío = sin límite propio." disabled={!canManage} label="Máximo opcional" min={1} max={1_000} value={option.maximumQuantity} onChange={(maximumQuantity) => changeOption(group, option.optionId, { maximumQuantity }, onChange)} />
            <EditorRowActions>
              <div className="flex items-center justify-end gap-2">
                <ActiveInput disabled={!canManage} checked={option.active} onChange={(active) => changeOption(group, option.optionId, { active }, onChange)} />
                {canManage && group.options.length > 1 && <RemoveButton label={`Quitar ${option.name}`} onClick={() => onRemove({ groupId: group.groupId, id: option.optionId, kind: "option", label: option.name })} />}
              </div>
            </EditorRowActions>
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
 * already used in this menu so a removed one can be picked again without uploading it. A path owned by another entity is
 * copied on the server before the new target path is assigned.
 */
/**
 * Enforces the 3-tier row discipline (Requirement 5 & 9):
 * 1. Fixed-height label area (`h-5 min-h-5`).
 * 2. 44 px target control (`h-11 min-h-11`).
 * 3. Reserved auxiliary line (`min-h-4`) below each field, avoiding baseline jitter.
 */
function EditorField({
  children,
  className = "w-full",
  help,
  hint,
  id: fixedId,
  label,
}: {
  readonly children: (id: string) => ReactNode;
  readonly className?: string;
  readonly help?: ReactNode;
  readonly hint?: string | undefined;
  readonly id?: string | undefined;
  readonly label: string;
}): ReactNode {
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  return (
    <div className={`flex min-w-0 flex-col gap-1 text-[11px] font-medium ${className}`}>
      <span className={MENU_FIELD_LABEL_CLASS}>
        <label htmlFor={id} className="truncate">{label}</label>
        {hint !== undefined && <FieldHint label={label} text={hint} />}
      </span>
      {children(id)}
      <span className={MENU_FIELD_AUXILIARY_CLASS}>
        {help ?? <span className="block min-h-4" aria-hidden="true" />}
      </span>
    </div>
  );
}

/**
 * Container for row actions and handles, vertically centered with the 44 px inputs
 * in the same row.
 */
function EditorRowActions({
  children,
  className = "",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactNode {
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="hidden h-5 min-h-5 sm:block" aria-hidden="true" />
      <div className="mt-1 flex h-11 min-h-11 items-center gap-2">
        {children}
      </div>
      <div className="hidden min-h-4 sm:block" aria-hidden="true" />
    </div>
  );
}

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
  const [panel, setPanel] = useState<"photo" | null>(null);
  const url = menuImagePublicUrl(supabaseUrl, imagePath);
  const entityWord = target === "product" ? "producto" : target === "category" ? "categoría" : "opción";
  const label = `Foto de ${name.trim() === "" ? `${entityWord} sin nombre` : name}`;
  const removedPaths = imagePathsOfEntity(usedImagePaths, targetId).filter((path) => path !== imagePath);
  const menuPaths = usedImagePaths.filter((path) => path !== imagePath);
  const showsPhoto = url !== null && failedPath !== imagePath && imagePath !== null;

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
    if (!canManage || busy) return;
    setMessage(null);
    setPanel("photo");
  };
  const assign = (path: string | null, note: string): void => { onChange(path); setFailedPath(null); setMessage(note); };
  const pickUsed = async (path: string): Promise<void> => {
    if (imagePathsOfEntity([path], targetId).length > 0) {
      assign(path, "Foto elegida. Publica la nueva versión para mostrarla en captura.");
      return;
    }
    setBusy(true);
    onUploadPendingChange(true);
    setMessage("Copiando la foto…");
    try {
      const result = await copyMenuImageAction(target, targetId, path);
      if (result.imagePath === undefined) {
        setMessage(result.error ?? "No se pudo copiar la foto.");
        return;
      }
      assign(result.imagePath, "Foto copiada. Publica la nueva versión para mostrarla en captura.");
    } catch (error: unknown) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message.slice(0, 120)})` : "";
      setMessage(offline
        ? "No se pudo copiar la foto: sin conexión a internet. Revisa la red e inténtalo de nuevo."
        : `No se pudo copiar la foto: el servidor no respondió${detail}. Inténtalo de nuevo.`);
    } finally {
      setBusy(false);
      onUploadPendingChange(false);
    }
  };
  const thumb = "inline-flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border";

  return <div className="relative flex min-w-0 flex-col items-start gap-1">
    <button type="button" disabled={!canManage || busy} aria-label={label} title={imagePath === null ? "Tocar para cargar una foto" : "Tocar para ver o cambiar la foto"} onClick={onThumbnail}
      className={`${thumb} bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-70 ${canManage ? "hover:border-accent" : ""}`}>
      {showsPhoto
        ? <img key={url} src={url} alt="" loading="lazy" onError={() => setFailedPath(imagePath)} className="size-full object-cover" />
        : busy ? <span aria-hidden="true" className="text-[10px] font-semibold text-accent-hover">…</span>
          : <span aria-hidden="true" className="text-lg font-bold text-accent-hover">{name.trim() === "" ? "+" : name.trim().charAt(0).toLocaleUpperCase("es-MX")}</span>}
    </button>
    {canManage && <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true" className="sr-only" onChange={(event) => { void choose(event); }} />}
    {message !== null && <div role="status" className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-2 text-[12px] text-text-muted shadow-lg">
      <p>{message}</p>
      {attempt.current !== null && message.startsWith("No se pudo subir") && <button type="button" disabled={busy} onClick={() => { void retry(); }} className="mt-1 min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-text focus-visible:outline-2 focus-visible:outline-accent">Reintentar</button>}
    </div>}
    {panel !== null && <PhotoDialog title={label} onClose={() => setPanel(null)}>
      {showsPhoto && url !== null && <img src={url} alt={label} className="max-h-[55vh] w-full rounded-xl border border-border bg-bg object-contain" />}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={openPicker} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {showsPhoto ? "Reemplazar" : "Cargar foto"}
        </button>
        {showsPhoto && (
          <button type="button" onClick={() => { onChange(null); setFailedPath(null); setMessage("Foto quitada del borrador."); }} className="min-h-11 rounded-lg border border-[oklch(85%_0.06_25)] px-4 py-2 text-[13px] font-semibold text-error focus-visible:outline-2 focus-visible:outline-accent">
            Quitar
          </button>
        )}
        <button type="button" autoFocus onClick={() => setPanel(null)} className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent">
          Cerrar
        </button>
      </div>
      <UsedPhotos title={`Fotos quitadas de este ${entityWord}`} paths={removedPaths} supabaseUrl={supabaseUrl} onPick={(path) => { void pickUsed(path); }} />
      <UsedPhotos title="Fotos ya usadas en este menú" paths={menuPaths} supabaseUrl={supabaseUrl} onPick={(path) => { void pickUsed(path); }} />
    </PhotoDialog>}
  </div>;
}

/**
 * Folded category color picker: a round button showing the current color (or a dashed ring if none).
 * Tapping it opens a popover with the 8 palette swatches; picking one applies it and closes the popover.
 * Clicking the active color swatch clears it back to automatic and closes.
 */
function CategoryColorPicker({ disabled, name, value, onChange }: {
  readonly disabled: boolean;
  readonly name: string;
  readonly value: MenuCategoryV1["color"];
  readonly onChange: (color: MenuCategoryV1["color"]) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const categoryName = name.trim() === "" ? "categoría sin nombre" : name;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent): void => {
      if (containerRef.current !== null && event.target instanceof Node && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const activeLabel = value !== null && value in MENU_CATEGORY_COLOR_LABELS
    ? `Color ${MENU_CATEGORY_COLOR_LABELS[value]}`
    : "Sin color asignado";

  const colorClasses = menuCategoryColorClasses(value);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${activeLabel} para ${categoryName}. Tocar para cambiar color.`}
        title={value !== null ? `Color: ${MENU_CATEGORY_COLOR_LABELS[value]}` : "Elegir color de categoría"}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-full transition-colors disabled:opacity-70 ${focus} ${
          colorClasses !== undefined
            ? `border-2 ${colorClasses.swatch}`
            : "border-2 border-dashed border-border bg-surface hover:border-accent"
        }`}
      />
      {open && (
        <div
          role="group"
          aria-label={`Color de ${categoryName}`}
          className="absolute left-0 top-full z-40 mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface p-2 shadow-xl"
          style={{ width: "max-content", maxWidth: "min(20rem, calc(100vw - 2rem))" }}
        >
          {MENU_CATEGORY_COLORS.map((color) => {
            const selected = value === color;
            return (
              <button
                key={color}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                aria-label={`Color ${MENU_CATEGORY_COLOR_LABELS[color]}`}
                title={MENU_CATEGORY_COLOR_LABELS[color]}
                onClick={() => {
                  onChange(selected ? null : color);
                  setOpen(false);
                }}
                className={`inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-full border-2 disabled:opacity-70 ${focus} ${menuCategoryColorClasses(color)?.swatch ?? ""} ${selected ? "ring-2 ring-accent ring-offset-1" : ""}`}
              >
                {selected && <span aria-hidden="true" className="text-[14px] font-bold">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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

function StationSelect({ disabled, onChange, usedStations, value, width = "w-full" }: { readonly disabled: boolean; readonly onChange: (value: string) => void; readonly usedStations: readonly string[]; readonly value: string; readonly width?: string }): ReactNode {
  const [other, setOther] = useState(false);
  const [draft, setDraft] = useState("");
  // The station the product had before «Otra estación…»: an emptied field goes back to it instead of leaving a stray value.
  const [before, setBefore] = useState(value);
  const values = stationValues(usedStations, value);
  return (
    <EditorField className={width} hint="Pantalla de cocina (KDS) donde aparece este producto al enviarlo a preparar; p. ej. cocina, barra, pizzas." label="Estación">
      {(id) => (
        <div className="flex min-w-0 flex-col gap-1">
          <select
            id={id}
            disabled={disabled}
            value={other ? MENU_OTHER_STATION : value}
            onChange={(event) => {
              if (event.target.value === MENU_OTHER_STATION) { setBefore(value); setOther(true); }
              else { setOther(false); setDraft(""); onChange(event.target.value); }
            }}
            className={MENU_FIELD_CONTROL_CLASS}
          >
            {values.map((station) => <option key={station} value={station}>{station}</option>)}
            <option value={MENU_OTHER_STATION}>Otra estación…</option>
          </select>
          {other && (
            <input
              aria-label="Nombre de la nueva estación"
              autoFocus
              required
              disabled={disabled}
              maxLength={MENU_STATION_MAX_LENGTH}
              placeholder="Ej. pizzas"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                onChange(event.target.value.trim() === "" ? before : event.target.value.trim());
              }}
              className={MENU_FIELD_CONTROL_CLASS}
            />
          )}
        </div>
      )}
    </EditorField>
  );
}

function TextInput({ disabled, help, hint, invalid = false, label, maxLength, onChange, required = true, value, width = "w-full" }: { readonly disabled: boolean; readonly help?: string; readonly hint?: string; readonly invalid?: boolean; readonly label: string; readonly maxLength: number; readonly onChange: (value: string) => void; readonly required?: boolean; readonly value: string; readonly width?: string }): ReactNode {
  return (
    <EditorField className={width} help={help} hint={hint} label={label}>
      {(id) => (
        <input
          id={id}
          required={required}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={MENU_FIELD_CONTROL_CLASS}
        />
      )}
    </EditorField>
  );
}

function MoneyInput({ currency, disabled, hint, label = "Precio", note, onChange, value, width = "w-full" }: {
  readonly currency: string;
  readonly disabled: boolean;
  readonly hint?: string;
  readonly label?: string;
  /** Replaces the formatted amount shown under the field (for example the tax treatment). */
  readonly note?: string | undefined;
  readonly onChange: (value: number) => void;
  readonly value: number;
  readonly width?: string;
}): ReactNode {
  const [text, setText] = useState(() => formatMinorForMoneyInput(value, currency) ?? "");
  const hintId = useId();
  const digits = currencyFractionDigits(currency);
  const parsed = parseMoneyInputToMinor(text, currency);
  const pattern = digits === 0 ? "[0-9]+" : digits === null ? "(?!)" : `[0-9]+([.,][0-9]{1,${digits}})?`;
  const errorText = digits === null ? "La moneda de este catálogo no está admitida; avisa al administrador."
    : `Escribe un precio válido${digits === 0 ? " sin decimales" : ` con máximo ${digits} decimales`}.`;

  const helpElement = (
    <span id={hintId} className={parsed === null ? "text-error" : "text-text-muted"}>
      {parsed === null ? errorText : note ?? formatMinorUnits(value, currency)}
    </span>
  );

  return (
    <EditorField className={width} help={helpElement} hint={hint} label={label}>
      {(id) => (
        <input
          id={id}
          required
          disabled={disabled}
          type="text"
          inputMode="decimal"
          pattern={pattern}
          value={text}
          aria-invalid={parsed === null}
          aria-describedby={hintId}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const amount = parseMoneyInputToMinor(next, currency);
            event.target.setCustomValidity(amount === null ? errorText : "");
            if (amount !== null) onChange(amount);
          }}
          onBlur={() => { if (parsed !== null) setText(formatMinorForMoneyInput(parsed, currency) ?? ""); }}
          className={MENU_FIELD_CONTROL_CLASS}
        />
      )}
    </EditorField>
  );
}

function NumberInput({ disabled, help, hint, label, max, min, onChange, value, width = "w-full" }: { readonly disabled: boolean; readonly help?: string; readonly hint?: string; readonly label: string; readonly max: number; readonly min: number; readonly onChange: (value: number) => void; readonly value: number; readonly width?: string }): ReactNode {
  return (
    <EditorField className={width} help={help} hint={hint} label={label}>
      {(id) => (
        <input
          id={id}
          required
          disabled={disabled}
          type="number"
          min={min}
          max={max}
          step="1"
          value={value}
          onChange={(event) => onChange(integerFrom(event.target.value, min, max))}
          className={MENU_FIELD_CONTROL_CLASS}
        />
      )}
    </EditorField>
  );
}

function NullableNumberInput({ disabled, help, hint, label, max, min, onChange, value, width = "w-full" }: { readonly disabled: boolean; readonly help?: string; readonly hint?: string; readonly label: string; readonly max: number; readonly min: number; readonly onChange: (value: number | null) => void; readonly value: number | null; readonly width?: string }): ReactNode {
  return (
    <EditorField className={width} help={help} hint={hint} label={label}>
      {(id) => (
        <input
          id={id}
          disabled={disabled}
          type="number"
          min={min}
          max={max}
          step="1"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? null : integerFrom(event.target.value, min, max))}
          className={MENU_FIELD_CONTROL_CLASS}
        />
      )}
    </EditorField>
  );
}

function ActiveInput({ checked, disabled, onChange }: { readonly checked: boolean; readonly disabled: boolean; readonly onChange: (value: boolean) => void }): ReactNode {
  return <CheckField labelClassName="flex min-h-11 items-center" className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium" hint={ACTIVE_HINT} label="Activo">{(id) => <input id={id} type="checkbox" className="size-5" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} />}</CheckField>;
}

function AddButton({ disabled = false, label, onClick }: { readonly disabled?: boolean; readonly label: string; readonly onClick: () => void }): ReactNode {
  return <button type="button" disabled={disabled} onClick={onClick} className="min-h-11 rounded-lg border border-accent px-3 py-2 text-[12px] font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-40">+ {label}</button>;
}

function RemoveButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }): ReactNode {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-lg border border-[oklch(85%_0.06_25)] px-2 text-[15px] font-bold text-error hover:bg-error-bg focus-visible:outline-2 focus-visible:outline-accent">×</button>;
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
