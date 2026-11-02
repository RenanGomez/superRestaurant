import { randomUUID } from "node:crypto";

import type { ReactNode } from "react";

import type {
  CheckoutOrderSummaryV1,
  OrderDetailV1,
  PaymentCollectionSummaryV1,
} from "@super-restaurant/shared-types";

import {
  channelLabel, formatMinorUnits, formatOrderWorkTime, requestBranchOrderWorkTray,
} from "../../../lib/branch-order-work-tray";
import { getCheckoutOrder, type FinancialApiResult } from "../../../lib/finance";
import { tableLabel } from "../../../lib/orders-view";
import { uiButton } from "../../../lib/ui-classes";
import { orderDetailAction, tableNamesAction } from "../orders/actions";
import { openCashRegisterAction } from "./actions";
import { paymentMethodLabel, parseReceiptQuery } from "./caja-helpers";
import {
  AuditFields, CajaHeader, EmptyState, ErrorBanner, KNOWN_ERRORS, KNOWN_STATUSES, MoneyField, SuccessBanner,
  loadCajaContext, newAudit, scalar, shortId, validUuid, type SearchParams,
} from "./caja-shared";
import { COBRAR_PATH, CORTE_PATH, cobrarHref, cobrarView, registerState } from "./caja-view";
import { PayableOrders } from "./payable-orders";
import { PaymentPanel } from "./payment-panel";
import { ReceiptPrintButton } from "./receipt-print-button";
import { CASH_RECEIPT_COOKIE, decodeReceiptCookie } from "./receipt";
import { CashierSubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

const PANEL = "rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.04)]";

export default async function CollectPaymentPage({ searchParams }: { readonly searchParams: SearchParams }): Promise<ReactNode> {
  const context = await loadCajaContext(searchParams);
  const { accessToken, canOperate, cookieStore, deviceId, env, membership, params, registerId, report, scope, userId } = context;
  const error = scalar(params.cashError);
  const status = scalar(params.cashStatus);
  const orderId = validUuid(scalar(params.orderId));
  const register = registerState(report);
  const receiptQuery = parseReceiptQuery(params);
  const view = cobrarView({ canOperate, register, orderId, hasReceipt: receiptQuery !== null });
  const openReport = report?.status === "ok" && report.value.register.status === "open" ? report.value : undefined;

  const tableNamesList = await tableNamesAction();
  const tableNamesRecord: Record<string, string> = Object.fromEntries(
    (tableNamesList ?? []).map((t) => [t.tableId, t.name]),
  );
  const tableNamesMap = new Map(Object.entries(tableNamesRecord));

  const decoded = receiptQuery === null || env.receiptCookieSecret === undefined ? undefined
    : decodeReceiptCookie(cookieStore.get(CASH_RECEIPT_COOKIE)?.value, userId, env.receiptCookieSecret);
  const receipt = decoded !== undefined && receiptQuery !== null
    && decoded.paymentId === receiptQuery.paymentId && decoded.orderId === receiptQuery.orderId
    && decoded.scope.restaurantId === scope.restaurantId && decoded.scope.branchId === scope.branchId
    ? decoded : undefined;
  const receiptUnavailable = receiptQuery !== null && receipt === undefined;
  const detailOrderId = view !== "order" ? undefined : receipt !== undefined ? receipt.orderId : orderId;
  const detailResult = detailOrderId === undefined ? undefined : await orderDetailAction(detailOrderId);
  const detail = detailResult?.ok && detailResult.value.scope.restaurantId === scope.restaurantId
    && detailResult.value.scope.branchId === scope.branchId ? detailResult.value : undefined;
  const checkout = view === "order" && receiptQuery === null && openReport !== undefined && orderId !== undefined && deviceId !== undefined && registerId !== undefined
    ? await getCheckoutOrder(accessToken, env.apiBaseUrl, {
      cashRegisterSessionId: openReport.register.cashRegisterSessionId,
      deviceId,
      orderId,
      registerId,
      schemaVersion: 1,
      scope,
    })
    : undefined;
  const tray = view === "list" ? await requestBranchOrderWorkTray(accessToken, env.apiBaseUrl, scope, null, 25) : undefined;
  const printHeader = { restaurantName: membership.restaurantName, branchName: membership.branchName };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
      <CajaHeader active="cobrar" membership={membership} registerStatus={register === "open" || register === "closed" ? register : "none"} />
      {error !== undefined && KNOWN_ERRORS.has(error) && <ErrorBanner code={error} />}
      {status !== undefined && KNOWN_STATUSES.has(status) && <SuccessBanner code={status} />}
      {view === "no_permission" ? (
        <EmptyState title="Sin permiso de caja" body="Tu rol actual no permite abrir, cobrar o cerrar una caja en esta sucursal." />
      ) : view === "unavailable" ? (
        <EmptyState
          title="No se pudo recuperar la caja"
          body="El estado autoritativo no está disponible. No se realizó ningún cobro ni cierre."
          action={<a href={COBRAR_PATH} className={uiButton("primary", "inline-flex items-center px-4 text-[14px]")}>Reintentar</a>}
        />
      ) : view === "open_register" ? (
        <OpenRegisterPanel closed={register === "closed"} />
      ) : view === "list" ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className={PANEL}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Cobro</p>
            <h2 className="mt-1 font-heading text-[18px] font-semibold">Órdenes por cobrar</h2>
            <PayableOrders scope={scope} initial={tray} selectedOrderId={undefined} tableNames={tableNamesRecord} />
          </section>
          <section className={`self-start ${PANEL}`}>
            <h2 className="font-heading text-[18px] font-semibold">Cuenta a cobrar</h2>
            <p className="mt-3 rounded-xl bg-bg p-4 text-[13px] text-text-muted">Elige una orden de la lista para ver su cuenta y cobrarla.</p>
          </section>
        </div>
      ) : (
        <OrderView
          checkout={checkout}
          detail={detail}
          header={printHeader}
          orderId={orderId}
          receipt={receipt}
          receiptUnavailable={receiptUnavailable}
          sessionId={openReport?.register.cashRegisterSessionId}
          tableNames={tableNamesMap}
        />
      )}
    </div>
  );
}

