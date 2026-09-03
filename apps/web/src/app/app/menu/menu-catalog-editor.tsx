"use client";

import type {
  MenuCategoryV1,
  MenuCatalogStateV1,
  MenuModifierGroupV1,
  MenuModifierOptionV1,
  MenuProductV1,
} from "@super-restaurant/shared-types";
import { useMemo, useState, type ReactNode } from "react";

import { saveMenuCatalogAction } from "./actions";

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
  kind: "category" | "group" | "option" | "product";
  label: string;
}>;

export function MenuCatalogEditor({ canManage, state }: {
  readonly canManage: boolean;
  readonly state: MenuCatalogStateV1;
}): ReactNode {
  const [currency, setCurrency] = useState(state.catalog?.currency ?? "MXN");
  const [categories, setCategories] = useState<readonly MenuCategoryV1[]>(() =>
    state.catalog?.categories.map((category) => ({ ...category })) ?? [],
  );
  const [products, setProducts] = useState<readonly MenuProductV1[]>(() =>
    state.catalog?.products.map((product) => ({ ...product, tax: product.tax === null ? null : { ...product.tax } })) ?? [],
  );
  const [groups, setGroups] = useState<readonly MenuModifierGroupV1[]>(() =>
    state.catalog?.modifierGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option })),
    })) ?? [],
  );
  const [removal, setRemoval] = useState<Removal | null>(null);
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
      name: "Nuevo producto",
      productId: crypto.randomUUID(),
      sku: null,
      stationId: "general",
      tax: null,
      unit: "pieza",
      unitPriceMinor: 0,
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
      options: [{ active: true, maximumQuantity: null, name: "Nueva opción", optionId: crypto.randomUUID(), unitPriceMinor: 0 }],
      productId,
    }]);
  };
  const addOption = (groupId: string): void => {
    setGroups((current) => current.map((group) => group.groupId === groupId ? {
      ...group,
      options: [...group.options, {
        active: true,
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
    } else if (removal.groupId !== undefined) {
      setGroups((current) => current.map((group) => group.groupId === removal.groupId
        ? { ...group, options: group.options.filter((option) => option.optionId !== removal.id) }
        : group));
    }
    setRemoval(null);
  };

  return (
    <form action={saveMenuCatalogAction} className="flex min-w-0 flex-col gap-5">
      <input type="hidden" name="draft" value={draft} />
      <section className="sticky top-0 z-20 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-surface/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">Versión actual</p>
            <p className="font-heading text-[18px] font-bold">{expectedVersion === 0 ? "Sin publicar" : `v${expectedVersion}`}</p>
          </div>
          <TextInput
            disabled={!canManage}
            label="Moneda ISO"
            maxLength={3}
            value={currency}
            onChange={(value) => setCurrency(value.toUpperCase())}
            width="w-28"
          />
          <p className="pb-2 text-[12px] text-text-muted">
            {categories.length} categorías · {products.length} productos · {groups.length} grupos
          </p>
        </div>
        {canManage ? (
          <button type="submit" className="min-h-11 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Publicar nueva versión
          </button>
        ) : (
          <p className="rounded-lg bg-bg px-3 py-2 text-[12px] text-text-muted">Vista de solo lectura</p>
        )}
      </section>

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
            {categories.map((category) => (
              <article key={category.categoryId} className="grid gap-3 rounded-xl border border-border bg-bg/50 p-3 sm:grid-cols-[1fr_110px_auto]">
                <TextInput disabled={!canManage} label="Nombre" maxLength={80} value={category.name} onChange={(name) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, name } : entry))} />
                <NumberInput disabled={!canManage} label="Orden" min={0} max={1_000_000} value={category.displayOrder} onChange={(displayOrder) => setCategories((current) => current.map((entry) => entry.categoryId === category.categoryId ? { ...entry, displayOrder } : entry))} />
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
        <SectionHeader title="Productos y modificadores" description="Precios exactos en unidad monetaria menor; los grupos pertenecen a un solo producto.">
          {canManage && <AddButton disabled={categories.length === 0} label="Agregar producto" onClick={addProduct} />}
        </SectionHeader>
        {products.length === 0 ? <EmptyText text="No hay productos en este borrador." /> : (
          <div className="mt-4 flex flex-col gap-4">
            {products.map((product) => (
              <ProductEditor
                key={product.productId}
                canManage={canManage}
                categories={categories}
                currency={currency}
                groups={groups.filter((group) => group.productId === product.productId)}
                product={product}
                onAddGroup={() => addGroup(product.productId)}
                onAddOption={addOption}
                onGroupsChange={setGroups}
                onProductChange={(changed) => setProducts((current) => current.map((entry) => entry.productId === changed.productId ? changed : entry))}
                onRemove={(request) => setRemoval(request)}
              />
            ))}
          </div>
        )}
      </section>
    </form>
  );
}

function ProductEditor({ canManage, categories, currency, groups, product, onAddGroup, onAddOption, onGroupsChange, onProductChange, onRemove }: {
  readonly canManage: boolean;
  readonly categories: readonly MenuCategoryV1[];
  readonly currency: string;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly product: MenuProductV1;
  readonly onAddGroup: () => void;
  readonly onAddOption: (groupId: string) => void;
  readonly onGroupsChange: (updater: (current: readonly MenuModifierGroupV1[]) => readonly MenuModifierGroupV1[]) => void;
  readonly onProductChange: (product: MenuProductV1) => void;
  readonly onRemove: (removal: Removal) => void;
}): ReactNode {
  const change = (patch: Partial<MenuProductV1>): void => onProductChange({ ...product, ...patch });
  const tax = product.tax;
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-bg/40 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TextInput disabled={!canManage} label="Producto" maxLength={120} value={product.name} onChange={(name) => change({ name })} />
        <label className="flex flex-col gap-1 text-[11px] font-medium">Categoría
          <select disabled={!canManage} value={product.categoryId} onChange={(event) => change({ categoryId: event.target.value })} className="min-h-10 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70">
            {categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
          </select>
        </label>
        <TextInput disabled={!canManage} label="SKU (opcional)" maxLength={64} value={product.sku ?? ""} onChange={(sku) => change({ sku: sku.length === 0 ? null : sku })} />
        <NumberInput disabled={!canManage} label={`Precio (${currency || "moneda"}, unidad menor)`} min={0} max={Number.MAX_SAFE_INTEGER} value={product.unitPriceMinor} onChange={(unitPriceMinor) => change({ unitPriceMinor })} />
        <TextInput disabled={!canManage} label="Estación" maxLength={64} value={product.stationId} onChange={(stationId) => change({ stationId })} />
        <TextInput disabled={!canManage} label="Unidad" maxLength={32} value={product.unit} onChange={(unit) => change({ unit })} />
        <NumberInput disabled={!canManage} label="Orden" min={0} max={1_000_000} value={product.displayOrder} onChange={(displayOrder) => change({ displayOrder })} />
        <div className="flex items-end gap-2 pb-1">
          <ActiveInput disabled={!canManage} checked={product.active} onChange={(active) => change({ active })} />
          {canManage && <RemoveButton label={`Quitar ${product.name}`} onClick={() => onRemove({ id: product.productId, kind: "product", label: product.name })} />}
        </div>
      </div>

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
      {groups.length === 0 ? <p className="mt-2 text-[12px] text-text-muted">Sin modificadores.</p> : groups.map((group) => (
        <ModifierGroupEditor key={group.groupId} canManage={canManage} currency={currency} group={group} onAddOption={() => onAddOption(group.groupId)} onChange={(changed) => onGroupsChange((current) => current.map((entry) => entry.groupId === changed.groupId ? changed : entry))} onRemove={onRemove} />
      ))}
    </article>
  );
}

function ModifierGroupEditor({ canManage, currency, group, onAddOption, onChange, onRemove }: {
  readonly canManage: boolean;
  readonly currency: string;
  readonly group: MenuModifierGroupV1;
  readonly onAddOption: () => void;
  readonly onChange: (group: MenuModifierGroupV1) => void;
  readonly onRemove: (removal: Removal) => void;
}): ReactNode {
  const change = (patch: Partial<MenuModifierGroupV1>): void => onChange({ ...group, ...patch });
  return (
    <section className="mt-3 min-w-0 rounded-xl border border-border bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <TextInput disabled={!canManage} label="Grupo" maxLength={80} value={group.name} onChange={(name) => change({ name })} />
        <NumberInput disabled={!canManage} label="Mínimo total" min={0} max={1_000} value={group.minimumQuantity} onChange={(minimumQuantity) => change({ minimumQuantity })} />
        <NumberInput disabled={!canManage} label="Máximo total" min={0} max={1_000} value={group.maximumQuantity} onChange={(maximumQuantity) => change({ maximumQuantity })} />
        <NumberInput disabled={!canManage} label="Orden" min={0} max={1_000_000} value={group.displayOrder} onChange={(displayOrder) => change({ displayOrder })} />
        <div className="flex items-end gap-2 pb-1"><ActiveInput disabled={!canManage} checked={group.active} onChange={(active) => change({ active })} />{canManage && <RemoveButton label={`Quitar ${group.name}`} onClick={() => onRemove({ id: group.groupId, kind: "group", label: group.name })} />}</div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Opciones</p>{canManage && <AddButton label="Agregar opción" onClick={onAddOption} />}</div>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        {group.options.map((option) => (
          <div key={option.optionId} className="grid gap-2 rounded-lg border border-border bg-bg/50 p-2 sm:grid-cols-[1fr_170px_140px_auto]">
            <TextInput disabled={!canManage} label="Opción" maxLength={80} value={option.name} onChange={(name) => changeOption(group, option.optionId, { name }, onChange)} />
            <NumberInput disabled={!canManage} label={`Precio (${currency || "moneda"})`} min={0} max={Number.MAX_SAFE_INTEGER} value={option.unitPriceMinor} onChange={(unitPriceMinor) => changeOption(group, option.optionId, { unitPriceMinor }, onChange)} />
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

function SectionHeader({ children, description, title }: { readonly children?: ReactNode; readonly description: string; readonly title: string }): ReactNode {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-heading text-[16px] font-semibold">{title}</h2><p className="mt-1 text-[12px] text-text-muted">{description}</p></div>{children}</div>;
}

function TextInput({ disabled, label, maxLength, onChange, value, width = "w-full" }: { readonly disabled: boolean; readonly label: string; readonly maxLength: number; readonly onChange: (value: string) => void; readonly value: string; readonly width?: string }): ReactNode {
  return <label className={`flex min-w-0 flex-col gap-1 text-[11px] font-medium ${width}`}>{label}<input required disabled={disabled} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-10 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70" /></label>;
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
  return <button type="button" disabled={disabled} onClick={onClick} className="min-h-10 rounded-lg border border-accent px-3 py-2 text-[12px] font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-40">+ {label}</button>;
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
  return values.reduce((maximum, value) => Math.max(maximum, value.displayOrder), -1) + 1;
}
