import type {
  ActiveTableOrderListV2,
  BranchMembershipSummaryV1,
  BranchOperationalContextV1,
  CashPaymentQuoteV1,
  CheckoutOrderSummaryV1,
  DiningLayoutV1,
  MembershipRoleCode,
  MenuCatalogStateV1,
  OperationalShiftListV1,
  OperationalShiftSummaryV1,
  PaymentCollectionSummaryV1,
  SimplePaymentMethodV1,
  SyncConnectivityStateV1,
  SyncEntityTypeV1,
  SyncOperationV1,
  SyncOutboxStateV1,
} from "@super-restaurant/shared-types";

import { MobileRequestError, type MobileBranchScope } from "./mobile-client.js";
import { formatMinorUnitsInput } from "./money.js";
import { isSameOperator, type MobileSession } from "./session.js";

export type MobileScreen = "starting" | "signIn" | "branches" | "shifts" | "workspace";
export type MobileTab = "tables" | "menu";
export type MobileFailure = "authorization" | "network" | "protocol" | "unavailable";
export type MobilePaymentFailure = MobileFailure | "conflict" | "invalidAmount" | "noRegister";
export type MobileNotice = "branchRevoked" | "sessionEnded";
export type MobileResourceStatus = "failed" | "idle" | "loading" | "ready";

export interface MobilePaymentFields {
  readonly amountInput: string;
  readonly cardExternalConfirmed: boolean;
  readonly cardProvider: string;
  readonly cardReference: string;
  readonly method: SimplePaymentMethodV1;
  readonly receivedInput: string;
  readonly terminalId: string;
  readonly tipInput: string;
  readonly transferReference: string;
}

export interface MobilePaymentState extends MobilePaymentFields {
  readonly checkout: MobileResource<CheckoutOrderSummaryV1>;
  readonly checkoutFailure: MobilePaymentFailure | undefined;
  readonly orderId: string | undefined;
  readonly quote: MobileResource<CashPaymentQuoteV1>;
  readonly quoteFailure: MobilePaymentFailure | undefined;
  readonly submission: {
    readonly failure: MobilePaymentFailure | undefined;
    readonly receipt: PaymentCollectionSummaryV1 | undefined;
    readonly status: "collected" | "failed" | "idle" | "sending";
  };
}

/**
 * One durable local change waiting to reach the server. It is deliberately a
 * plain view of an outbox entry: raw error codes and internal states never
 * reach the screen, only the operator-facing reading produced below.
 */
export interface MobileSyncQueueItem {
  readonly eventId: string;
  readonly entityType: SyncEntityTypeV1;
  readonly operation: SyncOperationV1;
  readonly localState: SyncOutboxStateV1;
  readonly retryCount: number;
  /** Raw code from the engine; used only to derive a sentence, never rendered. */
  readonly errorCode: string | null;
  readonly occurredAt: string;
  readonly financial: boolean;
}

/**
 * What the connectivity banner and the pending queue are allowed to know.
 *
 * Everything here belongs to one Restaurant/Branch pair (`scope`). A snapshot
 * for another pair is dropped by the reducer, so a stale sync answer can never
 * describe a branch the operator already left.
 */
export interface MobileSyncSnapshot {
  readonly scope: MobileBranchScope | undefined;
  readonly connectivity: SyncConnectivityStateV1;
  readonly lastConfirmedSyncAt: string | null;
  readonly storageAvailable: boolean;
  readonly syncing: boolean;
  readonly items: readonly MobileSyncQueueItem[];
}

export const EMPTY_MOBILE_SYNC_SNAPSHOT: MobileSyncSnapshot = Object.freeze({
  connectivity: "online",
  items: Object.freeze([]),
  lastConfirmedSyncAt: null,
  scope: undefined,
  storageAvailable: false,
  syncing: false,
});

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

/** The complete operational owner of one active-Order snapshot or read. */
export interface ActiveOrdersTarget {
  readonly scope: MobileBranchScope;
  readonly shiftId: string;
  readonly tableId: string;
}

/**
 * Active Orders need a finer owner than the other branch reads. Two tables in
 * the same branch and shift are different security/operational contexts, so
 * the owner stays attached after loading as well as while the read is pending.
 */
export interface ActiveOrdersResource extends MobileResource<ActiveTableOrderListV2> {
  readonly target: ActiveOrdersTarget | undefined;
}

/**
 * Whole client state. Everything below `branch` belongs to exactly one
 * authorized Restaurant/Branch pair: selecting, changing or releasing a branch
 * drops the previous branch's data in the same transition, so one branch can
 * never render data that was loaded for another.
 */
/**
 * The authoritative operating context of one branch, flattened to what this app
 * uses. `timeZone` is the reason it exists: `CreateOrderCommandV2` requires the
 * branch's IANA zone, and only PostgreSQL knows it — a device must never decide
 * the operational day of a restaurant.
 */
export interface MobileBranchContext {
  readonly branchId: string;
  readonly restaurantId: string;
  readonly roles: readonly MembershipRoleCode[];
  readonly timeZone: string;
}

