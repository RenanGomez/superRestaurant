import { cache } from "react";

import { getServerEnv } from "../env";
import { authorizeBranch } from "./branch-selection";
import { listMemberships } from "./memberships";
import { createServerSupabaseClient } from "./supabase-server";
import { canAccessSystemAdministration } from "./system-onboarding";

/**
 * Per-request memoization for Server Components (layout and page render in the same request).
 * Each helper still asks the same authority as before (Supabase Auth, `/access/memberships`,
 * `/access/branch`); `cache()` only stops one request from asking the same question twice.
 * Server Actions run in their own request and are unaffected.
 */
export const getRequestSupabase = cache(() => createServerSupabaseClient());

export const getRequestUser = cache(async () => {
  const supabase = await getRequestSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export const getRequestSession = cache(async () => {
  const supabase = await getRequestSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session;
});

export const getRequestMemberships = cache((accessToken: string) => listMemberships(accessToken, getServerEnv().apiBaseUrl));

export const getRequestAuthorizedBranch = cache((accessToken: string, restaurantId: string, branchId: string) =>
  authorizeBranch(accessToken, getServerEnv().apiBaseUrl, { branchId, restaurantId }));

export const getRequestSystemAdminAccess = cache((accessToken: string) => canAccessSystemAdministration(accessToken, getServerEnv().apiBaseUrl));
