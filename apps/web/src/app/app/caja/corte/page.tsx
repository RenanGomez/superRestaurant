import type { ReactNode } from "react";

import type { CashRegisterOperationalReportV1 } from "@super-restaurant/shared-types";

import { Field, CheckField } from "../../../../components/field-hint";
import { formatMinorUnits } from "../../../../lib/branch-order-work-tray";
import { uiButton } from "../../../../lib/ui-classes";
import { closeCashRegisterAction } from "../actions";
import { movementLabel } from "../caja-helpers";
import {
  AuditFields, CajaHeader, EmptyState, ErrorBanner, KNOWN_ERRORS, KNOWN_STATUSES, Metric, MoneyField, SuccessBanner,
  formatDate, formatTime, loadCajaContext, newAudit, scalar, shortId, type SearchParams,
} from "../caja-shared";
import { COBRAR_PATH, CORTE_PATH, corteView, registerState } from "../caja-view";
import { CashierSubmitButton } from "../submit-button";

export const dynamic = "force-dynamic";

export default async function CashCutPage({ searchParams }: { readonly searchParams: SearchParams }): Promise<ReactNode> {
  const context = await loadCajaContext(searchParams);
  const { canOperate, membership, report } = context;
  const error = scalar(context.params.cashError);
  const status = scalar(context.params.cashStatus);
  const register = registerState(report);
  const view = corteView({ canOperate, register });
  const value = report?.status === "ok" ? report.value : undefined;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
      <CajaHeader active="corte" membership={membership} registerStatus={register === "open" || register === "closed" ? register : "none"} />
      {error !== undefined && KNOWN_ERRORS.has(error) && <ErrorBanner code={error} />}
      {status !== undefined && KNOWN_STATUSES.has(status) && <SuccessBanner code={status} />}
      {view === "no_permission" ? (
        <EmptyState title="Sin permiso de caja" body="Tu rol actual no permite abrir, cobrar o cerrar una caja en esta sucursal." />
      ) : view === "unavailable" ? (
        <EmptyState
          title="No se pudo recuperar la caja"
          body="El estado autoritativo no está disponible. No se realizó ningún cobro ni cierre."
          action={<a href={CORTE_PATH} className={uiButton("primary", "inline-flex items-center px-4 text-[14px]")}>Reintentar</a>}
        />
      ) : view === "no_register" || value === undefined ? (
        <EmptyState
          title="No hay una caja abierta"
          body="Abre la caja en Cobrar para empezar el turno; el corte aparece aquí después."
          action={<a href={COBRAR_PATH} className={uiButton("primary", "inline-flex items-center px-4 text-[14px]")}>Ir a Cobrar</a>}
        />
      ) : view === "closed" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <OperationalReport report={value} title="Corte Z · caja cerrada" />
          <section className="self-start rounded-2xl border border-border bg-surface p-5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Siguiente turno</p>
            <h2 className="mt-1 font-heading text-[18px] font-semibold">Abrir una caja nueva</h2>
            <p className="mt-2 text-[13px] text-text-muted">El cierre anterior permanece disponible en esta vista. Una nueva apertura tendrá otra sesión y otro turno.</p>
            <a href={COBRAR_PATH} className={`mt-5 ${uiButton("primary", "inline-flex items-center px-4 text-[14px]")}`}>Abrir caja en Cobrar</a>
          </section>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <OperationalReport report={value} title="Corte X · vista operativa" />
          <CloseRegisterPanel report={value} />
        </div>
      )}
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
        <MoneyField hint="Efectivo que realmente hay en la caja al cerrar. El sistema lo compara con el esperado y guarda la diferencia." label="Efectivo contado" name="countedClosingBalancePesos" currency={report.register.currency} defaultValue="" />
        <Field id="close-reason" className="grid gap-1.5 text-[12px] font-semibold text-text" hint="Si el efectivo contado no coincide con el esperado, explica por qué (faltante, sobrante, error de cambio). Queda en la auditoría." label="Motivo de diferencia, si aplica"><textarea id="close-reason" name="reason" maxLength={500} rows={3} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" /></Field>
        <CheckField id="close-confirm" className="flex items-center gap-3 rounded-xl border border-[oklch(85%_0.06_25)] bg-error-bg px-3 text-[13px]" labelClassName="flex min-h-11 flex-1 items-center py-2" hint="El cierre queda registrado y no se puede deshacer; revisa el efectivo contado antes de confirmar." label="Este cierre es definitivo. Confirmo el efectivo contado."><input id="close-confirm" required type="checkbox" name="confirmClose" value="yes" className="h-5 w-5 shrink-0" /></CheckField>
        <CashierSubmitButton idle="Cerrar caja" pending="Guardando cierre…" tone="danger" />
      </form>
    </aside>
  );
}

function OperationalReport({ report, title }: { readonly report: CashRegisterOperationalReportV1; readonly title: string }): ReactNode {
  const register = report.register;
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_30px_oklch(20%_0.02_250_/_0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">Resumen no fiscal</p><h2 className="mt-1 font-heading text-[18px] font-semibold">{title}</h2></div><a href={CORTE_PATH} className={uiButton("secondary", "inline-flex items-center px-3 text-[13px]")}>Actualizar</a></div>
      <p className="mt-2 text-[12px] text-text-muted">Lectura autoritativa del turno. No cierra la caja ni genera folio, impresión o efecto fiscal.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Fondo inicial" value={formatMinorUnits(register.openingFloatMinor, register.currency)} />
        <Metric label="Ventas en efectivo" value={formatMinorUnits(report.cashCapturedMinor, register.currency)} />
        <Metric label="Tarjeta externa" value={formatMinorUnits(report.cardManualCapturedMinor, register.currency)} />
        <Metric label="Transferencias" value={formatMinorUnits(report.transferCapturedMinor, register.currency)} />
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
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-heading text-base font-semibold">Movimientos de efectivo</h3><span className="text-xs text-text-muted">{report.movementCount} en el turno</span></div>
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
