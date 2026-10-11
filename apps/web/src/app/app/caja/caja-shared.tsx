import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import type {
  BranchMembershipSummaryV1,
  BranchScope,
  CashRegisterOperationalReportV1,
} from "@super-restaurant/shared-types";

import { Field } from "../../../components/field-hint";
import { getServerEnv, type WebServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { getCashRegisterReport, type FinancialApiResult } from "../../../lib/finance";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { currencyFractionDigits } from "../../../lib/money-scale";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { uiButton } from "../../../lib/ui-classes";
import { COBRAR_PATH, CORTE_PATH } from "./caja-view";
import { CASH_REGISTER_COOKIE, CASH_REGISTER_SESSION_COOKIE, DEVICE_COOKIE } from "./context";

/** Roles allowed to collect and cut; the API revalidates every request. */
const FINANCIAL_ROLES = new Set(["owner", "admin", "manager", "supervisor", "cashier"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const KNOWN_ERRORS = new Set([
  "conflict", "context_invalid", "close_not_confirmed", "invalid_amount", "invalid_input", "mixed_currency", "not_found", "reason_required", "unauthorized", "unavailable", "unsupported_currency",
]);
export const KNOWN_STATUSES = new Set(["opened", "payment_collected", "closed"]);

export type SearchParams = Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;

export interface CajaContext {
  readonly accessToken: string;
  readonly userId: string;
  readonly env: WebServerEnv;
  readonly scope: BranchScope;
  readonly membership: BranchMembershipSummaryV1;
  readonly canOperate: boolean;
  readonly registerId: string | undefined;
  readonly deviceId: string | undefined;
  readonly cookieStore: Awaited<ReturnType<typeof cookies>>;
  readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly report: FinancialApiResult<CashRegisterOperationalReportV1> | undefined;
}

/** Session, branch authorization and the authoritative register report shared by Cobrar and Corte. */
export async function loadCajaContext(searchParams: SearchParams): Promise<CajaContext> {
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
  return { accessToken: session.access_token, canOperate, cookieStore, deviceId, env, membership, params, registerId, report, scope, userId: session.user.id };
}

export function CajaHeader({ active, membership, registerStatus }: {
  readonly active: "cobrar" | "corte";
  readonly membership: BranchMembershipSummaryV1;
  readonly registerStatus: "open" | "closed" | "none";
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Operación financiera</p>
          <h1 className="break-words font-heading text-[22px] font-bold text-text">Caja · {membership.branchName}</h1>
          <p className="mt-1 text-[13px] text-text-muted">{membership.restaurantName} · Importes en pesos.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${registerStatus === "open" ? "bg-[oklch(94%_0.04_155)] text-[oklch(38%_0.1_155)]" : "bg-bg text-text-muted"}`}>
            {registerStatus === "open" ? "Caja abierta" : registerStatus === "closed" ? "Caja cerrada" : "Sin caja"}
          </span>
          <a href="/app?change=1" className={uiButton("secondary", "inline-flex items-center px-3 text-[13px]")}>Cambiar sucursal</a>
        </div>
      </div>
      <nav aria-label="Secciones de caja" className="flex flex-wrap gap-2">
        <a href={COBRAR_PATH} aria-current={active === "cobrar" ? "page" : undefined} className={uiButton(active === "cobrar" ? "selected" : "secondary", "inline-flex items-center rounded-full px-4 text-[13px]")}>Cobrar</a>
        <a href={CORTE_PATH} aria-current={active === "corte" ? "page" : undefined} className={uiButton(active === "corte" ? "selected" : "secondary", "inline-flex items-center rounded-full px-4 text-[13px]")}>{active === "cobrar" ? "Ver corte de caja" : "Corte de caja"}</a>
      </nav>
    </div>
  );
}

export function MoneyField({ currency, defaultValue, hint, label, name, positive = false }: {
  readonly hint: string;
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
  return <div className="grid gap-1.5 text-[12px] font-semibold text-text"><Field id={`${name}-input`} className="grid gap-1.5" hint={hint} label={label}><input id={`${name}-input`} required disabled={digits === null} name={name} type="text" inputMode="decimal" pattern={pattern} defaultValue={defaultValue} aria-describedby={`${name}-hint`} className="min-h-12 min-w-0 rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" /></Field>
    <span id={`${name}-hint`} className="text-[11px] font-normal text-text-muted">{currency === undefined
      ? "Por ejemplo 130; si la moneda admite centavos, también 130.50."
      : digits === null ? decimals : `Por ejemplo 130${digits === 0 ? "" : " o 130.50"}; ${decimals}.`}</span>
  </div>;
}

export function Metric({ emphasis = false, label, value }: { readonly emphasis?: boolean; readonly label: string; readonly value: string }): ReactNode {
  return <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p><p className={`mt-1 break-words font-heading text-[15px] ${emphasis ? "text-accent" : "text-text"}`}>{value}</p></div>;
}

export function EmptyState({ action, body, title }: { readonly action?: ReactNode; readonly body: string; readonly title: string }): ReactNode {
  return <div className="flex flex-1 items-center justify-center p-4"><div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center"><h2 className="font-heading text-[18px] font-semibold">{title}</h2><p className="text-[13px] leading-relaxed text-text-muted">{body}</p>{action}</div></div>;
}

export function ErrorBanner({ code }: { readonly code: string }): ReactNode {
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

export function SuccessBanner({ code }: { readonly code: string }): ReactNode {
  const message = code === "opened" ? "Caja abierta y lista para cobrar." : code === "closed" ? "Caja cerrada. El corte operativo quedó congelado." : "Cobro registrado sin duplicados.";
  return <div role="status" className="rounded-[10px] border border-[oklch(84%_0.08_155)] bg-[oklch(96%_0.03_155)] px-3.5 py-2.5 text-[13px] text-[oklch(38%_0.1_155)]">{message}</div>;
}

export function AuditFields({ audit }: { readonly audit: ReturnType<typeof newAudit> }): ReactNode {
  return <><input type="hidden" name="eventId" value={audit.eventId} /><input type="hidden" name="idempotencyKey" value={audit.idempotencyKey} /><input type="hidden" name="occurredAt" value={audit.occurredAt} /></>;
}

export function newAudit() {
  return Object.freeze({ eventId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: new Date().toISOString() });
}

export function scalar(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function validUuid(value: string | undefined): string | undefined {
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function shortId(value: string): string {
  return value.slice(0, 8).toUpperCase();
}
