import type { MobileAuthPort } from "./auth-port.js";
import type { MobileEvent, MobileNotice } from "./mobile-state.js";

/**
 * Ends the session on this device.
 *
 * The local state is cleared **first and synchronously**: the session only ever
 * lived in this process, so nothing depends on the provider agreeing. Telling
 * Supabase to drop its own copy is best effort — a call that never settles or
 * that rejects can neither block the screen nor bring the operator back.
 *
 * A late notification carrying a closed session is rejected by the
 * authentication gate through its generation boundary; the reducer does not
 * retain the token, identity or any derived credential.
 *
 * `releaseLocalData` is the offline store's sign-out hook: it closes the push
 * gate synchronously and then purges read caches or locks pending evidence
 * (ADR-005 §5). It is best effort here for the same reason `signOut` is: a
 * storage failure must never keep the operator on a signed-in screen. The gate
 * closing is what stops new pushes; the purge is what protects confidentiality.
 */
export function endMobileSession({ dispatch, notice, signOut, releaseLocalData }: {
  readonly dispatch: (event: MobileEvent) => void;
  readonly notice: MobileNotice | undefined;
  readonly signOut: MobileAuthPort["signOut"];
  readonly releaseLocalData?: () => Promise<void>;
}): void {
  dispatch({ notice, type: "signedOut" });

  if (releaseLocalData !== undefined) {
    try {
      void releaseLocalData().catch(() => undefined);
    } catch {
      // A hook that throws synchronously is still only the store's problem.
    }
  }

  try {
    void signOut().catch(() => undefined);
  } catch {
    // A port that throws synchronously is still only the provider's problem.
  }
}