/** Identity of one operational-context read: operator, pair and attempt. */
export interface MobileContextRead {
  readonly attempt: number;
  readonly operator: string;
  readonly scope: MobileBranchScope;
}

export interface MobileState {
  /** The active branch and its context, or `undefined` while none is confirmed. */
  readonly branch: MobileBranchContext | undefined;
  readonly branchFailure: MobileFailure | undefined;
  /** The active Orders of the selected table, as the server reports them. */
  readonly activeOrders: ActiveOrdersResource;
  /** The context read in flight for `pendingScope`, if any. */
  readonly contextRead: MobileContextRead | undefined;
  readonly layout: MobileResource<DiningLayoutV1>;
  readonly memberships: MobileResource<readonly BranchMembershipSummaryV1[]>;
  readonly menu: MobileResource<MenuCatalogStateV1>;
  readonly notice: MobileNotice | undefined;
  readonly payment: MobilePaymentState;
  readonly pendingScope: MobileBranchScope | undefined;
  /** True while the foreground revalidation of session and scope is running. */
  readonly revalidating: boolean;
  /** Set when that revalidation could not complete; blocks every branch read. */
  readonly revalidationFailure: MobileFailure | undefined;
  readonly session: MobileSession | undefined;
  readonly shift: OperationalShiftSummaryV1 | undefined;
  readonly shifts: MobileResource<OperationalShiftListV1>;
  readonly started: boolean;
  /** Connectivity and the pending-sync queue of the active branch. */
  readonly sync: MobileSyncSnapshot;
  /** True while the operator is looking at the pending-sync queue screen. */
  readonly syncScreenOpen: boolean;
  readonly tab: MobileTab;
}

export type MobileEvent =
  | { readonly type: "accessRevoked" }
  | { readonly type: "activeOrdersFailed"; readonly attempt: number; readonly failure: MobileFailure; readonly scope: MobileBranchScope; readonly shiftId: string; readonly tableId: string }
  | { readonly type: "activeOrdersLoaded"; readonly attempt: number; readonly list: ActiveTableOrderListV2; readonly scope: MobileBranchScope; readonly shiftId: string; readonly tableId: string }
  | { readonly type: "activeOrdersLoading"; readonly attempt: number; readonly scope: MobileBranchScope; readonly shiftId: string; readonly tableId: string }
  | { readonly type: "activeOrdersReset"; readonly scope: MobileBranchScope }
  | { readonly type: "branchAuthorized"; readonly attempt: number; readonly context: BranchOperationalContextV1; readonly operator: string }
  | { readonly type: "branchContextRequested"; readonly attempt: number; readonly operator: string; readonly scope: MobileBranchScope }
  | { readonly type: "branchRejected"; readonly attempt: number; readonly failure: MobileFailure; readonly operator: string; readonly scope: MobileBranchScope }
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
  | { readonly orderId: string; readonly type: "paymentOpened" }
  | { readonly type: "paymentClosed" }
  | { readonly attempt: number; readonly orderId: string; readonly scope: MobileBranchScope; readonly type: "paymentCheckoutLoading" }
  | { readonly attempt: number; readonly checkout: CheckoutOrderSummaryV1; readonly scope: MobileBranchScope; readonly type: "paymentCheckoutLoaded" }
  | { readonly attempt: number; readonly failure: MobilePaymentFailure; readonly orderId: string; readonly scope: MobileBranchScope; readonly type: "paymentCheckoutFailed" }
  | { readonly type: "paymentCheckoutReset" }
  | { readonly patch: Partial<MobilePaymentFields>; readonly type: "paymentFieldChanged" }
  | { readonly attempt: number; readonly orderId: string; readonly scope: MobileBranchScope; readonly type: "paymentQuoteLoading" }
  | { readonly attempt: number; readonly quote: CashPaymentQuoteV1; readonly scope: MobileBranchScope; readonly type: "paymentQuoteLoaded" }
  | { readonly attempt: number; readonly failure: MobilePaymentFailure; readonly orderId: string; readonly scope: MobileBranchScope; readonly type: "paymentQuoteFailed" }
  | { readonly type: "paymentQuoteCleared" }
  | { readonly orderId: string; readonly type: "paymentSubmitStarted" }
  | { readonly receipt: PaymentCollectionSummaryV1; readonly scope: MobileBranchScope; readonly type: "paymentCollected" }
  | { readonly failure: MobilePaymentFailure; readonly orderId: string; readonly scope: MobileBranchScope; readonly type: "paymentSubmitFailed" }
  | { readonly type: "revalidationFailed"; readonly failure: MobileFailure }
  | { readonly type: "revalidationStarted" }
  | { readonly type: "revalidationSucceeded"; readonly context: BranchOperationalContextV1 | undefined }
  | { readonly type: "sessionObserved"; readonly session: MobileSession }
  | { readonly type: "sessionRestored"; readonly session: MobileSession | undefined }
  | { readonly type: "signedOut"; readonly notice: MobileNotice | undefined }
  | { readonly type: "shiftReleased" }
  | { readonly type: "shiftSelected"; readonly shift: OperationalShiftSummaryV1 }
  | { readonly type: "shiftsFailed"; readonly attempt: number; readonly failure: MobileFailure; readonly scope: MobileBranchScope }
  | { readonly type: "shiftsLoaded"; readonly attempt: number; readonly list: OperationalShiftListV1; readonly scope: MobileBranchScope }
  | { readonly type: "shiftsLoading"; readonly attempt: number; readonly scope: MobileBranchScope }
  | { readonly type: "shiftsReset"; readonly scope: MobileBranchScope }
  | { readonly type: "syncScreenClosed" }
  | { readonly type: "syncScreenOpened" }
  | { readonly snapshot: MobileSyncSnapshot; readonly scope: MobileBranchScope; readonly type: "syncSnapshotLoaded" }
  | { readonly type: "tabSelected"; readonly tab: MobileTab };

