import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { getServerEnv } from "../../env";
import type { BranchMembershipSummaryV1, DiningLayoutV1 } from "@super-restaurant/shared-types";
import { BRANCH_PREFERENCE_COOKIE, encodeScope, findMembership, listMemberships, parseBranchPreference } from "../../lib/memberships";
import { createServerSupabaseClient } from "../../lib/supabase-server";
import { getDiningLayout } from "../../lib/dining-layout";
import { selectBranchAction } from "./actions";
import { FocusRevalidate } from "./focus-revalidate";
import { DiningZone } from "./dining-zone";
import { SelectBranchSubmitButton } from "./select-branch-submit-button";

export const dynamic = "force-dynamic";

const KNOWN_BRANCH_ERRORS = new Set(["invalid_selection", "not_authorized"]);

interface AppHomePageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | ReadonlyArray<string> | undefined>>>;
}

/**
 * FE-0.1: selects (or confirms) the authorized Restaurant/Branch context.
 * Every render re-fetches `GET /api/v1/access/memberships` — the sole source
 * of truth (frontend.md task 1) — so this also serves as the "revalidar al
 * abrir sesión ... o recuperar foco" check (task 3): opening this page, or
 * `<FocusRevalidate>` calling `router.refresh()` on focus regain, both
 * re-run this exact logic. The persisted preference cookie is read here but
 * never trusted on its own — it only says which pair to *try* to match
 * against the fresh list.
 */
export default async function AppHomePage({ searchParams }: AppHomePageProps): Promise<ReactNode> {
  const resolvedSearchParams = await searchParams;
  const rawBranchError = resolvedSearchParams.branchError;
  const branchError = typeof rawBranchError === "string" && KNOWN_BRANCH_ERRORS.has(rawBranchError) ? rawBranchError : undefined;
  const forceChange = resolvedSearchParams.change === "1";

  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) {
    redirect("/login");
  }

  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);

  if (memberships === undefined) {
    return <NoticeState title="No se pudo verificar tu acceso" body="No fue posible confirmar tus sucursales autorizadas en este momento. Vuelve a intentarlo en unos segundos." />;
  }

  if (memberships.memberships.length === 0) {
    return (
      <NoticeState
        title="Sin sucursales asignadas"
        body="Tu cuenta no tiene ninguna membresía activa en este momento. Contacta a un administrador de tu restaurante."
      />
    );
  }

  const cookieStore = await cookies();
  const preference = parseBranchPreference(cookieStore.get(BRANCH_PREFERENCE_COOKIE)?.value);
  const current = preference === undefined ? undefined : findMembership(memberships.memberships, preference);
  const wasRevoked = preference !== undefined && current === undefined;

  if (current !== undefined && !forceChange) {
    if (resolvedSearchParams.edit !== "1") redirect("/app/tables");
    if (!current.roles.some((role) => role === "owner" || role === "admin" || role === "manager")) redirect("/app/tables");
    return (
      <>
        <FocusRevalidate />
        <CurrentBranchView
          membership={current}
          layout={await getDiningLayout(session.access_token, env.apiBaseUrl, current.scope)}
          layoutError={typeof resolvedSearchParams.layoutError === "string" ? resolvedSearchParams.layoutError : undefined}
          layoutStatus={typeof resolvedSearchParams.layoutStatus === "string" ? resolvedSearchParams.layoutStatus : undefined}
        />
      </>
    );
  }

  return (
    <>
      <FocusRevalidate />
      <BranchSelector memberships={memberships.memberships} revoked={wasRevoked} errorCode={branchError} />
    </>
  );
}

