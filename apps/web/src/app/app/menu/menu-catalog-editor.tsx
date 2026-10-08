"use client";

import { MENU_PRODUCT_MAX_VARIANTS, MENU_VARIANT_MAX_EXCLUDABLE_INGREDIENTS } from "@super-restaurant/shared-types";
import type {
  MenuCategoryV1,
  MenuCatalogStateV1,
  MenuModifierGroupV1,
  MenuModifierOptionV1,
  MenuProductV1,
  MenuProductVariantV1,
  MenuVariantFractionV1,
} from "@super-restaurant/shared-types";
import { useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { DEFAULT_PESO_CURRENCY, formatMinorForMoneyInput, parseMoneyInputToMinor } from "../../../lib/capture-payment";
import { currencyFractionDigits } from "../../../lib/money-scale";
import { isMenuImageContentType, menuImageAttempt, menuImagePublicUrl, publishDisabledReason, validateMenuImageFile, type MenuImageAttempt } from "../../../lib/menu-images";
import { variantValidationError } from "../../../lib/menu-variants";
import { reorder, reorderSubset } from "../../../lib/menu-reorder";
import { ReorderControls, reorderRowProps } from "./reorder-controls";

import { saveMenuCatalogAction, uploadMenuImageAction } from "./actions";

interface Draft {
  readonly categories: readonly MenuCategoryV1[];
  readonly currency: string;
  readonly expectedVersion: number;
  readonly modifierGroups: readonly MenuModifierGroupV1[];
  readonly products: readonly MenuProductV1[];
}

type Removal = Readonly<{
  groupId?: string;
  id: string;
  kind: "category" | "group" | "option" | "product" | "variant";
  label: string;
}>;

export function MenuCatalogEditor({ canManage, state, supabaseUrl }: {
  readonly canManage: boolean;
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
  const variantIssue = products.map((product) => variantValidationError(product.productId, product.variants ?? [], new Set(groups.filter((group) => group.productId === product.productId).map((group) => group.groupId)))).find((issue) => issue !== null) ?? null;
  const variantError = variantIssue === null ? null : `${products.find((product) => product.productId === variantIssue.productId)?.name || "Producto sin nombre"}: ${variantIssue.message}`;
  const [pendingUploads, setPendingUploads] = useState(0);
  const onUploadPendingChange = (pending: boolean): void => setPendingUploads((current) => current + (pending ? 1 : -1));
  const expectedVersion = state.catalog?.version ?? 0;
  const draft = useMemo(() => JSON.stringify({ categories, currency, expectedVersion, modifierGroups: groups, products } satisfies Draft), [categories, currency, expectedVersion, groups, products]);

  const addCategory = (): void => {
    setCategories((current) => [...current, {
      active: true,
      categoryId: crypto.randomUUID(),
      displayOrder: nextDisplayOrder(current),
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
      unit: "pieza",
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

  const confirmRemoval = (): void => {
    if (removal === null) return;
    if (removal.kind === "category") {
      const removedProducts = new Set(products.filter((product) => product.categoryId === removal.id).map((product) => product.productId));
      setCategories((current) => current.filter((category) => category.categoryId !== removal.id));
      setProducts((current) => current.filter((product) => !removedProducts.has(product.productId)));
      setGroups((current) => current.filter((group) => !removedProducts.has(group.productId)));
    } else if (removal.kind === "product") {
      setProducts((current) => current.filter((product) => product.productId !== removal.id));
      setGroups((current) => current.filter((group) => group.productId !== removal.id));
    } else if (removal.kind === "group") {
      setGroups((current) => current.filter((group) => group.groupId !== removal.id));
    } else if (removal.kind === "variant" && removal.groupId !== undefined) {
      setProducts((current) => current.map((product) => product.productId === removal.groupId
        ? { ...product, variants: product.variants?.filter((variant) => variant.variantId !== removal.id) ?? [] } : product));
    } else if (removal.groupId !== undefined) {
      setGroups((current) => current.map((group) => group.groupId === removal.groupId
        ? { ...group, options: group.options.filter((option) => option.optionId !== removal.id) }
        : group));
    }
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
          <PublishButton pendingUploads={pendingUploads} variantError={variantError} />
        ) : (
          <p className="rounded-lg bg-bg px-3 py-2 text-[12px] text-text-muted">Vista de solo lectura</p>
        )}
      </section>
      {variantError !== null && <p role="alert" className="text-sm text-error">{variantError}</p>}

      {removal !== null && (
        <section role="alertdialog" aria-labelledby="remove-title" className="rounded-xl border border-[oklch(80%_0.09_45)] bg-[oklch(97%_0.025_70)] p-4">
          <h2 id="remove-title" className="font-heading text-[14px] font-semibold">¿Quitar “{removal.label}” del borrador?</h2>
          <p className="mt-1 text-[12px] text-text-muted">La publicación anterior seguirá intacta. Si contiene elementos dependientes, también se quitarán de esta nueva versión.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={confirmRemoval} className="rounded-lg bg-error px-3 py-2 text-[12px] font-semibold text-white">Sí, quitar</button>
            <button type="button" onClick={() => setRemoval(null)} className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold">Cancelar</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <SectionHeader title="Categorías" description="Organizan la carta y controlan su orden de aparición.">
          {canManage && <AddButton label="Agregar categoría" onClick={addCategory} />}
        </SectionHeader>
        {categories.length === 0 ? <EmptyText text="Agrega una categoría para comenzar el menú." /> : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {categories.map((category, index) => (
              <article key={category.categoryId} {...reorderRowProps("categories", index)} className="grid gap-3 rounded-xl border border-border bg-bg/50 p-3 sm:grid-cols-[1fr_auto_auto]">
                <TextInput disabled={!canManage} label="Nombre" maxLength={80} value={category.name} onChange={(name) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, name } : entry))} />
                <ReorderControls count={categories.length} disabled={!canManage} index={index} label={category.name} listKey="categories" onMove={(from, to) => setCategories((current) => reorder(current, from, to))} />
                <div className="flex items-end gap-2 pb-1">
                  <ActiveInput disabled={!canManage} checked={category.active} onChange={(active) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, active } : entry))} />
                  {canManage && <RemoveButton label={`Quitar ${category.name}`} onClick={() => setRemoval({ id: category.categoryId, kind: "category", label: category.name })} />}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <SectionHeader title="Productos y modificadores" description="Captura precios en la moneda del restaurante; los grupos pertenecen a un solo producto.">
          {canManage && <AddButton disabled={categories.length === 0} label="Agregar producto" onClick={addProduct} />}
        </SectionHeader>
        {products.length === 0 ? <EmptyText text="No hay productos en este borrador." /> : (
          <div className="mt-4 flex flex-col gap-4">
            {products.map((product) => (
              <ProductEditor siblingCount={products.filter((entry) => entry.categoryId === product.categoryId).length} siblingIndex={products.filter((entry) => entry.categoryId === product.categoryId).findIndex((entry) => entry.productId === product.productId)} onMoveProduct={(from, to) => setProducts((current) => reorderSubset(current, (entry) => entry.categoryId === product.categoryId, from, to))} variantInvalid={variantIssue?.productId === product.productId}
                key={product.productId}
                canManage={canManage}
                categories={categories}
                currency={currency}
                groups={groups.filter((group) => group.productId === product.productId)}
                product={product}
                supabaseUrl={supabaseUrl}
                onAddGroup={() => addGroup(product.productId)}
                onAddOption={addOption}
                onGroupsChange={setGroups}
                onProductChange={(changed) => setProducts((current) => current.map((entry) => entry.productId === changed.productId ? changed : entry))}
                onProductImageChange={(imagePath) => setProducts((current) => current.map((entry) => entry.productId === product.productId ? { ...entry, imagePath } : entry))}
                onOptionImageChange={(groupId, optionId, imagePath) => setGroups((current) => current.map((entry) => entry.groupId === groupId ? { ...entry, options: entry.options.map((option) => option.optionId === optionId ? { ...option, imagePath } : option) } : entry))}
                onRemove={(request) => setRemoval(request)}
                onUploadPendingChange={onUploadPendingChange}
              />
            ))}
          </div>
        )}
      </section>
    </form>
  );
}

function PublishButton({ pendingUploads, variantError }: { readonly pendingUploads: number; readonly variantError: string | null }): ReactNode {
  const { pending: saving } = useFormStatus();
  const disabledReason = variantError ?? publishDisabledReason(pendingUploads, saving);
  return <button type="submit" disabled={disabledReason !== null}
    className="min-h-11 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60">
    {disabledReason ?? "Publicar nueva versión"}
  </button>;
}

function ProductEditor({ siblingCount, siblingIndex, onMoveProduct, variantInvalid, canManage, categories, currency, groups, product, supabaseUrl, onAddGroup, onAddOption, onGroupsChange, onProductChange, onProductImageChange, onOptionImageChange, onRemove, onUploadPendingChange }: {
  readonly siblingCount: number;
  readonly siblingIndex: number;
  readonly onMoveProduct: (from: number, to: number) => void;
  readonly variantInvalid: boolean;
  readonly canManage: boolean;
  readonly categories: readonly MenuCategoryV1[];
  readonly currency: string;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly product: MenuProductV1;
  readonly supabaseUrl: string;
  readonly onAddGroup: () => void;
  readonly onAddOption: (groupId: string) => void;
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
  const changeVariant = (variantId: string, patch: Partial<MenuProductVariantV1>): void =>
    change({ variants: variants.map((variant) => variant.variantId === variantId ? { ...variant, ...patch } : variant) });
  return (
    <article {...reorderRowProps(`products-${product.categoryId}`, siblingIndex)} className="min-w-0 rounded-2xl border border-border bg-bg/40 p-3 sm:p-4">
      <MenuPhoto canManage={canManage} imagePath={product.imagePath} name={product.name} supabaseUrl={supabaseUrl} target="product" targetId={product.productId} onChange={onProductImageChange} onUploadPendingChange={onUploadPendingChange} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TextInput disabled={!canManage} label="Producto" maxLength={120} value={product.name} onChange={(name) => change({ name })} />
        <label className="flex flex-col gap-1 text-[11px] font-medium">Categoría
          <select disabled={!canManage} value={product.categoryId} onChange={(event) => change({ categoryId: event.target.value })} className="min-h-10 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70">
            {categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
          </select>
        </label>
        <TextInput disabled={!canManage} label="Clave interna (opcional)" help="Código que usas en inventario o en tu impresora; puedes dejarlo vacío" required={false} maxLength={64} value={product.sku ?? ""} onChange={(sku) => change({ sku: sku.trim() === "" ? null : sku })} />
        <MoneyInput disabled={!canManage} currency={currency} value={product.unitPriceMinor} onChange={(unitPriceMinor) => change({ unitPriceMinor })} />
        <TextInput disabled={!canManage} label="Estación" maxLength={64} value={product.stationId} onChange={(stationId) => change({ stationId })} />
        <TextInput disabled={!canManage} label="Unidad" maxLength={32} value={product.unit} onChange={(unit) => change({ unit })} />
        <ReorderControls count={siblingCount} disabled={!canManage} index={siblingIndex} label={product.name} listKey={`products-${product.categoryId}`} onMove={onMoveProduct} />
        <div className="flex items-end gap-2 pb-1">
          <ActiveInput disabled={!canManage} checked={product.active} onChange={(active) => change({ active })} />
          {canManage && <RemoveButton label={`Quitar ${product.name}`} onClick={() => onRemove({ id: product.productId, kind: "product", label: product.name })} />}
        </div>
      </div>

      <section className="mt-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="font-heading text-[13px] font-semibold">Tamaños</h3>
            <p className="text-[12px] text-text-muted">Cada tamaño tiene su propio precio.</p></div>
          {canManage && <AddButton label="Añadir tamaño" disabled={variants.length >= MENU_PRODUCT_MAX_VARIANTS} onClick={() => change({ variants: [...variants, {
            active: true, displayOrder: nextDisplayOrder(variants), name: "", sku: null,
            unitPriceMinor: 0, variantId: crypto.randomUUID(),
          }] })} />}
        </div>
        {variants.length === 0 ? <p className="mt-2 text-[12px] text-text-muted">Sin tamaños; se usa el precio del producto.</p> :
          <div className="mt-3 grid gap-3">{variants.map((variant, variantIndex) => <div key={variant.variantId} {...reorderRowProps(`variants-${product.productId}`, variantIndex)}
            className="grid min-w-0 gap-3 rounded-lg border border-border bg-bg/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)auto_auto]">
            <TextInput disabled={!canManage} invalid={variantInvalid} label="Nombre del tamaño" maxLength={80} value={variant.name}
              onChange={(name) => changeVariant(variant.variantId, { name })} />
            <MoneyInput key={variant.variantId} label="Precio del tamaño" disabled={!canManage} currency={currency}
              value={variant.unitPriceMinor} onChange={(unitPriceMinor) => changeVariant(variant.variantId, { unitPriceMinor })} />
            <ReorderControls count={variants.length} disabled={!canManage} index={variantIndex} label={variant.name || "tamaño nuevo"} listKey={`variants-${product.productId}`}
              onMove={(from, to) => change({ variants: reorder(variants, from, to) })} />
            <div className="flex items-end gap-2 pb-1"><ActiveInput disabled={!canManage} checked={variant.active}
              onChange={(active) => changeVariant(variant.variantId, { active })} />
              {canManage && <RemoveButton label={`Quitar tamaño ${variant.name || "nuevo"}`}
                onClick={() => onRemove({ id: variant.variantId, groupId: product.productId, kind: "variant", label: variant.name || "tamaño nuevo" })} />}
            </div>
            <FractionEditor canManage={canManage} groups={groups} variant={variant}
              onChange={(fraction) => changeVariant(variant.variantId, { fraction })} />
          </div>)}</div>}
      </section>

      <div className="mt-3 rounded-xl border border-border bg-surface p-3">
        <label className="inline-flex min-h-10 items-center gap-2 text-[12px] font-semibold">
          <input disabled={!canManage} type="checkbox" checked={product.tax !== null} onChange={(event) => change({ tax: event.target.checked ? { inclusion: "included", name: "IVA", rateDenominator: 100, rateNumerator: 16, taxId: "iva", taxRuleVersion: "1" } : null })} />
          Aplicar impuesto
        </label>
        {tax !== null && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <TextInput disabled={!canManage} label="Clave" maxLength={64} value={tax.taxId} onChange={(taxId) => change({ tax: { ...tax, taxId } })} />
            <TextInput disabled={!canManage} label="Nombre fiscal" maxLength={80} value={tax.name} onChange={(name) => change({ tax: { ...tax, name } })} />
            <TextInput disabled={!canManage} label="Versión regla" maxLength={64} value={tax.taxRuleVersion} onChange={(taxRuleVersion) => change({ tax: { ...tax, taxRuleVersion } })} />
            <NumberInput disabled={!canManage} label="Numerador" min={0} max={1_000_000} value={tax.rateNumerator} onChange={(rateNumerator) => change({ tax: { ...tax, rateNumerator } })} />
            <NumberInput disabled={!canManage} label="Denominador" min={1} max={1_000_000} value={tax.rateDenominator} onChange={(rateDenominator) => change({ tax: { ...tax, rateDenominator } })} />
            <label className="flex flex-col gap-1 text-[11px] font-medium">Tratamiento
              <select disabled={!canManage} value={tax.inclusion} onChange={(event) => change({ tax: { ...tax, inclusion: event.target.value as "excluded" | "included" } })} className="min-h-10 rounded-lg border border-border bg-surface px-2 text-[13px]">
                <option value="included">Incluido</option><option value="excluded">Adicional</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <h3 className="font-heading text-[13px] font-semibold">Grupos de modificadores</h3>
        {canManage && <AddButton label="Agregar grupo" onClick={onAddGroup} />}
      </div>
      {groups.length === 0 ? <p className="mt-2 text-[12px] text-text-muted">Sin modificadores.</p> : groups.map((group, groupIndex) => (
        <ModifierGroupEditor key={group.groupId} siblingCount={groups.length} siblingIndex={groupIndex} onMoveGroup={(from, to) => onGroupsChange((current) => reorderSubset(current, (entry) => entry.productId === product.productId, from, to))} canManage={canManage} currency={currency} group={group} supabaseUrl={supabaseUrl} onAddOption={() => onAddOption(group.groupId)} onChange={(changed) => onGroupsChange((current) => current.map((entry) => entry.groupId === changed.groupId ? changed : entry))} onOptionImageChange={(optionId, imagePath) => onOptionImageChange(group.groupId, optionId, imagePath)} onRemove={onRemove} onUploadPendingChange={onUploadPendingChange} />
      ))}
    </article>
  );
}

const EMPTY_FRACTION: MenuVariantFractionV1 = { enabled: false, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: null };

/** "Permitir mitades" for one size: switch, flavor group, extras group and removable ingredients. */
function FractionEditor({ canManage, groups, variant, onChange }: {
  readonly canManage: boolean;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly variant: MenuProductVariantV1;
  readonly onChange: (fraction: MenuVariantFractionV1) => void;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const fraction = variant.fraction ?? EMPTY_FRACTION;
  const label = variant.name || "este tamaño";
  const update = (patch: Partial<MenuVariantFractionV1>): void => onChange({ ...fraction, ...patch });
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
    <label className="inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold">
      <input type="checkbox" className="h-5 w-5" disabled={!canManage} checked={fraction.enabled}
        onChange={(event) => update({ enabled: event.target.checked })} />
      Permitir mitades
      <span className="text-[12px] font-normal text-text-muted">El operador podrá armar {label} mitad y mitad.</span>
    </label>
    {fraction.enabled && <div className="grid gap-3 sm:grid-cols-2">
      {groups.length === 0 && <p role="status" className="text-[12px] text-text-muted sm:col-span-2">Primero crea un grupo con los sabores en «Modificadores» de este producto.</p>}
      <label className="flex flex-col gap-1 text-[11px] font-medium">Grupo de sabores
        <select className={select} disabled={!canManage} value={fraction.flavorGroupId ?? ""}
          onChange={(event) => update({ flavorGroupId: event.target.value === "" ? null : event.target.value })}>
          <option value="">Elige un grupo</option>
          {groups.filter((group) => group.groupId !== fraction.extraGroupId).map((group) => <option key={group.groupId} value={group.groupId}>{group.name || "Grupo sin nombre"}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-medium">Grupo de extras (opcional)
        <select className={select} disabled={!canManage} value={fraction.extraGroupId ?? ""}
          onChange={(event) => update({ extraGroupId: event.target.value === "" ? null : event.target.value })}>
          <option value="">Sin extras</option>
          {groups.filter((group) => group.groupId !== fraction.flavorGroupId).map((group) => <option key={group.groupId} value={group.groupId}>{group.name || "Grupo sin nombre"}</option>)}
        </select>
      </label>
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

function ModifierGroupEditor({ siblingCount, siblingIndex, onMoveGroup, canManage, currency, group, supabaseUrl, onAddOption, onChange, onOptionImageChange, onRemove, onUploadPendingChange }: {
  readonly siblingCount: number;
  readonly siblingIndex: number;
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
    <section {...reorderRowProps(`groups-${group.productId}`, siblingIndex)} className="mt-3 min-w-0 rounded-xl border border-border bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <TextInput disabled={!canManage} label="Grupo" maxLength={80} value={group.name} onChange={(name) => change({ name })} />
        <NumberInput disabled={!canManage} label="Mínimo total" min={0} max={1_000} value={group.minimumQuantity} onChange={(minimumQuantity) => change({ minimumQuantity })} />
        <NumberInput disabled={!canManage} label="Máximo total" min={0} max={1_000} value={group.maximumQuantity} onChange={(maximumQuantity) => change({ maximumQuantity })} />
        <ReorderControls count={siblingCount} disabled={!canManage} index={siblingIndex} label={group.name} listKey={`groups-${group.productId}`} onMove={onMoveGroup} />
        <div className="flex items-end gap-2 pb-1"><ActiveInput disabled={!canManage} checked={group.active} onChange={(active) => change({ active })} />{canManage && <RemoveButton label={`Quitar ${group.name}`} onClick={() => onRemove({ id: group.groupId, kind: "group", label: group.name })} />}</div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Opciones</p>{canManage && <AddButton label="Agregar opción" onClick={onAddOption} />}</div>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        {group.options.map((option) => (
          <div key={option.optionId} className="grid gap-2 rounded-lg border border-border bg-bg/50 p-2 sm:grid-cols-[1fr_170px_140px_auto]">
            <div className="sm:col-span-full"><MenuPhoto canManage={canManage} imagePath={option.imagePath} name={option.name} supabaseUrl={supabaseUrl} target="option" targetId={option.optionId} onChange={(imagePath) => onOptionImageChange(option.optionId, imagePath)} onUploadPendingChange={onUploadPendingChange} /></div>
            <TextInput disabled={!canManage} label="Opción" maxLength={80} value={option.name} onChange={(name) => changeOption(group, option.optionId, { name }, onChange)} />
            <MoneyInput disabled={!canManage} currency={currency} value={option.unitPriceMinor} onChange={(unitPriceMinor) => changeOption(group, option.optionId, { unitPriceMinor }, onChange)} />
            <NullableNumberInput disabled={!canManage} label="Máximo opcional" min={1} max={1_000} value={option.maximumQuantity} onChange={(maximumQuantity) => changeOption(group, option.optionId, { maximumQuantity }, onChange)} />
            <div className="flex items-end gap-2 pb-1"><ActiveInput disabled={!canManage} checked={option.active} onChange={(active) => changeOption(group, option.optionId, { active }, onChange)} />{canManage && group.options.length > 1 && <RemoveButton label={`Quitar ${option.name}`} onClick={() => onRemove({ groupId: group.groupId, id: option.optionId, kind: "option", label: option.name })} />}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function changeOption(group: MenuModifierGroupV1, optionId: string, patch: Partial<MenuModifierOptionV1>, onChange: (group: MenuModifierGroupV1) => void): void {
  onChange({ ...group, options: group.options.map((option) => option.optionId === optionId ? { ...option, ...patch } : option) });
}

function MenuPhoto({ canManage, imagePath, name, supabaseUrl, target, targetId, onChange, onUploadPendingChange }: {
  readonly canManage: boolean;
  readonly imagePath: string | null;
  readonly name: string;
  readonly supabaseUrl: string;
  readonly target: "product" | "option";
  readonly targetId: string;
  readonly onChange: (imagePath: string | null) => void;
  readonly onUploadPendingChange: (pending: boolean) => void;
}): ReactNode {
  const fileInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<MenuImageAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const url = menuImagePublicUrl(supabaseUrl, imagePath);

  const upload = async (selected: MenuImageAttempt): Promise<void> => {
    setMessage("Subiendo…");
    try {
      const result = await uploadMenuImageAction(target, targetId, selected);
      if (result.imagePath === undefined) { setMessage(result.error ?? "No se pudo subir la foto."); return; }
      onChange(result.imagePath);
      setFailedPath(null);
      setMessage("Foto lista. Publica la nueva versión para mostrarla en captura.");
    } catch {
      setMessage("No se pudo subir la foto. Inténtalo de nuevo.");
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
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read"));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });
      const dataBase64 = dataUrl.split(",", 2)[1];
      if (dataBase64 === undefined || !isMenuImageContentType(file.type)) throw new Error("read");
      const selected = menuImageAttempt(attempt.current, { contentType: file.type, dataBase64, fileName: file.name, lastModified: file.lastModified }, () => crypto.randomUUID(), () => new Date().toISOString());
      attempt.current = selected;
      await upload(selected);
    } catch {
      setMessage("No se pudo leer la foto. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
      onUploadPendingChange(false);
    }
  };

  return <div className="flex min-w-0 flex-wrap items-center gap-2 py-2">
    {url !== null && failedPath !== imagePath
      ? <img key={url} src={url} alt="" loading="lazy" onError={() => setFailedPath(imagePath)} className="h-14 w-14 rounded-lg border border-border object-cover" />
      : <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-lg bg-accent-soft text-lg font-bold text-accent">{name.trim().charAt(0).toLocaleUpperCase("es-MX")}</span>}
    {canManage && <>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={`Foto de ${name}`} onChange={(event) => { void choose(event); }} />
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60">{busy ? "Subiendo…" : "Foto"}</button>
      {attempt.current !== null && message !== null && message.startsWith("No se pudo subir") && <button type="button" disabled={busy} onClick={() => { void retry(); }} className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Reintentar</button>}
      {imagePath !== null && <button type="button" disabled={busy} onClick={() => { onChange(null); setMessage("Foto quitada del borrador."); }} className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent">Quitar foto</button>}
    </>}
    {message !== null && <span role="status" className="min-w-0 basis-full text-xs text-text-muted">{message}</span>}
  </div>;
}

function SectionHeader({ children, description, title }: { readonly children?: ReactNode; readonly description: string; readonly title: string }): ReactNode {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-heading text-[16px] font-semibold">{title}</h2><p className="mt-1 text-[12px] text-text-muted">{description}</p></div>{children}</div>;
}

function TextInput({ disabled, help, invalid = false, label, maxLength, onChange, required = true, value, width = "w-full" }: { readonly disabled: boolean; readonly help?: string; readonly invalid?: boolean; readonly label: string; readonly maxLength: number; readonly onChange: (value: string) => void; readonly required?: boolean; readonly value: string; readonly width?: string }): ReactNode {
  return <label className={`flex min-w-0 flex-col gap-1 text-[11px] font-medium ${width}`}>{label}<input required={required} aria-invalid={invalid || undefined} disabled={disabled} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70" />{help && <span className="text-[11px] font-normal text-text-muted">{help}</span>}</label>;
}

function MoneyInput({ currency, disabled, label = "Precio", onChange, value }: {
  readonly currency: string;
  readonly disabled: boolean;
  readonly label?: string;
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
  return <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium">{label}
    <input
      required disabled={disabled} type="text" inputMode="decimal" pattern={pattern}
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
      {parsed === null ? errorText : formatMinorUnits(value, currency)}
    </span>
  </label>;
}

function NumberInput({ disabled, label, max, min, onChange, value }: { readonly disabled: boolean; readonly label: string; readonly max: number; readonly min: number; readonly onChange: (value: number) => void; readonly value: number }): ReactNode {
  return <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium">{label}<input required disabled={disabled} type="number" min={min} max={max} step="1" value={value} onChange={(event) => onChange(integerFrom(event.target.value, min, max))} className="min-h-10 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70" /></label>;
}


function NullableNumberInput({ disabled, label, max, min, onChange, value }: { readonly disabled: boolean; readonly label: string; readonly max: number; readonly min: number; readonly onChange: (value: number | null) => void; readonly value: number | null }): ReactNode {
  return <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium">{label}<input disabled={disabled} type="number" min={min} max={max} step="1" value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : integerFrom(event.target.value, min, max))} className="min-h-10 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70" /></label>;
}

function ActiveInput({ checked, disabled, onChange }: { readonly checked: boolean; readonly disabled: boolean; readonly onChange: (value: boolean) => void }): ReactNode {
  return <label className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium"><input type="checkbox" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} />Activo</label>;
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
