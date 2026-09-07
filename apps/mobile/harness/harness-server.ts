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
import {
  createMobileDeviceIdentity,
  type MobileDeviceIdentity,
  type MobileSecureStorePort,
} from "../src/device-identity.js";
import type { MobileAppStatus, MobileLifecyclePort } from "../src/lifecycle.js";
import { MOBILE_API_PATHS, type MobileBranchScope } from "../src/mobile-client.js";
import type { OrderDraftFailure } from "../src/order-draft.js";
import type { OrderDeliveryPlanV1 } from "../src/order-plan.js";
import type { OrderDeliveryPort } from "../src/order-submission.js";
import type { MobileSession } from "../src/session.js";
import {
  FIXTURE_USER_A,
  FIXTURE_USER_B,
  branchOperationalContextBody,
  membershipListBody,
  operationalShiftListBody,
  orderEntryCatalogStateBody,
  orderEntryLayoutBody,
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

/**
 * What the draft integration double answers. `notConnected` is what the app
 * really ships with; the others exist so every state the composer can show is
 * reachable by hand in a browser. `hang` and `throws` are the two badly
 * behaved integrations: one never settles, the other fails before returning a
 * promise at all. Both must leave the screen usable.
 */
export type HarnessDraftOutcome =
  /** The real create/add/open sequence, against the synthetic Order server below. */
  | "synthetic"
  | "notConnected"
  | "accepted"
  | "conflict"
  | "authorization"
  | "network"
  | "protocol"
  | "unavailable"
  | "slowAccepted"
  | "hang"
  | "throws";

export const HARNESS_DRAFT_OUTCOMES: readonly { readonly label: string; readonly value: HarnessDraftOutcome }[] =
  Object.freeze([
    { label: "Envío: servidor sintético (secuencia real)", value: "synthetic" },
    { label: "Envío: sin conexión de integración", value: "notConnected" },
    { label: "Envío: aceptado", value: "accepted" },
    { label: "Envío: aceptado (lento)", value: "slowAccepted" },
    { label: "Envío: conflicto", value: "conflict" },
    { label: "Envío: sin autorización", value: "authorization" },
    { label: "Envío: red caída", value: "network" },
    { label: "Envío: protocolo inválido", value: "protocol" },
    { label: "Envío: servicio no disponible", value: "unavailable" },
    { label: "Envío: promesa colgada", value: "hang" },
    { label: "Envío: falla síncrona", value: "throws" },
  ]);

/** Mutable control surface driven by the harness UI. */
export interface HarnessControl {
  autoRefreshRuns: number;
  /** Simulates a keystore that is not there, so the `deviceId` cannot be read. */
  deviceStore: "available" | "corrupt" | "unavailable";
  draftOutcome: HarnessDraftOutcome;
  /** Makes the next Order mutation answer 409, to reach the conflict state. */
  orderConflict: boolean;
  scenario: HarnessScenario;
  tokenSerial: number;
}

export const harnessControl: HarnessControl = {
  autoRefreshRuns: 0,
  deviceStore: "available",
  draftOutcome: "synthetic",
  orderConflict: false,
  scenario: "ok",
  tokenSerial: 1,
};

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
  const harnessFetch = async (input: RequestInfo | URL, body: unknown): Promise<Response> => {
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

    if (path === MOBILE_API_PATHS.branchContext) {
      const requested = url.searchParams.get("branchId");
      return jsonResponse(branchOperationalContextBody(requested === scopeB.branchId ? scopeB : scopeA));
    }

    const scope = url.searchParams.get("branchId") === scopeB.branchId ? scopeB : scopeA;
    if (path === MOBILE_API_PATHS.operationalShifts) {
      return jsonResponse(operationalShiftListBody(scope));
    }
    if (path === MOBILE_API_PATHS.diningLayout) {
      return jsonResponse(orderEntryLayoutBody(scope, scope === scopeB ? "Salón principal" : "Terraza"));
    }
    if (path === MOBILE_API_PATHS.menuCatalog) {
      return jsonResponse(orderEntryCatalogStateBody(scope, "XTS", scope === scopeB ? 9_900 : 12_500));
    }
    if (path === MOBILE_API_PATHS.activeTableOrders) {
      return jsonResponse(harnessOrders.listActive(scope, url.searchParams.get("tableId") ?? ""));
    }
    if (path === MOBILE_API_PATHS.createOrder) return harnessOrders.create(body);
    if (path === MOBILE_API_PATHS.addOrderItem) return harnessOrders.addItem(body);
    if (path === MOBILE_API_PATHS.openOrder) return harnessOrders.open(body);

    return jsonResponse({ code: "HARNESS_PATH_NOT_ALLOWED", path }, 404);
  };

  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let body: unknown;
    if (typeof init?.body === "string") {
      body = JSON.parse(init.body);
      // `POST /access/branch` and `/access/branch/context` carry their pair in
      // the body; mirror it into the URL so one handler answers every path.
      const branchId = typeof body === "object" && body !== null
        ? (body as { readonly branchId?: unknown }).branchId
        : undefined;
      if (typeof branchId === "string") {
        const url = new URL(String(input), apiBaseUrl);
        url.searchParams.set("branchId", branchId);
        return harnessFetch(url.toString(), body);
      }
    }
    return harnessFetch(input, body);
  }) as typeof fetch;
}

