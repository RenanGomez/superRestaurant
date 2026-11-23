import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  parseBranchScope,
  parseQuoteCashPaymentRequestV1,
  type ActiveTableOrderListV2,
  type ActiveTableOrderSummaryV2,
  type SendOrderToKitchenCommandV1,
  type CollectPaymentCommandV1,
  type DiningTableV1,
  type OrderMutationSummaryV1,
  type TableBoardV1,
} from "@super-restaurant/shared-types";

import { gateMobileAuth, type MobileAuthGate } from "../auth-gate.js";
import type { MobileAuthPort } from "../auth-port.js";
import { createBranchReadTracker, type BranchReadTracker } from "../branch-read.js";
import type { MobileConfig } from "../config.js";
import { lifecycleEffects, type MobileAppStatus, type MobileLifecyclePort } from "../lifecycle.js";
import {
  addOrderItem,
  MobileRequestError,
  collectPayment,
  createOrder,
  getCashRegisterReport,
  getCheckoutOrder,
  getDiningLayout,
  getDaySummary,
  getMenuCatalog,
  getTableBoard,
  listActiveTableOrders,
  listMemberships,
  listOperationalShifts,
  openOrder,
  quoteCashPayment,
  selectBranchContext,
  sendToKitchen,
  type MobileBranchScope,
} from "../mobile-client.js";
import {
  activeOrdersForTable,
  activeOrdersReadTarget,
  activeScope,
  canReadBranchData,
  canSubmitMobilePayment,
  contextReadTarget,
  failureMessage,
  initialMobileState,
  layoutReadTarget,
  membershipsReadOperator,
  menuReadTarget,
  mobileCapabilityMessage,
  mobileScreen,
  noticeMessage,
  ownsContextRead,
  ownsMembershipsRead,
  reduceMobileState,
  shiftsReadTarget,
  toPaymentFailure,
  type MobileEvent,
  type MobileFailure,
  type MobileNotice,
  type MobilePaymentFields,
  type MobileState,
  type MobileTab,
} from "../mobile-state.js";
import { branchDate, openRegisters } from "../register-selection.js";
import { kitchenAttempt } from "../order-kitchen.js";
import { parseMinorUnitsInput } from "../money.js";
import {
  createOrderDeliveryTracker,
  type OrderDeliveryTracker,
} from "../order-delivery.js";
import {
  initialOrderDraftState,
  reduceOrderDraft,
  type OrderDraftEvent,
  type OrderDraftState,
} from "../order-draft.js";
import { buildOrderDeliveryPlan, type OrderDeliveryPlanV1 } from "../order-plan.js";
import {
  createOrderDeliveryPort,
  stableOfflineCashIdentity,
  type OfflineCashIdentity,
  type OrderDeliveryPort,
  type OrderMutationTransport,
} from "../order-submission.js";
import type { MobileDeviceIdentity } from "../device-identity.js";
import { readInitialSession, revalidateAccess } from "../revalidation.js";
import type { MobileSession } from "../session.js";
import { endMobileSession } from "../sign-out.js";
import { type ActiveOrdersRealtimeConfig } from "./active-orders-panel.js";
import { BranchScreen } from "./branch-screen.js";
import { ActionButton, Banner, Caption, LoadingBlock, StateBlock, Subheading, useFocusRing } from "./components.js";
import { MenuScreen } from "./menu-screen.js";
import { OrderDraftScreen } from "./order-draft-screen.js";
import { PendingSyncScreen } from "./pending-sync-screen.js";
import { SignInScreen } from "./sign-in-screen.js";
import { SyncBanner, useMobileSyncBridge } from "./sync-banner.js";
import { TablesScreen } from "./tables-screen.js";
import { ShiftScreen } from "./shift-screen.js";
import { colors, radius, spacing, touchTarget, typography } from "./theme.js";

const TAB_LABELS: Readonly<Record<MobileTab, string>> = Object.freeze({ menu: "Menú", tables: "Mesas" });

