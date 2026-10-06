import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  MAX_DELIVERY_ATTEMPTS,
  type BranchDeliveryItemV1,
  type BranchMemberV1,
  type BranchScope,
  type CashPaymentQuoteV1,
} from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { formatMinorUnits, formatOrderWorkTime } from "../../../lib/branch-order-work-tray";
import { formatMinorForMoneyInput, suggestTenderAmounts } from "../../../lib/capture-payment";
import {
  DELIVERY_COLUMN_LABELS,
  canReassign,
  courierInitials,
  groupDeliveriesByState,
  paymentMethodLabel,
  prefillTenderedMinor,
  prefillTipMinor,
  settlesInCaja,
} from "../../../lib/delivery-board";
import { listCouriers, listDeliveries, quoteCashPayment, readBranchTimeZone } from "../../../lib/deliveries";
import { getCashRegisterReport } from "../../../lib/finance";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { CashierSubmitButton } from "../caja/submit-button";
import { CASH_REGISTER_COOKIE, CASH_REGISTER_SESSION_COOKIE, DEVICE_COOKIE } from "../caja/context";
import { FocusRevalidate } from "../focus-revalidate";
import {
  assignDeliveryAction,
  unassignedDeliveriesAction,
  completeDeliveryAction,
  dispatchDeliveryAction,
  failDeliveryAction,
  settleDeliveryAction,
} from "./actions";
import { CourierOrderDetail } from "./courier-order-detail";
import { UnassignedDeliveries } from "./unassigned-deliveries";

export const dynamic = "force-dynamic";

interface DeliveriesPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

