import type { ReactNode } from "react";

/** The superRestaurant glyph, shared by the login brand panel and the app shell nav. */
export function BrandMark({ size = 44 }: { readonly size?: number }): ReactNode {
  const iconSize = Math.round(size * (24 / 44));
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl bg-accent"
      style={{ height: size, width: size }}
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 3v9a3 3 0 0 0 3 3h1v6" />
        <path d="M8 3v6" />
        <path d="M4 6h4" />
        <path d="M17 3c-1.5 2-2 4-2 6.5S16 15 17 15s2-2.5 2-5.5-.5-4.5-2-6.5Z" />
        <path d="M17 15v6" />
      </svg>
    </div>
  );
}
