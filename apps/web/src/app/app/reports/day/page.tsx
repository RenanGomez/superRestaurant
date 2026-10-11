import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Field } from "../../../../components/field-hint";
import { getServerEnv } from "../../../../env";
import { authorizeBranch } from "../../../../lib/branch-selection";
import { readBranchTimeZone } from "../../../../lib/deliveries";
import { buildDaySummaryView, isCalendarDate, todayInZone, type DaySummaryRow } from "../../../../lib/day-summary";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../../lib/memberships";
import { readDaySummary } from "../../../../lib/reports";
import { createServerSupabaseClient } from "../../../../lib/supabase-server";
import { selectSummaryDateAction } from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default async function DaySummaryPage({ searchParams }: PageProps): Promise<ReactNode> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    redirect("/app?branchError=not_authorized");
  }
  const params = await searchParams;
  const rawDate = typeof params.date === "string" ? params.date : undefined;
  const invalidDate = params.error === "invalid_date" || (rawDate !== undefined && !isCalendarDate(rawDate));
  const timeZone = await readBranchTimeZone(session.access_token, env.apiBaseUrl, scope);
  const date = rawDate !== undefined && isCalendarDate(rawDate) ? rawDate : timeZone === undefined ? undefined : todayInZone(new Date(), timeZone);

  const shell = (children: ReactNode): ReactNode => (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Reportes</p>
          <h1 className="break-words font-heading text-[22px] font-bold text-text">Resumen del día · {membership.branchName}</h1>
        </div>
        <form action={selectSummaryDateAction} className="flex items-end gap-2">
          <Field id="day-summary-date" className="flex flex-col gap-1 text-[12px] font-semibold text-text-muted" hint="Día del que quieres ver el resumen de ventas, en la zona horaria del restaurante." label="Fecha"><input id="day-summary-date" type="date" name="date" required defaultValue={date ?? ""} className={`min-h-11 rounded-xl border border-border bg-surface px-3 text-[14px] text-text ${FOCUS}`} /></Field>
          <button type="submit" className={`min-h-11 rounded-xl bg-accent px-4 text-[14px] font-semibold text-white ${FOCUS}`}>Ver</button>
        </form>
      </div>
      {invalidDate && <p role="alert" className="rounded-xl border border-border bg-error-bg p-3 text-[13px]">La fecha no es válida. Elige otra.</p>}
      {children}
    </div>
  );
  const message = (title: string, body: string, retry = true): ReactNode => shell(
    <div role="alert" className="rounded-2xl border border-border bg-surface p-6">
      <p className="font-heading text-[16px] font-semibold">{title}</p>
      <p className="mt-1 text-[13px] text-text-muted">{body}</p>
      {retry && <a href={date === undefined ? "/app/reports/day" : `/app/reports/day?date=${date}`} className={`mt-4 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-[14px] font-semibold text-white ${FOCUS}`}>Reintentar</a>}
    </div>,
  );

  if (date === undefined) return message("No se pudo cargar la sucursal", "No se obtuvo la zona horaria. No se registró ningún cambio.");
  const result = await readDaySummary(session.access_token, env.apiBaseUrl, scope, date);
  if (result.status === "unauthorized") return message("Sin permiso de reportes", "Tu rol actual no puede ver el resumen del día en esta sucursal.", false);
  if (result.status !== "ok") return message("No se pudo cargar el resumen", "El servicio no respondió con datos válidos. Reintenta en un momento.");
  const view = buildDaySummaryView(result.value);

  return shell(
    <>
      <p className="text-[13px] text-text-muted">Día {date} · zona {result.value.timeZone}</p>
      {view.empty && <p role="status" className="rounded-xl border border-border bg-surface p-4 text-[14px]">Sin movimientos este día: no hay pagos, turnos ni cancelaciones.</p>}
      <section aria-label="Totales" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view.cards.map((card) => (
          <div key={card.key} className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">{card.label}</p>
            <p className="mt-1 font-heading text-[26px] font-bold text-text">{card.value}</p>
            <p className="mt-1 text-[12px] text-text-muted">{card.detail}</p>
          </div>
        ))}
      </section>
      <SalesTable title="Ventas por canal" first="Canal" rows={view.channels} total={view.salesTotal} />
      <SalesTable title="Ventas por método" first="Método" rows={view.methods} total={view.salesTotal} />
      <section aria-label="Turnos y cajas" className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="font-heading text-[16px] font-semibold">Turnos y cajas</h2>
        {view.shifts.length === 0 ? <p className="mt-2 text-[13px] text-text-muted">No hubo turnos este día.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="text-text-muted"><tr>
                {["Turno", "Caja", "Apertura", "Cierre", "Fondo", "Esperado", "Contado", "Diferencia"].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {view.shifts.map((s) => (
                  <tr key={s.key} className="border-t border-border align-top">
                    <th scope="row" className="py-2 pr-3 font-semibold">{s.shift}</th>
                    <td className="py-2 pr-3">{s.status}{s.movements.length > 0 && <ul className="mt-1 text-[12px] text-text-muted">{s.movements.map((m) => <li key={m}>{m}</li>)}</ul>}</td>
                    <td className="py-2 pr-3">{s.opened}</td><td className="py-2 pr-3">{s.closed}</td>
                    <td className="py-2 pr-3">{s.float}</td><td className="py-2 pr-3">{s.expected}</td>
                    <td className="py-2 pr-3">{s.counted}</td><td className="py-2 pr-3 font-semibold">{s.difference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>,
  );
}

function SalesTable({ title, first, rows, total }: { readonly title: string; readonly first: string; readonly rows: readonly DaySummaryRow[]; readonly total: string }): ReactNode {
  return (
    <section aria-label={title} className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-heading text-[16px] font-semibold">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[360px] text-left text-[13px]">
          <thead className="text-text-muted"><tr>
            <th scope="col" className="py-2 pr-3 font-semibold">{first}</th><th scope="col" className="py-2 pr-3 text-right font-semibold">Pagos</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">Ventas</th><th scope="col" className="py-2 text-right font-semibold">Propinas</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <th scope="row" className="py-2 pr-3 font-medium">{r.label}</th><td className="py-2 pr-3 text-right">{r.count}</td>
                <td className="py-2 pr-3 text-right">{r.amount}</td><td className="py-2 text-right">{r.tip}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold"><th scope="row" className="py-2 pr-3">Total</th><td /><td className="py-2 pr-3 text-right">{total}</td><td /></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
