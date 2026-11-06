export default function Loading() {
  return <div role="status" aria-busy="true" className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <header><h1 className="font-heading text-2xl font-bold">Administración del sistema</h1><p className="mt-1 text-sm text-text-muted">Cargando información…</p></header>
    <div aria-hidden="true" className="h-40 rounded-xl border border-border bg-surface motion-safe:animate-pulse" />
  </div>;
}
