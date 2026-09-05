/**
 * The only session material this client keeps: an access token used as a
 * Bearer credential against the Nest API, plus the operator's email for
 * display. Refresh tokens are never persisted — see the storage decision
 * recorded in `apps/mobile/BACKEND_REQUESTS.md`.
 */
export interface MobileSession {
  readonly accessToken: string;
  readonly email: string | undefined;
}

/**
 * Supabase client options for this slice.
 *
 * `persistSession: false` and the absence of a `storage` adapter keep the whole
 * session — access **and** refresh token — in process memory: nothing is written
 * to the device, and closing the app ends the session. That is the storage
 * decision still pending in `BACKEND_REQUESTS.md` (SR-MOB-001).
 *
 * `autoRefreshToken: true` is a different concern: while the app is open and in
 * the foreground, the in-memory session renews itself instead of expiring in the
 * middle of a shift. On React Native the ticker must be driven by the app
 * lifecycle, so the adapter calls `startAutoRefresh`/`stopAutoRefresh` (see
 * `src/supabase-auth.ts`).
 */
export const MOBILE_AUTH_OPTIONS = Object.freeze({
  auth: Object.freeze({
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: false,
  }),
});

/** Sign-out stays local to this device; sessions elsewhere are untouched. */
export const MOBILE_SIGN_OUT_SCOPE = "local" as const;

/**
 * Narrows a Supabase session to the fields this app uses, fail-closed: a
 * missing, empty, untrimmed or oversized access token yields `undefined` and
 * is treated as "not signed in" rather than as a usable credential.
 */
export function toMobileSession(value: unknown): MobileSession | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { readonly access_token?: unknown; readonly user?: { readonly email?: unknown } | null };
  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0 || accessToken.length > 8_192
    || accessToken !== accessToken.trim()) return undefined;
  const email = record.user?.email;
  return Object.freeze({
    accessToken,
    email: typeof email === "string" && email.length > 0 && email.length <= 320 ? email : undefined,
  });
}
