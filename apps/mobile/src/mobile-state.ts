import type {
  BranchMembershipSummaryV1,
  DiningLayoutV1,
  MenuCatalogStateV1,
  OperationalShiftListV1,
  OperationalShiftSummaryV1,
} from "@super-restaurant/shared-types";

import { MobileRequestError, type AuthorizedMobileBranch, type MobileBranchScope } from "./mobile-client.js";
import { isSameOperator, type MobileSession } from "./session.js";

export type MobileScreen = "starting" | "signIn" | "branches" | "shifts" | "workspace";
export type MobileTab = "tables" | "menu";
export type MobileFailure = "authorization" | "network" | "protocol" | "unavailable";
export type MobileNotice = "branchRevoked" | "sessionEnded";
export type MobileResourceStatus = "failed" | "idle" | "loading" | "ready";

export interface MobileResource<T> {
  /**
   * Which read owns this resource. It is set while the resource is `loading`
   * and `undefined` in every other status, so it names exactly one request:
   * the one the screen is still waiting for.
   *
   * What the resource belongs to cannot name it on its own. Restaurant/Branch
   * is the same pair before and after a token renewal, a shift change or a
   * foreground revalidation; an operator can read the membership list twice in
   * one session. An answer that no longer matches the attempt on the resource
   * is an answer nobody is waiting for, and it is dropped instead of applied.
   */
  readonly attempt: number | undefined;
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
  /** True while the foreground revalidation of session and scope is running. */
  readonly revalidating: boolean;
  /** Set when that revalidation could not complete; blocks every branch read. */
  readonly revalidationFailure: MobileFailure | undefined;
  readonly session: MobileSession | undefined;
  readonly shift: OperationalShiftSummaryV1 | undefined;
  readonly shifts: MobileResource<OperationalShiftListV1>;
  readonly started: boolean;
  readonly tab: MobileTab;
}

export type MobileEvent =
  | { readonly type: "accessRevoked" }
  | { readonly type: "branchAuthorized"; readonly branch: AuthorizedMobileBranch }
  | { readonly type: "branchRejected"; readonly failure: MobileFailure; readonly scope: MobileBranchScope }
  | { readonly type: "branchReleased" }
  | { readonly type: "branchRequested"; readonly scope: MobileBranchScope }
  | { readonly type: "layoutFailed"; readonly attempt: number; readonly failure: MobileFailure; readonly scope: MobileBranchScope }
  | { readonly type: "layoutLoaded"; readonly attempt: number; readonly layout: DiningLayoutV1; readonly scope: MobileBranchScope }
  | { readonly type: "layoutLoading"; readonly attempt: number; readonly scope: MobileBranchScope }
  | { readonly type: "layoutReset"; readonly scope: MobileBranchScope }
  | { readonly type: "membershipsFailed"; readonly attempt: number; readonly failure: MobileFailure; readonly operator: string }
  | { readonly type: "membershipsLoaded"; readonly attempt: number; readonly memberships: readonly BranchMembershipSummaryV1[]; readonly operator: string }
  | { readonly type: "membershipsLoading"; readonly attempt: number; readonly operator: string }
  | { readonly type: "menuFailed"; readonly attempt: number; readonly failure: MobileFailure; readonly scope: MobileBranchScope }
  | { readonly type: "menuLoaded"; readonly attempt: number; readonly menu: MenuCatalogStateV1; readonly scope: MobileBranchScope }
  | { readonly type: "menuLoading"; readonly attempt: number; readonly scope: MobileBranchScope }
  | { readonly type: "menuReset"; readonly scope: MobileBranchScope }
  | { readonly type: "revalidationFailed"; readonly failure: MobileFailure }
  | { readonly type: "revalidationStarted" }
  | { readonly type: "revalidationSucceeded"; readonly branch: AuthorizedMobileBranch | undefined }
  | { readonly type: "sessionObserved"; readonly session: MobileSession }
  | { readonly type: "sessionRestored"; readonly session: MobileSession | undefined }
  | { readonly type: "signedOut"; readonly notice: MobileNotice | undefined }
  | { readonly type: "shiftReleased" }
  | { readonly type: "shiftSelected"; readonly shift: OperationalShiftSummaryV1 }
  | { readonly type: "shiftsFailed"; readonly attempt: number; readonly failure: MobileFailure; readonly scope: MobileBranchScope }
  | { readonly type: "shiftsLoaded"; readonly attempt: number; readonly list: OperationalShiftListV1; readonly scope: MobileBranchScope }
  | { readonly type: "shiftsLoading"; readonly attempt: number; readonly scope: MobileBranchScope }
  | { readonly type: "shiftsReset"; readonly scope: MobileBranchScope }
  | { readonly type: "tabSelected"; readonly tab: MobileTab };

