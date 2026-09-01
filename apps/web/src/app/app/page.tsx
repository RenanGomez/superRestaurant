import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { getServerEnv } from "../../env";
import type { BranchMembershipSummaryV1 } from "@super-restaurant/shared-types";
import { BRANCH_PREFERENCE_COOKIE, encodeScope, findMembership, listMemberships, parseBranchPreference } from "../../lib/memberships";
import { createServerSupabaseClient } from "../../lib/supabase-server";
import { selectBranchAction } from "./actions";
import { FocusRevalidate } from "./focus-revalidate";
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
    return (
      <>
        <FocusRevalidate />
        <CurrentBranchView membership={current} />
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

function CurrentBranchView({ membership }: { readonly membership: BranchMembershipSummaryV1 }): ReactNode {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-[380px] flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[oklch(94%_0.01_240)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" aria-hidden="true">
            <path d="M3 9.5 12 3l9 6.5" />
            <path d="M5 10v10h14V10" />
          </svg>
        </div>
        <h1 className="font-heading text-[17px] font-semibold text-text">
          {membership.restaurantName} · {membership.branchName}
        </h1>
        <p className="text-[13px] leading-relaxed text-text-muted">
          Rol{membership.roles.length > 1 ? "es" : ""}: {membership.roles.join(", ")}. La selección de menú, mesas y
          órdenes se habilita en las próximas fases.
        </p>
        <a
          href="/app?change=1"
          className="text-[13px] font-medium text-accent underline-offset-2 hover:underline focus-visible:underline"
        >
          Cambiar sucursal
        </a>
      </div>
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