function OpenRegisterPanel({ closed }: { readonly closed: boolean }): ReactNode {
  const audit = newAudit();
  return (
    <section className={`mx-auto grid w-full max-w-xl gap-4 ${PANEL}`}>
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Inicio de turno</p>
        <h2 className="mt-1 font-heading text-[18px] font-semibold">Abre la caja para cobrar</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
          {closed ? "La caja anterior está cerrada; su corte sigue disponible en Corte de caja. " : ""}Cuenta el fondo con el que inicia el turno.
        </p>
      </div>
      <form action={openCashRegisterAction} className="grid gap-4">
        <AuditFields audit={audit} />
        <input type="hidden" name="cashRegisterSessionId" value={randomUUID()} />
        <input type="hidden" name="shiftId" value={randomUUID()} />
        <MoneyField hint="Efectivo con el que abres la caja (cambio inicial). Cuéntalo físicamente antes de empezar a cobrar." label="Fondo inicial" name="openingFloatPesos" defaultValue="0" />
        <CashierSubmitButton idle="Abrir caja" pending="Guardando apertura…" />
      </form>
      {closed && <a href={CORTE_PATH} className={uiButton("secondary", "inline-flex items-center justify-center px-4 text-[14px]")}>Ver el corte anterior</a>}
    </section>
  );
}