const idleResource = Object.freeze({
  attempt: undefined,
  failure: undefined,
  status: "idle",
  value: undefined,
}) as MobileResource<never>;

export const initialMobileState: MobileState = Object.freeze({
  branch: undefined,
  branchFailure: undefined,
  layout: idleResource,
  memberships: idleResource,
  menu: idleResource,
  notice: undefined,
  pendingScope: undefined,
  revalidating: false,
  revalidationFailure: undefined,
  session: undefined,
  shift: undefined,
  shifts: idleResource,
  started: false,
  tab: "tables",
});

export function reduceMobileState(state: MobileState, event: MobileEvent): MobileState {
  switch (event.type) {
    case "sessionRestored":
      return event.session === undefined
        ? signedOutState(state.notice, true)
        : freeze({ ...initialMobileState, session: event.session, started: true });
    case "sessionObserved":
      // Whether a session may be observed at all is not decided here: the
      // authentication gate (`src/auth-gate.ts`) only lets through what belongs
      // to the generation that is open, so a notification about a session this
      // device already closed never reaches the reducer. What is decided here
      // is what an accepted session does to the screen: a renewed token of the
      // operator in place keeps the branch and its data; a first session, or a
      // different operator, starts from a clean state so nothing from a
      // previous scope survives. Identity is the immutable Supabase user id: an
      // email is display data and could be reassigned.
      //
      // A renewed token keeps the data that is already on screen, but not the
      // reads still in flight — the membership list included: those were started
      // with the token that is being replaced, and their answer — a 401 from it
      // above all — belongs to a request nobody is waiting for any more. They
      // are left `idle`, which is what starts a fresh read instead of leaving a
      // spinner nobody will ever answer.
      if (state.session === undefined || !isSameOperator(state.session, event.session)) {
        return freeze({ ...initialMobileState, session: event.session, started: true });
      }
      return freeze(state.session.accessToken === event.session.accessToken
        ? { ...state, session: event.session, started: true }
        : withoutReadsInFlight({ ...state, session: event.session, started: true }));
    case "signedOut":
      // Nothing about the closed session is kept — no token, no identity, no
      // derived key. Refusing what the provider says afterwards is the gate's
      // job, and it does it without remembering any credential.
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
      return freeze(revokedState(state));
    case "revalidationStarted":
      // Idempotent on purpose: repeated foreground events while a revalidation
      // is in flight must not start a second one. Branch data is dropped here,
      // before any request, so nothing loaded earlier can stay on screen while
      // the scope is unconfirmed.
      return state.revalidating
        ? state
        : freeze({
          ...state,
          layout: idleResource,
          menu: idleResource,
          shift: undefined,
          shifts: idleResource,
          revalidating: true,
          revalidationFailure: undefined,
        });
    case "revalidationSucceeded":
      if (!state.revalidating) return state;
      if (event.branch === undefined) {
        return freeze({ ...state, revalidating: false, revalidationFailure: undefined });
      }
      // An answer for a pair that is no longer active is ignored, exactly as in
      // the selection flow.
      return state.branch !== undefined && sameScope(state.branch, event.branch)
        ? freeze({ ...state, branch: event.branch, revalidating: false, revalidationFailure: undefined })
        : state;
    case "revalidationFailed":
      if (!state.revalidating) return state;
      if (event.failure === "authorization") return freeze(revokedState(state));
      return freeze({ ...state, revalidating: false, revalidationFailure: event.failure });
    case "membershipsLoading":
      // Only the operator in place may put their own list on screen. There is
      // no attempt to match yet — this event is what creates one — so the owner
      // is the whole test, which also stops a read started for the previous
      // operator from blanking the list of the one who is here now.
      return state.session.userId === event.operator
        ? freeze({ ...state, memberships: loading(event.attempt) })
        : state;
    case "membershipsLoaded":
      return ownsMembershipsRead(state, event)
        ? freeze({ ...state, memberships: ready(Object.freeze([...event.memberships])) })
        : state;
    case "membershipsFailed":
      if (!ownsMembershipsRead(state, event)) return state;
      // A token the server refuses ends the session on this device. Deciding it
      // here is what keeps a late 401 of the previous operator from closing the
      // session of the one who is signed in now: that answer is not owned, so
      // it never reaches this line. Telling the provider is the screen's half.
      return event.failure === "authorization"
        ? signedOutState("sessionEnded", true)
        : freeze({ ...state, memberships: failed(event.failure) });
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
        shift: undefined,
        shifts: idleResource,
        revalidating: false,
        revalidationFailure: undefined,
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
        shift: undefined,
        shifts: idleResource,
        revalidating: false,
        revalidationFailure: undefined,
        tab: "tables",
      });
    case "shiftSelected":
      // The operational reads belong to the shift too, so a layout or catalog
      // request started under the previous one stops being the current attempt.
      return state.branch !== undefined && state.shifts.status === "ready"
        && state.shifts.value?.shifts.some((candidate) => candidate.shiftId === event.shift.shiftId)
        && sameScope(state.branch, event.shift.scope)
        ? freeze(withoutBranchReadsInFlight({ ...state, shift: event.shift }))
        : state;
    case "shiftReleased":
      return freeze({ ...state, layout: idleResource, menu: idleResource, shift: undefined, tab: "tables" });
    case "shiftsLoading":
      return forActiveScope(state, event.scope, (current) => ({ ...current, shifts: loading(event.attempt) }));
    case "shiftsLoaded":
      return forCurrentRead(state, event, state.shifts, (current) => ({ ...current, shifts: ready(event.list) }));
    case "shiftsFailed":
      return forCurrentRead(state, event, state.shifts, (current) => (event.failure === "authorization"
        ? revokedState(current)
        : { ...current, shifts: failed(event.failure) }));
    case "shiftsReset":
      return forActiveScope(state, event.scope, (current) => ({ ...current, shifts: idleResource }));
    case "tabSelected":
      return state.branch === undefined || state.shift === undefined ? state : freeze({ ...state, tab: event.tab });
    case "layoutLoading":
      return forActiveScope(state, event.scope, (current) => ({ ...current, layout: loading(event.attempt) }));
    case "layoutLoaded":
      return forCurrentRead(state, event, state.layout, (current) => ({ ...current, layout: ready(event.layout) }));
    case "layoutFailed":
      return forCurrentRead(state, event, state.layout, (current) => (event.failure === "authorization"
        ? revokedState(current)
        : { ...current, layout: failed(event.failure) }));
    case "layoutReset":
      // Retry: back to idle, which is what makes the screen read again. It also
      // gives up the attempt in flight, so the retry owns the next answer.
      return forActiveScope(state, event.scope, (current) => ({ ...current, layout: idleResource }));
    case "menuLoading":
      return forActiveScope(state, event.scope, (current) => ({ ...current, menu: loading(event.attempt) }));
    case "menuLoaded":
      return forCurrentRead(state, event, state.menu, (current) => ({ ...current, menu: ready(event.menu) }));
    case "menuFailed":
      return forCurrentRead(state, event, state.menu, (current) => (event.failure === "authorization"
        ? revokedState(current)
        : { ...current, menu: failed(event.failure) }));
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
  if (state.revalidating || state.revalidationFailure !== undefined) return "workspace";
  if (state.shift === undefined) return "shifts";
  return "workspace";
}

