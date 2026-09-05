import type { MobileSession } from "./session.js";

/** Outcome of a sign-in attempt, kept distinct so the UI can explain it. */
export type MobileSignInResult = "ok" | "rejected" | "unavailable";

/**
 * The authentication surface the screens depend on. Keeping it an interface
 * lets the UI stay unaware of the Supabase SDK, and keeps every decision about
 * session storage and token renewal in one adapter.
 */
export interface MobileAuthPort {
  /** Re-reads the session from the client; `undefined` means "not signed in". */
  readonly currentSession: () => Promise<MobileSession | undefined>;
  readonly onSessionChange: (handler: (session: MobileSession | undefined) => void) => () => void;
  readonly signIn: (email: string, password: string) => Promise<MobileSignInResult>;
  readonly signOut: () => Promise<void>;
  /** Starts the in-memory token ticker; called when the app is in the foreground. */
  readonly startAutoRefresh: () => Promise<void>;
  /** Stops the ticker when the app leaves the foreground. */
  readonly stopAutoRefresh: () => Promise<void>;
}
