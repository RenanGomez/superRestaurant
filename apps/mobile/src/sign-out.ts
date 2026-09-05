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
 * A late notification carrying the session that was just closed is rejected by
 * the reducer, which remembers the closed session until a genuinely new one
 * arrives.
 */
export function endMobileSession({ dispatch, notice, signOut }: {
  readonly dispatch: (event: MobileEvent) => void;
  readonly notice: MobileNotice | undefined;
  readonly signOut: MobileAuthPort["signOut"];
}): void {
  dispatch({ notice, type: "signedOut" });

  try {
    void signOut().catch(() => undefined);
  } catch {
    // A port that throws synchronously is still only the provider's problem.
  }
}
