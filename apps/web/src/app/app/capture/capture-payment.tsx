"use client";

import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type {
  CapturePaymentBasisV1,
  CapturePaymentIntentMethodV1,
  CapturePaymentIntentProjectionV1,
  CapturePaymentIntentV1,
  CaptureFulfillmentChannelV1,
  DeliveryQuoteV1,
} from "@super-restaurant/shared-types";
import {
  describePaymentMethod, parseMoneyInputToMinor, shouldSubmitTender, suggestTenderAmounts,
} from "../../../lib/capture-payment";

const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const input = "min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const methods: readonly CapturePaymentIntentMethodV1[] = ["cash", "card_manual", "transfer"];
const tipChips: readonly { readonly label: string; readonly amountMinor: number }[] = [
  { label: "Sin propina", amountMinor: 0 },
  { label: "$10", amountMinor: 1000 },
  { label: "$20", amountMinor: 2000 },
  { label: "$50", amountMinor: 5000 },
];

interface CapturePaymentProps {
  readonly projection: CapturePaymentIntentProjectionV1 | null;
  /** H25: the pricing basis alone (no method/tender/tip), present even before any payment intent
   * exists. Only ever used for the summary and cash shortcuts once `projection` is null -- change
   * and tip always come exclusively from `projection`, never computed or inferred here. */
  readonly basis: CapturePaymentBasisV1 | null;
  readonly intent: CapturePaymentIntentV1 | null;
  readonly deliveryQuote: DeliveryQuoteV1 | null;
  readonly fulfillment: CaptureFulfillmentChannelV1 | null;
  readonly currency: string;
  readonly busy: boolean;
  /** H27: resolves to whether the server actually accepted the intent (never optimistic) --
   * `applyCustomTender` only records the tender as "applied" on `true`, so a rejected amount
   * (e.g. insufficient) stays editable and can be immediately resent, instead of getting stuck. */
  readonly onSetIntent: (
    method: CapturePaymentIntentMethodV1, tenderedMinor: number | null, tipMinor: number,
  ) => Promise<boolean>;
  readonly onRefreshIntent: () => void;
}

/** Step 5, "Cobro": states the payment intent (method, cash tender, tip). Never computes totals,
 * subtotal, shipping or change itself -- every money figure in the summary comes straight from the
 * server-computed `projection`, never from local arithmetic. */
