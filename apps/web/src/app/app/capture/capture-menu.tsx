"use client";

import { useState, type RefObject } from "react";
import type { MenuCatalogV1, MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { groupProductsByCategory } from "../../../lib/capture-selection";

const categoryButton = "flex min-h-11 w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-left text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent sm:w-auto";
const categoryActive = "border-accent bg-accent-soft font-semibold text-accent";
const input = "min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const productCard = "relative flex min-h-[160px] flex-col overflow-hidden rounded-xl border border-border bg-surface text-left focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60";
const badge = "absolute right-2 top-2 rounded-full bg-error-bg px-2 py-0.5 text-xs font-semibold text-error";
const countBadge = "absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white";

interface CaptureMenuProps {
  readonly catalog: MenuCatalogV1 | null;
  readonly currency: string;
  readonly lineQuantities: ReadonlyMap<string, number>;
  readonly busy: boolean;
  readonly searchInputRef?: RefObject<HTMLInputElement | null>;
  readonly onSelectProduct: (product: MenuProductV1, groups: readonly MenuModifierGroupV1[]) => void;
}

/** Touch menu: category rail (desktop) / horizontal chips (mobile), search, and a product grid. */
export function CaptureMenu({ catalog, currency, lineQuantities, busy, searchInputRef, onSelectProduct }: CaptureMenuProps) {
  const grouped = groupProductsByCategory(catalog);
  const [activeCategoryId, setActiveCategoryId] = useState<string>();
  const [query, setQuery] = useState("");
  const activeCategory = grouped.find((entry) => entry.category.categoryId === activeCategoryId) ?? grouped[0];
  const normalizedQuery = query.trim().toLowerCase();
  const products = normalizedQuery.length > 0
    ? grouped.flatMap((entry) => entry.products).filter((product) => product.name.toLowerCase().includes(normalizedQuery))
    : activeCategory?.products ?? [];

  if (catalog === null) {
    return <p role="status" className="p-4 text-sm text-text-muted">No fue posible leer el catálogo de esta sucursal. Recarga antes de continuar.</p>;
  }

  return <div className="flex min-h-0 flex-1 flex-col sm:flex-row" data-testid="capture-menu">
    <nav aria-label="Categorías" className="flex shrink-0 gap-2 overflow-x-auto border-b border-border p-2 sm:w-44 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
      {grouped.map((entry) => <button key={entry.category.categoryId} type="button"
        className={`${categoryButton} ${(activeCategory?.category.categoryId === entry.category.categoryId && normalizedQuery === "") ? categoryActive : ""}`}
        onClick={() => { setActiveCategoryId(entry.category.categoryId); setQuery(""); }}>
        {entry.category.name}
      </button>)}
    </nav>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
      <div className="sticky top-0 z-[1] bg-bg pb-3">
        <label className="sr-only" htmlFor="capture-product-search">Buscar producto</label>
        <input id="capture-product-search" ref={searchInputRef} className={`${input} w-full`}
          placeholder="Buscar producto  (/)" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <h2 className="mb-2 font-heading text-base font-semibold">
        {normalizedQuery !== "" ? `Resultados para "${query.trim()}"` : activeCategory?.category.name ?? "Menú"}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => {
          const groups = catalog.modifierGroups.filter((group) => group.productId === product.productId && group.active);
          const count = lineQuantities.get(product.productId) ?? 0;
          return <button key={product.productId} type="button" className={productCard} disabled={!product.active || busy}
            aria-disabled={!product.active} onClick={() => onSelectProduct(product, groups)}>
            {count > 0 && <span className={countBadge}>{count}</span>}
            {!product.active && <span className={badge}>Agotado</span>}
            <span className="flex h-24 items-center justify-center bg-surface-2 text-4xl">🍽️</span>
            <span className="grid gap-0.5 p-2">
              <span className="font-semibold leading-tight">{product.name}</span>
              <span className="text-sm text-text-muted">{money(product.unitPriceMinor, currency)}</span>
            </span>
          </button>;
        })}
        {products.length === 0 && <p className="col-span-full p-4 text-sm text-text-muted">Sin productos para mostrar.</p>}
      </div>
    </div>
  </div>;
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", { currency, style: "currency" }).format(amountMinor / 100);
}
