"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getServerEnv } from "../../env";
import { authorizeBranch } from "../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, encodeBranchPreference, findMembership, listMemberships, parseEncodedScope } from "../../lib/memberships";
import { createServerSupabaseClient } from "../../lib/supabase-server";

/** Local, immediate logout — reversible via re-login, so no confirmation dialog. */
export async function logoutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/**
 * Selects one Restaurant/Branch pair (frontend.md FE-0.1 task 2). Redirect
 * destinations are the two fixed constants below plus an allowlisted query
 * error code — never a caller-supplied path.
 *
 * Three independent checks gate a selection before the non-authoritative
 * preference cookie is written, so neither a tampered form value nor a
 * membership list that has gone stale since the page rendered can smuggle
 * an unauthorized pair through:
 *  1. the submitted value must parse as two UUIDs (`parseEncodedScope`);
 *  2. that pair must still appear in a *freshly fetched* membership list;
 *  3. `POST /api/v1/access/branch` must itself authorize it in Nest.
 */
export async function selectBranchAction(formData: FormData): Promise<void> {
  const raw = formData.get("scope");
  const scope = typeof raw === "string" ? parseEncodedScope(raw) : undefined;
  if (scope === undefined) {
    redirect("/app?branchError=invalid_selection");
  }

  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) {
    redirect("/login");
  }

  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined) {
    redirect("/app?branchError=not_authorized");
  }

  const authorized = await authorizeBranch(session.access_token, env.apiBaseUrl, scope);
  if (authorized === undefined) {
    redirect("/app?branchError=not_authorized");
  }

  const cookieStore = await cookies();
  cookieStore.set(
    BRANCH_PREFERENCE_COOKIE,
    encodeBranchPreference({ branchId: authorized.branchId, restaurantId: authorized.restaurantId }),
    {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: env.cookiesSecure,
    },
  );

  redirect("/app");
}
