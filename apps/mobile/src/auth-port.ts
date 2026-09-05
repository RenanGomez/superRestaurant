import type { MobileSession } from "./session.js";

/** Outcome of a sign-in attempt, kept distinct so the UI can explain it. */
export type MobileSignInResult = "ok" | "rejected" | "unavailable";

/**
 * The authentication surface the screens depend on. Keeping it an interface
 * lets the UI stay unaware of the Supabase SDK, and keeps every decision about
 * session storage in one adapter.
 */
export interface MobileAuthPort {
  readonly currentSession: () => Promise<MobileSession | undefined>;
  readonly onSessionChange: (handler: (session: MobileSession | undefined) => void) => () => void;
  readonly signIn: (email: string, password: string) => Promise<MobileSignInResult>;
  readonly signOut: () => Promise<void>;
}
