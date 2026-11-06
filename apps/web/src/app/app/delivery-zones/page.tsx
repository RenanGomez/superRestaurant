import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "../../../env";
import { getMenuCatalog } from "../../../lib/menu-catalog";
import { BRANCH_PREFERENCE_COOKIE, findMembership, parseBranchPreference } from "../../../lib/memberships";
import { getRequestSession, getRequestMemberships, getRequestAuthorizedBranch } from "../../../lib/request-context";
import { deliveryZonesAction } from "./actions";
import { DeliveryZonesEditor } from "./delivery-zones-editor";

export const dynamic = "force-dynamic";

export default async function DeliveryZonesPage() {
  const session = await getRequestSession();
  if (session === null) redirect("/login");
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  const env = getServerEnv();
  const memberships = await getRequestMemberships(session.access_token);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || !membership.roles.some((role) => ["owner", "admin", "manager"].includes(role))
    || await getRequestAuthorizedBranch(session.access_token, scope.restaurantId, scope.branchId) === undefined) redirect("/app?branchError=not_authorized");
  const menu = await getMenuCatalog(session.access_token, env.apiBaseUrl, scope);
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-accent">Domicilio</p>
      <h1 className="font-heading text-2xl font-bold">Zonas de entrega · {membership.restaurantName}</h1>
      <p className="mt-1 text-sm text-text-muted">{membership.branchName} · configuración para esta sucursal</p></header>
    {menu?.catalog === null || menu?.catalog === undefined
      ? <p role="alert" className="rounded-xl border border-border bg-error-bg p-4">No se pudo leer la moneda de la sucursal. Recarga para continuar.</p>
      : <DeliveryZonesEditor scope={scope} currency={menu.catalog.currency} action={deliveryZonesAction} />}
  </div>;
}
