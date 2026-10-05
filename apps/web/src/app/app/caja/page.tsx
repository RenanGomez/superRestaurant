import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import type {
  BranchMembershipSummaryV1,
  BranchScope,
  CashRegisterOperationalReportV1,
  CheckoutOrderSummaryV1,
} from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { formatMinorUnits, requestBranchOrderWorkTray, type BranchOrderTrayRequestResult } from "../../../lib/branch-order-work-tray";
import { currencyFractionDigits } from "../../../lib/money-scale";
import { getCashRegisterReport, getCheckoutOrder, type FinancialApiResult } from "../../../lib/finance";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import {
  closeCashRegisterAction,
  openCashRegisterAction,
} from "./actions";
import { CASH_REGISTER_COOKIE, CASH_REGISTER_SESSION_COOKIE, DEVICE_COOKIE } from "./context";
import { movementLabel } from "./caja-helpers";
import { PaymentPanel } from "./payment-panel";
import { PayableOrders } from "./payable-orders";
import { CashierSubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

interface CashRegisterPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const FINANCIAL_ROLES = new Set(["owner", "admin", "manager", "supervisor", "cashier"]);
const KNOWN_ERRORS = new Set([
  "conflict", "context_invalid", "close_not_confirmed", "invalid_amount", "invalid_input", "mixed_currency", "not_found", "reason_required", "unauthorized", "unavailable", "unsupported_currency",
]);
const KNOWN_STATUSES = new Set(["opened", "payment_collected", "closed"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export default async function CashRegisterPage({ searchParams }: CashRegisterPageProps): Promise<ReactNode> {
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
  const params = await searchParams;
  const error = scalar(params.cashError);
  const status = scalar(params.cashStatus);
  const orderId = validUuid(scalar(params.orderId));
  const canOperate = membership.roles.some((role) => FINANCIAL_ROLES.has(role));
  const registerId = validUuid(cookieStore.get(CASH_REGISTER_COOKIE)?.value);
  const deviceId = validUuid(cookieStore.get(DEVICE_COOKIE)?.value);
  const sessionId = validUuid(cookieStore.get(CASH_REGISTER_SESSION_COOKIE)?.value);
  const report = canOperate && registerId !== undefined && deviceId !== undefined
    ? await getCashRegisterReport(session.access_token, env.apiBaseUrl, {
      cashRegisterSessionId: sessionId ?? null,
      deviceId,
      registerId,
      schemaVersion: 1,
      scope,
    })
    : undefined;
  const checkout = report?.status === "ok" && report.value.register.status === "open" && orderId !== undefined
    ? await getCheckoutOrder(session.access_token, env.apiBaseUrl, {
      cashRegisterSessionId: report.value.register.cashRegisterSessionId,
      deviceId,
      orderId,
      registerId,
      schemaVersion: 1,
      scope,
    })
    : undefined;
  const tray = report?.status === "ok" && report.value.register.status === "open"
    ? await requestBranchOrderWorkTray(session.access_token, env.apiBaseUrl, scope, null, 25)
    : undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
      <PageHeader membership={membership} report={report} />
      {error !== undefined && KNOWN_ERRORS.has(error) && <ErrorBanner code={error} />}
      {status !== undefined && KNOWN_STATUSES.has(status) && <SuccessBanner code={status} />}
      {!canOperate ? (
        <EmptyState title="Sin permiso de caja" body="Tu rol actual no permite abrir, cobrar o cerrar una caja en esta sucursal." />
      ) : report === undefined || report.status === "not_found" ? (
        <OpenRegisterPanel />
      ) : report.status !== "ok" ? (
        <EmptyState
          title="No se pudo recuperar la caja"
          body="El estado autoritativo no está disponible. No se realizó ningún cobro ni cierre."
          action={<a href="/app/caja" className="min-h-11 rounded-xl bg-accent px-4 py-3 text-[14px] font-semibold text-white">Reintentar</a>}
        />
      ) : report.value.register.status === "closed" ? (
        <ClosedRegisterView report={report.value} />
      ) : (
        <OpenRegisterView checkout={checkout} orderId={orderId} report={report.value} scope={scope} tray={tray} />
      )}
    </div>
  );
}

function PageHeader({ membership, report }: {
  readonly membership: BranchMembershipSummaryV1;
  readonly report: FinancialApiResult<CashRegisterOperationalReportV1> | undefined;
}): ReactNode {
  const register = report?.status === "ok" ? report.value.register : undefined;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Operación financiera</p>
        <h1 className="break-words font-heading text-[22px] font-bold text-text">Caja · {membership.branchName}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{membership.restaurantName} · Importes en pesos.</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${register?.status === "open" ? "bg-[oklch(94%_0.04_155)] text-[oklch(38%_0.1_155)]" : "bg-bg text-text-muted"}`}>
          {register?.status === "open" ? "Caja abierta" : register?.status === "closed" ? "Caja cerrada" : "Sin caja"}
        </span>
        <a href="/app?change=1" className="min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium">Cambiar sucursal</a>
      </div>
    </div>
  );
}

function OpenRegisterPanel(): ReactNode {
  const audit = newAudit();
  return (
    <section className="mx-auto grid w-full max-w-3xl gap-5 rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.05)] sm:p-6">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Inicio de turno</p>
        <h2 className="mt-1 font-heading text-[18px] font-semibold">Abrir caja en este dispositivo</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-muted">Cuenta el fondo con el que inicia el turno.</p>
      </div>
      <form action={openCashRegisterAction} className="grid gap-4 sm:grid-cols-2">
        <AuditFields audit={audit} />
        <input type="hidden" name="cashRegisterSessionId" value={randomUUID()} />
        <input type="hidden" name="shiftId" value={randomUUID()} />
        <MoneyField label="Fondo inicial" name="openingFloatPesos" defaultValue="0" />
        <div className="sm:col-span-2"><CashierSubmitButton idle="Abrir caja" pending="Guardando apertura…" /></div>
      </form>
    </section>
  );
}

function OpenRegisterView({ checkout, orderId, report, scope, tray }: {
  readonly checkout: FinancialApiResult<CheckoutOrderSummaryV1> | undefined;
  readonly orderId: string | undefined;
  readonly report: CashRegisterOperationalReportV1;
  readonly scope: BranchScope;
  readonly tray: BranchOrderTrayRequestResult | undefined;
}): ReactNode {
  const register = report.register;
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <div className="grid min-w-0 gap-5">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Cobro</p><h2 className="mt-1 font-heading text-[18px] font-semibold">Cargar cuenta</h2></div>
            <span className="rounded-lg bg-bg px-3 py-2 font-mono text-[11px] text-text-muted">Caja {shortId(register.cashRegisterSessionId)}</span>
          </div>
          <PayableOrders scope={scope} initial={tray} selectedOrderId={orderId} />
          {orderId === undefined ? (
            <p className="mt-4 rounded-xl bg-bg p-4 text-[13px] text-text-muted">Elige una orden abierta o parcialmente pagada para cargar su cuenta.</p>
          ) : checkout?.status !== "ok" ? (
            <div role="alert" className="mt-4 rounded-xl border border-[oklch(85%_0.06_25)] bg-error-bg p-4 text-[13px] text-[oklch(35%_0.1_25)]">No se pudo cargar esa cuenta. Elige otra orden o actualiza; no se registró ningún pago.</div>
          ) : <PaymentPanel key={`${checkout.value.orderId}:${checkout.value.orderVersion}`} checkout={checkout.value} audit={{ ...newAudit(), paymentId: randomUUID() }} />}
        </section>
        <OperationalReport report={report} title="Corte X · vista operativa" />
      </div>
      <CloseRegisterPanel report={report} />
    </div>
  );
}

function CloseRegisterPanel({ report }: { readonly report: CashRegisterOperationalReportV1 }): ReactNode {
  const audit = newAudit();
  return (
    <aside className="self-start rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.04)] xl:sticky xl:top-5">
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-error">Corte Z · cierre operativo</p>
      <h2 className="mt-1 font-heading text-[18px] font-semibold">Cerrar caja</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-text-muted">El cierre congela esperado, contado y diferencia. No es un comprobante fiscal.</p>
      <div className="my-4 rounded-xl bg-bg p-4"><Metric label="Efectivo esperado" value={formatMinorUnits(report.register.expectedCashBalanceMinor, report.register.currency)} emphasis /></div>
      <form action={closeCashRegisterAction} className="grid gap-4">
        <AuditFields audit={audit} />
        <input type="hidden" name="cashRegisterSessionId" value={report.register.cashRegisterSessionId} />
        <MoneyField label="Efectivo contado" name="countedClosingBalancePesos" currency={report.register.currency} defaultValue="" />
        <label className="grid gap-1.5 text-[12px] font-semibold text-text">Motivo de diferencia, si aplica<textarea name="reason" maxLength={500} rows={3} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" /></label>
        <label className="flex min-h-11 items-start gap-3 rounded-xl border border-[oklch(85%_0.06_25)] bg-error-bg p-3 text-[13px]"><input required type="checkbox" name="confirmClose" value="yes" className="mt-1 h-4 w-4" /><span>Este cierre es definitivo. Confirmo el efectivo contado.</span></label>
        <CashierSubmitButton idle="Cerrar caja" pending="Guardando cierre…" tone="danger" />
      </form>
    </aside>
  );
}

function ClosedRegisterView({ report }: { readonly report: CashRegisterOperationalReportV1 }): ReactNode {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <OperationalReport report={report} title="Corte Z · caja cerrada" />
      <section className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Siguiente turno</p>
        <h2 className="mt-1 font-heading text-[18px] font-semibold">Abrir una caja nueva</h2>
        <p className="mt-2 text-[13px] text-text-muted">El cierre anterior permanece disponible en esta vista. Una nueva apertura tendrá otra sesión y otro turno.</p>
        <div className="mt-5"><OpenRegisterPanel /></div>
      </section>
    </div>
  );
}

function OperationalReport({ report, title }: { readonly report: CashRegisterOperationalReportV1; readonly title: string }): ReactNode {
  const register = report.register;
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Resumen no fiscal</p><h2 className="mt-1 font-heading text-[18px] font-semibold">{title}</h2></div><a href="/app/caja" className="min-h-10 rounded-lg border border-border px-3 py-2 text-[13px] font-medium">Actualizar</a></div>
      <p className="mt-2 text-[12px] text-text-muted">Lectura autoritativa del turno. No cierra la caja ni genera folio, impresión o efecto fiscal.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Fondo inicial" value={formatMinorUnits(register.openingFloatMinor, register.currency)} />
        <Metric label="Ventas en efectivo" value={formatMinorUnits(report.cashCapturedMinor, register.currency)} />
        <Metric label="Tarjeta externa" value={formatMinorUnits(report.cardManualCapturedMinor, register.currency)} />
        <Metric label="Transferencias" value="No disponible" />
        <Metric label="Propinas" value={formatMinorUnits(report.tipsMinor, register.currency)} />
        <Metric label="Cobros" value={String(report.paymentCount)} />
        <Metric label="Efectivo esperado" value={formatMinorUnits(register.expectedCashBalanceMinor, register.currency)} emphasis />
      </div>
      <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-[12px] text-text-muted sm:grid-cols-2">
        <div><dt className="inline font-semibold text-text">Apertura: </dt><dd className="inline">{formatDate(register.openedAt)}</dd></div>
        <div><dt className="inline font-semibold text-text">Fondo: </dt><dd className="inline">{formatMinorUnits(register.openingFloatMinor, register.currency)}</dd></div>
        {register.closedAt !== null && <div><dt className="inline font-semibold text-text">Cierre: </dt><dd className="inline">{formatDate(register.closedAt)}</dd></div>}
        {register.countedClosingBalanceMinor !== null && <div><dt className="inline font-semibold text-text">Contado: </dt><dd className="inline">{formatMinorUnits(register.countedClosingBalanceMinor, register.currency)}</dd></div>}
        {register.differenceMinor !== null && <div><dt className="inline font-semibold text-text">Diferencia: </dt><dd className="inline">{formatMinorUnits(register.differenceMinor, register.currency)}</dd></div>}
      </dl>
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-heading text-base font-semibold">Movimientos</h3><span className="text-xs text-text-muted">{report.movementCount} en el turno</span></div>
        {report.movements.length === 0 ? <p className="mt-3 text-sm text-text-muted">Todavía no hay movimientos de efectivo.</p> : <ul className="mt-3 grid gap-2">
          {report.movements.map((movement) => <li key={movement.movementId} className="flex min-w-0 items-start justify-between gap-3 rounded-xl bg-bg p-3 text-sm">
            <div className="min-w-0"><p className="font-semibold">{movementLabel(movement.type)}</p><p className="text-xs text-text-muted">{formatTime(movement.occurredAt)}{movement.sourcePaymentId !== null ? ` · Cobro ${shortId(movement.sourcePaymentId)}` : ""}</p></div>
            <span className="shrink-0 font-semibold">{movement.direction === "in" ? "+" : "−"}{formatMinorUnits(movement.amountMinor, register.currency)}</span>
          </li>)}
        </ul>}
        {report.movementCount > report.movements.length && <p className="mt-2 text-xs text-text-muted">Se muestran los {report.movements.length} movimientos más recientes.</p>}
      </div>
    </section>
  );
}

function MoneyField({ currency, defaultValue, label, name, positive = false }: {
  readonly currency?: string;
  readonly defaultValue: string;
  readonly label: string;
  readonly name: string;
  readonly positive?: boolean;
}): ReactNode {
  const digits = currency === undefined ? 2 : currencyFractionDigits(currency);
  const decimals = digits === 0 ? "sin decimales" : digits === null ? "Moneda no admitida; avisa al administrador." : `máximo ${digits} decimales`;
  const basePattern = digits === 0 ? "[0-9]+" : digits === null ? "(?!)" : `[0-9]+([.,][0-9]{1,${digits}})?`;
  const zeroPattern = digits === 0 ? "(?!0+$)" : `(?!0+(?:[.,]0{1,${digits ?? 2}})?$)`;
  const pattern = positive ? `${zeroPattern}${basePattern}` : basePattern;
  return <label className="grid gap-1.5 text-[12px] font-semibold text-text">{label}
    <input required disabled={digits === null} name={name} type="text" inputMode="decimal" pattern={pattern} defaultValue={defaultValue} aria-describedby={`${name}-hint`} className="min-h-12 min-w-0 rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
    <span id={`${name}-hint`} className="text-[11px] font-normal text-text-muted">{currency === undefined
      ? "Por ejemplo 130; si la moneda admite centavos, también 130.50."
      : digits === null ? decimals : `Por ejemplo 130${digits === 0 ? "" : " o 130.50"}; ${decimals}.`}</span>
  </label>;
}

function Metric({ emphasis = false, label, value }: { readonly emphasis?: boolean; readonly label: string; readonly value: string }): ReactNode {
  return <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p><p className={`mt-1 break-words font-heading text-[15px] ${emphasis ? "text-accent" : "text-text"}`}>{value}</p></div>;
}

function EmptyState({ action, body, title }: { readonly action?: ReactNode; readonly body: string; readonly title: string }): ReactNode {
  return <div className="flex flex-1 items-center justify-center p-4"><div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center"><h2 className="font-heading text-[18px] font-semibold">{title}</h2><p className="text-[13px] leading-relaxed text-text-muted">{body}</p>{action}</div></div>;
}

function ErrorBanner({ code }: { readonly code: string }): ReactNode {
  const message = code === "conflict" ? "El estado cambió en otro intento. Actualiza y vuelve a intentarlo; no se duplicó la operación."
    : code === "close_not_confirmed" ? "Confirma explícitamente el cierre antes de continuar."
    : code === "reason_required" ? "Si el efectivo contado difiere del esperado, escribe el motivo antes de cerrar."
      : code === "unauthorized" ? "Tu autorización para esta caja ya no está vigente."
        : code === "mixed_currency" ? "Hay cuentas abiertas en más de una moneda; avisa al administrador."
          : code === "unsupported_currency" ? "La moneda de las cuentas no está admitida; avisa al administrador."
          : code === "invalid_amount" ? "Escribe un importe válido; revisa los decimales de la moneda."
          : code === "invalid_input" ? "Hay datos inválidos o incompletos. Revisa importes y evidencia externa."
          : code === "context_invalid" ? "Este dispositivo perdió el contexto de caja. Actualiza para recuperarlo."
            : "No se completó la operación. Actualiza el estado y vuelve a intentarlo.";
  return <div role="alert" className="rounded-[10px] border border-[oklch(85%_0.06_25)] bg-error-bg px-3.5 py-2.5 text-[13px] text-[oklch(35%_0.1_25)]">{message}</div>;
}

function SuccessBanner({ code }: { readonly code: string }): ReactNode {
  const message = code === "opened" ? "Caja abierta y lista para cobrar." : code === "closed" ? "Caja cerrada. El corte operativo quedó congelado." : "Cobro registrado sin duplicados.";
  return <div role="status" className="rounded-[10px] border border-[oklch(84%_0.08_155)] bg-[oklch(96%_0.03_155)] px-3.5 py-2.5 text-[13px] text-[oklch(38%_0.1_155)]">{message}</div>;
}

function AuditFields({ audit }: { readonly audit: ReturnType<typeof newAudit> }): ReactNode {
  return <><input type="hidden" name="eventId" value={audit.eventId} /><input type="hidden" name="idempotencyKey" value={audit.idempotencyKey} /><input type="hidden" name="occurredAt" value={audit.occurredAt} /></>;
}

function newAudit() {
  return Object.freeze({ eventId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: new Date().toISOString() });
}

function scalar(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validUuid(value: string | undefined): string | undefined {
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function shortId(value: string): string {
  return value.slice(0, 8).toUpperCase();
}
