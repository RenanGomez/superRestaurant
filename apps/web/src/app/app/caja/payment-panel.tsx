"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CashPaymentQuoteV1, CheckoutOrderSummaryV1, OrderPaymentV1 } from "@super-restaurant/shared-types";
import { Field, FieldHint } from "../../../components/field-hint";
import { formatMinorUnits, formatOrderWorkTime } from "../../../lib/branch-order-work-tray";
import { formatMinorForMoneyInput, parseMoneyInputToMinor } from "../../../lib/capture-payment";
import { orderDetailAction } from "../orders/actions";
import { collectPaymentAction, quotePaymentAction } from "./actions";
import {
  buildReceiptHref,
  canCollectPayment,
  paymentAmountBounds,
  paymentMethodLabel,
  quickCashAmounts,
  requiredCashTenderMinor,
} from "./caja-helpers";

export function PaymentPanel({
  checkout,
  audit,
  payments,
  timeZone,
}: {
  readonly checkout: CheckoutOrderSummaryV1;
  readonly audit: { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string; readonly paymentId: string };
  readonly payments?: readonly OrderPaymentV1[] | undefined;
  readonly timeZone?: string | undefined;
}) {
  const router = useRouter();
  const [splitMode, setSplitMode] = useState<"full" | "split">("full");
  const [method, setMethod] = useState<"cash" | "card_manual" | "transfer">("cash");
  const [transferReference, setTransferReference] = useState("");
  // The amount seeds from the server balance at mount. page.tsx remounts this panel via
  // key={orderId:orderVersion}, so a changed balance resyncs it; "Pagar total" relies on that.
  const [amountPesos, setAmountPesos] = useState(() => formatMinorForMoneyInput(checkout.remainingBalanceMinor, checkout.currency) ?? "");
  const [receivedPesos, setReceivedPesos] = useState("");
  const [tipPesos, setTipPesos] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [reference, setReference] = useState("");
  const [quote, setQuote] = useState<CashPaymentQuoteV1 | null>(null);
  const [quoteError, setQuoteError] = useState("");
  // Cash needed (amount + tip) as reported by the server when it rejects the tender as short.
  const [serverRequiredMinor, setServerRequiredMinor] = useState<number | null>(null);
  const [serverRejected, setServerRejected] = useState(false);
  const [collectError, setCollectError] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const amountMinor = parseMoneyInputToMinor(amountPesos, checkout.currency);
  const validAmount = paymentAmountBounds(checkout.remainingBalanceMinor, amountMinor);
  const receivedMinor = parseMoneyInputToMinor(receivedPesos, checkout.currency);
  const tipMinor = tipPesos.trim() === "" ? 0 : parseMoneyInputToMinor(tipPesos, checkout.currency);
  const requiredCashMinor = !validAmount || tipMinor === null ? null : requiredCashTenderMinor(amountMinor, tipMinor);
  // Presentation only: the server decides insufficiency; this subtraction just words the message.
  const missingCashMinor = method === "cash" && serverRequiredMinor !== null && receivedMinor !== null && serverRequiredMinor > receivedMinor
    ? serverRequiredMinor - receivedMinor
    : null;

  useEffect(() => {
    const request = ++latest.current;
    setQuote(null);
    setQuoteError("");
    setServerRequiredMinor(null);
    setServerRejected(false);
    if (!validAmount || tipMinor === null || (method === "cash" && (receivedMinor === null || receivedMinor <= 0))) return;
    const timer = setTimeout(() => {
      void quotePaymentAction({
        cashRegisterSessionId: checkout.cashRegisterSessionId,
        orderId: checkout.orderId,
        amountPesos,
        receivedPesos,
        tipPesos,
        method,
      }).then((result) => {
        if (request !== latest.current) return;
        if (result.status === "ok" && result.value !== undefined) setQuote(result.value);
        else {
          if (result.status === "invalid_amount") setServerRejected(true);
          if (result.status === "invalid_amount" && result.requiredMinor !== undefined) setServerRequiredMinor(result.requiredMinor);
          else setQuoteError(errorText(result.status));
        }
      }).catch(() => {
        if (request === latest.current) setQuoteError("No se pudo consultar el cambio. Actualiza e intenta de nuevo.");
      });
    }, 250);
    return () => { clearTimeout(timer); latest.current += 1; };
  }, [amountPesos, checkout.cashRegisterSessionId, checkout.orderId, method, receivedMinor, receivedPesos, tipMinor, tipPesos, validAmount]);

  function handleSplitModeChange(mode: "full" | "split") {
    // Reads checkout.remainingBalanceMinor, kept fresh by the key remount from page.tsx.
    setSplitMode(mode);
    setAmountPesos(formatMinorForMoneyInput(checkout.remainingBalanceMinor, checkout.currency) ?? "");
  }

  async function collect(formData: FormData) {
    if (!canCollectPayment({ quote, remainingMinor: checkout.remainingBalanceMinor, amountMinor, method, receivedMinor, tipMinor, terminalId, reference, busy }) || serverRejected) return;
    setBusy(true);
    setCollectError("");
    try {
      const result = await collectPaymentAction(formData);
      if (result.status === "ok" && result.receiptHref !== undefined) {
        router.push(result.receiptHref);
        return;
      }
      if (result.status === "unavailable") {
        const detail = await orderDetailAction(checkout.orderId).catch(() => undefined);
        if (detail?.ok && detail.value.payments.some((p) => p.paymentId === audit.paymentId)) {
          const receiptHref = buildReceiptHref(audit.paymentId, checkout.orderId);
          if (receiptHref !== null) {
            router.push(receiptHref);
            return;
          }
        }
      }
      setCollectError(errorText(result.status));
    } catch {
      // The actions return statuses and their redirect() calls run server-side, so nothing to rethrow.
      const detail = await orderDetailAction(checkout.orderId).catch(() => undefined);
      if (detail?.ok && detail.value.payments.some((p) => p.paymentId === audit.paymentId)) {
        const receiptHref = buildReceiptHref(audit.paymentId, checkout.orderId);
        if (receiptHref !== null) {
          router.push(receiptHref);
          return;
        }
      }
      setCollectError("No se pudo confirmar el cobro. Actualiza la caja antes de volver a intentar.");
    } finally {
      setBusy(false);
    }
  }

  const canCollect = canCollectPayment({
    quote, remainingMinor: checkout.remainingBalanceMinor, amountMinor, method, receivedMinor, tipMinor, terminalId, reference, busy,
  }) && !serverRejected;

  return (
    <div id="cobrar" className="mt-4 grid min-w-0 gap-4 scroll-mt-4">
      <div className="grid gap-3 rounded-xl bg-bg p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="Total" value={formatMinorUnits(checkout.orderTotalMinor, checkout.currency)} />
          <Metric label="Pagado" value={formatMinorUnits(checkout.capturedAmountMinor, checkout.currency)} />
          <Metric label="Saldo pendiente" value={formatMinorUnits(checkout.remainingBalanceMinor, checkout.currency)} />
        </div>
        {payments !== undefined && payments.length > 0 && (
          <div className="border-t border-border pt-3 text-xs">
            <p className="font-semibold text-text">Pagos registrados:</p>
            <ul className="mt-1.5 grid gap-1">
              {payments.map((p, idx) => (
                <li key={p.paymentId} className="flex items-baseline justify-between text-text-muted">
                  <span>Pago {idx + 1} ({paymentMethodLabel(p)}{timeZone !== undefined ? `, ${formatOrderWorkTime(p.capturedAt, timeZone)}` : ""})</span>
                  <span className="font-medium text-text">−{formatMinorUnits(p.amountMinor, checkout.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <form action={(data) => void collect(data)} className="grid gap-4">
        <input type="hidden" name="cashRegisterSessionId" value={checkout.cashRegisterSessionId} />
        <input type="hidden" name="orderId" value={checkout.orderId} />
        <input type="hidden" name="paymentId" value={audit.paymentId} />
        <input type="hidden" name="eventId" value={audit.eventId} />
        <input type="hidden" name="idempotencyKey" value={audit.idempotencyKey} />
        <input type="hidden" name="occurredAt" value={audit.occurredAt} />

        <div className="grid gap-2">
          <span className="inline-flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            <span>Forma de cobro</span>
            <FieldHint label="Forma de cobro" text="Elige si vas a cobrar la cuenta completa o dividirla para cobrar en partes." />
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSplitModeChange("full")}
              aria-pressed={splitMode === "full"}
              className={`min-h-12 rounded-xl border p-2 text-sm font-semibold transition-colors ${
                splitMode === "full" ? "border-accent bg-accent-soft text-accent-hover" : "border-border bg-surface"
              }`}
            >
              Pagar total ({formatMinorUnits(checkout.remainingBalanceMinor, checkout.currency)})
            </button>
            <button
              type="button"
              onClick={() => handleSplitModeChange("split")}
              aria-pressed={splitMode === "split"}
              className={`min-h-12 rounded-xl border p-2 text-sm font-semibold transition-colors ${
                splitMode === "split" ? "border-accent bg-accent-soft text-accent-hover" : "border-border bg-surface"
              }`}
            >
              Dividir pago
            </button>
          </div>
        </div>

        <Field
          className="grid gap-1 text-sm font-semibold"
          hint="Importe de este cobro. Viene el saldo completo; en Dividir pago puedes bajarlo si el cliente paga sólo una parte."
          label="A cobrar en pesos"
        >
          {(id) => (
            <>
              <input
                id={id}
                name="amountPesos"
                value={amountPesos}
                readOnly={splitMode === "full"}
                onChange={(event) => {
                  if (splitMode === "split") {
                    setAmountPesos(event.target.value);
                  }
                }}
                inputMode="decimal"
                className={`min-h-12 min-w-0 rounded-xl border border-border px-3 text-base ${
                  splitMode === "full" ? "bg-bg text-text-muted cursor-default" : "bg-surface"
                }`}
                aria-describedby="amount-hint"
              />
              <span id="amount-hint" className="text-xs font-normal text-text-muted">
                {splitMode === "full"
                  ? "Saldo total precargado. Toca «Dividir pago» para ingresar un importe menor."
                  : `Ingresa un importe entre ${formatMinorUnits(1, checkout.currency)} y ${formatMinorUnits(checkout.remainingBalanceMinor, checkout.currency)}.`}
              </span>
            </>
          )}
        </Field>
        {!validAmount && (
          <p role="alert" className="text-sm text-error">
            Escribe un importe entre {formatMinorUnits(1, checkout.currency)} y {formatMinorUnits(checkout.remainingBalanceMinor, checkout.currency)}.
          </p>
        )}

        <input type="hidden" name="method" value={method} />
        <div className="grid gap-2">
          <span className="inline-flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden="true">Método</span>
            <FieldHint label="Método" text="Cómo paga el cliente. Efectivo calcula el cambio; tarjeta externa y transferencia sólo registran una operación ya confirmada." />
          </span>
          <fieldset className="grid grid-cols-3 gap-2">
            <legend className="sr-only">Método</legend>
            <Method selected={method === "cash"} label="Efectivo" onClick={() => setMethod("cash")} />
            <Method selected={method === "card_manual"} label="Tarjeta externa" onClick={() => setMethod("card_manual")} />
            <Method selected={method === "transfer"} label="Transferencia" onClick={() => setMethod("transfer")} />
          </fieldset>
        </div>

        {method === "cash" ? (
          <div className="grid gap-2">
            <Field
              className="grid gap-1 text-sm font-semibold"
              hint="Dinero que entrega el cliente. Con él se calcula el cambio; usa los botones de abajo para montos comunes."
              label="Recibido en pesos"
            >
              {(id) => (
                <>
                  <input
                    id={id}
                    name="receivedPesos"
                    value={receivedPesos}
                    onChange={(event) => setReceivedPesos(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="min-h-12 min-w-0 rounded-xl border border-border px-3 text-base"
                  />
                </>
              )}
            </Field>
            <div className="grid grid-cols-4 gap-2">
              <QuickAmount
                label="Exacto"
                disabled={requiredCashMinor === null}
                onClick={() => setReceivedPesos(formatMinorForMoneyInput(requiredCashMinor ?? 0, checkout.currency) ?? "")}
              />
              {[10_000, 20_000, 50_000].map((amount) => (
                <QuickAmount
                  key={amount}
                  label={formatMinorUnits(amount, checkout.currency).replace(/\.00$/u, "")}
                  disabled={!validAmount || tipMinor === null || !quickCashAmounts(amountMinor, tipMinor).includes(amount)}
                  onClick={() => setReceivedPesos(formatMinorForMoneyInput(amount, checkout.currency) ?? "")}
                />
              ))}
            </div>
            {missingCashMinor !== null && (
              <p role="status" className="font-heading text-sm font-semibold text-error">
                Recibido menor al cobro más propina: faltan {formatMinorUnits(missingCashMinor, checkout.currency)}
              </p>
            )}
            {!serverRejected && quote !== null && (
              <p role="status" className="font-heading text-lg font-semibold text-accent">
                Cambio después de propina: {formatMinorUnits(quote.changeMinor ?? 0, checkout.currency)}
              </p>
            )}
            {receivedMinor !== null && receivedMinor > 0 && quote === null && quoteError === "" && !serverRejected && (
              <p role="status" className="text-sm text-text-muted">Calculando cambio…</p>
            )}
          </div>
        ) : method === "transfer" ? (
          <div className="grid gap-3 rounded-xl bg-bg p-3">
            <p className="text-xs text-text-muted">Sin cambio ni terminal. Confirma que el depósito ya llegó antes de cobrar; no cuenta en el efectivo de la caja.</p>
            <Field
              className="grid gap-1 text-sm font-semibold"
              hint="Folio o clave de rastreo de la transferencia, para conciliarla después. Puedes dejarla vacía."
              label="Referencia (opcional)"
            >
              {(id) => (
                <>
                  <input
                    id={id}
                    name="transferReference"
                    maxLength={64}
                    value={transferReference}
                    onChange={(event) => setTransferReference(event.target.value)}
                    className="min-h-12 min-w-0 rounded-xl border border-border px-3"
                  />
                </>
              )}
            </Field>
          </div>
        ) : (
          <div className="grid gap-3 rounded-xl bg-bg p-3">
            <p className="text-xs text-text-muted">Registra sólo una operación ya confirmada en la terminal externa. No captures datos de tarjeta.</p>
            <Field
              className="grid gap-1 text-sm font-semibold"
              hint="Nombre o número de la terminal bancaria donde se cobró, por ejemplo Terminal 1."
              label="Terminal"
            >
              {(id) => (
                <>
                  <input
                    id={id}
                    name="terminalId"
                    required
                    value={terminalId}
                    onChange={(event) => setTerminalId(event.target.value)}
                    className="min-h-12 min-w-0 rounded-xl border border-border px-3"
                  />
                </>
              )}
            </Field>
            <Field
              className="grid gap-1 text-sm font-semibold"
              hint="Folio o autorización que imprime la terminal; sirve para localizar la operación. Nunca captures datos de la tarjeta."
              label="Referencia (mínimo 6 caracteres)"
            >
              {(id) => (
                <>
                  <input
                    id={id}
                    name="reference"
                    required
                    minLength={6}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    className="min-h-12 min-w-0 rounded-xl border border-border px-3"
                  />
                </>
              )}
            </Field>
          </div>
        )}

        <Field
          className="grid gap-1 text-sm font-semibold"
          hint="Propina voluntaria que deja el cliente además de la cuenta. Se registra aparte y no cambia el total de la orden."
          label="Propina en pesos (opcional)"
        >
          {(id) => (
            <>
              <input
                id={id}
                name="tipPesos"
                value={tipPesos}
                onChange={(event) => setTipPesos(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="min-h-12 min-w-0 rounded-xl border border-border px-3"
              />
            </>
          )}
        </Field>

        {quoteError && <p role="alert" className="rounded-xl bg-error-bg p-3 text-sm">{quoteError}</p>}
        {collectError && <p role="alert" className="rounded-xl bg-error-bg p-3 text-sm">{collectError}</p>}
        <button
          disabled={!canCollect}
          type="submit"
          className="min-h-12 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Cobrar"}
        </button>
      </form>
    </div>
  );
}

function Method({ label, selected, onClick }: { readonly label: string; readonly selected: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-12 rounded-xl border p-2 text-xs font-semibold ${
        selected ? "border-accent bg-accent-soft text-accent-hover" : "border-border bg-surface"
      }`}
    >
      {label}
    </button>
  );
}

function QuickAmount({ label, onClick, disabled = false }: { readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-12 rounded-xl border border-border bg-surface px-1 text-sm font-semibold disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="break-words font-heading text-sm font-semibold">{value}</p>
    </div>
  );
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
