"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { BrandMark } from "../../components/brand-mark";

const links = [
  { href: "/app/tables", label: "Mesas", icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M16 4v16M3 10h18" /></> },
  { href: "/app/menu", label: "Menú", icon: <><path d="M4 5h16M4 12h16M4 19h10" /><circle cx="18" cy="19" r="2" /></> },
  { href: "/app/caja", label: "Caja", icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h3M14 13h3" /></> },
  { href: "/app/orders", label: "Órdenes", icon: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></> },
  { href: "/app/deliveries", label: "Entregas", icon: <><path d="M3 8h11v10H3zM14 11h4l3 4v3h-7z" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></> },
  { href: "/app/customers", label: "Clientes", icon: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M19 21v-3a6 6 0 0 0-3-5" /></> },
  { href: "/app/capture", label: "Captura telefónica", icon: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /> },
  { href: "/app/delivery-zones", label: "Zonas de entrega", icon: <><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></> },
  { href: "/app/reports/day", label: "Resumen del día", icon: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></> },
  { href: "/app/system-admin/restaurants", label: "Administración del sistema", icon: <text x="4" y="19" stroke="none" fill="currentColor" fontSize="20">⚙</text> },
] as const;

/** Visible label under (narrow) or beside (wide) the icon; the full name stays in title/aria-label. */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  "/app/capture": "Captura", "/app/delivery-zones": "Zonas", "/app/reports/day": "Resumen", "/app/system-admin/restaurants": "Sistema",
};

export function AppNav({ canAccessSystemAdmin, canReadReports, branchName }: { readonly canAccessSystemAdmin: boolean; readonly canReadReports: boolean; readonly branchName?: string | undefined }): ReactNode {
  const pathname = usePathname();
  const initial = branchName?.trim().charAt(0).toLocaleUpperCase("es-MX") ?? "";

  return (
    <nav aria-label="Navegación principal" className="flex w-[76px] shrink-0 flex-col items-stretch gap-2 bg-nav px-2 py-4 lg:w-56">
      {branchName !== undefined && initial !== "" ? (
        <div className="mb-3 flex flex-col items-center gap-1 lg:flex-row lg:gap-3" title={`Sucursal activa: ${branchName}`}>
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-base font-bold text-white">{initial}</span>
          <span className="line-clamp-2 break-words text-center text-[10px] font-semibold leading-tight text-white lg:text-left lg:text-sm"><span className="sr-only">Sucursal activa: </span>{branchName}</span>
        </div>
      ) : <div className="mb-3 flex justify-center lg:justify-start"><BrandMark size={36} /></div>}
      {links.filter((link) => (canAccessSystemAdmin || link.href !== "/app/system-admin/restaurants") && (canReadReports || link.href !== "/app/reports/day")).map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} prefetch title={link.label} aria-label={link.label} aria-current={active ? "page" : undefined}
            className={`nav-link relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:flex-row lg:justify-start lg:gap-3 lg:px-3 ${active ? "bg-white/15 font-semibold" : "hover:bg-white/10"}`}>
            {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r bg-white" />}
            <svg aria-hidden="true" className="shrink-0" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{link.icon}</svg>
            <span className="max-w-full truncate text-[10px] font-medium leading-tight lg:text-sm">{SHORT_LABELS[link.href] ?? link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
