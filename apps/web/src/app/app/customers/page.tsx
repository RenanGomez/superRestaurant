import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { customerDirectoryAction } from "./actions";
import { CustomerEditor } from "./customer-editor";

export const dynamic = "force-dynamic";

export default async function CustomersPage(): Promise<ReactNode> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) redirect("/app?branchError=not_authorized");
  const canOperate = membership.roles.some(role => ["owner", "admin", "manager", "supervisor", "cashier", "waiter"].includes(role));
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Directorio operativo</p>
        <h1 className="font-heading text-2xl font-bold">Clientes · {membership.restaurantName}</h1>
        <p className="mt-1 text-sm text-text-muted">Sucursal: {membership.branchName} · Conexión requerida</p></div>
      <a href="/app?change=1" className="rounded-lg border border-border px-3 py-3 text-sm focus-visible:outline-2">Cambiar sucursal</a>
    </header>
    {canOperate ? <CustomerEditor key={`${scope.restaurantId}/${scope.branchId}`} scope={scope} action={customerDirectoryAction} />
      : <p role="alert" className="rounded-xl border border-border bg-surface p-5">Tu rol no permite consultar ni modificar clientes. Solicita acceso al responsable de la sucursal.</p>}
  </div>;
}
