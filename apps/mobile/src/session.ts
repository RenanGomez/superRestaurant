/**
 * The only session material this client keeps: the immutable Supabase user id,
 * an access token used as a Bearer credential against the Nest API, and the
 * operator's email **for display only**. Refresh tokens are never persisted —
 * see the storage decision recorded in `apps/mobile/BACKEND_REQUESTS.md`.
 *
 * Identity is `userId`. An email can be changed, reassigned or shared across
 * environments, so it must never decide whether a branch, its memberships or
 * its data may survive a session change.
 */
export interface MobileSession {
  readonly accessToken: string;
  /** Presentation only; never an identity check. */
  readonly email: string | undefined;
  /** Supabase `user.id`: the immutable identity of the operator. */
  readonly userId: string;
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

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Narrows a Supabase session to the fields this app uses, fail-closed: a
 * missing, empty, untrimmed or oversized access token, or a user id that is not
 * the UUID Supabase Auth issues, yields `undefined` and is treated as "not
 * signed in" rather than as a usable credential.
 */
export function toMobileSession(value: unknown): MobileSession | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as {
    readonly access_token?: unknown;
    readonly user?: { readonly email?: unknown; readonly id?: unknown } | null;
  };

  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0 || accessToken.length > 8_192
    || accessToken !== accessToken.trim()) return undefined;

  const userId = record.user?.id;
  if (typeof userId !== "string" || !USER_ID_PATTERN.test(userId)) return undefined;

  const email = record.user?.email;
  return Object.freeze({
    accessToken,
    email: typeof email === "string" && email.length > 0 && email.length <= 320 ? email : undefined,
    userId: userId.toLowerCase(),
  });
}

/** True when two sessions belong to the same operator, by immutable id only. */
export function isSameOperator(left: MobileSession, right: MobileSession): boolean {
  return left.userId === right.userId;
}
