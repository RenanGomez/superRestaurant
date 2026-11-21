"use client";

import { useRef, useState, type RefObject } from "react";
import type { MenuCatalogV1, MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { groupProductsByCategory } from "../../../lib/capture-selection";
import { menuProductPriceLabel } from "../../../lib/menu-variants";
import { groupsForProduct } from "../../../lib/menu-groups";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { useMenuImageBaseUrl } from "../../../lib/menu-image-url-context";
import { menuImagePublicUrl } from "../../../lib/menu-images";
import { menuCategoryColorClasses } from "../../../lib/menu-category-color";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const categoryItem = (active: boolean, color: string | null | undefined) => {
  const tint = menuCategoryColorClasses(color);
  const state = tint === undefined
    ? active ? "border-accent bg-accent-soft font-semibold text-accent-hover" : "border-transparent bg-surface text-text hover:bg-bg"
    : active ? `${tint.tabActive} font-semibold text-text` : `${tint.tab} text-text`;
  return `flex min-h-[5.75rem] w-[5.5rem] shrink-0 snap-start flex-col items-center gap-1.5 rounded-xl border-2 p-1.5 text-center text-xs ${focusRing} sm:min-h-11 sm:w-full sm:flex-row sm:gap-2 sm:rounded-lg sm:px-3 sm:py-2 sm:text-left sm:text-sm ${state}`;
};
const categoryThumb = "flex h-14 w-full shrink-0 items-center justify-center rounded-lg text-lg font-bold text-text sm:h-7 sm:w-7 sm:text-xs";
const input = "min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const productCard = `group relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left ${focusRing} disabled:cursor-not-allowed disabled:opacity-60`;
const cardMedia = "flex aspect-[16/10] w-full items-center justify-center text-4xl font-bold text-text sm:aspect-auto sm:h-24 sm:text-3xl";
const badge = "absolute right-2 top-2 rounded-full bg-error-bg px-2 py-0.5 text-xs font-semibold text-error";
const countBadge = "absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white";
const emptyAction = `min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg ${focusRing}`;
const categoryColors = ["bg-category-1", "bg-category-2", "bg-category-3", "bg-category-4", "bg-category-5", "bg-category-6", "bg-category-7", "bg-category-8"] as const;

function initials(name: string): string {
  return name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(word => [...word][0]?.toLocaleUpperCase("es-MX") ?? "").join("");
}

function categoryColor(categoryId: string): string {
  let hash = 0;
  for (const character of categoryId) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return categoryColors[hash % categoryColors.length]!;
}

interface CaptureMenuProps {
  readonly catalog: MenuCatalogV1 | null;
  readonly currency: string;
  readonly lineQuantities: ReadonlyMap<string, number>;
  readonly busy: boolean;
  readonly searchInputRef?: RefObject<HTMLInputElement | null>;
  readonly onSelectProduct: (product: MenuProductV1, groups: readonly MenuModifierGroupV1[]) => void;
}

/**
 * Touch menu for 390×844: search, a horizontal category carousel with photo (colour + initials as
 * fallback) and large product cards with photo, name and price. From `sm` up it becomes the desktop
 * rail plus denser grid. Prices are only formatted here; the server remains authoritative.
 */
export function CaptureMenu({ catalog, currency, lineQuantities, busy, searchInputRef, onSelectProduct }: CaptureMenuProps) {
  const supabaseUrl = useMenuImageBaseUrl();
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const grouped = groupProductsByCategory(catalog);
  const [activeCategoryId, setActiveCategoryId] = useState<string>();
  const [query, setQuery] = useState("");
  const activeCategory = grouped.find((entry) => entry.category.categoryId === activeCategoryId) ?? grouped[0];
  const normalizedQuery = query.trim().toLowerCase();
  const products = normalizedQuery.length > 0
    ? grouped.flatMap((entry) => entry.products).filter((product) => product.name.toLowerCase().includes(normalizedQuery))
    : activeCategory?.products ?? [];

  const scrollToTop = (): void => { listRef.current?.scrollTo({ top: 0 }); };
  const clearSearch = (): void => { setQuery(""); scrollToTop(); searchInputRef?.current?.focus(); };
  const emptyMessage = normalizedQuery !== ""
    ? `No encontramos productos para «${query.trim()}».`
    : grouped.length === 0 ? "No hay productos publicados en esta sucursal." : "Esta categoría no tiene productos disponibles.";

  if (catalog === null) {
    return <p role="alert" className="p-4 text-sm text-text-muted">No fue posible leer el catálogo de esta sucursal. Recarga antes de continuar.</p>;
  }

  return <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)] sm:grid-rows-[auto_minmax(0,1fr)]" data-testid="capture-menu">
    <div className="col-start-1 row-start-1 px-3 pb-2 pt-3 sm:col-start-2 sm:row-start-1">
      <label className="sr-only" htmlFor="capture-product-search">Buscar producto</label>
      <div className="relative">
        <input id="capture-product-search" ref={searchInputRef} type="search" autoComplete="off" enterKeyHint="search"
          className={`${input} w-full pr-12`} placeholder="Buscar producto  (/)" value={query}
          onChange={(event) => { setQuery(event.target.value); scrollToTop(); }} />
        {query !== "" && <button type="button" aria-label="Limpiar búsqueda" onClick={clearSearch}
          className={`absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-lg text-lg text-text-muted hover:text-text ${focusRing}`}>
          <span aria-hidden="true">×</span>
        </button>}
      </div>
    </div>
    <nav aria-label="Categorías" className="col-start-1 row-start-2 flex min-h-0 snap-x snap-mandatory gap-2 overflow-x-auto border-b border-border px-3 pb-2 sm:col-start-1 sm:row-span-2 sm:row-start-1 sm:w-auto sm:flex-col sm:gap-1.5 sm:overflow-visible sm:border-b-0 sm:border-r sm:px-2 sm:pb-3 sm:pt-3">
      {grouped.map((entry) => {
        const selected = activeCategory?.category.categoryId === entry.category.categoryId && normalizedQuery === "";
        const tint = menuCategoryColorClasses(entry.category.color);
        const categoryPhotoUrl = menuImagePublicUrl(supabaseUrl, entry.category.imagePath);
        const showPhoto = categoryPhotoUrl !== null && !failedImages.has(categoryPhotoUrl);
        return <button key={entry.category.categoryId} type="button" aria-pressed={selected}
          aria-label={`Categoría ${entry.category.name}`}
          className={categoryItem(selected, entry.category.color)}
          onClick={() => { setActiveCategoryId(entry.category.categoryId); setQuery(""); scrollToTop(); }}>
          {showPhoto
            ? <img src={categoryPhotoUrl} alt="" loading="lazy" decoding="async"
              onError={() => setFailedImages((current) => new Set(current).add(categoryPhotoUrl))} className="h-14 w-full shrink-0 rounded-lg object-cover sm:h-7 sm:w-7" />
            : <span aria-hidden="true" className={`${categoryThumb} ${tint?.swatch ?? categoryColor(entry.category.categoryId)}`}>{initials(entry.category.name)}</span>}
          <span className="line-clamp-2 w-full break-words leading-tight sm:min-w-0 sm:truncate sm:leading-normal">{entry.category.name}</span>
        </button>;
      })}
    </nav>
    <div ref={listRef} className="col-start-1 row-start-3 min-h-0 overflow-y-auto p-3 sm:col-start-2 sm:row-start-2">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">
          {normalizedQuery !== "" ? `Resultados para "${query.trim()}"` : activeCategory?.category.name ?? "Menú"}
        </h2>
        <span className="shrink-0 text-xs text-text-muted">{products.length} producto{products.length === 1 ? "" : "s"}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => {
          const groups = groupsForProduct(product, catalog.modifierGroups).filter((group) => group.active);
          const count = lineQuantities.get(product.productId) ?? 0;
          const photoUrl = menuImagePublicUrl(supabaseUrl, product.imagePath);
          return <button key={product.productId} type="button" className={productCard} disabled={!product.active || busy}
            aria-disabled={!product.active} onClick={() => onSelectProduct(product, groups)}>
            {count > 0 && <span className={countBadge} aria-label={`${count} en el pedido`}>{count}</span>}
            {!product.active && <span className={badge}>Agotado</span>}
            {photoUrl !== null && !failedImages.has(photoUrl)
              ? <img src={photoUrl} alt="" loading="lazy" decoding="async"
                onError={() => setFailedImages((current) => new Set(current).add(photoUrl))} className={`${cardMedia} object-cover`} />
              : <span aria-hidden="true" className={`${cardMedia} ${categoryColor(product.categoryId)}`}>{initials(product.name)}</span>}
            <span className="grid gap-1 p-3 sm:gap-0.5 sm:p-2">
              <span className="font-heading text-base font-semibold leading-snug sm:text-sm">{product.name}</span>
              <span className="text-sm text-text-muted">{menuProductPriceLabel(product, (price) => formatMinorUnits(price, currency))}</span>
            </span>
          </button>;
        })}
        {products.length === 0 && <div role="status" className="col-span-full grid justify-items-center gap-3 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-text-muted">{emptyMessage}</p>
          {normalizedQuery !== "" && <button type="button" className={emptyAction} onClick={clearSearch}>Limpiar búsqueda</button>}
        </div>}
      </div>
    </div>
  </div>;
}
