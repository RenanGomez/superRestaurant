import type { MobileAuthPort, MobileSignInResult } from "./auth-port.js";
import type { MobileSession } from "./session.js";

/**
 * The authentication gate: one explicit **generation** of authentication per
 * process, and the only thing that decides which provider events this device is
 * still willing to believe.
 *
 * The problem it solves is that a session ends here, locally and immediately,
 * while the identity provider keeps talking: a token renewal already in flight,
 * a `getSession()` read issued before the close, a listener the provider never
 * released. Any of those can arrive after the operator is gone, and none of
 * them may bring that operator back.
 *
 * The rules are deliberately about *when*, never about *what*:
 *
 * - a generation is opened only by an intentional `signIn()`;
 * - a generation is closed by `signOut()` — **before** the provider is asked,
 *   so a call that hangs, rejects or throws cannot keep the gate open — and by
 *   `closeGeneration()`, which the app calls when the provider reports that the
 *   session it was holding has ended;
 * - while the gate is closed, no session is delivered, whoever it belongs to;
 * - every subscription and every `currentSession()` read is bound to the
 *   generation it was created in, so an answer or a notification that belongs
 *   to an earlier one is dropped instead of being reinterpreted as current.
 *
 * Nothing about a closed session is remembered: no token, no hash, no identity.
 * The gate knows only that the generation moved on, which is why it keeps
 * working after any number of sign-in/sign-out cycles and still lets the
 * operator in place renew a token inside the generation that is open.
 */
export interface MobileAuthGate extends MobileAuthPort {
  /**
   * Closes the current generation without asking the provider anything. Used
   * when the provider itself reports the end of the session this device held.
   * Idempotent: closing an already closed generation changes nothing.
   */
  readonly closeGeneration: () => void;
  /** The generation currently open or closed; read by tests and the harness. */
  readonly generation: () => number;
}

/** Wraps an authentication port so every observation passes through the gate. */
export function gateMobileAuth(port: MobileAuthPort): MobileAuthGate {
  // The process starts willing to believe the provider: there is nothing to
  // protect yet, and a start-up session read is legitimate.
  let generation = 0;
  let open = true;
  let release: (() => void) | undefined;
  const observers = new Set<(session: MobileSession | undefined) => void>();

  function deliver(session: MobileSession | undefined): void {
    // A copy: an observer may subscribe or unsubscribe while being notified.
    for (const observer of [...observers]) observer(session);
  }

  function attach(): void {
    const bound = generation;
    release = port.onSessionChange((session) => {
      // A provider that keeps calling a handler it was told to forget is
      // speaking for a generation this process already left behind.
      if (bound !== generation) return;
      // A closed gate believes no session at all. The end of a session is
      // always believed: closing is never the dangerous direction.
      if (session !== undefined && !open) return;
      deliver(session);
    });
  }

  function detach(): void {
    const current = release;
    release = undefined;
    try {
      current?.();
    } catch {
      // A provider that cannot release a listener is still gated: the handler
      // it keeps is bound to a generation that is no longer current.
    }
  }

  function turn(next: boolean): void {
    generation += 1;
    open = next;
    // Re-subscribing is what binds the provider's listener to the new
    // generation, and what releases the one that belonged to the old.
    if (release === undefined) return;
    detach();
    attach();
  }

  return Object.freeze({
    closeGeneration: (): void => {
      if (open) turn(false);
    },
    currentSession: async (): Promise<MobileSession | undefined> => {
      const bound = generation;
      const session = await port.currentSession();
      // A read that started in an earlier generation answers about a session
      // this device no longer has: "not signed in" is the only honest answer.
      return bound === generation && open ? session : undefined;
    },
    generation: (): number => generation,
    onSessionChange: (handler: (session: MobileSession | undefined) => void): (() => void) => {
      observers.add(handler);
      if (release === undefined) attach();
      return (): void => {
        observers.delete(handler);
        if (observers.size === 0) detach();
      };
    },
    signIn: (email: string, password: string): Promise<MobileSignInResult> => {
      // The only intentional way back in, and the only thing that opens a gate.
      turn(true);
      const bound = generation;
      const closeUnused = (): void => {
        // Only if nothing else moved the generation in the meantime.
        if (bound === generation) turn(false);
      };

      let attempt: Promise<MobileSignInResult>;
      try {
        attempt = port.signIn(email, password);
      } catch (error: unknown) {
        closeUnused();
        throw error;
      }

      return attempt.then(
        (result: MobileSignInResult): MobileSignInResult => {
          // A sign-in that did not happen must not leave a gate open behind it.
          if (result !== "ok") closeUnused();
          return result;
        },
        (error: unknown): never => {
          closeUnused();
          throw error;
        },
      );
    },
    signOut: (): Promise<void> => {
      // Closed first, asked second: the gate never waits for the provider, and
      // a hanging, rejecting or synchronously throwing call reaches the caller
      // exactly as the provider produced it.
      if (open) turn(false);
      return port.signOut();
    },
    startAutoRefresh: (): Promise<void> => port.startAutoRefresh(),
    stopAutoRefresh: (): Promise<void> => port.stopAutoRefresh(),
  });
}
