import { useCallback, useEffect, useReducer, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileAuthPort } from "../auth-port.js";
import type { MobileConfig } from "../config.js";
import {
  authorizeBranch,
  getDiningLayout,
  getMenuCatalog,
  listMemberships,
  type MobileBranchScope,
} from "../mobile-client.js";
import {
  activeScope,
  initialMobileState,
  mobileScreen,
  noticeMessage,
  reduceMobileState,
  toMobileFailure,
  type MobileNotice,
  type MobileTab,
} from "../mobile-state.js";
import { BranchScreen } from "./branch-screen.js";
import { ActionButton, Caption, LoadingBlock, Subheading } from "./components.js";
import { MenuScreen } from "./menu-screen.js";
import { SignInScreen } from "./sign-in-screen.js";
import { TablesScreen } from "./tables-screen.js";
import { colors, radius, spacing, touchTarget, typography } from "./theme.js";

const TAB_LABELS: Readonly<Record<MobileTab, string>> = Object.freeze({ menu: "Menú", tables: "Mesas" });

export function App({ auth, config }: {
  readonly auth: MobileAuthPort;
  readonly config: MobileConfig;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(reduceMobileState, initialMobileState);
  const pendingNotice = useRef<MobileNotice | undefined>(undefined);
  const membershipRequest = useRef(0);
  const token = state.session?.accessToken;
  const scope = activeScope(state);
  const branchId = scope?.branchId;
  const restaurantId = scope?.restaurantId;

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
        : { session, type: "signedIn" });
    });
    return (): void => { active = false; unsubscribe(); };
  }, [auth]);

  useEffect(() => {
    if (token !== undefined && state.memberships.status === "idle") loadMemberships(token);
  }, [loadMemberships, state.memberships.status, token]);

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
    if (token === undefined || branchId === undefined || restaurantId === undefined) return undefined;
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
  }, [branchId, config, restaurantId, state.layout.status, state.tab, token]);

  useEffect(() => {
    if (token === undefined || branchId === undefined || restaurantId === undefined) return undefined;
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
  }, [branchId, config, restaurantId, state.menu.status, state.tab, token]);

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
      {(["tables", "menu"] as const).map((tab) => <Pressable
        accessibilityLabel={TAB_LABELS[tab]}
        accessibilityRole="tab"
        accessibilityState={{ selected: state.tab === tab }}
        key={tab}
        onPress={() => { dispatch({ tab, type: "tabSelected" }); }}
        style={(pressableState) => [
          styles.tab,
          state.tab === tab && styles.tabSelected,
          pressableState.pressed && styles.tabPressed,
        ]}
      >
        <Text style={[styles.tabLabel, state.tab === tab && styles.tabLabelSelected]}>{TAB_LABELS[tab]}</Text>
      </Pressable>)}
    </View>

    <View style={styles.content}>
      {state.tab === "tables"
        ? <TablesScreen layout={state.layout} onRetry={() => { retry("tables"); }} />
        : <MenuScreen menu={state.menu} onRetry={() => { retry("menu"); }} />}
    </View>
  </View>;
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
