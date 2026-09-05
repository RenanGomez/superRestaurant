import type { MobileAuthPort } from "./auth-port.js";
import type { AuthorizedMobileBranch, MobileBranchScope } from "./mobile-client.js";
import { toMobileFailure, type MobileFailure } from "./mobile-state.js";
import type { MobileSession } from "./session.js";

/**
 * Result of one foreground revalidation. There is no "unknown" outcome on
 * purpose: every path — including a session port that rejects — ends in an
 * explicit state, so no screen can stay loading or revalidating forever.
 */
export type MobileRevalidationOutcome =
  | { readonly branch: AuthorizedMobileBranch | undefined; readonly kind: "confirmed"; readonly session: MobileSession }
  | { readonly failure: MobileFailure; readonly kind: "failed"; readonly session: MobileSession }
  | { readonly kind: "sessionLost" };

/**
 * Reads the session at start-up. A port that rejects is treated exactly like an
 * absent session: the app shows sign-in instead of waiting forever.
 */
export async function readInitialSession(
  currentSession: MobileAuthPort["currentSession"],
): Promise<MobileSession | undefined> {
  try {
    return await currentSession();
  } catch {
    return undefined;
  }
}

/**
 * Revalidates the session and, when a branch is active, its exact
 * Restaurant/Branch pair.
 *
 * Fail-closed: if the session cannot be read — absent **or** rejected — the
 * outcome is `sessionLost` and the branch is never revalidated, so a device
 * that cannot prove who it is never keeps branch access.
 */
export async function revalidateAccess({ authorizeScope, currentSession, scope }: {
  /** Receives the freshly read session, so the request never uses a stale token. */
  readonly authorizeScope: (session: MobileSession, scope: MobileBranchScope) => Promise<AuthorizedMobileBranch>;
  readonly currentSession: MobileAuthPort["currentSession"];
  readonly scope: MobileBranchScope | undefined;
}): Promise<MobileRevalidationOutcome> {
  let session: MobileSession | undefined;
  try {
    session = await currentSession();
  } catch {
    return Object.freeze({ kind: "sessionLost" });
  }
  if (session === undefined) return Object.freeze({ kind: "sessionLost" });

  if (scope === undefined) return Object.freeze({ branch: undefined, kind: "confirmed", session });

  try {
    const branch = await authorizeScope(session, scope);
    return Object.freeze({ branch, kind: "confirmed", session });
  } catch (error: unknown) {
    return Object.freeze({ failure: toMobileFailure(error), kind: "failed", session });
  }
}
