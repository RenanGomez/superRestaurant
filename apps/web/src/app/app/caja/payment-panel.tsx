"use client";

import { useEffect, useRef, useState } from "react";
import type { CashPaymentQuoteV1, CheckoutOrderSummaryV1 } from "@super-restaurant/shared-types";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { formatMinorForMoneyInput, parseMoneyInputToMinor } from "../../../lib/capture-payment";
import { collectPaymentAction, quotePaymentAction } from "./actions";
import { canCollectPayment, paymentAmountBounds, quickCashAmounts, requiredCashTenderMinor } from "./caja-helpers";

export function PaymentPanel({ checkout, audit }: {
  readonly checkout: CheckoutOrderSummaryV1;
  readonly audit: { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string; readonly paymentId: string };
}) {
  const [method, setMethod] = useState<"cash" | "card_manual" | "transfer">("cash");
  const [transferReference, setTransferReference] = useState("");
  const [amountPesos, setAmountPesos] = useState(() => formatMinorForMoneyInput(checkout.remainingBalanceMinor, checkout.currency) ?? "");
  const [receivedPesos, setReceivedPesos] = useState("");
  const [tipPesos, setTipPesos] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [reference, setReference] = useState("");
  const [quote, setQuote] = useState<CashPaymentQuoteV1 | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [collectError, setCollectError] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const amountMinor = parseMoneyInputToMinor(amountPesos, checkout.currency);
  const validAmount = paymentAmountBounds(checkout.remainingBalanceMinor, amountMinor);
  const receivedMinor = parseMoneyInputToMinor(receivedPesos, checkout.currency);
  const tipMinor = tipPesos.trim() === "" ? 0 : parseMoneyInputToMinor(tipPesos, checkout.currency);
  const requiredCashMinor = !validAmount || tipMinor === null ? null : requiredCashTenderMinor(amountMinor, tipMinor);

  useEffect(() => {
    const request = ++latest.current;
    setQuote(null);
    setQuoteError("");
    if (!validAmount || tipMinor === null || (method === "cash" && (receivedMinor === null || receivedMinor <= 0))) return;
    const timer = setTimeout(() => {
      void quotePaymentAction({
        cashRegisterSessionId: checkout.cashRegisterSessionId, orderId: checkout.orderId,
        amountPesos, receivedPesos, tipPesos, method,
      }).then((result) => {
        if (request !== latest.current) return;
        if (result.status === "ok" && result.value !== undefined) setQuote(result.value);
        else setQuoteError(errorText(result.status));
      }).catch(() => { if (request === latest.current) setQuoteError("No se pudo consultar el cambio. Actualiza e intenta de nuevo."); });
    }, 250);
    return () => { clearTimeout(timer); latest.current += 1; };
  }, [amountPesos, checkout.cashRegisterSessionId, checkout.orderId, method, receivedMinor, receivedPesos, tipMinor, tipPesos, validAmount]);

  async function collect(formData: FormData) {
    if (!canCollectPayment({ quote, remainingMinor: checkout.remainingBalanceMinor, amountMinor, method, receivedMinor, tipMinor, terminalId, reference, busy })) return;
    setBusy(true);
    setCollectError("");
    try {
      const result = await collectPaymentAction(formData);
      if (result.status !== "ok") setCollectError(errorText(result.status));
    } catch { setCollectError("No se pudo confirmar el cobro. Actualiza la caja antes de volver a intentar."); }
    finally { setBusy(false); }
  }

  const canCollect = canCollectPayment({ quote, remainingMinor: checkout.remainingBalanceMinor, amountMinor, method, receivedMinor, tipMinor, terminalId, reference, busy });
  const insufficient = method === "cash" && receivedMinor !== null && receivedMinor > 0
    && requiredCashMinor !== null && receivedMinor < requiredCashMinor;
  return <div id="cobrar" className="mt-4 grid min-w-0 gap-4 scroll-mt-4">
    <div className="grid grid-cols-3 gap-2 rounded-xl bg-bg p-4 text-center">
      <Metric label="Total" value={formatMinorUnits(checkout.orderTotalMinor, checkout.currency)} />
      <Metric label="Pagado" value={formatMinorUnits(checkout.capturedAmountMinor, checkout.currency)} />
      <Metric label="Saldo" value={formatMinorUnits(checkout.remainingBalanceMinor, checkout.currency)} />
    </div>
    <form action={(data) => void collect(data)} className="grid gap-4">
      <input type="hidden" name="cashRegisterSessionId" value={checkout.cashRegisterSessionId} />
      <input type="hidden" name="orderId" value={checkout.orderId} />
      <input type="hidden" name="paymentId" value={audit.paymentId} />
      <input type="hidden" name="eventId" value={audit.eventId} />
      <input type="hidden" name="idempotencyKey" value={audit.idempotencyKey} />
      <input type="hidden" name="occurredAt" value={audit.occurredAt} />
      <label className="grid gap-1 text-sm font-semibold">A cobrar en pesos
        <input name="amountPesos" value={amountPesos} onChange={(event) => setAmountPesos(event.target.value)} inputMode="decimal" className="min-h-12 min-w-0 rounded-xl border border-border px-3 text-base" aria-describedby="amount-hint" />
        <span id="amount-hint" className="text-xs font-normal text-text-muted">Saldo precargado. Toca para cobrar sólo una parte.</span>
      </label>
      {!validAmount && <p role="alert" className="text-sm text-error">Escribe un importe entre {formatMinorUnits(1, checkout.currency)} y {formatMinorUnits(checkout.remainingBalanceMinor, checkout.currency)}.</p>}
      <input type="hidden" name="method" value={method} />
      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="mb-2 text-sm font-semibold">Método</legend>
        <Method selected={method === "cash"} label="Efectivo" onClick={() => setMethod("cash")} />
        <Method selected={method === "card_manual"} label="Tarjeta externa" onClick={() => setMethod("card_manual")} />
        <Method selected={method === "transfer"} label="Transferencia" onClick={() => setMethod("transfer")} />
      </fieldset>
      {method === "cash" ? <div className="grid gap-2">
        <label className="grid gap-1 text-sm font-semibold">Recibido en pesos<input name="receivedPesos" value={receivedPesos} onChange={(event) => setReceivedPesos(event.target.value)} inputMode="decimal" placeholder="0.00" className="min-h-12 min-w-0 rounded-xl border border-border px-3 text-base" /></label>
        <div className="grid grid-cols-4 gap-2">
          <QuickAmount label="Exacto" disabled={requiredCashMinor === null} onClick={() => setReceivedPesos(formatMinorForMoneyInput(requiredCashMinor ?? 0, checkout.currency) ?? "")} />
          {[10_000, 20_000, 50_000].map((amount) => <QuickAmount key={amount} label={formatMinorUnits(amount, checkout.currency).replace(/\.00$/u, "")} disabled={!validAmount || tipMinor === null || !quickCashAmounts(amountMinor, tipMinor).includes(amount)} onClick={() => setReceivedPesos(formatMinorForMoneyInput(amount, checkout.currency) ?? "")} />)}
        </div>
        {insufficient && quote !== null && <p role="status" className="font-heading text-lg font-semibold text-error">{amountMinor === checkout.remainingBalanceMinor ? `Falta ${formatMinorUnits(quote.remainingAfterMinor, checkout.currency)}` : "El recibido no cubre este cobro y la propina."}</p>}
        {!insufficient && quote !== null && <p role="status" className="font-heading text-lg font-semibold text-accent">Cambio después de propina: {formatMinorUnits(quote.changeMinor ?? 0, checkout.currency)}</p>}
        {receivedMinor !== null && receivedMinor > 0 && quote === null && quoteError === "" && <p role="status" className="text-sm text-text-muted">Calculando cambio…</p>}
      </div> : method === "transfer" ? <div className="grid gap-3 rounded-xl bg-bg p-3">
        <p className="text-xs text-text-muted">Sin cambio ni terminal. Confirma que el depósito ya llegó antes de cobrar; no cuenta en el efectivo de la caja.</p>
        <label className="grid gap-1 text-sm font-semibold">Referencia (opcional)<input name="transferReference" maxLength={64} value={transferReference} onChange={(event) => setTransferReference(event.target.value)} className="min-h-12 min-w-0 rounded-xl border border-border px-3" /></label>
      </div> : <div className="grid gap-3 rounded-xl bg-bg p-3">
        <p className="text-xs text-text-muted">Registra sólo una operación ya confirmada en la terminal externa. No captures datos de tarjeta.</p>
        <label className="grid gap-1 text-sm font-semibold">Terminal<input name="terminalId" required value={terminalId} onChange={(event) => setTerminalId(event.target.value)} className="min-h-12 min-w-0 rounded-xl border border-border px-3" /></label>
        <label className="grid gap-1 text-sm font-semibold">Referencia (mínimo 6 caracteres)<input name="reference" required minLength={6} value={reference} onChange={(event) => setReference(event.target.value)} className="min-h-12 min-w-0 rounded-xl border border-border px-3" /></label>
      </div>}
      <label className="grid gap-1 text-sm font-semibold">Propina en pesos (opcional)<input name="tipPesos" value={tipPesos} onChange={(event) => setTipPesos(event.target.value)} inputMode="decimal" placeholder="0.00" className="min-h-12 min-w-0 rounded-xl border border-border px-3" /></label>
      {quoteError && <p role="alert" className="rounded-xl bg-error-bg p-3 text-sm">{quoteError}</p>}
      {collectError && <p role="alert" className="rounded-xl bg-error-bg p-3 text-sm">{collectError}</p>}
      <button disabled={!canCollect} type="submit" className="min-h-12 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white disabled:opacity-50">{busy ? "Guardando…" : "Cobrar"}</button>
    </form>
  </div>;
}

