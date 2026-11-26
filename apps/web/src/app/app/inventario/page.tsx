import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DEFAULT_INVENTORY_TAB, parseInventoryTab } from "../../../lib/inventory-ui";
import {
  BRANCH_PREFERENCE_COOKIE,
  findMembership,
  parseBranchPreference,
} from "../../../lib/memberships";
import { getRequestAuthorizedBranch, getRequestMemberships, getRequestSession } from "../../../lib/request-context";
import { inventoryAction } from "./actions";
import { InventoryWorkspace } from "./inventory-workspace";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = new Set(["owner", "admin", "manager"]);

interface InventoryPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

export default async function InventoryPage({ searchParams }: InventoryPageProps): Promise<ReactNode> {
  const session = await getRequestSession();
  if (session === null) redirect("/login");

  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");

  const memberships = await getRequestMemberships(session.access_token);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined
    || await getRequestAuthorizedBranch(session.access_token, scope.restaurantId, scope.branchId) === undefined) {
    redirect("/app?branchError=not_authorized");
  }

  const params = await searchParams;
  const tabParam = typeof params.tab === "string" ? params.tab : undefined;
  const initialTab = parseInventoryTab(tabParam) ?? DEFAULT_INVENTORY_TAB;
  const canManage = membership.roles.some((role) => MANAGE_ROLES.has(role));

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Operación</p>
        <h1 className="break-words font-heading text-2xl font-bold">Inventario · {membership.restaurantName}</h1>
        <p className="mt-1 break-words text-sm text-text-muted">
          {membership.branchName} · insumos y almacenes de esta sucursal
        </p>
      </header>
      <InventoryWorkspace action={inventoryAction} canManage={canManage} initialTab={initialTab} />
    </div>
  );
}
