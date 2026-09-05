import { useCallback, useEffect, useReducer, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileAuthPort } from "../auth-port.js";
import type { MobileConfig } from "../config.js";
import { lifecycleEffects, type MobileAppStatus, type MobileLifecyclePort } from "../lifecycle.js";
import {
  authorizeBranch,
  getDiningLayout,
  getMenuCatalog,
  listMemberships,
  type MobileBranchScope,
} from "../mobile-client.js";
import {
  activeScope,
  canReadBranchData,
  failureMessage,
  initialMobileState,
  mobileScreen,
  noticeMessage,
  reduceMobileState,
  toMobileFailure,
  type MobileFailure,
  type MobileNotice,
  type MobileState,
  type MobileTab,
} from "../mobile-state.js";
import { BranchScreen } from "./branch-screen.js";
import { ActionButton, Banner, Caption, LoadingBlock, StateBlock, Subheading, useFocusRing } from "./components.js";
import { MenuScreen } from "./menu-screen.js";
import { SignInScreen } from "./sign-in-screen.js";
import { TablesScreen } from "./tables-screen.js";
import { colors, radius, spacing, touchTarget, typography } from "./theme.js";

const TAB_LABELS: Readonly<Record<MobileTab, string>> = Object.freeze({ menu: "Menú", tables: "Mesas" });