const idleResource = Object.freeze({
  attempt: undefined,
  failure: undefined,
  status: "idle",
  value: undefined,
}) as MobileResource<never>;

const idleActiveOrdersResource: ActiveOrdersResource = Object.freeze({
  ...idleResource,
  target: undefined,
});

const idlePaymentSubmission = Object.freeze({ failure: undefined, receipt: undefined, status: "idle" as const });

export const initialPaymentState: MobilePaymentState = Object.freeze({
  amountInput: "",
  cardExternalConfirmed: false,
  cardProvider: "",
  cardReference: "",
  checkout: idleResource,
  checkoutFailure: undefined,
  method: "cash",
  orderId: undefined,
  quote: idleResource,
  quoteFailure: undefined,
  receivedInput: "",
  submission: idlePaymentSubmission,
  terminalId: "",
  tipInput: "",
  transferReference: "",
});

export const initialMobileState: MobileState = Object.freeze({
  activeOrders: idleActiveOrdersResource,
  branch: undefined,
  branchFailure: undefined,
  contextRead: undefined,
  layout: idleResource,
  memberships: idleResource,
  menu: idleResource,
  notice: undefined,
  payment: initialPaymentState,
  pendingScope: undefined,
  revalidating: false,
  revalidationFailure: undefined,
  session: undefined,
  shift: undefined,
  shifts: idleResource,
  started: false,
  sync: EMPTY_MOBILE_SYNC_SNAPSHOT,
  syncScreenOpen: false,
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
          activeOrders: idleActiveOrdersResource,
          layout: idleResource,
          menu: idleResource,
          payment: initialPaymentState,
          shift: undefined,
          shifts: idleResource,
          revalidating: true,
          revalidationFailure: undefined,
          sync: EMPTY_MOBILE_SYNC_SNAPSHOT,
          syncScreenOpen: false,
        });
    case "revalidationSucceeded":
      if (!state.revalidating) return state;
      if (event.context === undefined) {
        return freeze({ ...state, revalidating: false, revalidationFailure: undefined });
      }
      // An answer for a pair that is no longer active is ignored, exactly as in
      // the selection flow. A confirmed one also refreshes the branch's zone.
      return state.branch !== undefined && sameScope(state.branch, event.context.scope)
        ? freeze({
          ...state,
          branch: toMobileBranchContext(event.context),
          revalidating: false,
          revalidationFailure: undefined,
        })
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
      // being visible while the new pair is revalidated. The context read goes
      // with it: an answer for the pair being left cannot confirm this one.
      return freeze({
        ...state,
        activeOrders: idleActiveOrdersResource,
        branch: undefined,
        branchFailure: undefined,
        contextRead: undefined,
        layout: idleResource,
        menu: idleResource,
        notice: undefined,
        payment: initialPaymentState,
        pendingScope: frozenScope(event.scope),
        shift: undefined,
        shifts: idleResource,
        revalidating: false,
        revalidationFailure: undefined,
        sync: EMPTY_MOBILE_SYNC_SNAPSHOT,
        syncScreenOpen: false,
        tab: "tables",
      });
    case "branchContextRequested":
      // The announcement that fixes the identity of this context read. Only the
      // operator in place, for the pair actually pending, may start one.
      return state.session.userId === event.operator
        && state.pendingScope !== undefined && sameScope(state.pendingScope, event.scope)
        ? freeze({ ...state, contextRead: frozenContextRead(event) })
        : state;
    case "branchAuthorized":
      // What confirms a branch is the server's own context: the roles it grants
      // there and the branch's IANA zone, bound to the operator, the pair and
      // the attempt that asked for it.
      return ownsContextRead(state, { attempt: event.attempt, operator: event.operator, scope: event.context.scope })
        ? freeze({
          ...state,
          branch: toMobileBranchContext(event.context),
          branchFailure: undefined,
          contextRead: undefined,
          pendingScope: undefined,
        })
        : state;
    case "branchRejected":
      return ownsContextRead(state, event)
        ? freeze({
          ...state,
          branchFailure: event.failure,
          contextRead: undefined,
          notice: event.failure === "authorization" ? "branchRevoked" : state.notice,
          pendingScope: undefined,
        })
        : state;
    case "branchReleased":
      return freeze({
        ...state,
        activeOrders: idleActiveOrdersResource,
        branch: undefined,
        branchFailure: undefined,
        contextRead: undefined,
        layout: idleResource,
        menu: idleResource,
        payment: initialPaymentState,
        pendingScope: undefined,
        shift: undefined,
        shifts: idleResource,
        revalidating: false,
        revalidationFailure: undefined,
        sync: EMPTY_MOBILE_SYNC_SNAPSHOT,
        syncScreenOpen: false,
        tab: "tables",
      });
    case "shiftSelected":
      // The operational reads belong to the shift too, so a layout or catalog
      // request started under the previous one stops being the current attempt.
      return state.branch !== undefined && state.shifts.status === "ready"
        && state.shifts.value?.shifts.some((candidate) => candidate.shiftId === event.shift.shiftId)
        && sameScope(state.branch, event.shift.scope)
        ? freeze(withoutBranchReadsInFlight({ ...state, payment: initialPaymentState, shift: event.shift }))
        : state;
    case "shiftReleased":
      return freeze({
        ...state,
        activeOrders: idleActiveOrdersResource,
        layout: idleResource,
        menu: idleResource,
        payment: initialPaymentState,
        shift: undefined,
        tab: "tables",
      });
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
    case "syncSnapshotLoaded": {
      // A sync answer belongs to one Restaurant/Branch pair and to the branch
      // the operator is actually in. A snapshot for the branch just left (or
      // for another tenant reusing the screen) is dropped whole.
      if (state.branch === undefined || !sameScope(state.branch, event.scope)) return state;
      const snapshotScope = event.snapshot.scope;
      if (snapshotScope !== undefined && !sameScope(snapshotScope, event.scope)) return state;
      return freeze({ ...state, sync: freezeSyncSnapshot(event.snapshot, event.scope) });
    }
    case "syncScreenOpened":
      return state.branch === undefined || state.syncScreenOpen
        ? state
        : freeze({ ...state, syncScreenOpen: true });
    case "syncScreenClosed":
      return state.syncScreenOpen ? freeze({ ...state, syncScreenOpen: false }) : state;
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
    case "activeOrdersLoading":
      return ownsActiveOrdersTarget(state, event)
        ? freeze({ ...state, activeOrders: activeOrdersLoading(event.attempt, activeOrdersTarget(event)) })
        : state;
    case "activeOrdersLoaded":
      // The answer has to be about the table that was asked about. A table may
      // hold more than one active Order, so the list is kept whole.
      return forCurrentActiveOrdersRead(state, event, (current) => (
        event.list.tableId.toLowerCase() === event.tableId.toLowerCase()
          ? { ...current, activeOrders: activeOrdersReady(event.list, activeOrdersTarget(event)) }
          : current
      ));
    case "activeOrdersFailed":
      return forCurrentActiveOrdersRead(state, event, (current) => (event.failure === "authorization"
        ? revokedState(current)
        : { ...current, activeOrders: activeOrdersFailed(event.failure, activeOrdersTarget(event)) }));
    case "activeOrdersReset":
      return forActiveScope(state, event.scope, (current) => ({ ...current, activeOrders: idleActiveOrdersResource }));
    case "paymentOpened":
      return canReadOperationalData(state)
        ? freeze({ ...state, payment: Object.freeze({ ...initialPaymentState, orderId: event.orderId.toLowerCase() }) })
        : state;
    case "paymentClosed":
      return state.payment.orderId === undefined ? state : freeze({ ...state, payment: initialPaymentState });
    case "paymentCheckoutLoading":
      return forActiveScope(state, event.scope, (current) => (current.payment.orderId === event.orderId.toLowerCase()
        ? { ...current, payment: Object.freeze({ ...current.payment, checkout: loading<CheckoutOrderSummaryV1>(event.attempt), checkoutFailure: undefined, quote: idleResource, quoteFailure: undefined }) }
        : current));
    case "paymentCheckoutLoaded":
      return forCurrentRead(state, event, state.payment.checkout, (current) => (current.payment.orderId === event.checkout.orderId.toLowerCase()
        ? {
          ...current,
          payment: Object.freeze({
            ...current.payment,
            amountInput: formatMinorUnitsInput(event.checkout.remainingBalanceMinor, event.checkout.currency) ?? "",
            checkout: ready(event.checkout),
            checkoutFailure: undefined,
            quote: idleResource,
            quoteFailure: undefined,
            submission: idlePaymentSubmission,
          }),
        }
        : current));
    case "paymentCheckoutFailed":
      return forCurrentRead(state, event, state.payment.checkout, (current) => (current.payment.orderId === event.orderId.toLowerCase()
        ? { ...current, payment: Object.freeze({ ...current.payment, checkout: failed<CheckoutOrderSummaryV1>("unavailable"), checkoutFailure: event.failure }) }
        : current));
    case "paymentCheckoutReset":
      return state.payment.orderId === undefined ? state : freeze({
        ...state,
        payment: Object.freeze({ ...state.payment, checkout: idleResource, checkoutFailure: undefined, quote: idleResource, quoteFailure: undefined, submission: idlePaymentSubmission }),
      });
    case "paymentFieldChanged": {
      if (state.payment.orderId === undefined || state.payment.submission.status === "sending") return state;
      const affectsQuote = event.patch.method !== undefined || event.patch.amountInput !== undefined
        || event.patch.receivedInput !== undefined || event.patch.tipInput !== undefined;
      return freeze({
        ...state,
        payment: Object.freeze({
          ...state.payment,
          ...event.patch,
          ...(affectsQuote ? { quote: idleResource, quoteFailure: undefined } : {}),
          submission: state.payment.submission.status === "failed" ? idlePaymentSubmission : state.payment.submission,
        }),
      });
    }
    case "paymentQuoteLoading":
      return forActiveScope(state, event.scope, (current) => (current.payment.orderId === event.orderId.toLowerCase()
        ? { ...current, payment: Object.freeze({ ...current.payment, quote: loading<CashPaymentQuoteV1>(event.attempt), quoteFailure: undefined }) }
        : current));
    case "paymentQuoteLoaded":
      return forCurrentRead(state, event, state.payment.quote, (current) => (current.payment.orderId === event.quote.orderId.toLowerCase()
        ? { ...current, payment: Object.freeze({ ...current.payment, quote: ready(event.quote), quoteFailure: undefined }) }
        : current));
    case "paymentQuoteFailed":
      return forCurrentRead(state, event, state.payment.quote, (current) => (current.payment.orderId === event.orderId.toLowerCase()
        ? { ...current, payment: Object.freeze({ ...current.payment, quote: failed<CashPaymentQuoteV1>("unavailable"), quoteFailure: event.failure }) }
        : current));
    case "paymentQuoteCleared":
      return state.payment.orderId === undefined || state.payment.quote.status === "idle" ? state
        : freeze({ ...state, payment: Object.freeze({ ...state.payment, quote: idleResource, quoteFailure: undefined }) });
    case "paymentSubmitStarted":
      return state.payment.orderId === event.orderId.toLowerCase() && state.payment.submission.status !== "sending"
        ? freeze({ ...state, payment: Object.freeze({ ...state.payment, submission: Object.freeze({ failure: undefined, receipt: undefined, status: "sending" }) }) })
        : state;
    case "paymentCollected":
      return forActiveScope(state, event.scope, (current) => (current.payment.orderId === event.receipt.orderId.toLowerCase()
        && current.payment.submission.status === "sending"
        ? { ...current, payment: Object.freeze({ ...current.payment, submission: Object.freeze({ failure: undefined, receipt: event.receipt, status: "collected" }) }) }
        : current));
    case "paymentSubmitFailed":
      return forActiveScope(state, event.scope, (current) => (current.payment.orderId === event.orderId.toLowerCase()
        && current.payment.submission.status === "sending"
        ? { ...current, payment: Object.freeze({ ...current.payment, submission: Object.freeze({ failure: event.failure, receipt: undefined, status: "failed" }) }) }
        : current));
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