function Method({ label, selected, onClick }: { readonly label: string; readonly selected: boolean; readonly onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={selected} className={`min-h-12 rounded-xl border p-2 text-xs font-semibold ${selected ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface"}`}>{label}</button>;
}
function QuickAmount({ label, onClick, disabled = false }: { readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="min-h-12 rounded-xl border border-border bg-surface px-1 text-sm font-semibold disabled:opacity-40">{label}</button>;
}
function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="min-w-0"><p className="text-xs text-text-muted">{label}</p><p className="break-words font-heading text-sm font-semibold">{value}</p></div>;
}
function errorText(status: string): string {
  if (status === "invalid_amount") return "Importe inválido o recibido insuficiente. Revisa los pesos y centavos.";
  if (status === "insufficient") return "El recibido no alcanza para cubrir el cobro y la propina.";
  if (status === "mixed_currency") return "La cuenta y caja usan monedas distintas.";
  if (status === "unsupported_currency") return "La moneda de esta cuenta no está admitida.";
  if (status === "conflict") return "La cuenta cambió. Actualiza antes de cobrar otra vez.";
  if (status === "invalid_input") return "Completa la terminal y una referencia de al menos 6 caracteres.";
  return "No se pudo consultar o guardar. Actualiza el estado antes de volver a intentar.";
}