export function CapturePayment({ projection, basis, intent, deliveryQuote, fulfillment, currency, busy,
  onSetIntent, onRefreshIntent }: CapturePaymentProps) {
  const [customTender, setCustomTender] = useState("");
  // H24: the last amount THIS field actually applied, so an Enter-then-blur pair (or repeated
  // blurs) never resends the identical amount as a redundant version bump that could stomp a
  // tip/method change made in between. H30: this must only ever dedupe THAT immediate,
  // same-cycle double-send -- once the server's own tendered amount has moved on for any other
  // reason (a suggestion chip, a method switch), it must stop blocking a resend of the same
  // digits. Syncing it to the server's own value on every change keeps it from going stale: the
  // only window where it still differs from `tenderedAmountMinor` is the brief gap between this
  // field's own apply call and the server's reply.
  const [appliedTenderMinor, setAppliedTenderMinor] = useState<number | null>(null);
  const method = intent?.method ?? "cash";
  const tipMinor = intent?.tipMinor ?? 0;
  const tenderedAmountMinor = intent?.tenderedAmountMinor ?? null;
  useEffect(() => { setAppliedTenderMinor(tenderedAmountMinor); }, [tenderedAmountMinor]);
  // H25: before any intent exists, projection is always null; the basis alone (no method/tender)
  // still lets the total-based suggestions and the summary read real numbers instead of dashes.
  const totalMinor = projection?.orderTotalMinor ?? basis?.orderTotalMinor ?? null;
  const suggestions = totalMinor === null ? [] : suggestTenderAmounts(totalMinor);
  const itemsSubtotalMinor = projection?.itemsSubtotalMinor ?? basis?.itemsSubtotalMinor ?? null;
  const deliveryFeeMinor = projection?.deliveryFeeMinor ?? basis?.deliveryFeeMinor ?? null;
  const summaryCurrency = projection?.currency ?? basis?.currency ?? currency;

  function chooseMethod(next: CapturePaymentIntentMethodV1): void {
    setCustomTender("");
    onSetIntent(next, next === "cash" ? tenderedAmountMinor : null, tipMinor);
  }

  function chooseTender(amountMinor: number): void {
    setCustomTender("");
    onSetIntent(method, amountMinor, tipMinor);
  }

  function chooseTip(amountMinor: number): void {
    onSetIntent(method, tenderedAmountMinor, amountMinor);
  }

  // H22: typing only updates the local field -- it never sends the intent on every valid
  // keystroke (which used to also flip `busy` mid-edit and lock the input the operator was still
  // typing into). The intent is only ever sent on blur, Enter, or the explicit "Aplicar" button;
  // an invalid value shows "Monto inválido" and is never sent regardless of how it's triggered.
  function handleCustomTenderChange(event: ChangeEvent<HTMLInputElement>): void {
    setCustomTender(event.target.value);
  }

  function applyCustomTender(): void {
    if (customTender.trim() === "") return;
    const parsedMinor = parseMoneyInputToMinor(customTender);
    if (!shouldSubmitTender(parsedMinor, appliedTenderMinor, tenderedAmountMinor)) return;
    void onSetIntent(method, parsedMinor, tipMinor).then((accepted) => {
      // H27: only record the tender as "applied" once the server actually accepted it -- a
      // rejection (insufficient) must leave it eligible for an immediate resend once it would
      // cover a since-changed total, never stuck as a silent no-op.
      if (accepted) setAppliedTenderMinor(parsedMinor);
    });
  }

  function handleCustomTenderKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyCustomTender();
  }

  const customTenderInvalid = customTender.trim() !== "" && parseMoneyInputToMinor(customTender) === null;

  const timing = projection?.timing ?? "now";

  return <section className={panel} data-testid="capture-payment">
    <h2 className="font-heading text-lg font-semibold">Cobro</h2>
    <p className="mt-1 text-sm text-text-muted">Es una intención de pago, no un cobro; el dinero entra a caja al liquidar.</p>
    {projection?.status === "stale" && <div role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">
      <p>Cambió el pedido: confirma de nuevo el cobro.</p>
      <button type="button" className={`${button} mt-2`} disabled={busy} onClick={onRefreshIntent}>
        Confirmar cobro de nuevo
      </button>
    </div>}
    {projection?.status === "insufficient" && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">
      El monto no cubre el total.
    </p>}
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {methods.map((candidate) => {
        const label = describePaymentMethod(candidate, timing);
        return <button key={candidate} type="button" disabled={busy}
          className={`${button} min-h-11 ${method === candidate ? "border-accent bg-bg" : ""}`}
          aria-pressed={method === candidate} onClick={() => chooseMethod(candidate)}>
          <span className="block">{label.label}</span>
          <span className="block text-xs text-text-muted">{label.notice}</span>
        </button>;
      })}
    </div>
    {method === "cash" && <div className="mt-4 grid gap-2">
      <span className="text-sm font-semibold">¿Paga con?</span>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((amountMinor) => <button key={amountMinor} type="button" disabled={busy}
          className={`${button} ${tenderedAmountMinor === amountMinor ? "border-accent bg-bg" : ""}`}
          aria-pressed={tenderedAmountMinor === amountMinor} onClick={() => chooseTender(amountMinor)}>
          {totalMinor !== null && amountMinor === totalMinor ? "Exacto" : money(amountMinor, currency)}
        </button>)}
      </div>
      <div className="grid gap-1 text-sm">
        <label htmlFor="capture-cash-with">Otro monto</label>
        <div className="flex flex-wrap gap-2">
          <input id="capture-cash-with" inputMode="decimal" className={input} value={customTender}
            disabled={busy} placeholder="0.00" onChange={handleCustomTenderChange}
            onBlur={applyCustomTender} onKeyDown={handleCustomTenderKeyDown}
            aria-invalid={customTenderInvalid} aria-describedby={customTenderInvalid ? "capture-cash-with-error" : undefined} />
          <button type="button" className={button} disabled={busy || customTender.trim() === ""}
            onMouseDown={(event) => event.preventDefault()} onClick={applyCustomTender}>Aplicar</button>
        </div>
      </div>
      {customTenderInvalid && <p id="capture-cash-with-error" role="alert" className="text-sm text-error">
        Monto inválido
      </p>}
    </div>}
    <div className="mt-4 grid gap-2">
      <span className="text-sm font-semibold">Propina (separada del total)</span>
      <div className="flex flex-wrap gap-2">
        {tipChips.map((chip) => <button key={chip.amountMinor} type="button" disabled={busy}
          className={`${button} ${tipMinor === chip.amountMinor ? "border-accent bg-bg" : ""}`}
          aria-pressed={tipMinor === chip.amountMinor} onClick={() => chooseTip(chip.amountMinor)}>
          {chip.label}
        </button>)}
      </div>
    </div>
    <div className="mt-4 grid gap-1 rounded-lg border border-border bg-bg p-3 text-sm">
      <div className="flex justify-between"><span>Subtotal</span>
        <span>{itemsSubtotalMinor === null ? "—" : money(itemsSubtotalMinor, summaryCurrency)}</span></div>
      {fulfillment === "delivery" && <div className="flex justify-between"><span>Envío</span>
        <span>{deliveryFeeMinor === null ? "—" : money(deliveryFeeMinor, summaryCurrency)}</span></div>}
      <div className="flex justify-between font-heading text-base font-bold"><span>Total</span>
        <span>{totalMinor === null ? "—" : money(totalMinor, summaryCurrency)}</span></div>
      {/* H25: tip and change stay exclusively projection's -- they only mean something once there
        is an actual intent, never inferred from the basis alone. */}
      <div className="flex justify-between"><span>Propina</span>
        <span>{projection === null ? "—" : money(projection.tipMinor, projection.currency)}</span></div>
      {projection?.method === "cash" && <div className="flex justify-between"><span>Cambio</span>
        <span>{projection.changeDueMinor === null ? "—" : money(projection.changeDueMinor, projection.currency)}</span></div>}
    </div>
    {fulfillment === "delivery" && deliveryQuote === null && <p className="mt-2 text-xs text-text-muted">
      Cotiza la entrega antes de confirmar el cobro final.
    </p>}
  </section>;
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", { currency, style: "currency" }).format(amountMinor / 100);
}