const SYNC_CONNECTIVITY_LABEL: Readonly<Record<SyncConnectivityStateV1, string>> = Object.freeze({
  degraded: "Conexión lenta",
  offline: "Sin conexión",
  online: "En línea",
  reconnecting: "Reconectando",
  sync_blocked: "Sincronización bloqueada",
});

export function syncConnectivityLabel(connectivity: SyncConnectivityStateV1): string {
  return SYNC_CONNECTIVITY_LABEL[connectivity];
}

/**
 * States an operator still has to care about. Accepted/duplicate entries are
 * done and are not listed; leaving them in the queue would suggest work that no
 * longer exists.
 */
const VISIBLE_SYNC_STATES: ReadonlySet<SyncOutboxStateV1> = new Set([
  "conflict",
  "manual_review",
  "pending",
  "rejected",
  "retry_wait",
  "sending",
]);

export function visibleSyncQueue(snapshot: MobileSyncSnapshot): readonly MobileSyncQueueItem[] {
  const seen = new Set<string>();
  const items: MobileSyncQueueItem[] = [];
  for (const item of snapshot.items) {
    if (seen.has(item.eventId) || !VISIBLE_SYNC_STATES.has(item.localState)) continue;
    seen.add(item.eventId);
    items.push(item);
  }
  return Object.freeze(items);
}