/** The active pair, or `undefined` while no branch is authorized. */
export function activeScope(state: MobileState): MobileBranchScope | undefined {
  return state.branch === undefined
    ? undefined
    : Object.freeze({ branchId: state.branch.branchId, restaurantId: state.branch.restaurantId });
}

/**
 * Branch-scoped reads are allowed only when the scope is confirmed: never while
 * a foreground revalidation is running, and never after one failed.
 */
export function canReadBranchData(state: MobileState): boolean {
  return state.branch !== undefined && !state.revalidating && state.revalidationFailure === undefined;
}

/** Tables and menu are operational reads and require a freshly selected open shift. */
export function canReadOperationalData(state: MobileState): boolean {
  return canReadBranchData(state) && state.shift !== undefined;
}

/**
 * The Restaurant/Branch pair each branch-scoped read may be started for right
 * now, or `undefined` when the state does not authorize starting it.
 *
 * State alone decides this, and it decides it in one place: the screen effects
 * ask these functions instead of restating the conditions in a dependency list.
 * A read starts only from `idle`, and `idle` is exactly what every event that
 * invalidates a read leaves behind, so giving up an answer and starting the
 * current read are the same transition seen from both sides.
 */
export function shiftsReadTarget(state: MobileState): MobileBranchScope | undefined {
  return canReadBranchData(state) && state.shifts.status === "idle" ? activeScope(state) : undefined;
}

