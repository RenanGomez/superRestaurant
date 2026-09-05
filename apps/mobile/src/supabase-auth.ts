import { createClient } from "@supabase/supabase-js";

import type { MobileAuthPort, MobileSignInResult } from "./auth-port.js";
import type { MobileConfig } from "./config.js";
import { MOBILE_AUTH_OPTIONS, MOBILE_SIGN_OUT_SCOPE, toMobileSession } from "./session.js";

/**
 * The single place that talks to Supabase Auth, with the publishable key only.
 *
 * The session is held in memory (see `MOBILE_AUTH_OPTIONS`): this slice does not
 * choose a device storage adapter, so no token is ever written to disk. Token
 * renewal is driven by the app lifecycle: `@supabase/supabase-js` 2.112.4
 * exposes `auth.startAutoRefresh()`/`auth.stopAutoRefresh()` for exactly this
 * React Native case, and this adapter is the only caller.
 *
 * Nothing here logs a token: failures are reduced to a coarse outcome before
 * they reach the UI.
 */
export function createMobileAuth(config: MobileConfig): MobileAuthPort {
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, MOBILE_AUTH_OPTIONS);

  return Object.freeze({
    currentSession: async (): Promise<ReturnType<typeof toMobileSession>> => {
      const { data } = await client.auth.getSession();
      return toMobileSession(data.session);
    },
    onSessionChange: (handler: (session: ReturnType<typeof toMobileSession>) => void): (() => void) => {
      const { data } = client.auth.onAuthStateChange((_event, session) => { handler(toMobileSession(session)); });
      return (): void => { data.subscription.unsubscribe(); };
    },
    signIn: async (email: string, password: string): Promise<MobileSignInResult> => {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error === null) return "ok";
      // Only an explicit refusal by Auth counts as wrong credentials; anything
      // else (offline, 5xx, unknown) is reported as a service failure.
      return error.status === 400 || error.status === 401 || error.status === 403 ? "rejected" : "unavailable";
    },
    signOut: async (): Promise<void> => { await client.auth.signOut({ scope: MOBILE_SIGN_OUT_SCOPE }); },
    startAutoRefresh: async (): Promise<void> => { await client.auth.startAutoRefresh(); },
    stopAutoRefresh: async (): Promise<void> => { await client.auth.stopAutoRefresh(); },
  });
}
