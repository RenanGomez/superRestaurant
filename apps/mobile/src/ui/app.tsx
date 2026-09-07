import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DiningTableV1 } from "@super-restaurant/shared-types";

import { gateMobileAuth, type MobileAuthGate } from "../auth-gate.js";
import type { MobileAuthPort } from "../auth-port.js";
import { createBranchReadTracker, type BranchReadTracker } from "../branch-read.js";
import type { MobileConfig } from "../config.js";
import { lifecycleEffects, type MobileAppStatus, type MobileLifecyclePort } from "../lifecycle.js";
import {
  authorizeBranch,
  getDiningLayout,
  getMenuCatalog,
  listMemberships,
  listOperationalShifts,
  type MobileBranchScope,
} from "../mobile-client.js";
import {
  activeScope,
  canReadBranchData,
  failureMessage,
  initialMobileState,
  layoutReadTarget,
  membershipsReadOperator,
  menuReadTarget,
  mobileScreen,
  noticeMessage,
  ownsMembershipsRead,
  reduceMobileState,
  shiftsReadTarget,
  toMobileFailure,
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
import {
  buildOrderDraftHandoff,
  disconnectedOrderDraftIntegration,
  type OrderDraftIntegration,
} from "../order-intents.js";
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

export function App({ auth, config, lifecycle, orderDraftIntegration = disconnectedOrderDraftIntegration }: {
  readonly auth: MobileAuthPort;
  readonly config: MobileConfig;
  readonly lifecycle: MobileLifecyclePort;
  /**
   * Who performs the Order writes. The default accepts the draft and reports
   * that nothing was sent, which is the truth of this slice: the composer is
   * built, the server-side integration is not.
   */
  readonly orderDraftIntegration?: OrderDraftIntegration;
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
      authorizeScope: (session, requested) => authorizeBranch(config, session.accessToken, requested),
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
      dispatch({ branch: outcome.branch, type: "revalidationSucceeded" });
      if (outcome.branch === undefined) loadMemberships(outcome.session);
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

  useEffect(() => {
    const pending = state.pendingScope;
    const session = state.session;
    if (pending === undefined || session === undefined) return undefined;
    let active = true;
    void authorizeBranch(config, session.accessToken, pending)
      .then((branch) => { if (active) dispatch({ branch, type: "branchAuthorized" }); })
      .catch((error: unknown) => {
        if (!active) return;
        const failure = toMobileFailure(error);
        dispatch({ failure, scope: pending, type: "branchRejected" });
        // A refused pair may mean the membership itself changed: read it again.
        if (failure === "authorization") loadMemberships(session);
      });
    return (): void => { active = false; };
  }, [config, dispatch, loadMemberships, state.pendingScope, state.session]);

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
  useEffect(() => {
    if (previousDraftContext.current === draftContext) return;
    previousDraftContext.current = draftContext;
    // The hand-over in flight, if any, belonged to the context being left. It is
    // abandoned here so it can neither block the new context nor apply its
    // outcome to the draft composed in it.
    delivery.abandon();
    dispatchDraft({ type: "contextReleased" });
    setDraftCategory(undefined);
  }, [delivery, draftContext]);

  const retry = useCallback((tab: MobileTab): void => {
    if (branchId === undefined || restaurantId === undefined) return;
    const target: MobileBranchScope = { branchId, restaurantId };
    dispatch(tab === "tables" ? { scope: target, type: "layoutReset" } : { scope: target, type: "menuReset" });
  }, [branchId, restaurantId]);

  const retryMenu = useCallback((): void => {
    if (branchId === undefined || restaurantId === undefined) return;
    dispatch({ scope: { branchId, restaurantId }, type: "menuReset" });
  }, [branchId, restaurantId]);

  const submitDraft = useCallback((): void => {
    const tableId = draft.tableId;
    const catalog = state.menu.value?.catalog ?? null;
    if (tableId === undefined || branchId === undefined || restaurantId === undefined) return;
    if (draft.lines.length === 0 || draft.composer !== undefined || draft.submission.status === "sending") return;

    delivery.run({
      build: () => (catalog === null
        ? undefined
        : buildOrderDraftHandoff({ catalog, lines: draft.lines, scope: { branchId, restaurantId }, tableId })),
      context: draftContext,
      integration: orderDraftIntegration,
      onSettle: (failure) => {
        dispatchDraft(failure === undefined
          ? { type: "submissionSucceeded" }
          : { failure, type: "submissionFailed" });
      },
      onStart: () => { dispatchDraft({ type: "submissionStarted" }); },
    });
  }, [branchId, delivery, draft, draftContext, orderDraftIntegration, restaurantId, state.menu.value]);

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
        draft={draft}
        draftCategory={draftCategory}
        menu={state.menu}
        layout={state.layout}
        onDraftCategory={setDraftCategory}
        onDraftEvent={dispatchDraft}
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
  draft,
  draftCategory,
  layout,
  menu,
  onDraftCategory,
  onDraftEvent,
  onRetryMenu,
  onRetryRead,
  onRetryRevalidation,
  onSelectTable,
  onSubmitDraft,
  revalidating,
  revalidationFailure,
  tab,
}: {
  readonly draft: OrderDraftState;
  readonly draftCategory: string | undefined;
  readonly layout: MobileState["layout"];
  readonly menu: MobileState["menu"];
  readonly onDraftCategory: (categoryId: string) => void;
  readonly onDraftEvent: (event: OrderDraftEvent) => void;
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
    category={draftCategory}
    draft={draft}
    menu={menu}
    onBackToTables={() => { onDraftEvent({ intent: "leaveTable", type: "confirmationRequested" }); }}
    onCategorySelected={onDraftCategory}
    onEvent={onDraftEvent}
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