/** Changes still waiting for the server, financial evidence included. */
export function syncPendingCount(snapshot: MobileSyncSnapshot): number {
  return visibleSyncQueue(snapshot).filter(
    (item) => item.localState === "pending" || item.localState === "retry_wait" || item.localState === "sending",
  ).length;
}

/** Changes the server refused or that need a supervisor: retrying alone will not fix them. */
export function syncAttentionCount(snapshot: MobileSyncSnapshot): number {
  return visibleSyncQueue(snapshot).filter(
    (item) => item.localState === "rejected" || item.localState === "conflict" || item.localState === "manual_review",
  ).length;
}

export function syncItemTitle(item: MobileSyncQueueItem): string {
  if (item.entityType === "Payment") return item.financial ? "Cobro en efectivo" : "Pago";
  if (item.entityType === "CashMovement" || item.entityType === "CashRegisterSession") return "Movimiento de caja";
  if (item.entityType === "OrderItem") return "Línea de pedido";
  if (item.entityType === "Order") return item.operation === "create" ? "Pedido" : "Cambio de pedido";
  if (item.entityType === "Customer") return "Cliente";
  if (item.entityType === "DiningTable") return "Mesa";
  return "Registro";
}

/** Operator-facing reading of one queued change. Never shows raw engine codes. */
export function syncItemDetail(item: MobileSyncQueueItem): string {
  const base = {
    accepted: "Confirmado por el servidor.",
    conflict: "Otro cambio usó una versión distinta. Se conservan ambos para revisión.",
    duplicate: "El servidor ya tenía este cambio.",
    manual_review: "Requiere revisión de un supervisor antes de continuar.",
    pending: "Pendiente de enviar al servidor.",
    rejected: "El servidor rechazó este cambio. Revisa la operación antes de intentarlo de nuevo.",
    retry_wait: "No se confirmó el envío. Se reintentará sin duplicarlo.",
    sending: "Enviando al servidor…",
  }[item.localState];
  if (base === undefined) return "Confirmado por el servidor.";
  return item.retryCount > 0 ? `${base} Intentos: ${item.retryCount}.` : base;
}

