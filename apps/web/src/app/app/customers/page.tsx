import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BRANCH_PREFERENCE_COOKIE, findMembership, parseBranchPreference } from "../../../lib/memberships";
import { getRequestSession, getRequestMemberships, getRequestAuthorizedBranch } from "../../../lib/request-context";
import { customerDirectoryAction } from "./actions";
import { customerHistoryAction } from "./history-action";
import { CustomerEditor } from "./customer-editor";

export const dynamic = "force-dynamic";

export default async function CustomersPage(): Promise<ReactNode> {
  const session = await getRequestSession();
  if (session === null) redirect("/login");
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  const memberships = await getRequestMemberships(session.access_token);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await getRequestAuthorizedBranch(session.access_token, scope.restaurantId, scope.branchId) === undefined) redirect("/app?branchError=not_authorized");
  const canOperate = membership.roles.some(role => ["owner", "admin", "manager", "supervisor", "cashier", "waiter"].includes(role));
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-widest text-accent">Directorio operativo</p>
        <h1 className="break-words font-heading text-2xl font-bold">Clientes · {membership.restaurantName}</h1>
        <p className="mt-1 break-words text-sm text-text-muted">Sucursal: {membership.branchName} · Conexión requerida</p></div>
      <Link href="/app?change=1" className="rounded-lg border border-border px-3 py-3 text-sm focus-visible:outline-2">Cambiar sucursal</Link>
    </header>
    {canOperate ? <CustomerEditor key={`${scope.restaurantId}/${scope.branchId}`} scope={scope} branchName={membership.branchName} action={customerDirectoryAction} historyAction={customerHistoryAction} />
      : <p role="alert" className="rounded-xl border border-border bg-surface p-5">Tu rol no permite consultar ni modificar clientes. Solicita acceso al responsable de la sucursal.</p>}
  </div>;
}
