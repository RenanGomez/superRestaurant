const TEST_STATE_SYMBOL = Symbol.for("superRestaurant.web.supabaseSsrTestState");

export interface SupabaseSsrTestCookie {
  readonly name: string;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly value: string;
}

export interface SupabaseSsrTestState {
  readonly calls: {
    getSession: number;
    getUser: number;
    signOut: number;
  };
  readonly refreshCookies?: readonly SupabaseSsrTestCookie[];
  readonly session: Readonly<{ access_token: string }> | null;
  readonly signOutCookies?: readonly SupabaseSsrTestCookie[];
  readonly user: Readonly<{ id: string }> | null;
}

type TestGlobal = typeof globalThis & {
  [TEST_STATE_SYMBOL]?: SupabaseSsrTestState;
};

interface ServerClientOptions {
  readonly cookies: {
    setAll(cookies: readonly SupabaseSsrTestCookie[]): void;
  };
}

export function setSupabaseSsrTestState(state: SupabaseSsrTestState | undefined): void {
  const testGlobal = globalThis as TestGlobal;
  if (state === undefined) delete testGlobal[TEST_STATE_SYMBOL];
  else testGlobal[TEST_STATE_SYMBOL] = state;
}

export function createServerClient(
  _url: string,
  _publishableKey: string,
  options: ServerClientOptions,
) {
  const state = readState();
  return Object.freeze({
    auth: Object.freeze({
      getSession: async () => {
        state.calls.getSession += 1;
        return Object.freeze({ data: Object.freeze({ session: state.session }) });
      },
      getUser: async () => {
        state.calls.getUser += 1;
        if (state.refreshCookies !== undefined) options.cookies.setAll(state.refreshCookies);
        return Object.freeze({ data: Object.freeze({ user: state.user }) });
      },
      signOut: async () => {
        state.calls.signOut += 1;
        if (state.signOutCookies !== undefined) options.cookies.setAll(state.signOutCookies);
        return Object.freeze({ error: null });
      },
    }),
  });
}

function readState(): SupabaseSsrTestState {
  const state = (globalThis as TestGlobal)[TEST_STATE_SYMBOL];
  if (state === undefined) throw new Error("SUPABASE_SSR_TEST_STATE_MISSING");
  return state;
}