// Roles holding `deliveries.manage` + `payments.collect` (mirrors the server RBAC policy; the server decides).
const MANAGER_ROLES = new Set(["owner", "admin", "manager", "supervisor", "cashier"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STATUS_MESSAGES: Readonly<Record<string, string>> = {
  assign: "Repartidor asignado.",
  complete: "Entrega registrada.",
  dispatch: "Salida registrada.",
  fail: "Entrega marcada como no realizada.",
  settled: "Entrega liquidada.",
  settled_prepaid: "Entrega cerrada; la orden ya estaba pagada.",
};
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  conflict: "La entrega cambió mientras trabajabas. Se recargó la lista; revisa y repite.",
  invalid: "No se pudo leer la solicitud. Actualiza e inténtalo de nuevo.",
  invalid_amount: "Revisa los importes: usa números y el recibido debe cubrir saldo y propina.",
  invalid_input: "El servidor rechazó los datos. Actualiza e inténtalo de nuevo.",
  no_register: "No hay una caja abierta en este dispositivo. Ábrela en Caja y vuelve.",
  not_found: "No se encontró la entrega o la orden.",
  reason_required: "Escribe el motivo (máximo 300 caracteres).",
  unauthorized: "Tu rol no permite esta acción.",
  unavailable: "El servicio no respondió. No se registró nada; reintenta.",
};

export default async function DeliveriesPage({ searchParams }: DeliveriesPageProps): Promise<ReactNode> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const cookieStore = await cookies();
  const scope = parseBranchPreference(cookieStore.get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    redirect("/app?branchError=not_authorized");
  }
  const canManage = membership.roles.some((role) => MANAGER_ROLES.has(role));
  const isCourier = !canManage && membership.roles.includes("courier");
  const params = await searchParams;
  const status = scalar(params.status);
  const error = scalar(params.error);
  const settleId = validUuid(scalar(params.settle));
  const failId = validUuid(scalar(params.fail));

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Operación</p>
        <h1 className="break-words font-heading text-[22px] font-bold text-text">Entregas · {membership.branchName}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{isCourier ? "Tus entregas asignadas." : "Asigna, despacha y liquida las entregas a domicilio."}</p>
      </div>
      <a href="/app/deliveries" className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Actualizar</a>
    </div>
  );
  const shell = (children: ReactNode): ReactNode => (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
      <FocusRevalidate />
      {header}
      {status !== undefined && STATUS_MESSAGES[status] !== undefined && (
        <p role="status" className="rounded-xl border border-[oklch(85%_0.06_155)] bg-[oklch(95%_0.04_155)] p-3 text-[13px] font-medium text-[oklch(33%_0.1_155)]">
          {STATUS_MESSAGES[status]}{status === "settled" ? changeText(params) : ""}
        </p>
      )}
      {error !== undefined && ERROR_MESSAGES[error] !== undefined && (
        <p role="alert" className="rounded-xl border border-[oklch(85%_0.06_25)] bg-error-bg p-3 text-[13px] text-[oklch(35%_0.1_25)]">{ERROR_MESSAGES[error]}</p>
      )}
      {children}
    </div>
  );

  if (!canManage && !isCourier) {
    return shell(<Empty title="Sin permiso de entregas" body="Tu rol actual no ve ni mueve entregas en esta sucursal." />);
  }

  const [list, timeZone, couriers] = await Promise.all([
    listDeliveries(session.access_token, env.apiBaseUrl, scope),
    readBranchTimeZone(session.access_token, env.apiBaseUrl, scope),
    canManage ? listCouriers(session.access_token, env.apiBaseUrl, scope) : Promise.resolve(undefined),
  ]);
  if (list.status !== "ok" || timeZone === undefined) {
    return shell(<Empty title="No se pudo cargar la lista" body="El estado no está disponible. No se registró ningún cambio." action={<a href="/app/deliveries" className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-[14px] font-semibold text-white">Reintentar</a>} />);
  }
  const items = list.value.items;
  const columns = groupDeliveriesByState(items);
  const courierList: readonly BranchMemberV1[] = couriers?.status === "ok" ? couriers.value : [];
  const settleItem = canManage && settleId !== undefined ? items.find((entry) => entry.delivery.orderId === settleId && entry.delivery.state === "delivered") : undefined;
  const failItem = failId !== undefined ? items.find((entry) => entry.delivery.orderId === failId && (entry.delivery.state === "assigned" || entry.delivery.state === "en_route")) : undefined;

  return shell(
    <>
      {settleItem !== undefined && (
        <SettleSheet item={settleItem} params={params} scope={scope} session={{
          accessToken: session.access_token, apiBaseUrl: env.apiBaseUrl,
          deviceId: validUuid(cookieStore.get(DEVICE_COOKIE)?.value),
          registerId: validUuid(cookieStore.get(CASH_REGISTER_COOKIE)?.value),
          sessionId: validUuid(cookieStore.get(CASH_REGISTER_SESSION_COOKIE)?.value),
        }} />
      )}
      {failItem !== undefined && <FailSheet item={failItem} />}
      {canManage && couriers?.status !== "ok" && couriers !== undefined && (
        <p role="alert" className="rounded-xl border border-[oklch(85%_0.06_25)] bg-error-bg p-3 text-[13px]">No se pudo leer la lista de repartidores; no podrás asignar hasta actualizar.</p>
      )}
      <div className="grid min-w-0 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {canManage && (
          <UnassignedDeliveries action={unassignedDeliveriesAction} assignAction={assignDeliveryAction} couriers={courierList} scope={scope} />
        )}
        <Column id="assigned" count={columns.assigned.length}>
          {columns.assigned.length === 0 ? <ColumnEmpty /> : columns.assigned.map((item) => (
            <DeliveryCard key={item.delivery.orderId} item={item} timeZone={timeZone} showCourierDetail={isCourier}>
              <TransitionButton action={dispatchDeliveryAction} item={item} idle="Salió" pending="Guardando…" />
              <FailLink orderId={item.delivery.orderId} />
            </DeliveryCard>
          ))}
        </Column>
        <Column id="en_route" count={columns.en_route.length}>
          {columns.en_route.length === 0 ? <ColumnEmpty /> : columns.en_route.map((item) => (
            <DeliveryCard key={item.delivery.orderId} item={item} timeZone={timeZone} showCourierDetail={isCourier}>
              <TransitionButton action={completeDeliveryAction} item={item} idle="Entregada" pending="Guardando…" />
              <FailLink orderId={item.delivery.orderId} />
            </DeliveryCard>
          ))}
        </Column>
        <Column id="to_settle" count={columns.to_settle.length}>
          {columns.to_settle.length === 0 ? <ColumnEmpty /> : columns.to_settle.map((item) => (
            <DeliveryCard key={item.delivery.orderId} item={item} timeZone={timeZone} showCourierDetail={isCourier}>
              {canManage
                ? <a href={`/app/deliveries?settle=${item.delivery.orderId}`} className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-[14px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Liquidar</a>
                : <p className="text-[12px] text-text-muted">Pendiente de liquidar en caja.</p>}
            </DeliveryCard>
          ))}
        </Column>
        <Column id="failed" count={columns.failed.length}>
          {columns.failed.length === 0 ? <ColumnEmpty /> : columns.failed.map((item) => (
            <DeliveryCard key={item.delivery.orderId} item={item} timeZone={timeZone} showCourierDetail={isCourier}>
              {item.delivery.failedReason !== null && <p className="text-[12px] text-text-muted">Motivo: {item.delivery.failedReason}</p>}
              {canManage && canReassign(item, MAX_DELIVERY_ATTEMPTS)
                ? <CourierPicker orderId={item.delivery.orderId} version={item.delivery.version} couriers={courierList} label="Reasignar a" />
                : <p className="text-[12px] text-text-muted">{canManage ? "Sin más intentos: resuélvela desde Órdenes." : "Sin acciones."}</p>}
            </DeliveryCard>
          ))}
        </Column>
      </div>
    </>,
  );
}