export function App({ auth, config, deviceIdentity, lifecycle, orderDelivery, randomUuid }: {
  readonly auth: MobileAuthPort;
  readonly config: MobileConfig;
  /**
   * Where this installation's `deviceId` comes from. It is a port because the
   * keystore is a platform capability: the app must not care which one, and the
   * rules that decide whether an identity is usable are testable without it.
   */
  readonly deviceIdentity: MobileDeviceIdentity;
  readonly lifecycle: MobileLifecyclePort;
  /**
   * Who performs the Order writes. Left out, the screen builds the productive
   * port over the three authorized Order paths; the verification harness passes
   * its own so every outcome the composer can show stays reachable by hand.
   */
  readonly orderDelivery?: OrderDeliveryPort;
  /**
   * How a fresh identifier is minted. It is a port for the same reason the
   * keystore is: the platform provides the entropy, and a test needs to hand
   * over a generator whose values it chose.
   */
  readonly randomUuid: () => string;
}): React.JSX.Element {
  const [state, applyEvent] = useReducer(reduceMobileState, initialMobileState);
  /**
   * A mirror of the reducer's state, advanced in the same synchronous step as
   * the event that changes it.
   *
   * `state` is what a render saw. A provider callback or a request answer runs
   * long after that render, and the one question it has to ask — did the reducer
   * accept this read as the current one? — can only be answered against what the
   * reducer knows *now*. The mirror is the same pure reducer over the same
   * events in the same order, so it cannot disagree with what React renders; it
   * is only ever ahead of it, which is exactly what those callbacks need.
   */
  const mirror = useRef(state);
  const dispatch = useCallback((event: MobileEvent): void => {
    mirror.current = reduceMobileState(mirror.current, event);
    applyEvent(event);
  }, []);
  const [draft, dispatchDraft] = useReducer(reduceOrderDraft, initialOrderDraftState);
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>();
  const [kitchenState, setKitchenState] = useState<"idle" | "sending" | "failed">("idle");
  const kitchenRef = useRef(new Map<string, SendOrderToKitchenCommandV1>());
  const kitchenBusyRef = useRef(false);
  const [draftCategory, setDraftCategory] = useState<string | undefined>(undefined);
  // Every conversation with the identity provider goes through the gate, so a
  // late notification, a late session read or a listener the provider never
  // released cannot revive a session this device already closed.
  const gate = useAuthGate(auth);
  const pendingNotice = useRef<MobileNotice | undefined>(undefined);
  /**
   * Sign-out hook of the durable offline store, published by `useMobileSyncBridge`
   * (declared further down) and read by `endSession`: the store must purge or
   * lock before the screen is considered closed.
   */
  const releaseLocalDataRef = useRef<(() => Promise<void>) | undefined>(undefined);
  // Whether this device is currently holding a session, readable from the
  // provider callbacks, which run long after the render that produced them.
  const identified = useRef(false);
  /**
   * One read tracker per mounted app, held in a ref because it is stateful: it
   * is what gives each read — the membership list included — the identity the
   * reducer checks before applying an answer.
   */
  const readerRef = useRef<BranchReadTracker | undefined>(undefined);
  readerRef.current ??= createBranchReadTracker();
  const reader = readerRef.current;
  const token = state.session?.accessToken;
  const scope = activeScope(state);
  const branchId = scope?.branchId;
  const restaurantId = scope?.restaurantId;
  const readable = canReadBranchData(state);

  /**
   * Ends the session on this device only, keeping the reason to explain it. The
   * screen closes immediately; telling the provider is best effort.
   */
  const endSession = useCallback((notice: MobileNotice | undefined): void => {
    pendingNotice.current = notice;
    // `gate.signOut` closes the generation before the provider is asked; the
    // offline store releases its local data (purge or lock-with-evidence).
    endMobileSession({
      dispatch,
      notice,
      signOut: gate.signOut,
      ...(releaseLocalDataRef.current === undefined ? {} : { releaseLocalData: releaseLocalDataRef.current }),
    });
  }, [dispatch, gate]);

  /**
   * Reads the membership list of one operator. The whole session is taken, not
   * just its token, because the read belongs to the immutable `userId`: that is
   * what the reducer checks before putting a list on screen, so an answer for
   * the operator who was here before can never be shown to the one who is here
   * now — and cannot end their session either.
   */
  const loadMemberships = useCallback((session: MobileSession): void => {
    const operator = session.userId;
    reader.start({
      onFailed: (failure, attempt) => {
        // Read before the dispatch, because the dispatch is what ends the
        // session when this is the read the state is waiting for.
        const owned = ownsMembershipsRead(mirror.current, { attempt, operator });
        dispatch({ attempt, failure, operator, type: "membershipsFailed" });
        // The reducer has already signed this device out; `endSession` is the
        // provider half of it, and restating the same reason changes nothing.
        if (owned && failure === "authorization") endSession("sessionEnded");
      },
      onLoaded: (list, attempt) => {
        dispatch({ attempt, memberships: list.memberships, operator, type: "membershipsLoaded" });
      },
      onLoading: (attempt) => { dispatch({ attempt, operator, type: "membershipsLoading" }); },
      read: () => listMemberships(config, session.accessToken),
    });
  }, [config, dispatch, endSession, reader]);

  useEffect(() => { identified.current = state.session !== undefined; }, [state.session]);

  useEffect(() => {
    let active = true;
    // A session port that rejects is treated as "no session": the app shows
    // sign-in instead of staying on the start-up screen. A read that answers
    // after a sign-out answers for an older generation, and the gate turns it
    // into "no session" too.
    void readInitialSession(gate.currentSession).then((session) => {
      if (active) dispatch({ session, type: "sessionRestored" });
    });
    const unsubscribe = gate.onSessionChange((session) => {
      if (session === undefined) {
        // Echo of a local sign-out, or one decided by the provider: reuse the
        // reason when this device asked for it. When a session really ended,
        // close the generation as well, so nothing the provider says afterwards
        // can revive it — including a sign-out this device never asked for.
        if (identified.current) gate.closeGeneration();
        // A provider-driven sign-out must release the offline store too, even
        // when it did not go through `endSession`.
        void releaseLocalDataRef.current?.().catch(() => undefined);
        dispatch({ notice: pendingNotice.current, type: "signedOut" });
        return;
      }
      // Only sessions of the generation that is open reach this point, so an
      // accepted one always starts a new story or renews the current operator.
      pendingNotice.current = undefined;
      dispatch({ session, type: "sessionObserved" });
    });
    // The token ticker only runs while this component is mounted and the app is
    // in the foreground; it never writes anything to the device.
    void gate.startAutoRefresh().catch(() => undefined);
    return (): void => {
      active = false;
      unsubscribe();
      void gate.stopAutoRefresh().catch(() => undefined);
    };
  }, [gate]);

  // Foreground lifecycle: drive the token ticker and revalidate the session and
  // the exact Restaurant/Branch pair on every real return to the foreground.
  useEffect(() => {
    let previous: MobileAppStatus = "active";
    return lifecycle.subscribe((next) => {
      const effects = lifecycleEffects(previous, next);
      previous = next;
      void (effects.autoRefresh === "start" ? gate.startAutoRefresh() : gate.stopAutoRefresh())
        .catch(() => undefined);
      if (effects.revalidate) dispatch({ type: "revalidationStarted" });
    });
  }, [gate, lifecycle]);

  // One revalidation at a time: the reducer ignores repeated starts, and this
  // effect only runs while `revalidating` is true.
  useEffect(() => {
    if (!state.revalidating) return undefined;
    let active = true;
    const target = branchId !== undefined && restaurantId !== undefined
      ? { branchId, restaurantId } satisfies MobileBranchScope
      : undefined;
    void revalidateAccess({
      authorizeScope: (session, requested) => selectBranchContext(config, session.accessToken, requested),
      currentSession: gate.currentSession,
      scope: target,
    }).then((outcome) => {
      if (!active) return;
      if (outcome.kind === "sessionLost") { endSession("sessionEnded"); return; }
      dispatch({ session: outcome.session, type: "sessionObserved" });
      if (outcome.kind === "failed") {
        dispatch({ failure: outcome.failure, type: "revalidationFailed" });
        return;
      }
      dispatch({ context: outcome.context, type: "revalidationSucceeded" });
      if (outcome.context === undefined) loadMemberships(outcome.session);
    });
    return (): void => { active = false; };
  }, [branchId, config, dispatch, endSession, gate, loadMemberships, restaurantId, state.revalidating]);

  useEffect(() => {
    // `membershipsReadOperator` is the whole condition, and it is the same one
    // the reducer uses to decide whose list may be shown.
    const session = state.session;
    if (session === undefined || membershipsReadOperator(state) !== session.userId) return;
    loadMemberships(session);
  }, [loadMemberships, state]);

  // Selecting a branch reads its operational context. That answer — roles and
  // the branch's IANA zone — is what authorizes the operational flow, and it is
  // owned by the operator, the pair and the attempt that asked for it, so a
  // late one cannot confirm a branch nobody is selecting any more.
  useEffect(() => {
    const target = contextReadTarget(state);
    const session = state.session;
    if (target === undefined || session === undefined) return;
    const operator = target.operator;
    const scope = target.scope;
    reader.start({
      onFailed: (failure, attempt) => {
        const owned = ownsContextRead(mirror.current, { attempt, operator, scope });
        dispatch({ attempt, failure, operator, scope, type: "branchRejected" });
        // A refused pair may mean the membership itself changed: read it again.
        if (owned && failure === "authorization") loadMemberships(session);
      },
      onLoaded: (context, attempt) => { dispatch({ attempt, context, operator, type: "branchAuthorized" }); },
      onLoading: (attempt) => { dispatch({ attempt, operator, scope, type: "branchContextRequested" }); },
      read: () => selectBranchContext(config, session.accessToken, scope),
    });
  }, [config, dispatch, loadMemberships, reader, state]);

  // The three branch-scoped reads. None of them cancels anything on cleanup:
  // the `loading` dispatch each one makes is what re-runs its own effect, and
  // when a real tap started the read React flushes that update synchronously,
  // so a cleanup flag would cancel the request it had just issued. What decides
  // whether an answer is still wanted is the attempt the tracker allocates and
  // the reducer stores on the resource: a read that has been given up — another
  // token, another branch, another shift, a revalidation — leaves its resource
  // `idle`, which both refuses the old answer and lets the current read start.
  useEffect(() => {
    const target = shiftsReadTarget(state);
    if (target === undefined || token === undefined) return;
    reader.start({
      onFailed: (failure, attempt) => { dispatch({ attempt, failure, scope: target, type: "shiftsFailed" }); },
      onLoaded: (list, attempt) => { dispatch({ attempt, list, scope: target, type: "shiftsLoaded" }); },
      onLoading: (attempt) => { dispatch({ attempt, scope: target, type: "shiftsLoading" }); },
      read: () => listOperationalShifts(config, token, target),
    });
  }, [config, reader, state, token]);

  useEffect(() => {
    const target = layoutReadTarget(state);
    if (target === undefined || token === undefined) return;
    reader.start({
      onFailed: (failure, attempt) => { dispatch({ attempt, failure, scope: target, type: "layoutFailed" }); },
      onLoaded: (layout, attempt) => { dispatch({ attempt, layout, scope: target, type: "layoutLoaded" }); },
      onLoading: (attempt) => { dispatch({ attempt, scope: target, type: "layoutLoading" }); },
      read: () => getDiningLayout(config, token, target),
    });
  }, [config, reader, state, token]);

  useEffect(() => {
    const target = menuReadTarget(state, draft.tableId !== undefined);
    if (target === undefined || token === undefined) return;
    reader.start({
      onFailed: (failure, attempt) => { dispatch({ attempt, failure, scope: target, type: "menuFailed" }); },
      onLoaded: (menu, attempt) => { dispatch({ attempt, menu, scope: target, type: "menuLoaded" }); },
      onLoading: (attempt) => { dispatch({ attempt, scope: target, type: "menuLoading" }); },
      read: () => getMenuCatalog(config, token, target),
    });
  }, [config, draft.tableId, reader, state, token]);

  // The active Orders of the table whose draft is on screen. A table can hold
  // more than one, and the list is the only authority on what is already there:
  // the composer never assumes it owns the table.
  useEffect(() => {
    const target = activeOrdersReadTarget(state, draft.tableId);
    if (target === undefined || token === undefined) return;
    const { scope: targetScope, shiftId, tableId } = target;
    reader.start({
      onFailed: (failure, attempt) => {
        dispatch({ attempt, failure, scope: targetScope, shiftId, tableId, type: "activeOrdersFailed" });
      },
      onLoaded: (list, attempt) => {
        dispatch({ attempt, list, scope: targetScope, shiftId, tableId, type: "activeOrdersLoaded" });
      },
      onLoading: (attempt) => {
        dispatch({ attempt, scope: targetScope, shiftId, tableId, type: "activeOrdersLoading" });
      },
      read: () => listActiveTableOrders(config, token, targetScope, tableId),
    });
  }, [config, dispatch, draft.tableId, reader, state, token]);

  // A draft belongs to exactly one operator, branch and shift. When any of them
  // changes — sign-out, another operator, another branch, another shift, or an
  // access the server revoked — the draft is dropped in the same transition, so
  // nothing composed for one context can be sent in another.
  const draftContext = `${state.session?.userId ?? ""}|${restaurantId ?? ""}|${branchId ?? ""}|${state.shift?.shiftId ?? ""}`;
  const previousDraftContext = useRef(draftContext);
  /**
   * One delivery tracker per mounted app, held in a ref because it is stateful:
   * it is what keeps a hand-over in flight tied to the context that started it.
   */
  const trackerRef = useRef<OrderDeliveryTracker | undefined>(undefined);
  trackerRef.current ??= createOrderDeliveryTracker();
  const delivery = trackerRef.current;
  /**
   * The plan of the delivery currently on screen, kept so that a retry reuses
   * the very same identities. `key` is what a *new* delivery looks like: another
   * context, another table, or a draft the operator edited. When it changes the
   * plan is dropped, and the next submit mints fresh identities.
   */
  const planRef = useRef<{ readonly key: string; readonly plan: OrderDeliveryPlanV1 } | undefined>(undefined);
  useEffect(() => {
    if (previousDraftContext.current === draftContext) return;
    previousDraftContext.current = draftContext;
    // The hand-over in flight, if any, belonged to the context being left. It is
    // abandoned here so it can neither block the new context nor apply its
    // outcome to the draft composed in it.
    delivery.abandon();
    planRef.current = undefined;
    dispatchDraft({ type: "contextReleased" });
    setDraftCategory(undefined);
    setSelectedOrderId(undefined);
    kitchenRef.current.clear();
    setKitchenState("idle");
    setSyncNotice(undefined);
    setOfflineQueued(false);
    setOfflineCashBlocked(undefined);
    setOfflineCashQueuedKey(undefined);
    offlineCashIdentityRef.current = undefined;
    offlineCashInFlightRef.current = false;
  }, [delivery, draftContext]);

  /**
   * The `deviceId` of this installation, read once. It is not optional: every
   * Order mutation carries it, so a keystore that cannot produce one blocks the
   * hand-over explicitly rather than letting an audit record be written without
   * saying which device wrote it.
   */
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void deviceIdentity.load().then(
      (identity) => { if (active) setDeviceId(identity); },
      // Deliberately not logged: the failure is reported through the screen, and
      // the identity itself must never reach a log.
      () => { if (active) setDeviceId(undefined); },
    );
    return (): void => { active = false; };
  }, [deviceIdentity]);

  /**
   * The productive port, or the one the harness supplied. It is rebuilt when the
   * token changes so a delivery never runs with a credential that was replaced;
   * a delivery already in flight keeps the port it started with, which is the
   * tracker's job, not this one's.
   */
  const deliveryPort = useMemo((): OrderDeliveryPort | undefined => {
    if (orderDelivery !== undefined) return orderDelivery;
    if (token === undefined || branchId === undefined || restaurantId === undefined) return undefined;
    const scope: MobileBranchScope = { branchId, restaurantId };
    const transport: OrderMutationTransport = {
      addItem: (command): Promise<OrderMutationSummaryV1> => addOrderItem(config, token, command),
      createOrder: (command): Promise<OrderMutationSummaryV1> => createOrder(config, token, command),
      listActiveOrders: (table): Promise<ActiveTableOrderListV2> => listActiveTableOrders(config, token, scope, table),
      openOrder: (command): Promise<OrderMutationSummaryV1> => openOrder(config, token, command),
    };
    return createOrderDeliveryPort(Object.freeze(transport));
  }, [branchId, config, orderDelivery, restaurantId, token]);

  /**
   * Durable sync engine of this installation, bound to the active branch. It is
   * the same engine the queue screen reads, so the banner and the queue can
   * never disagree about what is pending.
   */
  const sync = useMobileSyncBridge({
    config,
    deviceId,
    scope: readable && branchId !== undefined && restaurantId !== undefined ? { branchId, restaurantId } : undefined,
    session: state.session,
  });
  // Publish the store's sign-out hook so `endSession` and the provider-driven
  // sign-out path can release local data before the screen closes.
  useEffect(() => { releaseLocalDataRef.current = sync.releaseLocalData; }, [sync.releaseLocalData]);
  const [syncNotice, setSyncNotice] = useState<string | undefined>(undefined);
  const [offlineQueued, setOfflineQueued] = useState(false);
  const [offlineCashBusy, setOfflineCashBusy] = useState(false);
  const [offlineCashBlocked, setOfflineCashBlocked] = useState<string | undefined>(undefined);
  const [offlineCashQueuedKey, setOfflineCashQueuedKey] = useState<string | undefined>(undefined);
  /** One collection identity per (order, version): a second tap must replay it. */
  const offlineCashIdentityRef = useRef<OfflineCashIdentity | undefined>(undefined);
  /** Synchronous guard: two taps in one frame cannot both start a collection. */
  const offlineCashInFlightRef = useRef(false);

  useEffect(() => {
    if (branchId === undefined || restaurantId === undefined) return;
    dispatch({
      scope: { branchId, restaurantId },
      snapshot: sync.snapshot,
      type: "syncSnapshotLoaded",
    });
  }, [branchId, dispatch, restaurantId, sync.snapshot]);

  const [board, setBoard] = useState<{ key: string; value?: TableBoardV1; failed?: boolean }>({ key: "" });
  const [boardRevision, setBoardRevision] = useState(0);
  const boardKey = `${token ?? ""}|${restaurantId ?? ""}|${branchId ?? ""}|${state.shift?.shiftId ?? ""}`;
  useEffect(() => {
    if (token === undefined || branchId === undefined || restaurantId === undefined || state.shift === undefined || state.revalidating) return;
    let active = true;
    setBoard({ key: boardKey });
    void getTableBoard(config, token, { branchId, restaurantId }).then(
      (value) => { if (active) setBoard({ key: boardKey, value }); },
      () => { if (active) setBoard({ key: boardKey, failed: true }); },
    );
    return () => { active = false; };
  }, [boardKey, boardRevision, branchId, config, restaurantId, state.revalidating, state.shift, token]);

  const retry = useCallback((tab: MobileTab): void => {
    if (branchId === undefined || restaurantId === undefined) return;
    const target: MobileBranchScope = { branchId, restaurantId };
    dispatch(tab === "tables" ? { scope: target, type: "layoutReset" } : { scope: target, type: "menuReset" });
  }, [branchId, restaurantId]);

  const retryMenu = useCallback((): void => {
    if (branchId === undefined || restaurantId === undefined) return;
    dispatch({ scope: { branchId, restaurantId }, type: "menuReset" });
  }, [branchId, dispatch, restaurantId]);

  const retryActiveOrders = useCallback((): void => {
    if (branchId === undefined || restaurantId === undefined) return;
    dispatch({ scope: { branchId, restaurantId }, type: "activeOrdersReset" });
  }, [branchId, dispatch, restaurantId]);

  const paymentAttemptRef = useRef<{
    readonly eventId: string;
    readonly idempotencyKey: string;
    readonly key: string;
    readonly occurredAt: string;
    readonly paymentId: string;
  } | undefined>(undefined);
  const paymentQuoteAttemptRef = useRef(0);
  const paymentCheckoutAttemptRef = useRef(0);
  const paymentSubmitAttemptRef = useRef(0);

  const [registers, setRegisters] = useState<{ key: string; status: "loading" | "failed" | "ready"; entries: ReturnType<typeof openRegisters> }>({ key: "", status: "loading", entries: [] });
  const [registerId, setRegisterId] = useState<string | undefined>();
  const [registerRevision, setRegisterRevision] = useState(0);
  const registerKey = `${draftContext}|${state.payment.orderId ?? ""}`;
  useEffect(() => {
    if (state.payment.orderId === undefined || token === undefined || branchId === undefined || restaurantId === undefined || state.shift === undefined || state.branch === undefined) return;
    let active = true;
    setRegisterId(undefined);
    setRegisters({ key: registerKey, status: "loading", entries: [] });
    const date = branchDate(new Date(), state.branch.timeZone);
    if (date === undefined) { setRegisters({ key: registerKey, status: "failed", entries: [] }); return; }
    void getDaySummary(config, token, { branchId, restaurantId }, date).then(
      (summary) => { if (active) setRegisters({ key: registerKey, status: "ready", entries: openRegisters(summary, state.shift!.shiftId) }); },
      () => { if (active) setRegisters({ key: registerKey, status: "failed", entries: [] }); },
    );
    return () => { active = false; };
  }, [branchId, config, registerKey, registerRevision, restaurantId, state.branch, state.payment.orderId, state.shift, token]);

  useEffect(() => {
    const orderId = state.payment.orderId;
    const selected = registers.key === registerKey ? registers.entries.find((entry) => entry.registerId === registerId) : undefined;
    if (orderId === undefined || selected === undefined || state.payment.checkout.status !== "idle" || token === undefined || branchId === undefined || restaurantId === undefined) return;
    const targetScope: MobileBranchScope = { branchId, restaurantId };
    paymentCheckoutAttemptRef.current += 1;
    const attempt = paymentCheckoutAttemptRef.current;
    dispatch({ attempt, orderId, scope: targetScope, type: "paymentCheckoutLoading" });
    if (deviceId === undefined) {
      dispatch({ attempt, failure: "unavailable", orderId, scope: targetScope, type: "paymentCheckoutFailed" });
      return;
    }
    void getCashRegisterReport(config, token, { cashRegisterSessionId: selected.cashRegisterSessionId, deviceId, registerId: selected.registerId, scope: targetScope })
      .then((report) => {
        if (report.register.status !== "open" || report.register.cashRegisterSessionId !== selected.cashRegisterSessionId) return Promise.reject(new Error("NO_OPEN_REGISTER"));
        return getCheckoutOrder(config, token, { cashRegisterSessionId: selected.cashRegisterSessionId, deviceId, orderId, registerId: selected.registerId, scope: targetScope });
      }).then(
        (checkout) => { dispatch({ attempt, checkout, scope: targetScope, type: "paymentCheckoutLoaded" }); },
        (error: unknown) => { dispatch({ attempt, failure: error instanceof Error && error.message === "NO_OPEN_REGISTER" ? "noRegister" : toPaymentFailure(error), orderId, scope: targetScope, type: "paymentCheckoutFailed" }); },
      );
  }, [branchId, config, deviceId, dispatch, registerId, registerKey, registers, restaurantId, state.payment.checkout.status, state.payment.orderId, token]);

  // Debounced server quote whenever payment inputs change; zero client money calculation.
  useEffect(() => {
    const checkout = state.payment.checkout.value;
    if (state.payment.checkout.status !== "ready" || checkout === undefined || state.payment.submission.status === "collected"
      || token === undefined || branchId === undefined || restaurantId === undefined) return undefined;
    const amountMinor = parseMinorUnitsInput(state.payment.amountInput, checkout.currency);
    const tipMinor = state.payment.tipInput.trim() === "" ? 0 : parseMinorUnitsInput(state.payment.tipInput, checkout.currency);
    const tenderedAmountMinor = state.payment.method === "cash"
      ? parseMinorUnitsInput(state.payment.receivedInput, checkout.currency)
      : null;
    if (amountMinor === null || tipMinor === null || (state.payment.method === "cash" && tenderedAmountMinor === null)) {
      dispatch({ type: "paymentQuoteCleared" });
      return undefined;
    }
    const targetScope: MobileBranchScope = { branchId, restaurantId };
    const request = parseQuoteCashPaymentRequestV1({
      amountMinor,
      cashRegisterSessionId: checkout.cashRegisterSessionId,
      method: state.payment.method,
      orderId: checkout.orderId,
      schemaVersion: 1,
      scope: targetScope,
      tenderedAmountMinor,
      tipMinor,
    });
    if (request === undefined) {
      paymentQuoteAttemptRef.current += 1;
      const attempt = paymentQuoteAttemptRef.current;
      dispatch({ attempt, orderId: checkout.orderId, scope: targetScope, type: "paymentQuoteLoading" });
      dispatch({ attempt, failure: "invalidAmount", orderId: checkout.orderId, scope: targetScope, type: "paymentQuoteFailed" });
      return undefined;
    }
    const timer = setTimeout(() => {
      paymentQuoteAttemptRef.current += 1;
      const attempt = paymentQuoteAttemptRef.current;
      dispatch({ attempt, orderId: checkout.orderId, scope: targetScope, type: "paymentQuoteLoading" });
      void quoteCashPayment(config, token, request).then(
        (quote) => { dispatch({ attempt, quote, scope: targetScope, type: "paymentQuoteLoaded" }); },
        (error: unknown) => { dispatch({ attempt, failure: toPaymentFailure(error), orderId: checkout.orderId, scope: targetScope, type: "paymentQuoteFailed" }); },
      );
    }, 200);
    return (): void => { clearTimeout(timer); };
  }, [
    branchId, config, dispatch, restaurantId, state.payment.amountInput, state.payment.checkout.status,
    state.payment.checkout.value, state.payment.method, state.payment.receivedInput,
    state.payment.submission.status, state.payment.tipInput, token,
  ]);

  const submitPayment = useCallback((): void => {
    const checkout = state.payment.checkout.value;
    const quote = state.payment.quote.value;
    if (checkout === undefined || quote === undefined || !canSubmitMobilePayment(state.payment)
      || token === undefined || branchId === undefined || restaurantId === undefined || deviceId === undefined) return;
    const commandScope = parseBranchScope({ branchId, restaurantId });
    if (commandScope === undefined) return;
    const targetScope: MobileBranchScope = { branchId, restaurantId };
    let cardManualEvidence: CollectPaymentCommandV1["cardManualEvidence"] = null;
    if (quote.method === "card_manual") {
      if (!state.payment.cardExternalConfirmed) return;
      cardManualEvidence = {
        externalConfirmed: state.payment.cardExternalConfirmed,
        provider: state.payment.cardProvider.trim(),
        reference: state.payment.cardReference.trim(),
        terminalId: state.payment.terminalId.trim(),
      };
    }
    const transferRef = state.payment.method === "transfer" && state.payment.transferReference.trim().length > 0
      ? state.payment.transferReference.trim()
      : null;
    const key = [
      draftContext, checkout.orderId, checkout.orderVersion, checkout.cashRegisterSessionId, checkout.cashRegisterVersion,
      quote.method, quote.amountMinor, quote.tenderedAmountMinor ?? "", quote.tipMinor,
      state.payment.cardProvider.trim(), state.payment.terminalId.trim(), state.payment.cardReference.trim(),
      String(state.payment.cardExternalConfirmed), transferRef ?? "",
    ].join("|");
    if (paymentAttemptRef.current?.key !== key) {
      paymentAttemptRef.current = {
        eventId: randomUuid(),
        idempotencyKey: randomUuid(),
        key,
        occurredAt: new Date().toISOString(),
        paymentId: randomUuid(),
      };
    }
    const audit = paymentAttemptRef.current;
    paymentSubmitAttemptRef.current += 1;
    const submitAttempt = paymentSubmitAttemptRef.current;
    dispatch({ orderId: checkout.orderId, type: "paymentSubmitStarted" });
    void collectPayment(config, token, {
      amountMinor: quote.amountMinor,
      cardManualEvidence,
      cashRegisterExpectedVersion: checkout.cashRegisterVersion,
      cashRegisterSessionId: checkout.cashRegisterSessionId,
      deviceId,
      eventId: audit.eventId,
      idempotencyKey: audit.idempotencyKey,
      localSequence: checkout.nextLocalSequence,
      method: quote.method,
      occurredAt: audit.occurredAt,
      orderExpectedVersion: checkout.orderVersion,
      orderId: checkout.orderId,
      paymentId: audit.paymentId,
      schemaVersion: 1,
      scope: commandScope,
      tenderedAmountMinor: quote.tenderedAmountMinor,
      tipMinor: quote.tipMinor,
      ...(transferRef === null ? {} : { transferReference: transferRef }),
    }).then(
      (receipt) => {
        if (paymentSubmitAttemptRef.current !== submitAttempt) return;
        paymentAttemptRef.current = undefined;
        dispatch({ receipt, scope: targetScope, type: "paymentCollected" });
        dispatch({ scope: targetScope, type: "activeOrdersReset" });
      },
      (error: unknown) => {
        if (paymentSubmitAttemptRef.current !== submitAttempt) return;
        dispatch({ failure: toPaymentFailure(error), orderId: checkout.orderId, scope: targetScope, type: "paymentSubmitFailed" });
      },
    );
  }, [branchId, config, deviceId, dispatch, draftContext, randomUuid, restaurantId, state.payment, token]);

  const submitDraft = useCallback((): void => {
    const tableId = draft.tableId;
    const catalog = state.menu.value?.catalog ?? null;
    const timeZone = state.branch?.timeZone;
    const shiftId = state.shift?.shiftId;
    if (tableId === undefined || branchId === undefined || restaurantId === undefined) return;
    if (draft.lines.length === 0 || draft.composer !== undefined || draft.submission.status === "sending") return;

    // Everything a mutation needs has to be present *before* the first request.
    // Missing identity or a missing context is reported as a failure the
    // operator can see, never worked around with a value invented here.
    if (deviceId === undefined || timeZone === undefined || shiftId === undefined || deliveryPort === undefined) {
      dispatchDraft({ failure: "unavailable", type: "submissionFailed" });
      return;
    }

    // The key of this delivery. Editing the draft changes it, which is what
    // makes the next submit a new delivery with new identities.
    const key = `${draftContext}|${tableId}|${selectedOrderId ?? "new"}|${JSON.stringify(draft.lines)}`;
    delivery.run({
      build: () => {
        if (catalog === null) return undefined;
        const held = planRef.current;
        if (held !== undefined && held.key === key) return held.plan;
        const plan = buildOrderDeliveryPlan({
          catalog,
          ...(selectedOrderId === undefined ? {} : { existingOrderId: selectedOrderId }),
          deviceId,
          lines: draft.lines,
          now: Date.now(),
          randomUuid,
          scope: { branchId, restaurantId },
          shiftId,
          tableId,
          timeZone,
        });
        planRef.current = plan === undefined ? undefined : { key, plan };
        return plan;
      },
      context: draftContext,
      integration: deliveryPort,
      onSettle: (failure) => {
        if (failure === undefined) {
          // Accepted by the server: the plan is spent, and the lines it carried
          // must never be offered again.
          planRef.current = undefined;
          dispatchDraft({ type: "submissionSucceeded" });
          setBoardRevision((revision) => revision + 1);
          // What the table now holds changed, so the active list is read again.
          if (branchId !== undefined && restaurantId !== undefined) {
            dispatch({ scope: { branchId, restaurantId }, type: "activeOrdersReset" });
          }
          return;
        }
        dispatchDraft({ failure, type: "submissionFailed" });
      },
      onStart: () => { dispatchDraft({ type: "submissionStarted" }); },
    });
  }, [
    branchId, config, deliveryPort, deviceId, dispatch, delivery, draft, draftContext,
    randomUuid, restaurantId, selectedOrderId, state.branch, state.menu.value, state.shift,
  ]);

  /**
   * The plan of the draft on screen, reusing the immutable identities already
   * minted for this content. Both the online submit and the offline capture use
   * it, so queueing after a failed connection is the same delivery, not a second
   * order.
   */
  const buildCurrentPlan = useCallback((): OrderDeliveryPlanV1 | undefined => {
    const tableId = draft.tableId;
    const catalog = state.menu.value?.catalog ?? null;
    const timeZone = state.branch?.timeZone;
    const shiftId = state.shift?.shiftId;
    if (tableId === undefined || branchId === undefined || restaurantId === undefined
      || deviceId === undefined || timeZone === undefined || shiftId === undefined || catalog === null) {
      return undefined;
    }
    const key = `${draftContext}|${tableId}|${selectedOrderId ?? "new"}|${JSON.stringify(draft.lines)}`;
    const held = planRef.current;
    if (held !== undefined && held.key === key) return held.plan;
    const plan = buildOrderDeliveryPlan({
      catalog,
      ...(selectedOrderId === undefined ? {} : { existingOrderId: selectedOrderId }),
      deviceId,
      lines: draft.lines,
      now: Date.now(),
      randomUuid,
      scope: { branchId, restaurantId },
      shiftId,
      tableId,
      timeZone,
    });
    planRef.current = plan === undefined ? undefined : { key, plan };
    return plan;
  }, [
    branchId, deviceId, draft.lines, draft.tableId, draftContext, randomUuid,
    restaurantId, selectedOrderId, state.branch, state.menu.value, state.shift,
  ]);

  const queueOfflineOrder = useCallback((): void => {
    const plan = buildCurrentPlan();
    if (plan === undefined) {
      setSyncNotice("No se pudo preparar el pedido para guardarlo en este dispositivo. Revisa el catálogo y el turno.");
      return;
    }
    void sync.queueOrder(plan).then((result) => {
      if (!result.queued) {
        setSyncNotice(result.reasonCode === null
          ? "No se pudo guardar el pedido en este dispositivo. Inténtalo de nuevo."
          : mobileCapabilityMessage(result.reasonCode));
        return;
      }
      planRef.current = undefined;
      setOfflineQueued(true);
      setSyncNotice(
        "Pedido guardado en este dispositivo, pendiente de sincronizar. Cocina y otros equipos todavía no lo ven; "
        + "no se considera enviado hasta que el servidor lo confirme.",
      );
      dispatchDraft({ type: "submissionSucceeded" });
    });
  }, [buildCurrentPlan, dispatchDraft, sync]);

  const queueOfflineCash = useCallback((): void => {
    const checkout = state.payment.checkout.value;
    const quote = state.payment.quote.value;
    if (checkout === undefined || quote === undefined || quote.method !== "cash"
      || branchId === undefined || restaurantId === undefined || deviceId === undefined) {
      return;
    }
    const key = `${checkout.orderId}|${checkout.orderVersion}`;
    // Two taps in the same frame are stopped synchronously; after the first
    // success the button stays disabled for this same collection.
    if (offlineCashInFlightRef.current || offlineCashQueuedKey === key) return;
    offlineCashInFlightRef.current = true;
    setOfflineCashBusy(true);
    setOfflineCashBlocked(undefined);
    const identity = stableOfflineCashIdentity(offlineCashIdentityRef.current, {
      key,
      now: new Date(),
      uuid: randomUuid,
    });
    offlineCashIdentityRef.current = identity;
    void sync.queueCash({
      amountMinor: quote.amountMinor,
      cashRegisterSessionId: checkout.cashRegisterSessionId,
      currency: quote.currency,
      idempotencyKey: identity.idempotencyKey,
      occurredAt: identity.occurredAt,
      orderId: checkout.orderId,
      orderVersion: checkout.orderVersion,
      paymentId: identity.paymentId,
    }, {
      // The server confirmed both when it produced this checkout; the amount is
      // the one it quoted, so the local limit is not invented here.
      cashRegisterOpen: true,
      cashierShiftOpen: true,
      withinOfflineCashLimit: true,
    }).then((result) => {
      if (result.queued) {
        setOfflineCashQueuedKey(key);
        setSyncNotice(
          "Cobro en efectivo guardado en este dispositivo, pendiente de sincronizar. "
          + "No se considera cobrado hasta que el servidor lo confirme.",
        );
      } else {
        setOfflineCashBlocked(result.reasonCode === null
          ? "No se pudo guardar el cobro en este dispositivo. Inténtalo de nuevo."
          : mobileCapabilityMessage(result.reasonCode));
      }
    }).finally(() => {
      offlineCashInFlightRef.current = false;
      setOfflineCashBusy(false);
    });
  }, [
    branchId, deviceId, offlineCashQueuedKey, randomUuid, restaurantId,
    state.payment.checkout.value, state.payment.quote.value, sync,
  ]);

  const dispatchOrderDraft = useCallback((event: OrderDraftEvent): void => {
    const nextDraft = reduceOrderDraft(draft, event);
    if (nextDraft.tableId !== draft.tableId && branchId !== undefined && restaurantId !== undefined) {
      // The draft and the server snapshot have separate reducers, so leaving
      // or changing table invalidates the read before the draft transition is
      // rendered. Deriving that fact from the same pure reducer also covers the
      // empty-draft shortcut and a confirmed departure without duplicating its
      // rules here. A late failure — a 401 especially — then belongs nowhere.
      dispatch({ scope: { branchId, restaurantId }, type: "activeOrdersReset" });
      dispatch({ type: "paymentClosed" });
      setSelectedOrderId(undefined);
      kitchenRef.current.clear();
      setKitchenState("idle");
    }
    dispatchDraft(event);
  }, [branchId, dispatch, draft, restaurantId]);

  const sendPending = useCallback((order: ActiveTableOrderSummaryV2): void => {
    if (kitchenBusyRef.current || token === undefined || deviceId === undefined || branchId === undefined || restaurantId === undefined || draft.tableId === undefined) return;
    const key = `${draftContext}|${draft.tableId}|${order.orderId}`;
    const previous = kitchenRef.current.get(key);
    const command = previous ?? kitchenAttempt(previous, { deviceId, scope: { branchId, restaurantId }, order,
      eventId: randomUuid(), idempotencyKey: randomUuid(), occurredAt: new Date().toISOString() });
    if (command === undefined) { setKitchenState("failed"); return; }
    kitchenRef.current.set(key, command);
    const current = command;
    kitchenBusyRef.current = true;
    setKitchenState("sending");
    void sendToKitchen(config, token, current).then(() => {
      if (kitchenRef.current.get(key) !== current) return;
      kitchenRef.current.delete(key);
      setKitchenState("idle");
      dispatch({ scope: { branchId, restaurantId }, type: "activeOrdersReset" });
      setBoardRevision((revision) => revision + 1);
    }, (error: unknown) => {
      if (kitchenRef.current.get(key) !== current) return;
      if (error instanceof MobileRequestError && error.status === 409) {
        kitchenRef.current.delete(key);
        dispatch({ scope: { branchId, restaurantId }, type: "activeOrdersReset" });
      }
      setKitchenState("failed");
    })
      .finally(() => { kitchenBusyRef.current = false; });
  }, [branchId, config, deviceId, dispatch, draft.tableId, draftContext, randomUuid, restaurantId, token]);

  const selectTable = useCallback((table: DiningTableV1): void => {
    dispatchOrderDraft({ tableId: table.tableId, type: "tableSelected", zoneId: table.zoneId });
  }, [dispatchOrderDraft]);

  const screen = mobileScreen(state);
  const notice = state.notice === undefined ? undefined : noticeMessage(state.notice);
  // Offline capture is offered only when there is no connection at all.
  // `reconnecting` may already reach the server, so the online actions stay
  // visible; `sync_blocked` is not a network outage either, it is a blocked
  // queue the operator has to review.
  const offlineMode = sync.snapshot.connectivity === "offline";
  const syncBlocked = sync.snapshot.connectivity === "sync_blocked";
  const offlineOrder = offlineMode && readable && draft.tableId !== undefined
    ? {
      canQueue: sync.snapshot.storageAvailable,
      message: sync.snapshot.storageAvailable
        ? "Sin conexión. Puedes guardar este pedido en este dispositivo; se enviará al servidor al reconectar. "
          + "Cocina y otros equipos todavía no lo ven."
        : "Sin conexión y sin almacenamiento local en este dispositivo. No se puede guardar el pedido; reconecta para continuar.",
      onQueue: queueOfflineOrder,
      queued: offlineQueued,
    }
    : undefined;
  const paymentCheckout = state.payment.checkout.value;
  const offlineCashKey = paymentCheckout === undefined
    ? undefined
    : `${paymentCheckout.orderId}|${paymentCheckout.orderVersion}`;
  const offlineCashAlreadyQueued = offlineCashKey !== undefined && offlineCashQueuedKey === offlineCashKey;
  const offlineCash = offlineMode && readable
    && state.payment.orderId !== undefined && paymentCheckout !== undefined
    && state.payment.quote.status === "ready"
    ? {
      allowed: state.payment.method === "cash" && sync.snapshot.storageAvailable
        && offlineCashBlocked === undefined && !offlineCashAlreadyQueued,
      busy: offlineCashBusy,
      message: offlineCashAlreadyQueued
        ? "El cobro en efectivo de esta orden ya está guardado en este dispositivo, pendiente de sincronizar."
        : offlineCashBlocked ?? (state.payment.method === "cash"
          ? (sync.snapshot.storageAvailable
            ? "Sin conexión. El efectivo se puede guardar en este dispositivo; quedará pendiente y no cuenta como cobrado "
              + "hasta que el servidor lo confirme."
            : "Sin conexión y sin almacenamiento local en este dispositivo. No se puede guardar el cobro; reconecta para continuar.")
          : state.payment.method === "card_manual"
            ? "Sin conexión. El cobro con tarjeta no puede confirmarse; regístralo cuando vuelva la red."
            : "Sin conexión. La transferencia debe registrarse cuando vuelva la conexión."),
      onQueue: queueOfflineCash,
    }
    : undefined;
  const cashBlockedNotice = syncBlocked && readable
    && state.payment.orderId !== undefined && paymentCheckout !== undefined
    ? "La sincronización está bloqueada. Revisa la cola de pendientes antes de registrar el cobro."
    : undefined;

  if (screen === "starting") return <LoadingBlock label="Abriendo superRestaurant…" />;

  // `gate.signIn` is what opens a new generation: entering again is always a
  // deliberate act, never something a provider event can do on its own.
  if (screen === "signIn") return <SignInScreen notice={notice} onSignIn={gate.signIn} />;

  if (screen === "branches") {
    return <BranchScreen
      branchFailure={state.branchFailure}
      memberships={state.memberships}
      notice={notice}
      onRetry={() => { if (state.session !== undefined) loadMemberships(state.session); }}
      onSelect={(selected) => { dispatch({ scope: selected, type: "branchRequested" }); }}
      onSignOut={() => { endSession(undefined); }}
      pendingScope={state.pendingScope}
    />;
  }

  if (screen === "shifts") {
    if (state.revalidating) return <LoadingBlock label="Confirmando sesión y sucursal…" />;
    const selectedMembership = state.memberships.value?.find((candidate) => (
      candidate.scope.restaurantId === restaurantId && candidate.scope.branchId === branchId
    ));
    return <ShiftScreen
      branchName={selectedMembership?.branchName ?? "Sucursal autorizada"}
      onBack={() => { dispatch({ type: "branchReleased" }); }}
      onRetry={() => {
        if (branchId !== undefined && restaurantId !== undefined) {
          dispatch({ scope: { branchId, restaurantId }, type: "shiftsReset" });
        }
      }}
      onSelect={(shift) => { dispatch({ shift, type: "shiftSelected" }); }}
      shifts={state.shifts}
    />;
  }

  // Identity is rendered only while the scope is confirmed. During a
  // revalidation, or after one failed, the pair stays in state for the request
  // but no restaurant, branch or operator is shown.
  const membership = readable
    ? state.memberships.value?.find((candidate) => (
      candidate.scope.restaurantId === restaurantId && candidate.scope.branchId === branchId
    ))
    : undefined;

  return <View style={styles.workspace}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        {readable
          ? <>
            <Caption>{membership?.restaurantName ?? "Restaurante autorizado"}</Caption>
            <Subheading>{membership?.branchName ?? "Sucursal autorizada"}</Subheading>
            <Caption>{state.shift?.name ?? "Turno no seleccionado"}</Caption>
            <Caption>{state.session?.email ?? ""}</Caption>
          </>
          : <>
            <Caption>superRestaurant</Caption>
            <Subheading>Acceso sin confirmar</Subheading>
            <Caption>No se muestra información hasta revalidar tu acceso.</Caption>
          </>}
      </View>
      <View style={styles.headerActions}>
        <ActionButton label="Cambiar turno" onPress={() => { dispatch({ type: "shiftReleased" }); }} tone="secondary" />
        <ActionButton label="Cambiar sucursal" onPress={() => { dispatch({ type: "branchReleased" }); }} tone="secondary" />
        <ActionButton label="Salir" onPress={() => { endSession(undefined); }} tone="secondary" />
      </View>
    </View>

    <SyncBanner
      branchName={membership?.branchName}
      onOpenQueue={() => { dispatch({ type: "syncScreenOpened" }); }}
      snapshot={sync.snapshot}
    />

    {state.syncScreenOpen
      ? <View style={styles.content}>
        <PendingSyncScreen
          onClose={() => { dispatch({ type: "syncScreenClosed" }); }}
          onRetryAll={sync.retryAll}
          retrying={sync.snapshot.syncing}
          snapshot={sync.snapshot}
        />
      </View>
      : <>
        <View accessibilityRole="tablist" style={styles.tabs}>
          {(["tables", "menu"] as const).map((tab) => <WorkspaceTab
            key={tab}
            onPress={() => { dispatch({ tab, type: "tabSelected" }); }}
            selected={state.tab === tab}
            tab={tab}
          />)}
        </View>

        <View style={styles.content}>
          <WorkspaceContent
            activeOrders={activeOrdersForTable(state, draft.tableId)}
            selectedOrderId={selectedOrderId}
            onSelectOrder={setSelectedOrderId}
            onSendKitchen={sendPending}
            kitchenState={kitchenState}
            board={board.key === boardKey ? board.value : undefined}
            boardFailed={board.key === boardKey && board.failed === true}
            onRetryBoard={() => { setBoardRevision((revision) => revision + 1); }}
            draft={draft}
            draftCategory={draftCategory}
            menu={state.menu}
            layout={state.layout}
            onCollectOrder={(orderId) => { dispatch({ orderId, type: "paymentOpened" }); }}
            onDraftCategory={setDraftCategory}
            onDraftEvent={dispatchOrderDraft}
            onPaymentClose={() => {
              paymentSubmitAttemptRef.current += 1;
              paymentAttemptRef.current = undefined;
              dispatch({ type: "paymentClosed" });
            }}
            onPaymentFieldChange={(patch) => { dispatch({ patch, type: "paymentFieldChanged" }); }}
            onPaymentRetry={() => { dispatch({ type: "paymentCheckoutReset" }); }}
            onPaymentSubmit={submitPayment}
            onRetryActiveOrders={retryActiveOrders}
            onRetryMenu={retryMenu}
            onRetryRead={retry}
            onRetryRevalidation={() => { dispatch({ type: "revalidationStarted" }); }}
            onSelectTable={selectTable}
            onSubmitDraft={submitDraft}
            offline={offlineOrder}
            offlineCash={offlineCash}
            cashBlockedNotice={cashBlockedNotice}
            payment={state.payment}
            registers={registers.key === registerKey ? registers : { status: "loading", entries: [] }}
            registerId={registerId}
            onRegisterSelect={(id) => { setRegisterId(id); dispatch({ type: "paymentCheckoutReset" }); }}
            onRegisterRetry={() => { setRegisterRevision((n) => n + 1); }}
            realtime={orderDelivery === undefined && token !== undefined ? { accessToken: token, apiBaseUrl: config.apiBaseUrl } : undefined}
            revalidating={state.revalidating}
            revalidationFailure={state.revalidationFailure}
            sentMessage={offlineQueued
              ? "Pedido guardado en este dispositivo, pendiente de sincronizar. Cocina y otros equipos todavía no lo ven."
              : undefined}
            syncNotice={syncNotice}
            tab={state.tab}
          />
        </View>
      </>}
  </View>;
}

