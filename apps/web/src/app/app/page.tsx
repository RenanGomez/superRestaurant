import type { ReactNode } from "react";

export default function AppHomePage(): ReactNode {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-[360px] flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[oklch(94%_0.01_240)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 10h18" />
          </svg>
        </div>
        <h1 className="font-heading text-[17px] font-semibold text-text">Sesión verificada</h1>
        <p className="text-[13px] leading-relaxed text-text-muted">
          La selección de sucursal, mesas y menú se habilitan en las próximas fases (FE-0.1 y FE-1). Esta pantalla
          confirma que la identidad y el acceso protegido de FE-0 quedaron activos.
        </p>
      </div>
    </div>
  );
}