/** Only a change that can still reach the server is worth a retry button. */
export function syncItemCanRetry(item: MobileSyncQueueItem): boolean {
  return item.localState === "pending" || item.localState === "retry_wait";
}

const SYNC_BLOCK_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  CARD_MANUAL_CANNOT_CAPTURE_OFFLINE:
    "El cobro con tarjeta no puede confirmarse sin conexión. Regístralo cuando vuelva la red.",
  CASH_REGISTER_REQUIRED: "Abre una caja y un turno de cajero antes de cobrar sin conexión.",
  CLIENT_NOT_SUPPORTED: "Esta pantalla no puede realizar esa operación.",
  EXTERNAL_TERMINAL_CONFIRMATION_REQUIRED: "Confirma el cobro en la terminal antes de registrarlo.",
  LOCAL_RULE_LIMIT_EXCEEDED: "El descuento supera el límite permitido sin conexión.",
  OFFLINE_CASH_LIMIT_EXCEEDED: "El efectivo supera el tope permitido sin conexión.",
  OFFLINE_NOT_SUPPORTED: "Esta operación requiere conexión con el servidor.",
  PHASE3_UNSUPPORTED: "Esta operación no está disponible sin conexión en esta versión.",
  REMOTE_ORIGIN_OFFLINE_BLOCKED:
    "Este pedido se creó en otro dispositivo. Edítalo cuando vuelva la conexión.",
  SESSION_REQUIRED: "Tu sesión no es válida para operar sin conexión.",
  SNAPSHOTS_REQUIRED:
    "Este dispositivo todavía no tiene menú y mesas guardados para operar sin conexión.",
  SUPERVISOR_REQUIRED_ONLINE: "Esta acción requiere autorización de supervisor con conexión.",
  SYNC_BLOCKED_ENTITY:
    "Hay cambios pendientes de este registro que deben revisarse antes de continuar.",
  TEMPLATE_CACHE_REQUIRED: "Este dispositivo no tiene una plantilla de ticket guardada.",
});

export function mobileCapabilityMessage(code: string | null | undefined): string {
  if (code === null || code === undefined) return SYNC_BLOCK_MESSAGES.OFFLINE_NOT_SUPPORTED ?? "";
  return SYNC_BLOCK_MESSAGES[code] ?? SYNC_BLOCK_MESSAGES.OFFLINE_NOT_SUPPORTED ?? "";
}

