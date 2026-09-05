import type {
  BranchMembershipSummaryV1,
  DiningLayoutV1,
  MenuCatalogStateV1,
} from "@super-restaurant/shared-types";

import { MobileRequestError, type AuthorizedMobileBranch, type MobileBranchScope } from "./mobile-client.js";
import type { MobileSession } from "./session.js";

export type MobileScreen = "starting" | "signIn" | "branches" | "workspace";
export type MobileTab = "tables" | "menu";
export type MobileFailure = "authorization" | "network" | "protocol" | "unavailable";
export type MobileNotice = "branchRevoked" | "sessionEnded";
export type MobileResourceStatus = "failed" | "idle" | "loading" | "ready";

export interface MobileResource<T> {
  readonly failure: MobileFailure | undefined;
  readonly status: MobileResourceStatus;
  readonly value: T | undefined;
}

/**
 * Whole client state. Everything below `branch` belongs to exactly one
 * authorized Restaurant/Branch pair: selecting, changing or releasing a branch
 * drops the previous branch's data in the same transition, so one branch can
 * never render data that was loaded for another.
 */
export interface MobileState {
  readonly branch: AuthorizedMobileBranch | undefined;
  readonly branchFailure: MobileFailure | undefined;
  readonly layout: MobileResource<DiningLayoutV1>;
  readonly memberships: MobileResource<readonly BranchMembershipSummaryV1[]>;
  readonly menu: MobileResource<MenuCatalogStateV1>;
  readonly notice: MobileNotice | undefined;
  readonly pendingScope: MobileBranchScope | undefined;
  readonly session: MobileSession | undefined;
  readonly started: boolean;
  readonly tab: MobileTab;
}

export type MobileEvent =
  | { readonly type: "accessRevoked" }
  | { readonly type: "branchAuthorized"; readonly branch: AuthorizedMobileBranch }
  | { readonly type: "branchRejected"; readonly failure: MobileFailure; readonly scope: MobileBranchScope }
  | { readonly type: "branchReleased" }
  | { readonly type: "branchRequested"; readonly scope: MobileBranchScope }
  | { readonly type: "layoutFailed"; readonly failure: MobileFailure; readonly scope: MobileBranchScope }
  | { readonly type: "layoutLoaded"; readonly layout: DiningLayoutV1; readonly scope: MobileBranchScope }
  | { readonly type: "layoutLoading"; readonly scope: MobileBranchScope }
  | { readonly type: "layoutReset"; readonly scope: MobileBranchScope }
  | { readonly type: "membershipsFailed"; readonly failure: MobileFailure }
  | { readonly type: "membershipsLoaded"; readonly memberships: readonly BranchMembershipSummaryV1[] }
  | { readonly type: "membershipsLoading" }
  | { readonly type: "menuFailed"; readonly failure: MobileFailure; readonly scope: MobileBranchScope }
  | { readonly type: "menuLoaded"; readonly menu: MenuCatalogStateV1; readonly scope: MobileBranchScope }
  | { readonly type: "menuLoading"; readonly scope: MobileBranchScope }
  | { readonly type: "menuReset"; readonly scope: MobileBranchScope }
  | { readonly type: "sessionRestored"; readonly session: MobileSession | undefined }
  | { readonly type: "signedIn"; readonly session: MobileSession }
  | { readonly type: "signedOut"; readonly notice: MobileNotice | undefined }
  | { readonly type: "tabSelected"; readonly tab: MobileTab };

const idleResource = Object.freeze({ failure: undefined, status: "idle", value: undefined }) as MobileResource<never>;

export const initialMobileState: MobileState = Object.freeze({
  branch: undefined,
  branchFailure: undefined,
  layout: idleResource,
  memberships: idleResource,
  menu: idleResource,
  notice: undefined,
  pendingScope: undefined,
  session: undefined,
  started: false,
  tab: "tables",
});