/**
 * One authentication generation per mounted app. Held in a ref rather than a
 * memo because the gate is stateful: it must survive every render of this
 * component and be replaced only when the underlying port really changes.
 */
function useAuthGate(auth: MobileAuthPort): MobileAuthGate {
  const held = useRef<{ readonly gate: MobileAuthGate; readonly port: MobileAuthPort } | undefined>(undefined);
  if (held.current === undefined || held.current.port !== auth) {
    held.current = { gate: gateMobileAuth(auth), port: auth };
  }
  return held.current.gate;
}

function WorkspaceTab({ onPress, selected, tab }: {
  readonly onPress: () => void;
  readonly selected: boolean;
  readonly tab: MobileTab;
}): React.JSX.Element {
  const focus = useFocusRing();
  return <Pressable
    accessibilityLabel={TAB_LABELS[tab]}
    accessibilityRole="tab"
    accessibilityState={{ selected }}
    onPress={onPress}
    {...focus.handlers}
    style={(state) => [
      styles.tab,
      selected && styles.tabSelected,
      (state.pressed || focus.focused) && styles.tabPressed,
    ]}
  >
    <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{TAB_LABELS[tab]}</Text>
  </Pressable>;
}

/**
 * While the scope is being revalidated — or after a revalidation that could not
 * complete — the branch screens are not rendered at all. There is nothing left
 * to leak: the reducer already dropped the loaded layout and menu.
 */