/** Local wall-clock time of a confirmed sync, or `null` when never confirmed. */
export function formatSyncClock(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export interface MobileSyncBannerModel {
  readonly connectivityLabel: string;
  readonly pendingLabel: string;
  readonly lastSyncLabel: string;
  readonly attentionLabel: string | undefined;
  /** One sentence with the branch, the queue and the last confirmation, no promises. */
  readonly message: string;
  readonly tone: "error" | "info" | "success";
}

/**
 * What the persistent banner says. It reports only what the queue screen can
 * actually offer: pending changes, review items and the last confirmed sync. It
 * never claims an operation was charged, paid or delivered to the kitchen.
 */
export function describeSyncBanner(
  snapshot: MobileSyncSnapshot,
  branchName: string | undefined,
): MobileSyncBannerModel {
  const pending = syncPendingCount(snapshot);
  const attention = syncAttentionCount(snapshot);
  const connectivityLabel = snapshot.storageAvailable
    ? syncConnectivityLabel(snapshot.connectivity)
    : `${syncConnectivityLabel(snapshot.connectivity)} · sin almacenamiento local`;
  const branch = branchName !== undefined && branchName.trim() !== "" ? branchName : "Sucursal";
  const pendingLabel = pending === 0 ? "Sin pendientes" : `Pendientes: ${pending}`;
  const clock = formatSyncClock(snapshot.lastConfirmedSyncAt);
  const lastSyncLabel = clock === null ? "Última sincronización: sin confirmar" : `Última sincronización: ${clock}`;
  const attentionLabel = attention === 0 ? undefined : `Requiere revisión: ${attention}`;
  const tone: "error" | "info" | "success" = attention > 0
    ? "error"
    : pending > 0
      ? "info"
      : snapshot.connectivity === "online" && snapshot.storageAvailable
        ? "success"
        : "info";
  return Object.freeze({
    attentionLabel,
    connectivityLabel,
    lastSyncLabel,
    message: `${connectivityLabel} · ${branch} · ${pendingLabel} · ${lastSyncLabel}`,
    pendingLabel,
    tone,
  });
}

/** Deduplicates by event id and freezes the snapshot to the active pair. */
function freezeSyncSnapshot(snapshot: MobileSyncSnapshot, scope: MobileBranchScope): MobileSyncSnapshot {
  const seen = new Set<string>();
  const items: MobileSyncQueueItem[] = [];
  for (const item of snapshot.items) {
    if (seen.has(item.eventId)) continue;
    seen.add(item.eventId);
    items.push(Object.freeze({ ...item }));
  }
  return Object.freeze({
    ...snapshot,
    items: Object.freeze(items),
    scope: frozenScope(scope),
  });
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
 * Whether a context answer may still be applied: same operator, same pending
 * pair, and the attempt the state is waiting for. The token is covered by the
 * attempt — a renewal gives the read up, so its answer no longer matches.
 */
export function ownsContextRead(state: MobileState, read: MobileContextRead): boolean {
  return state.session?.userId === read.operator
    && state.contextRead?.attempt === read.attempt
    && state.pendingScope !== undefined
    && sameScope(state.pendingScope, read.scope);
}

/**
 * The pair whose operational context may be read right now, with the operator
 * it belongs to, or `undefined` when the state does not authorize starting it.
 */
export function contextReadTarget(state: MobileState): MobileContextRead | undefined {
  const pending = state.pendingScope;
  if (state.session === undefined || pending === undefined || state.contextRead !== undefined) return undefined;
  // The attempt is allocated by the screen's tracker, not here; `0` is a
  // placeholder the caller replaces. Only the operator and pair are decided.
  return Object.freeze({ attempt: 0, operator: state.session.userId, scope: pending });
}

/**
 * The table whose active Orders may be read right now, or `undefined`. A table
 * is only asked about while a shift is open and its own draft is on screen.
 */
export function activeOrdersReadTarget(
  state: MobileState,
  tableId: string | undefined,
): ActiveOrdersTarget | undefined {
  const scope = activeScope(state);
  const shiftId = state.shift?.shiftId;
  if (!canReadOperationalData(state) || scope === undefined || shiftId === undefined || tableId === undefined) return undefined;
  const target = freezeActiveOrdersTarget({ scope, shiftId, tableId });
  return sameActiveOrdersTarget(state.activeOrders.target, target) ? undefined : target;
}

/**
 * Filters the resource at the rendering boundary too. The effect normally
 * replaces a stale owner synchronously, but a render can never expose another
 * table's snapshot even if a caller misses that transition.
 */
export function activeOrdersForTable(
  state: MobileState,
  tableId: string | undefined,
): ActiveOrdersResource {
  const scope = activeScope(state);
  const shiftId = state.shift?.shiftId;
  if (scope === undefined || shiftId === undefined || tableId === undefined) return idleActiveOrdersResource;
  return sameActiveOrdersTarget(state.activeOrders.target, { scope, shiftId, tableId })
    ? state.activeOrders
    : idleActiveOrdersResource;
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

export function toPaymentFailure(error: unknown): MobilePaymentFailure {
  if (!(error instanceof MobileRequestError)) return "unavailable";
  if (error.status === 404) return "noRegister";
  if (error.status === 409) return "conflict";
  if (error.status === 400) return "invalidAmount";
  return toMobileFailure(error);
}

export function paymentFailureMessage(failure: MobilePaymentFailure): string {
  if (failure === "authorization") return "Tu rol actual no tiene permiso para cobrar en esta sucursal.";
  if (failure === "noRegister") return "No hay una caja abierta en este dispositivo. Ábrela en Caja antes de cobrar.";
  if (failure === "conflict") return "La orden o la caja cambiaron en el servidor. Actualiza antes de volver a cobrar.";
  if (failure === "invalidAmount") return "Importe o monto recibido inválido. Revisa los datos e inténtalo de nuevo.";
  return failureMessage(failure);
}

export function paymentMethodLabel(method: SimplePaymentMethodV1): string {
  return { card_manual: "Tarjeta manual", cash: "Efectivo", transfer: "Transferencia" }[method];
}

/** True only when the server checkout and quote are ready and method evidence satisfies contract bounds. */
export function canSubmitMobilePayment(payment: MobilePaymentState): boolean {
  if (payment.checkout.status !== "ready" || payment.quote.status !== "ready" || payment.submission.status === "sending") return false;
  if (payment.method === "card_manual") {
    const provider = payment.cardProvider.trim();
    const terminal = payment.terminalId.trim();
    const reference = payment.cardReference.trim();
    return payment.cardExternalConfirmed
      && provider.length > 0 && provider.length <= 120 && !/[\p{Cc}\p{Cf}]/u.test(provider)
      && terminal.length > 0 && terminal.length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(terminal)
      && reference.length >= 6 && reference.length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(reference);
  }
  if (payment.method === "transfer") {
    return payment.transferReference.trim().length <= 64 && !/[\p{Cc}\p{Cf}]/u.test(payment.transferReference);
  }
  return payment.quote.value?.changeMinor !== null;
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

function activeOrdersTarget(event: {
  readonly scope: MobileBranchScope;
  readonly shiftId: string;
  readonly tableId: string;
}): ActiveOrdersTarget {
  return freezeActiveOrdersTarget(event);
}

function freezeActiveOrdersTarget(target: ActiveOrdersTarget): ActiveOrdersTarget {
  return Object.freeze({
    scope: frozenScope(target.scope),
    shiftId: target.shiftId,
    tableId: target.tableId,
  });
}

function sameActiveOrdersTarget(
  left: ActiveOrdersTarget | undefined,
  right: ActiveOrdersTarget,
): boolean {
  return left !== undefined
    && sameScope(left.scope, right.scope)
    && left.shiftId === right.shiftId
    && left.tableId === right.tableId;
}

function ownsActiveOrdersTarget(
  state: MobileState,
  target: ActiveOrdersTarget,
): boolean {
  const scope = activeScope(state);
  return scope !== undefined
    && state.shift?.shiftId === target.shiftId
    && sameScope(scope, target.scope);
}

function forCurrentActiveOrdersRead(
  state: MobileState,
  event: ActiveOrdersTarget & { readonly attempt: number },
  change: (current: MobileState) => MobileState,
): MobileState {
  return state.activeOrders.attempt === event.attempt
    && sameActiveOrdersTarget(state.activeOrders.target, event)
    && ownsActiveOrdersTarget(state, event)
    ? freeze(change(state))
    : state;
}

/**
 * Gives up every read that has not answered yet, leaving each one `idle` rather
 * than `loading`. Idle is what lets the screen start the read that is current
 * now; staying `loading` would wait forever for an answer that can no longer be
 * applied. Resources that already settled are left exactly as they are.
 */
function withoutReadsInFlight(state: MobileState): MobileState {
  return {
    ...withoutBranchReadsInFlight(state),
    // A context read started with the token being replaced is given up too, and
    // `pendingScope` is deliberately kept: the selection the operator made is
    // still what they want, so the screen starts a fresh read for it at once
    // instead of dropping them back to the branch list.
    contextRead: undefined,
    memberships: givenUp(state.memberships),
  };
}

/** The same, for the three reads a shift change invalidates but a list read outlives. */
function withoutBranchReadsInFlight(state: MobileState): MobileState {
  return {
    ...state,
    activeOrders: state.activeOrders.status === "loading" ? idleActiveOrdersResource : state.activeOrders,
    layout: givenUp(state.layout),
    menu: givenUp(state.menu),
    payment: Object.freeze({ ...state.payment, checkout: givenUp(state.payment.checkout), quote: givenUp(state.payment.quote) }),
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
    activeOrders: idleActiveOrdersResource,
    branch: undefined,
    branchFailure: "authorization",
    contextRead: undefined,
    layout: idleResource,
    memberships: idleResource,
    menu: idleResource,
    notice: "branchRevoked",
    payment: initialPaymentState,
    pendingScope: undefined,
    shift: undefined,
    shifts: idleResource,
    revalidating: false,
    revalidationFailure: undefined,
    sync: EMPTY_MOBILE_SYNC_SNAPSHOT,
    syncScreenOpen: false,
    tab: "tables",
  };
}

function loading<T>(attempt: number): MobileResource<T> {
  return Object.freeze({ attempt, failure: undefined, status: "loading", value: undefined });
}

function activeOrdersLoading(attempt: number, target: ActiveOrdersTarget): ActiveOrdersResource {
  return Object.freeze({ attempt, failure: undefined, status: "loading", target, value: undefined });
}

function activeOrdersReady(value: ActiveTableOrderListV2, target: ActiveOrdersTarget): ActiveOrdersResource {
  return Object.freeze({ attempt: undefined, failure: undefined, status: "ready", target, value });
}

function activeOrdersFailed(failure: MobileFailure, target: ActiveOrdersTarget): ActiveOrdersResource {
  return Object.freeze({ attempt: undefined, failure, status: "failed", target, value: undefined });
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

function frozenContextRead(read: MobileContextRead): MobileContextRead {
  return Object.freeze({ attempt: read.attempt, operator: read.operator, scope: frozenScope(read.scope) });
}

/**
 * Flattens the shared context contract to what this app holds. Nothing is
 * invented and nothing is dropped silently: the pair, the roles and the zone
 * all come from the response the shared parser accepted.
 */
export function toMobileBranchContext(context: BranchOperationalContextV1): MobileBranchContext {
  return Object.freeze({
    branchId: context.scope.branchId,
    restaurantId: context.scope.restaurantId,
    roles: context.roles,
    timeZone: context.timeZone,
  });
}

function freeze(state: MobileState): MobileState {
  return Object.freeze(state);
}
