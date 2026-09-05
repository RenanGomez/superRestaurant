/**
 * Local verification harness — **never part of the distributable app**.
 *
 * It answers the four authorized Nest paths with the same synthetic fixtures the
 * tests use, so the authenticated screens can be inspected in a real browser
 * without credentials, without a server and without touching any remote
 * environment. Metro only resolves this directory when `MOBILE_VISUAL_HARNESS=1`
 * (see `metro.config.js`), so it cannot reach a production bundle.
 *
 * It is not a mock of business rules: the app's real client, real shared parsers
 * and real state machine run unchanged; only the network and the identity
 * provider are replaced by doubles.
 */
import type { MobileAuthPort, MobileSignInResult } from "../src/auth-port.js";
import type { MobileAppStatus, MobileLifecyclePort } from "../src/lifecycle.js";
import { MOBILE_API_PATHS } from "../src/mobile-client.js";
import type { MobileSession } from "../src/session.js";
import {
  FIXTURE_USER_A,
  FIXTURE_USER_B,
  authorizedBranchBody,
  diningLayoutBody,
  membershipListBody,
  menuCatalogStateBody,
  scopeA,
  scopeB,
} from "../src/test-fixtures.js";

export type HarnessScenario =
  | "ok"
  | "revoked"
  | "expired"
  | "empty"
  | "network"
  | "slow"
  | "sessionError"
  | "signOutHang"
  | "signOutBroken";

export const HARNESS_SCENARIOS: readonly { readonly label: string; readonly value: HarnessScenario }[] = Object.freeze([
  { label: "Datos válidos", value: "ok" },
  { label: "Acceso revocado", value: "revoked" },
  { label: "Sesión expirada", value: "expired" },
  { label: "Sin sucursales", value: "empty" },
  { label: "Red caída", value: "network" },
  { label: "Respuesta lenta", value: "slow" },
  { label: "Sesión ilegible", value: "sessionError" },
  { label: "Cierre colgado", value: "signOutHang" },
  { label: "Cierre fallido", value: "signOutBroken" },
]);

/** Mutable control surface driven by the harness UI. */
export interface HarnessControl {
  autoRefreshRuns: number;
  scenario: HarnessScenario;
  tokenSerial: number;
}

export const harnessControl: HarnessControl = { autoRefreshRuns: 0, scenario: "ok", tokenSerial: 1 };

// Exposed for the browser verification only, from harness code that never
// reaches a build: it lets the reviewer read the token-ticker counter directly.
(globalThis as unknown as { __harnessControl?: HarnessControl }).__harnessControl = harnessControl;

/**
 * Two synthetic operators, so a complete A-in/A-out/B-in/B-out cycle can be
 * driven by hand. The access screen picks one by the local part of the email:
 * anything starting with "b" is operator B, everything else operator A. No
 * credential is checked against anything.
 */
const HARNESS_OPERATORS = Object.freeze({
  a: Object.freeze({ email: "operador.a.sintetico@example.invalid", userId: FIXTURE_USER_A }),
  b: Object.freeze({ email: "operador.b.sintetico@example.invalid", userId: FIXTURE_USER_B }),
});

function harnessOperator(email: string): { readonly email: string; readonly userId: string } {
  return email.trim().toLowerCase().startsWith("b") ? HARNESS_OPERATORS.b : HARNESS_OPERATORS.a;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/**
 * Replaces `globalThis.fetch` for the harness bundle only. Requests to anything
 * other than the four authorized paths fail loudly, which also proves the app
 * never calls a path it is not allowed to call.
 */
export function installHarnessFetch(apiBaseUrl: string): void {
  const harnessFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input), apiBaseUrl);
    const path = url.pathname;

    if (harnessControl.scenario === "network") throw new TypeError("HARNESS_NETWORK_DOWN");
    if (harnessControl.scenario === "slow") await delay(1_500);
    if (harnessControl.scenario === "expired") return jsonResponse({ code: "UNAUTHENTICATED" }, 401);

    if (path === MOBILE_API_PATHS.memberships) {
      const scopes = harnessControl.scenario === "empty" || harnessControl.scenario === "revoked"
        ? []
        : [scopeA, scopeB];
      return jsonResponse(membershipListBody(scopes));
    }

    if (harnessControl.scenario === "revoked") return jsonResponse({ code: "SCOPE_AUTHORIZATION_REJECTED" }, 403);

    if (path === MOBILE_API_PATHS.authorizeBranch) {
      const requested = url.searchParams.get("branchId");
      return jsonResponse(authorizedBranchBody(requested === scopeB.branchId ? scopeB : scopeA));
    }

    const scope = url.searchParams.get("branchId") === scopeB.branchId ? scopeB : scopeA;
    if (path === MOBILE_API_PATHS.diningLayout) {
      return jsonResponse(diningLayoutBody(scope, scope === scopeB ? "Salón principal" : "Terraza"));
    }
    if (path === MOBILE_API_PATHS.menuCatalog) {
      return jsonResponse(menuCatalogStateBody(scope, "XTS", scope === scopeB ? 9_900 : 12_500));
    }

    return jsonResponse({ code: "HARNESS_PATH_NOT_ALLOWED", path }, 404);
  };

  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // `POST /access/branch` carries its pair in the body; mirror it into the URL
    // so one handler can answer every authorized path.
    if (typeof init?.body === "string") {
      const parsed: unknown = JSON.parse(init.body);
      const branchId = typeof parsed === "object" && parsed !== null
        ? (parsed as { readonly branchId?: unknown }).branchId
        : undefined;
      if (typeof branchId === "string") {
        const url = new URL(String(input), apiBaseUrl);
        url.searchParams.set("branchId", branchId);
        return harnessFetch(url.toString());
      }
    }
    return harnessFetch(input);
  }) as typeof fetch;
}