function Column({ children, count, id }: { readonly children: ReactNode; readonly count: number; readonly id: keyof typeof DELIVERY_COLUMN_LABELS }): ReactNode {
  return (
    <section aria-labelledby={`col-${id}`} className="grid min-w-0 content-start gap-3 rounded-2xl border border-border bg-bg p-3">
      <h2 id={`col-${id}`} className="flex items-center justify-between gap-2 px-1 font-heading text-[15px] font-semibold">
        {DELIVERY_COLUMN_LABELS[id]}
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-[12px] font-semibold text-text-muted">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function ColumnEmpty(): ReactNode {
  return <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[13px] text-text-muted">Nada por aquí.</p>;
}

function Card({ children, courier, meta, payment, subtitle, title, total }: {
  readonly children: ReactNode;
  readonly courier: string | null;
  readonly meta: string;
  readonly payment: string | null;
  readonly subtitle: string;
  readonly title: string;
  readonly total: string;
}): ReactNode {
  return (
    <article className="grid min-w-0 gap-2 rounded-xl border border-border bg-surface p-3.5 shadow-[0_4px_16px_oklch(20%_0.02_250_/_0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[14px] font-semibold">{title}</p>
          <p className="break-words text-[12px] text-text-muted">{subtitle}</p>
        </div>
        {courier !== null && (
          <span title={courier} aria-label={`Repartidor ${courier}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-white">{courierInitials(courier)}</span>
        )}
      </div>
      <p className="text-[12px] text-text-muted">{meta} · <span className="font-semibold text-text">{total}</span></p>
      {payment !== null && <p className="text-[12px]"><span className="font-semibold">Pagará con:</span> {payment}</p>}
      {children !== null && <div className="mt-1 flex flex-wrap items-center gap-2">{children}</div>}
    </article>
  );
}

function DeliveryCard({ children, item, timeZone, showCourierDetail }: { readonly children: ReactNode; readonly item: BranchDeliveryItemV1; readonly timeZone: string; readonly showCourierDetail: boolean }): ReactNode {
  const promise = item.promiseEnd ?? item.promiseStart;
  const intent = item.paymentIntent;
  return (
    <Card
      title={item.customerLabel ?? "—"}
      subtitle={item.addressLabel ?? "—"}
      meta={promise === null ? "Sin hora prometida" : `Prometida ${formatOrderWorkTime(promise, timeZone)}`}
      total={formatMinorUnits(item.totalMinor, item.currency)}
      payment={item.orderStatus === "paid" ? "Ya pagada" : intent === null ? "Sin definir" : intentText(intent.method, intent.tenderedAmountMinor, item.currency)}
      courier={item.courierLabel ?? "Repartidor"}>
      {item.deliveryInstructions !== null && <p className="w-full break-words text-[12px] text-text-muted">Indicaciones: {item.deliveryInstructions}</p>}
      {showCourierDetail && <CourierOrderDetail orderId={item.delivery.orderId} />}
      {children}
    </Card>
  );
}

function intentText(method: "cash" | "card_manual" | "transfer", tenderedMinor: number | null, currency: string): string {
  return method === "cash" && tenderedMinor !== null && tenderedMinor > 0
    ? `${paymentMethodLabel(method)} · Recibe ${formatMinorUnits(tenderedMinor, currency)}`
    : paymentMethodLabel(method);
}

function CourierPicker({ couriers, label = "Asignar a", orderId, version }: {
  readonly couriers: readonly BranchMemberV1[];
  readonly label?: string;
  readonly orderId: string;
  readonly version: number;
}): ReactNode {
  if (couriers.length === 0) {
    return <p className="text-[12px] text-text-muted">No hay repartidores activos; asigna el rol en Accesos.</p>;
  }
  return (
    <div className="grid w-full gap-1.5">
      <p className="text-[12px] font-semibold text-text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {couriers.map((courier) => {
          const name = courier.displayName ?? `Repartidor ${courier.userId.slice(0, 4)}`;
          return (
            <form key={courier.userId} action={assignDeliveryAction}>
              <AuditFields />
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="expectedVersion" value={version} />
              <input type="hidden" name="courierUserId" value={courier.userId} />
              <PickerButton label={name} />
            </form>
          );
        })}
      </div>
    </div>
  );
}

function PickerButton({ label }: { readonly label: string }): ReactNode {
  return <CashierSubmitButton idle={`${courierInitials(label)} · ${label}`} pending="Guardando…" tone="secondary" />;
}

function TransitionButton({ action, idle, item, pending }: {
  readonly action: (formData: FormData) => Promise<void>;
  readonly idle: string;
  readonly item: BranchDeliveryItemV1;
  readonly pending: string;
}): ReactNode {
  return (
    <form action={action}>
      <AuditFields />
      <input type="hidden" name="orderId" value={item.delivery.orderId} />
      <input type="hidden" name="expectedVersion" value={item.delivery.version} />
      <CashierSubmitButton idle={idle} pending={pending} />
    </form>
  );
}

function FailLink({ orderId }: { readonly orderId: string }): ReactNode {
  return <a href={`/app/deliveries?fail=${orderId}`} className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">No se pudo</a>;
}

function FailSheet({ item }: { readonly item: BranchDeliveryItemV1 }): ReactNode {
  return (
    <section aria-labelledby="fail-title" className="grid gap-3 rounded-2xl border border-[oklch(85%_0.06_25)] bg-surface p-4">
      <h2 id="fail-title" className="font-heading text-[17px] font-semibold">No se pudo entregar · {item.customerLabel ?? "—"}</h2>
      <form action={failDeliveryAction} className="grid gap-3">
        <AuditFields />
        <input type="hidden" name="orderId" value={item.delivery.orderId} />
        <input type="hidden" name="expectedVersion" value={item.delivery.version} />
        <label className="grid gap-1.5 text-[12px] font-semibold">Motivo
          <textarea required name="reason" maxLength={300} rows={3} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
        </label>
        <div className="flex flex-wrap gap-2">
          <CashierSubmitButton idle="Marcar como no entregada" pending="Guardando…" tone="danger" />
          <a href="/app/deliveries" className="inline-flex min-h-12 items-center rounded-xl border border-border bg-surface px-4 text-[14px] font-semibold">Cancelar</a>
        </div>
      </form>
    </section>
  );
}

async function SettleSheet({ item, params, scope, session }: {
  readonly item: BranchDeliveryItemV1;
  readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly scope: BranchScope;
  readonly session: {
    readonly accessToken: string;
    readonly apiBaseUrl: string;
    readonly deviceId: string | undefined;
    readonly registerId: string | undefined;
    readonly sessionId: string | undefined;
  };
}): Promise<ReactNode> {
  const orderId = item.delivery.orderId;
  const prepaid = item.orderStatus === "paid";
  const caja = settlesInCaja(item);
  const heading = <h2 id="settle-title" className="font-heading text-[17px] font-semibold">Liquidar · {item.customerLabel ?? "—"}</h2>;
  if (caja) {
    return (
      <section aria-labelledby="settle-title" className="grid gap-3 rounded-2xl border border-border bg-surface p-4">
        {heading}
        <p className="text-[14px]">Esta entrega se paga con {paymentMethodLabel(item.paymentIntent?.method ?? "card_manual").toLowerCase()}. Cóbrala en Caja.</p>
        <div className="flex flex-wrap gap-2">
          <a href={`/app/caja?orderId=${orderId}`} className="inline-flex min-h-12 items-center rounded-xl bg-accent px-4 text-[14px] font-semibold text-white">Cobrar en Caja</a>
          <a href="/app/deliveries" className="inline-flex min-h-12 items-center rounded-xl border border-border bg-surface px-4 text-[14px] font-semibold">Cerrar</a>
        </div>
      </section>
    );
  }
  const report = session.registerId !== undefined && session.deviceId !== undefined && session.sessionId !== undefined
    ? await getCashRegisterReport(session.accessToken, session.apiBaseUrl, {
      cashRegisterSessionId: session.sessionId, deviceId: session.deviceId, registerId: session.registerId, schemaVersion: 1, scope,
    })
    : undefined;
  const registerOpen = report?.status === "ok" && report.value.register.status === "open";
  if (!registerOpen) {
    return (
      <section aria-labelledby="settle-title" className="grid gap-3 rounded-2xl border border-border bg-surface p-4">
        {heading}
        <p className="text-[14px]">Abre la caja en este dispositivo para liquidar en efectivo.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/app/caja" className="inline-flex min-h-12 items-center rounded-xl bg-accent px-4 text-[14px] font-semibold text-white">Ir a Caja</a>
          <a href="/app/deliveries" className="inline-flex min-h-12 items-center rounded-xl border border-border bg-surface px-4 text-[14px] font-semibold">Cerrar</a>
        </div>
      </section>
    );
  }
  const tenderedParam = minorParam(params.tendered);
  const tipParam = minorParam(params.tip);
  const tenderedMinor = prepaid ? null : (tenderedParam ?? prefillTenderedMinor(item));
  const tipMinor = prepaid ? 0 : (tipParam ?? prefillTipMinor(item));
  let quote: CashPaymentQuoteV1 | undefined;
  if (!prepaid && item.remainingMinor > 0 && session.sessionId !== undefined) {
    const base = {
      amountMinor: item.remainingMinor, cashRegisterSessionId: session.sessionId, method: "cash", orderId,
      schemaVersion: 1, scope, tipMinor,
    };
    quote = await quoteCashPayment(session.accessToken, session.apiBaseUrl, { ...base, tenderedAmountMinor: tenderedMinor });
    if (quote === undefined && tenderedMinor !== null) {
      quote = await quoteCashPayment(session.accessToken, session.apiBaseUrl, { ...base, tenderedAmountMinor: null });
    }
  }
  const effectiveTendered = quote?.tenderedAmountMinor ?? null;
  const quickAmounts = prepaid ? [] : suggestTenderAmounts(item.remainingMinor, item.currency);
  const audit = newAudit();
  return (
    <section aria-labelledby="settle-title" className="grid gap-4 rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.05)]">
      {heading}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-bg p-3 sm:grid-cols-3">
        <Metric label="Total" value={formatMinorUnits(item.totalMinor, item.currency)} />
        <Metric label="Saldo a cobrar" value={formatMinorUnits(item.remainingMinor, item.currency)} emphasis />
        <Metric label="Cambio" value={prepaid ? "—" : quote?.changeMinor === null || quote === undefined ? "Exacto" : formatMinorUnits(quote.changeMinor, item.currency)} />
      </div>
      {prepaid ? (
        <p className="text-[14px]">La orden ya está pagada. Al liquidar sólo se cierra la entrega; no se cobra nada.</p>
      ) : (
        <div className="grid gap-2">
          <p className="text-[12px] font-semibold text-text-muted">Recibido rápido</p>
          <div className="flex flex-wrap gap-2">
            {quickAmounts.map((amount, index) => (
              <a key={amount} href={`/app/deliveries?settle=${orderId}&tendered=${amount}&tip=${tipMinor}`}
                aria-current={effectiveTendered === amount ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${effectiveTendered === amount ? "border-accent bg-accent text-white" : "border-border bg-surface"}`}>
                {index === 0 ? "Exacto" : formatMinorUnits(amount, item.currency)}
              </a>
            ))}
          </div>
        </div>
      )}
      <form action={settleDeliveryAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="eventId" value={audit.eventId} />
        <input type="hidden" name="idempotencyKey" value={audit.idempotencyKey} />
        <input type="hidden" name="occurredAt" value={audit.occurredAt} />
        <input type="hidden" name="paymentId" value={randomUUID()} />
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="expectedVersion" value={item.delivery.version} />
        {!prepaid && (
          <>
            <MoneyField label="Recibido (vacío = exacto)" name="tenderedPesos" required={false} currency={item.currency}
              defaultValue={tenderedMinor === null ? "" : formatMinorForMoneyInput(tenderedMinor, item.currency) ?? ""} />
            <MoneyField label="Propina" name="tipPesos" required={false} currency={item.currency}
              defaultValue={formatMinorForMoneyInput(tipMinor, item.currency) ?? "0"} />
          </>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <CashierSubmitButton idle="Liquidar" pending="Guardando…" />
          <a href="/app/deliveries" className="inline-flex min-h-12 items-center rounded-xl border border-border bg-surface px-4 text-[14px] font-semibold">Cancelar</a>
        </div>
      </form>
    </section>
  );
}

function MoneyField({ currency, defaultValue, label, name, required }: {
  readonly currency: string;
  readonly defaultValue: string;
  readonly label: string;
  readonly name: string;
  readonly required: boolean;
}): ReactNode {
  return (
    <label className="grid gap-1.5 text-[12px] font-semibold">{label}
      <input name={name} type="text" inputMode="decimal" required={required} defaultValue={defaultValue}
        pattern="[0-9]*([.,][0-9]+)?" aria-label={`${label} en ${currency}`}
        className="min-h-12 min-w-0 rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
    </label>
  );
}

function Metric({ emphasis = false, label, value }: { readonly emphasis?: boolean; readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`break-words font-heading ${emphasis ? "text-[20px] font-bold" : "text-[16px] font-semibold"}`}>{value}</p>
    </div>
  );
}

