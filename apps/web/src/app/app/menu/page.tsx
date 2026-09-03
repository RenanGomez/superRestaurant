import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { getMenuCatalog } from "../../../lib/menu-catalog";
import {
  BRANCH_PREFERENCE_COOKIE,
  findMembership,
  listMemberships,
  parseBranchPreference,
} from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { MenuCatalogEditor } from "./menu-catalog-editor";

export const dynamic = "force-dynamic";

interface MenuPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

export default async function MenuPage({ searchParams }: MenuPageProps): Promise<ReactNode> {
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

  const state = await getMenuCatalog(session.access_token, env.apiBaseUrl, scope);
  const resolvedSearchParams = await searchParams;
  const canManage = membership.roles.some((role) => role === "owner" || role === "admin" || role === "manager");

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Catálogo</p>
          <h1 className="break-words font-heading text-[22px] font-bold text-text">Menú · {membership.restaurantName}</h1>
          <p className="mt-1 break-words text-[13px] text-text-muted">
            Consulta desde {membership.branchName}. Cada publicación conserva una versión histórica inmutable.
          </p>
        </div>
        <a href="/app?change=1" className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium">
          Cambiar sucursal
        </a>
      </div>

      {typeof resolvedSearchParams.menuError === "string" && (
        <div role="alert" className="rounded-[10px] border border-[oklch(85%_0.06_25)] bg-error-bg px-3.5 py-2.5 text-[13px] text-[oklch(35%_0.1_25)]">
          {resolvedSearchParams.menuError === "invalid_draft"
            ? "El borrador contiene datos inválidos. Revisa categorías, productos, precios y modificadores."
            : "No se pudo publicar. El catálogo pudo cambiar en otro dispositivo; recarga y vuelve a intentarlo."}
        </div>
      )}
      {resolvedSearchParams.menuStatus === "published" && (
        <div role="status" className="rounded-[10px] border border-[oklch(84%_0.08_155)] bg-[oklch(96%_0.03_155)] px-3.5 py-2.5 text-[13px] text-[oklch(38%_0.1_155)]">
          Menú publicado correctamente.
        </div>
      )}
      {state === undefined ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <h2 className="font-heading text-[16px] font-semibold">No se pudo cargar el menú</h2>
          <p className="mt-2 text-[13px] text-text-muted">Vuelve a intentarlo en unos segundos.</p>
        </div>
      ) : (
        <MenuCatalogEditor canManage={canManage} state={state} />
      )}
    </div>
  );
}
