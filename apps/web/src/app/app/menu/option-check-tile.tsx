"use client";

import type { MenuModifierOptionV1 } from "@super-restaurant/shared-types";
import { useState, type ReactNode } from "react";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { menuImagePublicUrl } from "../../../lib/menu-images";
import { uiOption } from "../../../lib/ui-classes";

const thumb = "flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg text-[12px] font-bold text-text-muted";

/** One option of a pizza group: checkbox, photo (or initial placeholder), name and, when `currency` is given, its extra price. */
export function OptionCheckTile({ option, supabaseUrl, checked, currency, disabled = false, onCheckedChange }: {
  readonly option: MenuModifierOptionV1;
  readonly supabaseUrl: string;
  readonly checked: boolean;
  readonly currency?: string;
  readonly disabled?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}): ReactNode {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photoUrl = menuImagePublicUrl(supabaseUrl, option.imagePath);
  const showPhoto = photoUrl !== null && failedUrl !== photoUrl;
  const price = currency !== undefined && option.unitPriceMinor > 0 ? formatMinorUnits(option.unitPriceMinor, currency) : null;
  const name = option.name || "Opción sin nombre";
  return <label className={`${uiOption(checked, "flex w-full min-w-0 cursor-pointer items-center gap-3 px-2 py-2 text-left")} ${disabled ? "opacity-60" : ""}`}>
    <input type="checkbox" className="size-5 shrink-0 accent-accent" checked={checked} disabled={disabled}
      aria-label={name} onChange={(event) => onCheckedChange(event.target.checked)} />
    {showPhoto
      ? <img src={photoUrl} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(photoUrl)} className={`${thumb} object-cover`} />
      : <span aria-hidden="true" className={thumb}>{name.trim().slice(0, 1).toLocaleUpperCase("es-MX")}</span>}
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="truncate text-[13px] leading-snug">{name}</span>
      {price !== null && <span className="text-[12px] font-normal opacity-80">{price}</span>}
    </span>
  </label>;
}

/** Options container: vertical list below `sm`, two-column grid from `sm` up. */
export function OptionCheckTileGrid({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>;
}