function Empty({ action, body, title }: { readonly action?: ReactNode; readonly body: string; readonly title: string }): ReactNode {
  return (
    <section className="grid gap-2 rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-heading text-[17px] font-semibold">{title}</h2>
      <p className="text-[13px] text-text-muted">{body}</p>
      {action}
    </section>
  );
}

function AuditFields(): ReactNode {
  const audit = newAudit();
  return (
    <>
      <input type="hidden" name="eventId" value={audit.eventId} />
      <input type="hidden" name="idempotencyKey" value={audit.idempotencyKey} />
      <input type="hidden" name="occurredAt" value={audit.occurredAt} />
    </>
  );
}

function newAudit() {
  return Object.freeze({ eventId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: new Date().toISOString() });
}

function changeText(params: Readonly<Record<string, string | readonly string[] | undefined>>): string {
  const change = minorParam(params.change);
  const currency = scalar(params.currency);
  return change !== undefined && currency !== undefined && /^[A-Z]{3}$/u.test(currency)
    ? ` Cambio: ${formatMinorUnits(change, currency)}.` : "";
}

function minorParam(value: string | readonly string[] | undefined): number | undefined {
  return typeof value === "string" && /^\d{1,12}$/u.test(value) ? Number(value) : undefined;
}

function scalar(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validUuid(value: string | undefined): string | undefined {
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}
