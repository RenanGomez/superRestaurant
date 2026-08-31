import type { ReactNode } from "react";

export default function AppLoading(): ReactNode {
  return (
    <div role="status" className="flex flex-1 items-center justify-center">
      <span className="sr-only">Cargando…</span>
      <div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}
