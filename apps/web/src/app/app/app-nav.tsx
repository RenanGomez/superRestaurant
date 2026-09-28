"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { BrandMark } from "../../components/brand-mark";

const links = [
  { href: "/app", label: "Mesas", icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M16 4v16M3 10h18" /></> },
  { href: "/app/menu", label: "Menú", icon: <><path d="M4 5h16M4 12h16M4 19h10" /><circle cx="18" cy="19" r="2" /></> },
  { href: "/app/caja", label: "Caja", icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h3M14 13h3" /></> },
  { href: "/app/orders", label: "Órdenes", icon: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></> },
  { href: "/app/customers", label: "Clientes", icon: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M19 21v-3a6 6 0 0 0-3-5" /></> },
  { href: "/app/capture", label: "Captura telefónica", icon: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /> },
  { href: "/app/delivery-zones", label: "Zonas de entrega", icon: <><path d="M3 8h11v10H3zM14 11h4l3 4v3h-7z" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></> },
  { href: "/app/system-admin/restaurants", label: "Administración del sistema", icon: <text x="4" y="19" stroke="none" fill="currentColor" fontSize="20">⚙</text> },
] as const;

export function AppNav({ canAccessSystemAdmin }: { readonly canAccessSystemAdmin: boolean }): ReactNode {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegación principal" className="flex w-[76px] shrink-0 flex-col items-center gap-7 bg-nav py-5">
      <BrandMark size={36} />
      {links.filter((link) => canAccessSystemAdmin || link.href !== "/app/system-admin/restaurants").map((link) => {
        const active = pathname === link.href || (link.href !== "/app" && pathname.startsWith(`${link.href}/`));
        return (
          <a key={link.href} href={link.href} title={link.label} aria-label={link.label} aria-current={active ? "page" : undefined}
            className={`flex h-11 w-11 items-center justify-center rounded-xl border text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${active ? "border-accent bg-accent" : "border-transparent hover:bg-white/10"}`}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{link.icon}</svg>
          </a>
        );
      })}
    </nav>
  );
}