/**
 * A synthetic Order server: enough state to answer the three mutations the way
 * Nest does, so the *real* create/add/open sequence — including a replay and a
 * resume — can be driven by hand in a browser without a server.
 *
 * It keeps the two rules that shape the client's retry: `create` is idempotent
 * by `idempotencyKey`, and `addItem`/`open` require the exact `expectedVersion`
 * and answer 409 otherwise.
 */
interface HarnessOrder {
  items: { orderItemId: string; productId: string; quantity: number }[];
  orderId: string;
  shiftId: string | null;
  status: "draft" | "open";
  tableId: string;
  version: number;
}

const harnessOrders = createHarnessOrderServer();

function createHarnessOrderServer(): {
  readonly addItem: (body: unknown) => Response;
  readonly create: (body: unknown) => Response;
  readonly listActive: (scope: MobileBranchScope, tableId: string) => unknown;
  readonly open: (body: unknown) => Response;
  readonly reset: () => void;
  readonly summary: () => readonly string[];
} {
  const orders = new Map<string, HarnessOrder>();
  const applied = new Map<string, { orderId: string; version: number }>();

  const record = (body: unknown, key: string): string | undefined => {
    const value = field(body, key);
    return typeof value === "string" ? value.toLowerCase() : undefined;
  };

  const answer = (order: HarnessOrder, replayed: boolean): Response => jsonResponse({
    kdsEvent: null,
    orderId: order.orderId,
    orderStatus: order.status,
    replayed,
    schemaVersion: 1,
    scope: { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId },
    version: order.version,
  });

  const conflict = (): Response => jsonResponse({ code: "ORDER_CONFLICT" }, 409);

  return Object.freeze({
    addItem: (body: unknown): Response => {
      const orderId = record(body, "orderId");
      const idempotencyKey = record(body, "idempotencyKey");
      const orderItemId = record(body, "orderItemId");
      const productId = record(body, "productId");
      const expectedVersion = field(body, "expectedVersion");
      const quantity = field(body, "quantity");
      if (orderId === undefined || idempotencyKey === undefined || orderItemId === undefined
        || productId === undefined) return jsonResponse({ code: "ORDER_REQUEST_REJECTED" }, 400);
      const order = orders.get(orderId);
      if (order === undefined) return jsonResponse({ code: "ORDER_NOT_FOUND" }, 404);
      if (harnessControl.orderConflict) return conflict();
      // Exactly as Nest: the version gate runs before the idempotency check.
      if (order.version !== expectedVersion) return conflict();
      order.items.push({
        orderItemId,
        productId,
        quantity: typeof quantity === "number" ? quantity : 1,
      });
      order.version += 1;
      applied.set(idempotencyKey, { orderId, version: order.version });
      return answer(order, false);
    },
    create: (body: unknown): Response => {
      const orderId = record(body, "orderId");
      const idempotencyKey = record(body, "idempotencyKey");
      const tableId = record(body, "tableId");
      const shiftId = record(body, "shiftId");
      if (orderId === undefined || idempotencyKey === undefined || tableId === undefined) {
        return jsonResponse({ code: "ORDER_REQUEST_REJECTED" }, 400);
      }
      if (harnessControl.orderConflict) return conflict();
      const existing = orders.get(orderId);
      // Idempotent by key, which is what a byte-for-byte retry relies on.
      if (existing !== undefined && applied.get(idempotencyKey)?.orderId === orderId) {
        return answer(existing, true);
      }
      const order: HarnessOrder = {
        items: [],
        orderId,
        shiftId: shiftId ?? null,
        status: "draft",
        tableId,
        version: 1,
      };
      orders.set(orderId, order);
      applied.set(idempotencyKey, { orderId, version: 1 });
      return answer(order, false);
    },
    listActive: (scope: MobileBranchScope, tableId: string): unknown => ({
      orders: [...orders.values()]
        .filter((order) => order.tableId === tableId.toLowerCase())
        .map((order) => ({
          currency: "XTS",
          itemCount: order.items.length,
          items: order.items.map((item, index) => ({
            modifiers: [],
            orderItemId: item.orderItemId,
            productId: item.productId,
            productName: index === 0
              ? "Arrachera al carbón con guarnición de temporada"
              : "Agua mineral",
            quantity: item.quantity,
            status: "sent",
            unit: "pieza",
            unitPrice: { amountMinor: scope === scopeB ? 9_900 : 12_500, currency: "XTS" },
          })),
          orderId: order.orderId,
          shiftId: order.shiftId,
          status: order.status,
          tableId: order.tableId,
          updatedAt: "2026-09-04T12:00:00.000Z",
          version: order.version,
        })),
      schemaVersion: 2,
      scope: { branchId: scope.branchId, restaurantId: scope.restaurantId },
      tableId: tableId.toLowerCase(),
    }),
    open: (body: unknown): Response => {
      const orderId = record(body, "orderId");
      const idempotencyKey = record(body, "idempotencyKey");
      const expectedVersion = field(body, "expectedVersion");
      if (orderId === undefined || idempotencyKey === undefined) {
        return jsonResponse({ code: "ORDER_REQUEST_REJECTED" }, 400);
      }
      const order = orders.get(orderId);
      if (order === undefined) return jsonResponse({ code: "ORDER_NOT_FOUND" }, 404);
      if (harnessControl.orderConflict) return conflict();
      if (order.version !== expectedVersion) return conflict();
      order.status = "open";
      order.version += 1;
      applied.set(idempotencyKey, { orderId, version: order.version });
      return answer(order, false);
    },
    reset: (): void => { orders.clear(); applied.clear(); },
    summary: (): readonly string[] => [...orders.values()].map(
      (order) => `${order.status} v${order.version} · ${order.items.length} línea(s) · mesa ${order.tableId.slice(0, 8)}`,
    ),
  });
}

