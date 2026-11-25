"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { BrandMark } from "../../components/brand-mark";

const links = [
  { href: "/app/tables", label: "Mesas", icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M16 4v16M3 10h18" /></> },
  { href: "/app/menu", label: "Menú", icon: <><path d="M4 5h16M4 12h16M4 19h10" /><circle cx="18" cy="19" r="2" /></> },
  { href: "/app/inventario", label: "Inventario", icon: <><path d="M3 8l9-5 9 5-9 5-9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></> },
  { href: "/app/caja", label: "Caja", icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h3M14 13h3" /></> },
  { href: "/app/orders", label: "Órdenes", icon: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></> },
  { href: "/app/deliveries", label: "Entregas", icon: <><path d="M3 8h11v10H3zM14 11h4l3 4v3h-7z" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></> },
  { href: "/app/customers", label: "Clientes", icon: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M19 21v-3a6 6 0 0 0-3-5" /></> },
  { href: "/app/capture", label: "Captura telefónica", icon: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /> },
  { href: "/app/delivery-zones", label: "Zonas de entrega", icon: <><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></> },
  { href: "/app/reports/day", label: "Resumen del día", icon: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></> },
  { href: "/app/sync", label: "Sincronización", icon: <><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></> },
  { href: "/app/system-admin/restaurants", label: "Administración del sistema", icon: <text x="4" y="19" stroke="none" fill="currentColor" fontSize="20">⚙</text> },
] as const;

/** Visible label under (narrow) or beside (wide) the icon; the full name stays in title/aria-label. */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  "/app/capture": "Captura", "/app/delivery-zones": "Zonas", "/app/reports/day": "Resumen", "/app/sync": "Conexión", "/app/system-admin/restaurants": "Sistema",
};

/** Hottest operational routes for the mobile bottom bar; everything else lives behind «Más». */
const MOBILE_PRIMARY: readonly string[] = ["/app/tables", "/app/capture", "/app/orders", "/app/caja"];

function NavIcon({ children }: { readonly children: ReactNode }): ReactNode {
  return <svg aria-hidden="true" className="shrink-0" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

export function AppNav({ canAccessSystemAdmin, canReadReports, branchName }: { readonly canAccessSystemAdmin: boolean; readonly canReadReports: boolean; readonly branchName?: string | undefined }): ReactNode {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const initial = branchName?.trim().charAt(0).toLocaleUpperCase("es-MX") ?? "";
  const visibleLinks = links.filter((link) => (canAccessSystemAdmin || link.href !== "/app/system-admin/restaurants") && (canReadReports || link.href !== "/app/reports/day"));
  const mobilePrimary = MOBILE_PRIMARY.flatMap((href) => visibleLinks.filter((link) => link.href === href));
  const mobileMore = visibleLinks.filter((link) => !MOBILE_PRIMARY.includes(link.href));
  const isActive = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);
  const moreActive = mobileMore.some((link) => isActive(link.href));

  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === "Escape") setMoreOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  return (
    <>
      <nav aria-label="Navegación principal" className="hidden w-[76px] shrink-0 flex-col items-stretch gap-2 bg-nav px-2 py-4 sm:flex lg:sticky lg:top-0 lg:h-[100dvh] lg:w-56 lg:self-start lg:overflow-x-hidden lg:overflow-y-auto">
        {branchName !== undefined && initial !== "" ? (
          <div className="mb-3 flex flex-col items-center gap-1 lg:flex-row lg:gap-3" title={`Sucursal activa: ${branchName}`}>
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-base font-bold text-white">{initial}</span>
            <span className="line-clamp-2 break-words text-center text-[10px] font-semibold leading-tight text-white lg:text-left lg:text-sm"><span className="sr-only">Sucursal activa: </span>{branchName}</span>
          </div>
        ) : <div className="mb-3 flex justify-center lg:justify-start"><BrandMark size={36} /></div>}
        {visibleLinks.map((link) => {
          const active = isActive(link.href);
          return (
            <Link key={link.href} href={link.href} prefetch title={link.label} aria-label={link.label} aria-current={active ? "page" : undefined}
              className={`nav-link relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:flex-row lg:justify-start lg:gap-3 lg:px-3 ${active ? "bg-white/15 font-semibold" : "hover:bg-white/10"}`}>
              {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r bg-white" />}
              <NavIcon>{link.icon}</NavIcon>
              <span className="max-w-full truncate text-[10px] font-medium leading-tight lg:text-sm">{SHORT_LABELS[link.href] ?? link.label}</span>
            </Link>
          );
        })}
      </nav>

      <nav aria-label="Navegación principal" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-nav pb-[env(safe-area-inset-bottom)] sm:hidden">
        {mobileMore.length > 0 && moreOpen && (
          <div id="mobile-more-menu" className="absolute inset-x-2 bottom-full mb-2 max-h-[60dvh] overflow-y-auto rounded-2xl border border-white/10 bg-nav p-2 shadow-2xl">
            <div className="mb-1 flex items-center justify-between gap-2 pl-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/60">Más secciones</span>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Cerrar menú de secciones"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-white/70 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                <NavIcon><path d="M6 6l12 12M18 6L6 18" /></NavIcon>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {mobileMore.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link key={link.href} href={link.href} prefetch title={link.label} aria-label={link.label} aria-current={active ? "page" : undefined} onClick={() => setMoreOpen(false)}
                    className={`flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${active ? "bg-white/15 font-semibold text-white" : "text-white/75 hover:bg-white/10"}`}>
                    <NavIcon>{link.icon}</NavIcon>
                    <span className="min-w-0 truncate text-[13px] font-medium">{SHORT_LABELS[link.href] ?? link.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex items-stretch">
          {mobilePrimary.map((link) => {
            const active = isActive(link.href);
            return (
              <Link key={link.href} href={link.href} prefetch title={link.label} aria-label={link.label} aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white ${active ? "font-semibold text-white" : "text-white/70 hover:bg-white/10"}`}>
                <NavIcon>{link.icon}</NavIcon>
                <span className="max-w-full truncate text-[10px] font-medium leading-tight">{SHORT_LABELS[link.href] ?? link.label}</span>
              </Link>
            );
          })}
          {mobileMore.length > 0 && (
            <button type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-controls="mobile-more-menu" aria-current={moreActive ? "page" : undefined} title="Más secciones"
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white ${moreActive || moreOpen ? "font-semibold text-white" : "text-white/70 hover:bg-white/10"}`}>
              <NavIcon><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></NavIcon>
              <span className="text-[10px] font-medium leading-tight">Más</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