export function layoutReadTarget(state: MobileState): MobileBranchScope | undefined {
  return canReadOperationalData(state) && state.tab === "tables" && state.layout.status === "idle"
    ? activeScope(state)
    : undefined;
}

/**
 * The catalog also backs the draft composer, which lives inside the tables tab,
 * so it is read whenever a table is selected as well.
 */
export function menuReadTarget(state: MobileState, tableSelected: boolean): MobileBranchScope | undefined {
  if (!canReadOperationalData(state) || state.menu.status !== "idle") return undefined;
  return state.tab === "menu" || tableSelected ? activeScope(state) : undefined;
}

/**
 * Identity of one membership read: the operator it was started for and the
 * attempt that started it.
 *
 * The membership list is not branch-scoped — it belongs to an operator — so its
 * owner is the immutable Supabase `userId`, never the email and never the token.
 * The attempt is what distinguishes two reads of the *same* operator, which is
 * what a token renewal or a retry produces.
 */
export interface MembershipsRead {
  readonly attempt: number;
  readonly operator: string;
}

/**
 * Whether a membership answer may still be applied: same operator, and the
 * attempt the resource is waiting for. Both halves are required, and both are
 * checked here rather than in the screen, so success, failure and the sign-out
 * a 401 causes are decided in one place.
 */
export function ownsMembershipsRead(state: MobileState, read: MembershipsRead): boolean {
  return state.session?.userId === read.operator && state.memberships.attempt === read.attempt;
}

/**
 * The operator whose membership list may be read right now, or `undefined` when
 * the state does not authorize starting that read. Same shape as the
 * branch-scoped targets: the screen asks, it does not decide.
 */
export function membershipsReadOperator(state: MobileState): string | undefined {
  if (state.session === undefined || state.revalidating || state.revalidationFailure !== undefined) return undefined;
  return state.memberships.status === "idle" ? state.session.userId : undefined;
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

/**
 * Applies the answer of a branch-scoped read only when that read is still the
 * one the resource is waiting for: the active Restaurant/Branch has to match,
 * and so does the attempt. The two together are the ownership test — success,
 * failure and the revocation a 401 causes all pass through here, so an answer
 * to a request the app already gave up on can change nothing at all.
 */
function forCurrentRead<T>(
  state: MobileState,
  event: { readonly attempt: number; readonly scope: MobileBranchScope },
  resource: MobileResource<T>,
  change: (current: MobileState) => MobileState,
): MobileState {
  if (resource.attempt !== event.attempt) return state;
  return forActiveScope(state, event.scope, change);
}

/**
 * Gives up every read that has not answered yet, leaving each one `idle` rather
 * than `loading`. Idle is what lets the screen start the read that is current
 * now; staying `loading` would wait forever for an answer that can no longer be
 * applied. Resources that already settled are left exactly as they are.
 */
function withoutReadsInFlight(state: MobileState): MobileState {
  return { ...withoutBranchReadsInFlight(state), memberships: givenUp(state.memberships) };
}

/** The same, for the three reads a shift change invalidates but a list read outlives. */
function withoutBranchReadsInFlight(state: MobileState): MobileState {
  return {
    ...state,
    layout: givenUp(state.layout),
    menu: givenUp(state.menu),
    shifts: givenUp(state.shifts),
  };
}

function givenUp<T>(resource: MobileResource<T>): MobileResource<T> {
  return resource.status === "loading" ? idleResource : resource;
}

/** The branch is gone and so is everything read for it; memberships are re-read. */
function revokedState(state: MobileState): MobileState {
  return {
    ...state,
    branch: undefined,
    branchFailure: "authorization",
    layout: idleResource,
    memberships: idleResource,
    menu: idleResource,
    notice: "branchRevoked",
    pendingScope: undefined,
    shift: undefined,
    shifts: idleResource,
    revalidating: false,
    revalidationFailure: undefined,
    tab: "tables",
  };
}

function loading<T>(attempt: number): MobileResource<T> {
  return Object.freeze({ attempt, failure: undefined, status: "loading", value: undefined });
}

function ready<T>(value: T): MobileResource<T> {
  return Object.freeze({ attempt: undefined, failure: undefined, status: "ready", value });
}

function failed<T>(failure: MobileFailure): MobileResource<T> {
  return Object.freeze({ attempt: undefined, failure, status: "failed", value: undefined });
}

function frozenScope(scope: MobileBranchScope): MobileBranchScope {
  return Object.freeze({ branchId: scope.branchId, restaurantId: scope.restaurantId });
}

function freeze(state: MobileState): MobileState {
  return Object.freeze(state);
}