function OrderView({
  checkout,
  detail,
  header,
  orderId,
  receipt,
  receiptUnavailable,
  sessionId,
  tableNames,
}: {
  readonly checkout: FinancialApiResult<CheckoutOrderSummaryV1> | undefined;
  readonly detail: OrderDetailV1 | undefined;
  readonly header: { readonly restaurantName: string; readonly branchName: string };
  readonly orderId: string | undefined;
  readonly receipt: PaymentCollectionSummaryV1 | undefined;
  readonly receiptUnavailable: boolean;
  readonly sessionId: string | undefined;
  readonly tableNames: ReadonlyMap<string, string>;
}): ReactNode {
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(340px,1.1fr)]">
      <OrderSummary detail={detail} checkout={checkout?.status === "ok" ? checkout.value : undefined} tableNames={tableNames} />
      <section className={`min-w-0 self-start ${PANEL}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Cobro</p><h2 className="mt-1 font-heading text-[18px] font-semibold">Cobrar cuenta</h2></div>
          {sessionId !== undefined && <span className="rounded-lg bg-bg px-3 py-2 font-mono text-[11px] text-text-muted">Caja {shortId(sessionId)}</span>}
        </div>
        {receipt !== undefined ? <ReceiptCard receipt={receipt} order={detail} header={header} /> : receiptUnavailable ? (
          <div id="cobrar" role="status" className="mt-4 grid gap-3 rounded-xl bg-bg p-4 text-[13px]">
            <h3 className="font-heading text-lg font-semibold">Recibo no disponible</h3>
            <p className="text-text-muted">Si acabas de cobrar, el pago quedó registrado; consulta el corte de caja para confirmarlo.</p>
            <a href={CORTE_PATH} className={uiButton("secondary", "inline-flex items-center justify-center px-4 text-[14px]")}>Ver corte de caja</a>
            <BackLinks />
          </div>
        ) : orderId === undefined || checkout?.status !== "ok" ? (
          <div role="alert" className="mt-4 grid gap-3 rounded-xl border border-[oklch(85%_0.06_25)] bg-error-bg p-4 text-[13px] text-[oklch(35%_0.1_25)]">
            <p>No se pudo cargar esa cuenta. Elige otra orden o actualiza; no se registró ningún pago.</p>
            <BackLinks />
          </div>
        ) : (
          <>
            <PaymentPanel
              key={`${checkout.value.orderId}:${checkout.value.orderVersion}`}
              checkout={checkout.value}
              audit={{ ...newAudit(), paymentId: randomUUID() }}
              payments={detail?.payments}
              timeZone={detail?.timeZone}
            />
            <div className="mt-4"><BackLinks /></div>
          </>
        )}
      </section>
    </div>
  );
}

function BackLinks(): ReactNode {
  return (
    <div className="flex flex-wrap gap-2">
      <a href="/app/orders" className={uiButton("secondary", "inline-flex items-center justify-center px-4 text-[14px]")}>Volver a órdenes</a>
      <a href={COBRAR_PATH} className={uiButton("secondary", "inline-flex items-center justify-center px-4 text-[14px]")}>Cobrar otra cuenta</a>
    </div>
  );
}

function OrderSummary({
  checkout,
  detail,
  tableNames,
}: {
  readonly checkout: CheckoutOrderSummaryV1 | undefined;
  readonly detail: OrderDetailV1 | undefined;
  readonly tableNames: ReadonlyMap<string, string>;
}): ReactNode {
  const currency = detail?.currency ?? checkout?.currency;
  const headline = detail === undefined
    ? "Resumen de la orden"
    : detail.channel === "table"
      ? tableLabel(detail.tableId, tableNames, detail.accountLabel)
      : detail.accountLabel !== null && detail.accountLabel.trim().length > 0
        ? `${channelLabel(detail.channel)} · ${detail.accountLabel.trim()}`
        : detail.shortFolio !== null
          ? `Orden ${detail.shortFolio}`
          : channelLabel(detail.channel);

  const orderTotalMinor = checkout?.orderTotalMinor ?? detail?.totals.totalMinor ?? 0;
  const remainingMinor = checkout?.remainingBalanceMinor;

  return (
    <section className={`min-w-0 self-start ${PANEL}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Cuenta</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-[18px] font-semibold">{headline}</h2>
        {detail?.shortFolio !== null && detail?.shortFolio !== undefined && (
          <span className="font-mono text-[11px] text-text-muted">Folio {detail.shortFolio}</span>
        )}
      </div>
      {detail !== undefined && (
        <p className="mt-1 text-[12px] text-text-muted">
          {channelLabel(detail.channel)}
          {detail.createdAt !== null && ` · Abierta ${formatOrderWorkTime(detail.createdAt, detail.timeZone)}`}
        </p>
      )}

      {detail === undefined || currency === undefined ? (
        <p className="mt-3 rounded-xl bg-bg p-4 text-[13px] text-text-muted">El detalle de la orden no está disponible. El cobro usa el saldo que calcula el servidor.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {detail.items.filter((item) => item.status !== "cancelled").map((item) => (
            <li key={item.orderItemId} className="flex min-w-0 items-start justify-between gap-3 rounded-xl bg-bg p-3 text-[13px]">
              <div className="min-w-0">
                <p className="break-words font-semibold">{item.quantity} × {item.name}{item.variantName === null || item.variantName === undefined ? "" : ` · ${item.variantName}`}</p>
                {item.note !== null && <p className="break-words text-[12px] text-text-muted">{item.note}</p>}
              </div>
              <span className="shrink-0 font-semibold">{formatMinorUnits(item.lineTotalMinor, currency)}</span>
            </li>
          ))}
        </ul>
      )}

      {currency !== undefined && (orderTotalMinor > 0 || (detail?.payments !== undefined && detail.payments.length > 0)) && (
        <div className="mt-4 grid gap-2 border-t border-border pt-4 text-sm">
          <div className="flex items-baseline justify-between font-heading font-semibold">
            <span>Total de la cuenta</span>
            <span>{formatMinorUnits(orderTotalMinor, currency)}</span>
          </div>
          {detail?.payments !== undefined && detail.payments.length > 0 && (
            <ul className="grid gap-1.5 border-t border-border/50 py-2 text-xs">
              {detail.payments.map((p, idx) => (
                <li key={p.paymentId} className="flex items-baseline justify-between text-text-muted">
                  <span>
                    Pago {idx + 1} ({paymentMethodLabel(p)}{detail.timeZone ? `, ${formatOrderWorkTime(p.capturedAt, detail.timeZone)}` : ""})
                  </span>
                  <span className="font-semibold text-text">
                    −{formatMinorUnits(p.amountMinor, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-baseline justify-between border-t border-border/60 pt-2 font-heading text-[16px] font-semibold text-accent">
            <span>Saldo pendiente</span>
            <span>{remainingMinor === undefined ? "Saldo no disponible" : formatMinorUnits(remainingMinor, currency)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function ReceiptCard({ receipt, order, header }: { readonly receipt: PaymentCollectionSummaryV1; readonly order: OrderDetailV1 | undefined; readonly header: { readonly restaurantName: string; readonly branchName: string } }): ReactNode {
  return (
    <div id="cobrar" role="status" className="mt-4 grid gap-4 rounded-xl border border-[oklch(84%_0.08_155)] bg-[oklch(96%_0.03_155)] p-5">
      <h3 className="font-heading text-lg font-semibold">Cobro registrado</h3>
      <p>
        {paymentMethodLabel(receipt)} · Cobrado {formatMinorUnits(receipt.amountMinor, receipt.currency)}
        {receipt.tenderedAmountMinor !== null && <> · Recibido {formatMinorUnits(receipt.tenderedAmountMinor, receipt.currency)}</>}
        {" "}· Cambio {formatMinorUnits(receipt.changeMinor ?? 0, receipt.currency)} · Propina {formatMinorUnits(receipt.tipMinor, receipt.currency)}
      </p>
      <p className="font-heading text-lg font-semibold">
        {receipt.remainingBalanceMinor > 0 ? `Saldo restante ${formatMinorUnits(receipt.remainingBalanceMinor, receipt.currency)}` : "Cuenta pagada por completo"}
      </p>
      {receipt.remainingBalanceMinor > 0 && <a href={cobrarHref(receipt.orderId)} className={uiButton("primary", "inline-flex items-center justify-center px-4 text-sm")}>Seguir cobrando esta cuenta</a>}
      {order !== undefined && <ReceiptPrintButton order={order} payment={receipt} header={header} />}
      <BackLinks />
    </div>
  );
}