function WorkspaceContent({
  activeOrders,
  selectedOrderId,
  onSelectOrder,
  onSendKitchen,
  kitchenState,
  board,
  boardFailed,
  onRetryBoard,
  draft,
  draftCategory,
  layout,
  menu,
  onCollectOrder,
  onDraftCategory,
  onDraftEvent,
  onPaymentClose,
  onPaymentFieldChange,
  onPaymentRetry,
  onPaymentSubmit,
  onRetryActiveOrders,
  onRetryMenu,
  onRetryRead,
  onRetryRevalidation,
  onSelectTable,
  onSubmitDraft,
  offline,
  offlineCash,
  cashBlockedNotice,
  payment,
  registers, registerId, onRegisterSelect, onRegisterRetry,
  realtime,
  revalidating,
  revalidationFailure,
  sentMessage,
  syncNotice,
  tab,
}: {
  readonly activeOrders: MobileState["activeOrders"];
  readonly selectedOrderId: string | undefined;
  readonly onSelectOrder: (orderId: string | undefined) => void;
  readonly onSendKitchen: (order: ActiveTableOrderSummaryV2) => void;
  readonly kitchenState: "idle" | "sending" | "failed";
  readonly board: TableBoardV1 | undefined;
  readonly boardFailed: boolean;
  readonly onRetryBoard: () => void;
  readonly draft: OrderDraftState;
  readonly draftCategory: string | undefined;
  readonly layout: MobileState["layout"];
  readonly menu: MobileState["menu"];
  readonly onCollectOrder: (orderId: string) => void;
  readonly onDraftCategory: (categoryId: string) => void;
  readonly onDraftEvent: (event: OrderDraftEvent) => void;
  readonly onPaymentClose: () => void;
  readonly onPaymentFieldChange: (patch: Partial<MobilePaymentFields>) => void;
  readonly onPaymentRetry: () => void;
  readonly onPaymentSubmit: () => void;
  readonly onRetryActiveOrders: () => void;
  readonly onRetryMenu: () => void;
  readonly onRetryRead: (tab: MobileTab) => void;
  readonly onRetryRevalidation: () => void;
  readonly onSelectTable: (table: DiningTableV1) => void;
  readonly onSubmitDraft: () => void;
  readonly offline?: {
    readonly canQueue: boolean;
    readonly message: string;
    readonly onQueue: () => void;
    readonly queued: boolean;
  } | undefined;
  readonly offlineCash?: {
    readonly allowed: boolean;
    readonly busy: boolean;
    readonly message: string;
    readonly onQueue: () => void;
  } | undefined;
  /** Non-network block (sync blocked): explains why a collection must wait. */
  readonly cashBlockedNotice?: string | undefined;
  readonly payment: MobileState["payment"];
  readonly registers: { readonly status: "loading" | "failed" | "ready"; readonly entries: ReturnType<typeof openRegisters> };
  readonly registerId: string | undefined;
  readonly onRegisterSelect: (id: string) => void;
  readonly onRegisterRetry: () => void;
  readonly realtime?: ActiveOrdersRealtimeConfig | undefined;
  readonly revalidating: boolean;
  readonly revalidationFailure: MobileFailure | undefined;
  readonly sentMessage?: string | undefined;
  readonly syncNotice?: string | undefined;
  readonly tab: MobileTab;
}): React.JSX.Element {
  if (revalidating) {
    return <>
      <Banner message="Revalidando tu acceso a esta sucursal…" tone="info" />
      <LoadingBlock label="Confirmando sesión y sucursal…" />
    </>;
  }
  if (revalidationFailure !== undefined) {
    return <StateBlock
      action={{ label: "Reintentar", onPress: onRetryRevalidation }}
      description={failureMessage(revalidationFailure)}
      title="No se pudo revalidar tu acceso"
    />;
  }
  if (tab === "menu") return <MenuScreen menu={menu} onRetry={() => { onRetryRead("menu"); }} />;

  if (draft.tableId === undefined) {
    return <TablesScreen
      board={board}
      boardFailed={boardFailed}
      onRetryBoard={onRetryBoard}
      layout={layout}
      onRetry={() => { onRetryRead("tables"); }}
      onSelectTable={onSelectTable}
      selectedTableId={undefined}
    />;
  }

  // The composer only exists for a table the layout still publishes: the plan
  // is authoritative, and a table that disappeared from it is not composed for.
  if (layout.status === "idle" || layout.status === "loading") {
    return <LoadingBlock label="Cargando mesas de la sucursal…" />;
  }
  const located = layout.value?.zones
    .flatMap((zone) => zone.tables.map((table) => ({ table, zoneName: zone.name })))
    .find((candidate) => candidate.table.tableId === draft.tableId);
  if (located === undefined) {
    // The table itself is gone, so there is no composition to return to and no
    // choice to confirm: the only honest action states the loss in its label.
    return <StateBlock
      action={{
        label: draft.lines.length === 0 ? "Volver a mesas" : "Descartar borrador y volver a mesas",
        onPress: () => { onDraftEvent({ type: "tableReleased" }); },
      }}
      description="Esta mesa ya no aparece en el plano de la sucursal. El borrador local no puede seguir asociado a ella."
      title="La mesa ya no está disponible"
    />;
  }

  return <OrderDraftScreen
    activeOrders={activeOrders}
    selectedOrderId={selectedOrderId}
    onSelectOrder={onSelectOrder}
    onSendKitchen={onSendKitchen}
    kitchenState={kitchenState}
    category={draftCategory}
    draft={draft}
    menu={menu}
    onBackToTables={() => { onDraftEvent({ intent: "leaveTable", type: "confirmationRequested" }); }}
    onCategorySelected={onDraftCategory}
    onCollectOrder={onCollectOrder}
    onEvent={onDraftEvent}
    onPaymentClose={onPaymentClose}
    onPaymentFieldChange={onPaymentFieldChange}
    onPaymentRetry={onPaymentRetry}
    onPaymentSubmit={onPaymentSubmit}
    onRetryActiveOrders={onRetryActiveOrders}
    onRetryMenu={onRetryMenu}
    onSubmit={onSubmitDraft}
    offline={offline}
    offlineCash={offlineCash}
    cashBlockedNotice={cashBlockedNotice}
    payment={payment}
    registers={registers}
    registerId={registerId}
    onRegisterSelect={onRegisterSelect}
    onRegisterRetry={onRegisterRetry}
    realtime={realtime}
    sentMessage={sentMessage}
    syncNotice={syncNotice}
    table={located.table}
    zoneName={located.zoneName}
  />;
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, width: "100%" },
  headerText: { flexGrow: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  tab: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.control,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: touchTarget.primary,
    paddingHorizontal: spacing.md,
  },
  tabLabel: { color: colors.text, fontWeight: "600", ...typography.body },
  tabLabelSelected: { color: colors.accentText },
  tabPressed: { borderColor: colors.focus, borderWidth: 3 },
  tabSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabs: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.md },
  workspace: { flex: 1, padding: spacing.lg },
});