export function reduceMobileState(state: MobileState, event: MobileEvent): MobileState {
  switch (event.type) {
    case "sessionRestored":
      return event.session === undefined
        ? signedOutState(state.notice, true)
        : freeze({ ...initialMobileState, session: event.session, started: true });
    case "signedIn":
      return freeze({ ...initialMobileState, session: event.session, started: true });
    case "signedOut":
      return signedOutState(event.notice, true);
    default:
      break;
  }

  // Nothing else is accepted without a session: a late response that arrives
  // after sign-out must not repopulate the screen.
  if (state.session === undefined) return state;

  switch (event.type) {
    case "accessRevoked":
      // The server refused an authorized branch mid-session. Drop the branch and
      // its data, and force the membership list to be read again from Nest.
      return freeze({
        ...state,
        branch: undefined,
        branchFailure: "authorization",
        layout: idleResource,
        memberships: idleResource,
        menu: idleResource,
        notice: "branchRevoked",
        pendingScope: undefined,
        tab: "tables",
      });
    case "membershipsLoading":
      return freeze({ ...state, memberships: loading(state.memberships) });
    case "membershipsLoaded":
      return freeze({ ...state, memberships: ready(Object.freeze([...event.memberships])) });
    case "membershipsFailed":
      return freeze({ ...state, memberships: failed(event.failure) });
    case "branchRequested":
      // Clearing branch-scoped data here is what keeps the previous branch from
      // being visible while the new pair is revalidated.
      return freeze({
        ...state,
        branch: undefined,
        branchFailure: undefined,
        layout: idleResource,
        menu: idleResource,
        notice: undefined,
        pendingScope: frozenScope(event.scope),
        tab: "tables",
      });
    case "branchAuthorized":
      return state.pendingScope !== undefined && sameScope(state.pendingScope, event.branch)
        ? freeze({ ...state, branch: event.branch, branchFailure: undefined, pendingScope: undefined })
        : state;
    case "branchRejected":
      return state.pendingScope !== undefined && sameScope(state.pendingScope, event.scope)
        ? freeze({
          ...state,
          branchFailure: event.failure,
          notice: event.failure === "authorization" ? "branchRevoked" : state.notice,
          pendingScope: undefined,
        })
        : state;
    case "branchReleased":
      return freeze({
        ...state,
        branch: undefined,
        branchFailure: undefined,
        layout: idleResource,
        menu: idleResource,
        pendingScope: undefined,
        tab: "tables",
      });
    case "tabSelected":
      return state.branch === undefined ? state : freeze({ ...state, tab: event.tab });
    case "layoutLoading":
      return forActiveScope(state, event.scope, (current) => ({ ...current, layout: loading(current.layout) }));
    case "layoutLoaded":
      return forActiveScope(state, event.scope, (current) => ({ ...current, layout: ready(event.layout) }));
    case "layoutFailed":
      return forActiveScope(state, event.scope, (current) => ({ ...current, layout: failed(event.failure) }));
    case "layoutReset":
      // Retry: back to idle, which is what makes the screen read again.
      return forActiveScope(state, event.scope, (current) => ({ ...current, layout: idleResource }));
    case "menuLoading":
      return forActiveScope(state, event.scope, (current) => ({ ...current, menu: loading(current.menu) }));
    case "menuLoaded":
      return forActiveScope(state, event.scope, (current) => ({ ...current, menu: ready(event.menu) }));
    case "menuFailed":
      return forActiveScope(state, event.scope, (current) => ({ ...current, menu: failed(event.failure) }));
    case "menuReset":
      return forActiveScope(state, event.scope, (current) => ({ ...current, menu: idleResource }));
    default:
      return state;
  }
}

/** Which screen the state authorizes; never derived from navigation history. */
export function mobileScreen(state: MobileState): MobileScreen {
  if (!state.started) return "starting";
  if (state.session === undefined) return "signIn";
  if (state.branch === undefined) return "branches";
  return "workspace";
}

/** The active pair, or `undefined` while no branch is authorized. */
export function activeScope(state: MobileState): MobileBranchScope | undefined {
  return state.branch === undefined
    ? undefined
    : Object.freeze({ branchId: state.branch.branchId, restaurantId: state.branch.restaurantId });
}

/** True once Nest answered with an empty, and therefore explicit, membership list. */
export function hasNoMemberships(state: MobileState): boolean {
  return state.memberships.status === "ready" && (state.memberships.value?.length ?? 0) === 0;
}

export function sameScope(left: MobileBranchScope, right: MobileBranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

/** Maps a transport failure to the operational state the UI explains. */
export function toMobileFailure(error: unknown): MobileFailure {
  if (!(error instanceof MobileRequestError)) return "unavailable";
  if (error.status === "network") return "network";
  if (error.status === "protocol") return "protocol";
  if (error.status === 401 || error.status === 403) return "authorization";
  return "unavailable";
}

/** Operational Spanish messages, coherent with the web and KDS clients. */
export function failureMessage(failure: MobileFailure): string {
  return {
    authorization: "Tu acceso a esta sucursal ya no está autorizado.",
    network: "Sin conexión con el servidor. Revisa la red e inténtalo de nuevo.",
    protocol: "La respuesta del servidor no es válida. No se muestra información parcial.",
    unavailable: "El servicio no está disponible en este momento.",
  }[failure];
}

export function noticeMessage(notice: MobileNotice): string {
  return {
    branchRevoked: "Tu acceso a la sucursal seleccionada fue revocado.",
    sessionEnded: "Tu sesión se cerró en este dispositivo.",
  }[notice];
}

function signedOutState(notice: MobileNotice | undefined, started: boolean): MobileState {
  return freeze({ ...initialMobileState, notice, started });
}

function forActiveScope(
  state: MobileState,
  scope: MobileBranchScope,
  change: (current: MobileState) => MobileState,
): MobileState {
  const active = activeScope(state);
  return active !== undefined && sameScope(active, scope) ? freeze(change(state)) : state;
}

function loading<T>(current: MobileResource<T>): MobileResource<T> {
  return Object.freeze({ failure: undefined, status: "loading", value: current.value });
}

function ready<T>(value: T): MobileResource<T> {
  return Object.freeze({ failure: undefined, status: "ready", value });
}

function failed<T>(failure: MobileFailure): MobileResource<T> {
  return Object.freeze({ failure, status: "failed", value: undefined });
}

function frozenScope(scope: MobileBranchScope): MobileBranchScope {
  return Object.freeze({ branchId: scope.branchId, restaurantId: scope.restaurantId });
}

function freeze(state: MobileState): MobileState {
  return Object.freeze(state);
}
