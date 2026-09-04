export default function CashRegisterLoading() {
  return (
    <div role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.05)]">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-xl bg-[oklch(90%_0.04_230)]" />
        <p className="mt-4 font-heading text-[16px] font-semibold">Verificando caja</p>
        <p className="mt-1 text-[13px] text-text-muted">Estamos consultando el estado autoritativo de la sucursal.</p>
      </div>
    </div>
  );
}