function CurrentBranchView({ membership, layout, layoutError, layoutStatus }: {
  readonly membership: BranchMembershipSummaryV1;
  readonly layout: DiningLayoutV1 | undefined;
  readonly layoutError: string | undefined;
  readonly layoutStatus: string | undefined;
}): ReactNode {
  const canManage = membership.roles.some((role) => role === "owner" || role === "admin" || role === "manager");
  if (layout === undefined) return <NoticeState title="No se pudo cargar el plano" body="La configuración de mesas no está disponible en este momento. Vuelve a intentarlo." />;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-5 lg:p-8">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Mesas y layout</p>
          <h1 className="break-words font-heading text-[22px] font-bold text-text">{membership.restaurantName} · {membership.branchName}</h1>
          <p className="mt-1 text-[13px] text-text-muted">Plano en cuadrícula de 24 columnas. Los cambios se validan y versionan en el servidor.</p>
        </div>
        <div className="flex gap-2"><a href="/app/tables" className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium">Volver a mesas</a><a href="/app?change=1" className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium">Cambiar sucursal</a></div>
      </div>
      {layoutError !== undefined && <NoticeBanner text={layoutError === "update_failed" ? "No se guardó el cambio. El plano pudo cambiar en otro dispositivo; recarga e inténtalo de nuevo." : "No se pudo crear la mesa. Revisa los datos y que el nombre sea único."} />}
      {layoutStatus !== undefined && <div role="status" className="rounded-[10px] border border-[oklch(84%_0.08_155)] bg-[oklch(96%_0.03_155)] px-3.5 py-2.5 text-[13px] text-[oklch(38%_0.1_155)]">{layoutStatus === "table_created" ? "Mesa creada." : "Layout guardado."}</div>}
      {layout.zones.length === 0 ? (
        <NoticeState title="Aún no hay zonas" body="Crea primero una zona del restaurante para poder agregar y acomodar mesas." />
      ) : layout.zones.map((zone) => <DiningZone key={zone.zoneId} zone={zone} canManage={canManage} />)}
    </div>
  );
}

function NoticeState({ title, body }: { readonly title: string; readonly body: string }): ReactNode {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-[380px] flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-error-bg">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-error" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="font-heading text-[16px] font-semibold text-text">{title}</h1>
        <p className="text-[13px] leading-relaxed text-text-muted">{body}</p>
      </div>
    </div>
  );
}

function BranchSelector({
  memberships,
  revoked,
  errorCode,
}: {
  readonly memberships: readonly BranchMembershipSummaryV1[];
  readonly revoked: boolean;
  readonly errorCode: string | undefined;
}): ReactNode {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <form action={selectBranchAction} className="flex w-full max-w-[440px] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-[20px] font-bold text-text">Elige tu sucursal</h1>
          <p className="text-[13px] text-text-muted">Solo se muestran las sucursales donde tienes una membresía activa.</p>
        </div>

        <div aria-live="polite" className="flex flex-col gap-2.5">
          {revoked && (
            <NoticeBanner text="Tu acceso a la sucursal seleccionada anteriormente ya no está activo. Elige una disponible." />
          )}
          {errorCode === "not_authorized" && (
            <NoticeBanner text="No se pudo confirmar esa sucursal con el servidor. Elige una opción de la lista." />
          )}
          {errorCode === "invalid_selection" && (
            <NoticeBanner text="Selección inválida. Elige una de las sucursales disponibles." />
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Sucursales disponibles</legend>
          {memberships.map((membership, index) => (
            <label
              key={encodeScope(membership.scope)}
              className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-surface p-3.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:checked]:border-accent"
            >
              <input
                type="radio"
                name="scope"
                value={encodeScope(membership.scope)}
                defaultChecked={index === 0}
                className="mt-1"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-text">
                  {membership.restaurantName} · {membership.branchName}
                </span>
                <span className="text-[12px] text-text-muted">{membership.roles.join(", ")}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <SelectBranchSubmitButton />
      </form>
    </div>
  );
}

function NoticeBanner({ text }: { readonly text: string }): ReactNode {
  return (
    <div role="alert" className="rounded-[10px] border border-[oklch(85%_0.06_25)] bg-error-bg px-3.5 py-2.5 text-[13px] text-[oklch(35%_0.1_25)]">
      {text}
    </div>
  );
}