export function App({ auth, config, lifecycle }: {
  readonly auth: MobileAuthPort;
  readonly config: MobileConfig;
  readonly lifecycle: MobileLifecyclePort;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(reduceMobileState, initialMobileState);
  const pendingNotice = useRef<MobileNotice | undefined>(undefined);
  const membershipRequest = useRef(0);
  const token = state.session?.accessToken;
  const scope = activeScope(state);
  const branchId = scope?.branchId;
  const restaurantId = scope?.restaurantId;
  const readable = canReadBranchData(state);

  /** Ends the session on this device only, keeping the reason to explain it. */
  const endSession = useCallback((notice: MobileNotice | undefined): void => {
    pendingNotice.current = notice;
    void auth.signOut().finally(() => {
      dispatch({ notice, type: "signedOut" });
      pendingNotice.current = undefined;
    });
  }, [auth]);

  const loadMemberships = useCallback((accessToken: string): void => {
    const request = membershipRequest.current + 1;
    membershipRequest.current = request;
    dispatch({ type: "membershipsLoading" });
    void listMemberships(config, accessToken)
      .then((list) => {
        if (membershipRequest.current === request) dispatch({ memberships: list.memberships, type: "membershipsLoaded" });
      })
      .catch((error: unknown) => {
        if (membershipRequest.current !== request) return;
        const failure = toMobileFailure(error);
        if (failure === "authorization") endSession("sessionEnded");
        else dispatch({ failure, type: "membershipsFailed" });
      });
  }, [config, endSession]);

  useEffect(() => {
    let active = true;
    void auth.currentSession().then((session) => {
      if (active) dispatch({ session, type: "sessionRestored" });
    });
    const unsubscribe = auth.onSessionChange((session) => {
      dispatch(session === undefined
        ? { notice: pendingNotice.current, type: "signedOut" }
        : { session, type: "sessionObserved" });
    });
    // The token ticker only runs while this component is mounted and the app is
    // in the foreground; it never writes anything to the device.
    void auth.startAutoRefresh();
    return (): void => { active = false; unsubscribe(); void auth.stopAutoRefresh(); };
  }, [auth]);

  // Foreground lifecycle: drive the token ticker and revalidate the session and
  // the exact Restaurant/Branch pair on every real return to the foreground.
  useEffect(() => {
    let previous: MobileAppStatus = "active";
    return lifecycle.subscribe((next) => {
      const effects = lifecycleEffects(previous, next);
      previous = next;
      void (effects.autoRefresh === "start" ? auth.startAutoRefresh() : auth.stopAutoRefresh());
      if (effects.revalidate) dispatch({ type: "revalidationStarted" });
    });
  }, [auth, lifecycle]);

  // One revalidation at a time: the reducer ignores repeated starts, and this
  // effect only runs while `revalidating` is true.
  useEffect(() => {
    if (!state.revalidating) return undefined;
    let active = true;
    const target = branchId !== undefined && restaurantId !== undefined
      ? { branchId, restaurantId } satisfies MobileBranchScope
      : undefined;
    void (async (): Promise<void> => {
      const session = await auth.currentSession();
      if (!active) return;
      if (session === undefined) { endSession("sessionEnded"); return; }
      dispatch({ session, type: "sessionObserved" });
      if (target === undefined) {
        dispatch({ branch: undefined, type: "revalidationSucceeded" });
        loadMemberships(session.accessToken);
        return;
      }
      try {
        const branch = await authorizeBranch(config, session.accessToken, target);
        if (active) dispatch({ branch, type: "revalidationSucceeded" });
      } catch (error: unknown) {
        if (active) dispatch({ failure: toMobileFailure(error), type: "revalidationFailed" });
      }
    })();
    return (): void => { active = false; };
  }, [auth, branchId, config, endSession, loadMemberships, restaurantId, state.revalidating]);

  useEffect(() => {
    if (readable && token !== undefined && state.memberships.status === "idle") loadMemberships(token);
  }, [loadMemberships, readable, state.memberships.status, token]);

  useEffect(() => {
    const pending = state.pendingScope;
    if (pending === undefined || token === undefined) return undefined;
    let active = true;
    void authorizeBranch(config, token, pending)
      .then((branch) => { if (active) dispatch({ branch, type: "branchAuthorized" }); })
      .catch((error: unknown) => {
        if (!active) return;
        const failure = toMobileFailure(error);
        dispatch({ failure, scope: pending, type: "branchRejected" });
        // A refused pair may mean the membership itself changed: read it again.
        if (failure === "authorization") loadMemberships(token);
      });
    return (): void => { active = false; };
  }, [config, loadMemberships, state.pendingScope, token]);

  useEffect(() => {
    if (!readable || token === undefined || branchId === undefined || restaurantId === undefined) return undefined;
    if (state.tab !== "tables" || state.layout.status !== "idle") return undefined;
    const target: MobileBranchScope = { branchId, restaurantId };
    let active = true;
    dispatch({ scope: target, type: "layoutLoading" });
    void getDiningLayout(config, token, target)
      .then((layout) => { if (active) dispatch({ layout, scope: target, type: "layoutLoaded" }); })
      .catch((error: unknown) => {
        if (!active) return;
        const failure = toMobileFailure(error);
        if (failure === "authorization") dispatch({ type: "accessRevoked" });
        else dispatch({ failure, scope: target, type: "layoutFailed" });
      });
    return (): void => { active = false; };
  }, [branchId, config, readable, restaurantId, state.layout.status, state.tab, token]);

  useEffect(() => {
    if (!readable || token === undefined || branchId === undefined || restaurantId === undefined) return undefined;
    if (state.tab !== "menu" || state.menu.status !== "idle") return undefined;
    const target: MobileBranchScope = { branchId, restaurantId };
    let active = true;
    dispatch({ scope: target, type: "menuLoading" });
    void getMenuCatalog(config, token, target)
      .then((menu) => { if (active) dispatch({ menu, scope: target, type: "menuLoaded" }); })
      .catch((error: unknown) => {
        if (!active) return;
        const failure = toMobileFailure(error);
        if (failure === "authorization") dispatch({ type: "accessRevoked" });
        else dispatch({ failure, scope: target, type: "menuFailed" });
      });
    return (): void => { active = false; };
  }, [branchId, config, readable, restaurantId, state.menu.status, state.tab, token]);

  const retry = useCallback((tab: MobileTab): void => {
    if (branchId === undefined || restaurantId === undefined) return;
    const target: MobileBranchScope = { branchId, restaurantId };
    dispatch(tab === "tables" ? { scope: target, type: "layoutReset" } : { scope: target, type: "menuReset" });
  }, [branchId, restaurantId]);

  const screen = mobileScreen(state);
  const notice = state.notice === undefined ? undefined : noticeMessage(state.notice);

  if (screen === "starting") return <LoadingBlock label="Abriendo superRestaurant…" />;

  if (screen === "signIn") return <SignInScreen notice={notice} onSignIn={auth.signIn} />;

  if (screen === "branches") {
    return <BranchScreen
      branchFailure={state.branchFailure}
      memberships={state.memberships}
      notice={notice}
      onRetry={() => { if (token !== undefined) loadMemberships(token); }}
      onSelect={(selected) => { dispatch({ scope: selected, type: "branchRequested" }); }}
      onSignOut={() => { endSession(undefined); }}
      pendingScope={state.pendingScope}
    />;
  }

  const membership = state.memberships.value?.find((candidate) => (
    candidate.scope.restaurantId === restaurantId && candidate.scope.branchId === branchId
  ));

  return <View style={styles.workspace}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Caption>{membership?.restaurantName ?? "Restaurante autorizado"}</Caption>
        <Subheading>{membership?.branchName ?? "Sucursal autorizada"}</Subheading>
        <Caption>{state.session?.email ?? ""}</Caption>
      </View>
      <View style={styles.headerActions}>
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
        menu={state.menu}
        layout={state.layout}
        onRetryRead={retry}
        onRetryRevalidation={() => { dispatch({ type: "revalidationStarted" }); }}
        revalidating={state.revalidating}
        revalidationFailure={state.revalidationFailure}
        tab={state.tab}
      />
    </View>
  </View>;
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
function WorkspaceContent({ layout, menu, onRetryRead, onRetryRevalidation, revalidating, revalidationFailure, tab }: {
  readonly layout: MobileState["layout"];
  readonly menu: MobileState["menu"];
  readonly onRetryRead: (tab: MobileTab) => void;
  readonly onRetryRevalidation: () => void;
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
  return tab === "tables"
    ? <TablesScreen layout={layout} onRetry={() => { onRetryRead("tables"); }} />
    : <MenuScreen menu={menu} onRetry={() => { onRetryRead("menu"); }} />;
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
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
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