type HarnessSessionHandler = (next: MobileSession | undefined) => void;

/**
 * An in-memory identity double. No credential is ever checked against a real
 * service: any password signs in, except the literal `rechazar`, which produces
 * the rejected-credentials state.
 *
 * It behaves worse than a real provider on purpose, in the two ways that break
 * naive session handling:
 *
 * - it keeps **every** session it ever minted, so one from an earlier cycle can
 *   be notified after two or more complete sign-in/sign-out rounds;
 * - it keeps **every** handler it was ever given, released or not, and replays
 *   historical sessions to all of them, so a provider that never lets go can be
 *   reproduced by hand.
 */
export function createHarnessAuth(): MobileAuthPort & {
  readonly emitHistoricalSession: (index: number) => void;
  readonly emitRefreshedToken: () => void;
  readonly expireSession: () => void;
  readonly history: () => readonly MobileSession[];
  readonly operator: () => string;
} {
  let session: MobileSession | undefined;
  // Oldest first; every token this double ever issued. All synthetic.
  const history: MobileSession[] = [];
  const live = new Set<HarnessSessionHandler>();
  const retired = new Set<HarnessSessionHandler>();
  const notify = (): void => { for (const listener of [...live]) listener(session); };

  const mint = (email: string, userId: string): void => {
    harnessControl.tokenSerial += 1;
    session = Object.freeze({ accessToken: `harness-token-${harnessControl.tokenSerial}`, email, userId });
    history.push(session);
    notify();
  };

  return Object.freeze({
    currentSession: (): Promise<MobileSession | undefined> => {
      // Exercises the rejected-port path end to end.
      if (harnessControl.scenario === "sessionError") {
        return Promise.reject(new Error("HARNESS_SESSION_UNREADABLE"));
      }
      return Promise.resolve(harnessControl.scenario === "expired" ? undefined : session);
    },
    /**
     * Replays a session from the history to every handler this double ever
     * received, released or not: the provider notifying late about a session
     * that may be one, two or more cycles old.
     */
    emitHistoricalSession: (index: number): void => {
      const replayed = history[index];
      if (replayed === undefined) return;
      for (const listener of [...live, ...retired]) listener(replayed);
    },
    emitRefreshedToken: (): void => {
      if (session === undefined) return;
      mint(session.email ?? HARNESS_OPERATORS.a.email, session.userId);
    },
    expireSession: (): void => { harnessControl.scenario = "expired"; },
    history: (): readonly MobileSession[] => [...history],
    onSessionChange: (handler: HarnessSessionHandler): (() => void) => {
      live.add(handler);
      return (): void => { live.delete(handler); retired.add(handler); };
    },
    operator: (): string => session?.email ?? "—",
    signIn: (email: string, password: string): Promise<MobileSignInResult> => {
      if (harnessControl.scenario === "network") return Promise.resolve("unavailable");
      if (password === "rechazar") return Promise.resolve("rejected");
      // Every sign-in mints a new token, as Auth does.
      const operator = harnessOperator(email);
      mint(operator.email, operator.userId);
      return Promise.resolve("ok");
    },
    signOut: (): Promise<void> => {
      // The provider hangs: nothing is cleared and nobody is notified.
      if (harnessControl.scenario === "signOutHang") return new Promise<void>(() => undefined);
      if (harnessControl.scenario === "signOutBroken") return Promise.reject(new Error("HARNESS_SIGN_OUT_FAILED"));
      session = undefined;
      notify();
      return Promise.resolve();
    },
    startAutoRefresh: (): Promise<void> => { harnessControl.autoRefreshRuns += 1; return Promise.resolve(); },
    stopAutoRefresh: (): Promise<void> => { harnessControl.autoRefreshRuns -= 1; return Promise.resolve(); },
  });
}

/** A lifecycle source the harness UI drives by hand. */
export function createHarnessLifecycle(): MobileLifecyclePort & {
  readonly emit: (status: MobileAppStatus) => void;
} {
  const listeners = new Set<(status: MobileAppStatus) => void>();
  return Object.freeze({
    emit: (status: MobileAppStatus): void => { for (const listener of listeners) listener(status); },
    subscribe: (handler: (status: MobileAppStatus) => void): (() => void) => {
      listeners.add(handler);
      return (): void => { listeners.delete(handler); };
    },
  });
}