function field(body: unknown, key: string): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(body, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

/** What the synthetic server currently holds, for the control bar to display. */
export function harnessOrderSummary(): readonly string[] {
  return harnessOrders.summary();
}

export function resetHarnessOrders(): void {
  harnessOrders.reset();
}

/**
 * A keystore double. It behaves like `expo-secure-store` in the three ways that
 * matter — present, absent and holding something this app did not write — so the
 * `deviceId` rules can be exercised by hand instead of only in a unit test.
 */
export function createHarnessDeviceIdentity(): MobileDeviceIdentity {
  const values = new Map<string, string>();
  const store: MobileSecureStorePort = Object.freeze({
    getItem: (key: string): Promise<string | null> => Promise.resolve(
      harnessControl.deviceStore === "corrupt" ? "no-es-un-uuid" : values.get(key) ?? null,
    ),
    isAvailable: (): Promise<boolean> => Promise.resolve(harnessControl.deviceStore !== "unavailable"),
    setItem: (key: string, value: string): Promise<void> => {
      values.set(key, value);
      return Promise.resolve();
    },
  });
  return createMobileDeviceIdentity({ randomUuid: harnessRandomUuid, store });
}

/**
 * Unique, valid, and boring on purpose: a reviewer can read the ids the screen
 * produced and see that a retry reused them. Never a real random source, and
 * never one of the UUIDs any recorded evidence already uses.
 */
let harnessUuidSerial = 0;
export function harnessRandomUuid(): string {
  harnessUuidSerial += 1;
  return `4d000000-0000-4000-8000-${harnessUuidSerial.toString(16).padStart(12, "0")}`;
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

/**
 * A draft delivery double. It records the plan the screen offered — which is how
 * a reviewer can see that every audit identity came from the plan and that a
 * retry reused it — and answers with whatever outcome the control bar selected.
 * It performs no request of any kind.
 *
 * `synthetic` is the exception, and the default: it means "use the real
 * sequence", so the screen builds its productive port instead of receiving this
 * one at all. That choice is made in `harness-root.tsx`.
 */
export function createHarnessOrderDelivery(onChange: () => void): OrderDeliveryPort & {
  readonly offered: () => readonly string[];
  readonly reset: () => void;
} {
  const offered: string[] = [];
  return Object.freeze({
    offered: (): readonly string[] => [...offered],
    reset: (): void => { offered.length = 0; onChange(); },
    /**
     * The one delivery call. The plan is read here — inside it — instead of
     * through a second callback surface, which is exactly what keeps a real
     * integration from performing create/add/open twice.
     */
    // Deliberately not `async`: an `async` function turns every throw into a
    // rejected promise, which would make the "falla sincrona" control test
    // something the app already handles. This one really throws before any
    // promise exists.
    deliver: (plan: OrderDeliveryPlanV1): Promise<OrderDraftFailure | undefined> => {
      offered.push(`crear ${plan.channel}/${plan.currency} @${plan.timeZone} orden ${plan.orderId.slice(0, 8)}`);
      offered.push(`turno ${plan.shiftId.slice(0, 8)} dispositivo ${plan.deviceId.slice(0, 8)} en ${plan.occurredAt}`);
      for (const line of plan.addItems) {
        offered.push(`item ${line.draftLineId} x${line.quantity} -> ${line.orderItemId.slice(0, 8)} (${line.idempotencyKey.slice(0, 8)})`);
      }
      offered.push(`abrir ${plan.openOrder.idempotencyKey.slice(0, 8)}`);
      onChange();
      if (harnessControl.draftOutcome === "throws") throw new Error("HARNESS_SYNCHRONOUS_THROW");
      if (harnessControl.draftOutcome === "hang") return new Promise<never>(() => undefined);
      if (harnessControl.draftOutcome === "slowAccepted") return delay(1_500).then(() => undefined);
      if (harnessControl.draftOutcome === "accepted") return Promise.resolve(undefined);
      if (harnessControl.draftOutcome === "synthetic") return Promise.resolve(undefined);
      return Promise.resolve(harnessControl.draftOutcome);
    },
  });
}
