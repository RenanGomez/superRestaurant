import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  ActiveTableOrderListV2,
  DiningTableV1,
  OrderMutationSummaryV1,
} from "@super-restaurant/shared-types";

import { gateMobileAuth, type MobileAuthGate } from "../auth-gate.js";
import type { MobileAuthPort } from "../auth-port.js";
import { createBranchReadTracker, type BranchReadTracker } from "../branch-read.js";
import type { MobileConfig } from "../config.js";
import { lifecycleEffects, type MobileAppStatus, type MobileLifecyclePort } from "../lifecycle.js";
import {
  addOrderItem,
  createOrder,
  getDiningLayout,
  getMenuCatalog,
  listActiveTableOrders,
  listMemberships,
  listOperationalShifts,
  openOrder,
  selectBranchContext,
  type MobileBranchScope,
} from "../mobile-client.js";
import {
  activeOrdersReadTarget,
  activeScope,
  canReadBranchData,
  contextReadTarget,
  failureMessage,
  initialMobileState,
  layoutReadTarget,
  membershipsReadOperator,
  menuReadTarget,
  mobileScreen,
  noticeMessage,
  ownsContextRead,
  ownsMembershipsRead,
  reduceMobileState,
  shiftsReadTarget,
  type MobileEvent,
  type MobileFailure,
  type MobileNotice,
  type MobileState,
  type MobileTab,
} from "../mobile-state.js";
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
import { createOrderDeliveryPort, type OrderDeliveryPort, type OrderMutationTransport } from "../order-submission.js";
import type { MobileDeviceIdentity } from "../device-identity.js";
import { readInitialSession, revalidateAccess } from "../revalidation.js";
import type { MobileSession } from "../session.js";
import { endMobileSession } from "../sign-out.js";
import { BranchScreen } from "./branch-screen.js";
import { ActionButton, Banner, Caption, LoadingBlock, StateBlock, Subheading, useFocusRing } from "./components.js";
import { MenuScreen } from "./menu-screen.js";
import { OrderDraftScreen } from "./order-draft-screen.js";
import { SignInScreen } from "./sign-in-screen.js";
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
  const [draftCategory, setDraftCategory] = useState<string | undefined>(undefined);
  // Every conversation with the identity provider goes through the gate, so a
  // late notification, a late session read or a listener the provider never
  // released cannot revive a session this device already closed.
  const gate = useAuthGate(auth);
  const pendingNotice = useRef<MobileNotice | undefined>(undefined);
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
    // `gate.signOut` closes the generation before the provider is asked.
    endMobileSession({ dispatch, notice, signOut: gate.signOut });
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
    const tableId = draft.tableId;
    const target = activeOrdersReadTarget(state, tableId);
    if (target === undefined || tableId === undefined || token === undefined) return;
    reader.start({
      onFailed: (failure, attempt) => {
        dispatch({ attempt, failure, scope: target, tableId, type: "activeOrdersFailed" });
      },
      onLoaded: (list, attempt) => {
        dispatch({ attempt, list, scope: target, tableId, type: "activeOrdersLoaded" });
      },
      onLoading: (attempt) => { dispatch({ attempt, scope: target, tableId, type: "activeOrdersLoading" }); },
      read: () => listActiveTableOrders(config, token, target, tableId),
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
    const key = `${draftContext}|${tableId}|${JSON.stringify(draft.lines)}`;
    delivery.run({
      build: () => {
        if (catalog === null) return undefined;
        const held = planRef.current;
        if (held !== undefined && held.key === key) return held.plan;
        const plan = buildOrderDeliveryPlan({
          catalog,
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
    randomUuid, restaurantId, state.branch, state.menu.value, state.shift,
  ]);

  const selectTable = useCallback((table: DiningTableV1): void => {
    dispatchDraft({ tableId: table.tableId, type: "tableSelected", zoneId: table.zoneId });
  }, []);

  const screen = mobileScreen(state);
  const notice = state.notice === undefined ? undefined : noticeMessage(state.notice);

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
        activeOrders={state.activeOrders}
        draft={draft}
        draftCategory={draftCategory}
        menu={state.menu}
        layout={state.layout}
        onDraftCategory={setDraftCategory}
        onDraftEvent={dispatchDraft}
        onRetryActiveOrders={retryActiveOrders}
        onRetryMenu={retryMenu}
        onRetryRead={retry}
        onRetryRevalidation={() => { dispatch({ type: "revalidationStarted" }); }}
        onSelectTable={selectTable}
        onSubmitDraft={submitDraft}
        revalidating={state.revalidating}
        revalidationFailure={state.revalidationFailure}
        tab={state.tab}
      />
    </View>
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
  draft,
  draftCategory,
  layout,
  menu,
  onDraftCategory,
  onDraftEvent,
  onRetryActiveOrders,
  onRetryMenu,
  onRetryRead,
  onRetryRevalidation,
  onSelectTable,
  onSubmitDraft,
  revalidating,
  revalidationFailure,
  tab,
}: {
  readonly activeOrders: MobileState["activeOrders"];
  readonly draft: OrderDraftState;
  readonly draftCategory: string | undefined;
  readonly layout: MobileState["layout"];
  readonly menu: MobileState["menu"];
  readonly onDraftCategory: (categoryId: string) => void;
  readonly onDraftEvent: (event: OrderDraftEvent) => void;
  readonly onRetryActiveOrders: () => void;
  readonly onRetryMenu: () => void;
  readonly onRetryRead: (tab: MobileTab) => void;
  readonly onRetryRevalidation: () => void;
  readonly onSelectTable: (table: DiningTableV1) => void;
  readonly onSubmitDraft: () => void;
  readonly revalidating: boolean;
  readonly revalidationFailure: MobileFailure | undefined;
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
    category={draftCategory}
    draft={draft}
    menu={menu}
    onBackToTables={() => { onDraftEvent({ intent: "leaveTable", type: "confirmationRequested" }); }}
    onCategorySelected={onDraftCategory}
    onEvent={onDraftEvent}
    onRetryActiveOrders={onRetryActiveOrders}
    onRetryMenu={onRetryMenu}
    onSubmit={onSubmitDraft}
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
