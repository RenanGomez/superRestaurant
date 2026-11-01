"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { FieldLabel } from "../../../components/field-hint";
import type {
  CapturePaymentBasisV1,
  CapturePaymentIntentMethodV1,
  CapturePaymentIntentProjectionV1,
  CapturePaymentIntentV1,
  CaptureFulfillmentChannelV1,
  DeliveryQuoteV1,
} from "@super-restaurant/shared-types";
import {
  describePaymentMethod, formatMinorForMoneyInput, parseMoneyInputToMinor, shouldSubmitTender, suggestTenderAmounts,
} from "../../../lib/capture-payment";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { currencyFractionDigits } from "../../../lib/money-scale";
import { uiButton, uiOption } from "../../../lib/ui-classes";

const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = uiButton();
const input = "min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const methods: readonly CapturePaymentIntentMethodV1[] = ["cash", "card_manual", "transfer"];
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
  readonly errorNotice?: string | undefined;
}

/** Step 5, "Cobro": states the payment intent (method, cash tender, tip). Never computes totals,
 * subtotal, shipping or change itself -- every money figure in the summary comes straight from the
 * server-computed `projection`, never from local arithmetic. */
export function CapturePayment({ projection, basis, intent, deliveryQuote, fulfillment, currency, busy,
  onSetIntent, onRefreshIntent, errorNotice }: CapturePaymentProps) {
  const [customTender, setCustomTender] = useState("");
  const [feedback, setFeedback] = useState<{ key: string; state: "saving" | "saved" | "error" }>();
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);
  async function submit(key: string, method: CapturePaymentIntentMethodV1, tender: number | null, tip: number): Promise<boolean> {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback({ key, state: "saving" });
    const accepted = await onSetIntent(method, tender, tip);
    setFeedback({ key, state: accepted ? "saved" : "error" });
    if (accepted) feedbackTimer.current = setTimeout(() => setFeedback(undefined), 2000);
    return accepted;
  }
  function status(key: string): string | null {
    return feedback?.key === key ? feedback.state === "saving" ? "Guardando…"
      : feedback.state === "saved" ? "Guardado" : errorNotice ?? "No se pudo guardar. Reintenta." : null;
  }
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
  const itemsSubtotalMinor = projection?.itemsSubtotalMinor ?? basis?.itemsSubtotalMinor ?? null;
  const deliveryFeeMinor = projection?.deliveryFeeMinor ?? basis?.deliveryFeeMinor ?? null;
  const summaryCurrency = projection?.currency ?? basis?.currency ?? currency;
  const digits = currencyFractionDigits(summaryCurrency);
  const currencySupported = digits !== null;
  const suggestions = totalMinor === null ? [] : suggestTenderAmounts(totalMinor, summaryCurrency);
  const tipChips = [
    { label: "Sin propina", amountMinor: 0 },
    ...(digits === null ? [] : [10n, 20n, 50n].map((major) => {
      const amountMinor = Number(major * 10n ** BigInt(digits));
      return { label: formatMinorUnits(amountMinor, summaryCurrency), amountMinor };
    })),
  ];

  function chooseMethod(next: CapturePaymentIntentMethodV1): void {
    if (!currencySupported) return;
    setCustomTender("");
    void submit(`method:${next}`, next, next === "cash" ? tenderedAmountMinor : null, tipMinor);
  }

  function chooseTender(amountMinor: number): void {
    if (!currencySupported) return;
    setCustomTender("");
    void submit(`tender:${amountMinor}`, method, amountMinor, tipMinor);
  }

  function chooseTip(amountMinor: number): void {
    if (!currencySupported) return;
    void submit(`tip:${amountMinor}`, method, tenderedAmountMinor, amountMinor);
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
    const parsedMinor = parseMoneyInputToMinor(customTender, summaryCurrency);
    if (!shouldSubmitTender(parsedMinor, appliedTenderMinor, tenderedAmountMinor)) return;
    void submit("custom", method, parsedMinor, tipMinor).then((accepted) => {
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

  const customTenderMinor = customTender.trim() === "" ? null : parseMoneyInputToMinor(customTender, summaryCurrency);
  // A preset is marked only while the typed amount is empty or equals that preset (compared in minor units).
  const presetSelected = (amountMinor: number): boolean => tenderedAmountMinor === amountMinor
    && (customTender.trim() === "" || customTenderMinor === amountMinor);
  const customTenderInvalid = customTender.trim() !== "" && parseMoneyInputToMinor(customTender, summaryCurrency) === null;

  const timing = projection?.timing ?? "now";

  return <section className={panel} data-testid="capture-payment">
    <h2 className="font-heading text-lg font-semibold">4. Cobro</h2>
    <p className="mt-1 text-sm text-text-muted">Es una intención de pago, no un cobro; el dinero entra a caja al liquidar.</p>
    {!currencySupported && <p role="alert" className="mt-2 rounded-lg bg-error-bg p-3 text-sm">Moneda no admitida; avisa al administrador.</p>}
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
        return <button key={candidate} type="button" disabled={busy || !currencySupported}
          className={uiOption(method === candidate)}
          aria-pressed={method === candidate} onClick={() => chooseMethod(candidate)}>
          <span className="block">{label.label}{status(`method:${candidate}`) === "Guardando…" ? " · Guardando…" : ""}</span>
          <span className="block text-xs font-normal">{label.notice}</span>
        </button>;
      })}
    </div>
    {feedback?.key.startsWith("method:") && feedback.state !== "saving" && <p role={feedback.state === "error" ? "alert" : "status"} className="mt-2 text-sm">{status(feedback.key)}</p>}
    {method === "cash" && <div className="mt-4 grid gap-2">
      <span className="text-sm font-semibold">¿Paga con?</span>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((amountMinor) => <button key={amountMinor} type="button" disabled={busy || !currencySupported}
          className={uiOption(presetSelected(amountMinor))}
          aria-pressed={presetSelected(amountMinor)} onClick={() => chooseTender(amountMinor)}>
          {totalMinor !== null && amountMinor === totalMinor ? "Exacto" : formatMinorUnits(amountMinor, summaryCurrency)}{status(`tender:${amountMinor}`) === "Guardando…" ? " · Guardando…" : ""}
        </button>)}
      </div>
      {feedback?.key.startsWith("tender:") && feedback.state !== "saving" && <p role={feedback.state === "error" ? "alert" : "status"} className="text-sm">{status(feedback.key)}</p>}
      <div className="grid gap-1 text-sm">
        <FieldLabel htmlFor="capture-cash-with" hint="Billete o monto exacto con el que paga el cliente, para calcular el cambio que lleva el repartidor." label="Otro monto" />
        <div className="flex flex-wrap gap-2">
          <input id="capture-cash-with" inputMode="decimal" className={input} value={customTender}
            disabled={busy || !currencySupported} placeholder={formatMinorForMoneyInput(0, summaryCurrency) ?? ""} onChange={handleCustomTenderChange}
            onBlur={applyCustomTender} onKeyDown={handleCustomTenderKeyDown}
            aria-invalid={customTenderInvalid} aria-describedby={customTenderInvalid ? "capture-cash-with-error" : undefined} />
          <button type="button" className={button} disabled={busy || !currencySupported || customTender.trim() === ""}
            onMouseDown={(event) => event.preventDefault()} onClick={applyCustomTender}>{status("custom") === "Guardando…" ? "Guardando…" : "Aplicar"}</button>
        </div>
        {feedback?.key === "custom" && feedback.state !== "saving" && <p role={feedback.state === "error" ? "alert" : "status"} className="text-sm">{status("custom")}</p>}
      </div>
      {customTenderInvalid && <p id="capture-cash-with-error" role="alert" className="text-sm text-error">
        Monto inválido
      </p>}
    </div>}
    <div className="mt-4 grid gap-2">
      <span className="text-sm font-semibold">Propina (separada del total)</span>
      <div className="flex flex-wrap gap-2">
        {tipChips.map((chip) => <button key={chip.amountMinor} type="button" disabled={busy || !currencySupported}
          className={uiOption(tipMinor === chip.amountMinor)}
          aria-pressed={tipMinor === chip.amountMinor} onClick={() => chooseTip(chip.amountMinor)}>
          {chip.label}{status(`tip:${chip.amountMinor}`) === "Guardando…" ? " · Guardando…" : ""}
        </button>)}
      </div>
      {feedback?.key.startsWith("tip:") && feedback.state !== "saving" && <p role={feedback.state === "error" ? "alert" : "status"} className="text-sm">{status(feedback.key)}</p>}
    </div>
    <div className="mt-4 grid gap-1 rounded-lg border border-border bg-bg p-3 text-sm">
      <div className="flex justify-between"><span>Subtotal</span>
        <span>{itemsSubtotalMinor === null ? "—" : formatMinorUnits(itemsSubtotalMinor, summaryCurrency)}</span></div>
      {fulfillment === "delivery" && <div className="flex justify-between"><span>Envío</span>
        <span>{deliveryFeeMinor === null ? "—" : formatMinorUnits(deliveryFeeMinor, summaryCurrency)}</span></div>}
      <div className="flex justify-between font-heading text-base font-bold"><span>Total</span>
        <span>{totalMinor === null ? "—" : formatMinorUnits(totalMinor, summaryCurrency)}</span></div>
      {/* H25: tip and change stay exclusively projection's -- they only mean something once there
        is an actual intent, never inferred from the basis alone. */}
      <div className="flex justify-between"><span>Propina</span>
        <span>{projection === null ? "—" : formatMinorUnits(projection.tipMinor, projection.currency)}</span></div>
      {projection?.method === "cash" && <div className="flex justify-between"><span>Cambio:</span>
        <span>{projection.changeDueMinor === null ? "Sin cambio calculado" : formatMinorUnits(projection.changeDueMinor, projection.currency)}</span></div>}
    </div>
    {fulfillment === "delivery" && deliveryQuote === null && <p className="mt-2 text-xs text-text-muted">
      Cotiza la entrega antes de confirmar el cobro final.
    </p>}
  </section>;
}
