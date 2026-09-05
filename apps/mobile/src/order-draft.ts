/**
 * Ephemeral presentation state for the mobile order-entry draft.
 *
 * This module is **not** a second Order entity and holds no domain authority:
 *
 * - it never computes a subtotal, tax, discount, tip or total — the amounts it
 *   surfaces are the unit prices the catalog contract delivered, rendered one
 *   by one by the screen and added up only by the server;
 * - it never claims a table is occupied, free or billed, and it never recovers
 *   an active order: no such read exists yet, and the gap stays visible;
 * - it never writes anything. The screen exposes typed callbacks for `create
 *   order`, `add item` and `open order`; wiring them to the Nest endpoints is a
 *   later, server-side unit.
 *
 * The only identifiers it mints are local line handles of the form
 * `draft-line-N`, deliberately **not** UUIDs, so a draft handle can never be
 * mistaken for an `orderItemId` or persisted as one.
 *
 * The selection bounds it enforces are the ones the catalog contract publishes
 * (`minimumQuantity`/`maximumQuantity` per group and per option) plus the
 * integer range `AddOrderItemCommandV1` accepts. They exist so the interface
 * cannot offer a selection the contract already refuses; the server remains the
 * authority and revalidates everything.
 */
import type {
  MenuCatalogV1,
  MenuModifierGroupV1,
  MenuModifierOptionV1,
  MenuProductV1,
  ModifierGroupSelectionV1,
} from "@super-restaurant/shared-types";

import { failureMessage, type MobileFailure } from "./mobile-state.js";

/** Integer range `parseAddOrderItemCommandV1` accepts for a quantity. */
export const DRAFT_MIN_QUANTITY = 1;
export const DRAFT_MAX_QUANTITY = 1_000;

/** Bounds `parseAddOrderItemCommandV1` accepts for one command. */
export const DRAFT_MAX_GROUPS = 50;
export const DRAFT_MAX_SELECTIONS_PER_GROUP = 100;

/**
 * Why a draft could not be handed over. The four shared failures keep the
 * wording the rest of the client already uses; `conflict` is the optimistic
 * concurrency answer an Order mutation can return, `stale` is a draft the
 * published catalog no longer supports, and `notConnected` is the honest state
 * of this slice: the screen exists, the write does not.
 */
export type OrderDraftFailure = MobileFailure | "conflict" | "notConnected" | "stale";

export type OrderDraftSubmissionStatus = "failed" | "idle" | "sending" | "sent";

export interface OrderDraftSubmission {
  readonly failure: OrderDraftFailure | undefined;
  readonly status: OrderDraftSubmissionStatus;
}

/** One line of the draft. No price is stored here; the catalog carries them. */
export interface OrderDraftLine {
  readonly draftLineId: string;
  readonly modifierGroups: readonly ModifierGroupSelectionV1[];
  readonly productId: string;
  readonly quantity: number;
}

/** The product currently being configured, before it becomes a line. */
export interface OrderDraftComposer {
  readonly modifierGroups: readonly ModifierGroupSelectionV1[];
  readonly productId: string;
  readonly quantity: number;
  /** Set while editing an existing line, so committing replaces it in place. */
  readonly replacingLineId: string | undefined;
}

export interface OrderDraftState {
  readonly composer: OrderDraftComposer | undefined;
  /** True while the in-screen discard confirmation is open. Never `confirm()`. */
  readonly discardRequested: boolean;
  readonly lines: readonly OrderDraftLine[];
  readonly nextLineSerial: number;
  readonly submission: OrderDraftSubmission;
  readonly tableId: string | undefined;
  readonly zoneId: string | undefined;
}

export type OrderDraftEvent =
  | { readonly type: "composerClosed" }
  | { readonly type: "composerCommitted" }
  | {
    readonly type: "composerOptionSet";
    readonly groupId: string;
    readonly optionId: string;
    readonly quantity: number;
  }
  /**
   * Relative steps exist because a stepper button reads the quantity from the
   * render it was drawn in. Two rapid taps would both send "current + 1" from
   * the same stale value and land on the same number; a delta the reducer
   * applies to the state it holds cannot lose a tap. `maximum` is the bound the
   * catalog publishes for that option, passed in by the screen so the reducer
   * can clamp without reading the catalog itself.
   */
  | {
    readonly type: "composerOptionStepped";
    readonly delta: number;
    readonly groupId: string;
    readonly maximum: number;
    readonly optionId: string;
  }
  | { readonly type: "composerQuantitySet"; readonly quantity: number }
  | { readonly type: "composerQuantityStepped"; readonly delta: number }
  | { readonly type: "contextReleased" }
  | { readonly type: "discardCancelled" }
  | { readonly type: "discardConfirmed" }
  | { readonly type: "discardRequested" }
  | { readonly type: "lineEditRequested"; readonly draftLineId: string }
  | { readonly type: "lineRemoved"; readonly draftLineId: string }
  | { readonly type: "productOpened"; readonly productId: string }
  | { readonly type: "submissionFailed"; readonly failure: OrderDraftFailure }
  | { readonly type: "submissionStarted" }
  | { readonly type: "submissionSucceeded" }
  | { readonly type: "tableReleased" }
  | { readonly type: "tableSelected"; readonly tableId: string; readonly zoneId: string };

const idleSubmission: OrderDraftSubmission = Object.freeze({ failure: undefined, status: "idle" });

export const initialOrderDraftState: OrderDraftState = Object.freeze({
  composer: undefined,
  discardRequested: false,
  lines: Object.freeze([]),
  nextLineSerial: 1,
  submission: idleSubmission,
  tableId: undefined,
  zoneId: undefined,
});

export function reduceOrderDraft(state: OrderDraftState, event: OrderDraftEvent): OrderDraftState {
  switch (event.type) {
    case "contextReleased":
      // Signing out, changing branch, changing shift or losing the confirmed
      // scope drops the whole draft in the same transition. Nothing composed
      // for one branch, shift or operator can survive into another.
      return initialOrderDraftState;
    case "tableSelected":
      // Selecting the table that is already selected is a no-op, so a double
      // tap cannot silently discard a draft that is already being composed.
      return state.tableId === event.tableId
        ? state
        : freeze({ ...initialOrderDraftState, tableId: event.tableId, zoneId: event.zoneId });
    case "tableReleased":
      return initialOrderDraftState;
    default:
      break;
  }

  // Nothing below exists without a selected table: a late press from a screen
  // that is already gone must not compose anything.
  if (state.tableId === undefined) return state;

  // While the draft is being handed over nothing about it may change, so a
  // second tap, an edit or a removal cannot race the request.
  if (
    state.submission.status === "sending"
    && event.type !== "submissionSucceeded"
    && event.type !== "submissionFailed"
  ) {
    return state;
  }

  switch (event.type) {
    case "productOpened":
      return freeze({
        ...state,
        composer: Object.freeze({
          modifierGroups: Object.freeze([]),
          productId: event.productId,
          quantity: DRAFT_MIN_QUANTITY,
          replacingLineId: undefined,
        }),
        submission: idleSubmission,
      });
    case "composerClosed":
      return state.composer === undefined ? state : freeze({ ...state, composer: undefined });
    case "composerQuantitySet":
      return state.composer === undefined || !isCountableQuantity(event.quantity)
        ? state
        : freeze({ ...state, composer: Object.freeze({ ...state.composer, quantity: event.quantity }) });
    case "composerQuantityStepped": {
      if (state.composer === undefined || !Number.isSafeInteger(event.delta)) return state;
      const quantity = clamp(state.composer.quantity + event.delta, DRAFT_MIN_QUANTITY, DRAFT_MAX_QUANTITY);
      return quantity === state.composer.quantity
        ? state
        : freeze({ ...state, composer: Object.freeze({ ...state.composer, quantity }) });
    }
    case "composerOptionSet": {
      if (state.composer === undefined) return state;
      const groups = withOptionQuantity(state.composer.modifierGroups, event.groupId, event.optionId, event.quantity);
      return groups === undefined
        ? state
        : freeze({ ...state, composer: Object.freeze({ ...state.composer, modifierGroups: groups }) });
    }
    case "composerOptionStepped": {
      if (state.composer === undefined || !Number.isSafeInteger(event.delta)) return state;
      const current = selectedOptionQuantity(state.composer.modifierGroups, event.groupId, event.optionId);
      const ceiling = Number.isSafeInteger(event.maximum) ? Math.min(event.maximum, DRAFT_MAX_QUANTITY) : 0;
      const quantity = clamp(current + event.delta, 0, Math.max(0, ceiling));
      if (quantity === current) return state;
      const groups = withOptionQuantity(state.composer.modifierGroups, event.groupId, event.optionId, quantity);
      return groups === undefined
        ? state
        : freeze({ ...state, composer: Object.freeze({ ...state.composer, modifierGroups: groups }) });
    }
    case "composerCommitted": {
      const composer = state.composer;
      if (composer === undefined) return state;
      const replacing = composer.replacingLineId;
      if (replacing !== undefined && !state.lines.some((line) => line.draftLineId === replacing)) return state;
      const line: OrderDraftLine = Object.freeze({
        draftLineId: replacing ?? `draft-line-${state.nextLineSerial}`,
        modifierGroups: composer.modifierGroups,
        productId: composer.productId,
        quantity: composer.quantity,
      });
      return freeze({
        ...state,
        composer: undefined,
        lines: Object.freeze(replacing === undefined
          ? [...state.lines, line]
          : state.lines.map((current) => (current.draftLineId === replacing ? line : current))),
        nextLineSerial: replacing === undefined ? state.nextLineSerial + 1 : state.nextLineSerial,
        submission: idleSubmission,
      });
    }
    case "lineEditRequested": {
      const line = state.lines.find((candidate) => candidate.draftLineId === event.draftLineId);
      return line === undefined
        ? state
        : freeze({
          ...state,
          composer: Object.freeze({
            modifierGroups: line.modifierGroups,
            productId: line.productId,
            quantity: line.quantity,
            replacingLineId: line.draftLineId,
          }),
          submission: idleSubmission,
        });
    }
    case "lineRemoved": {
      const lines = state.lines.filter((line) => line.draftLineId !== event.draftLineId);
      if (lines.length === state.lines.length) return state;
      const composer = state.composer?.replacingLineId === event.draftLineId ? undefined : state.composer;
      return freeze({
        ...state,
        composer,
        discardRequested: lines.length === 0 ? false : state.discardRequested,
        lines: Object.freeze(lines),
        submission: idleSubmission,
      });
    }
    case "discardRequested":
      // Destructive actions are confirmed inside the screen; never with a
      // platform `alert()`, `confirm()` or `prompt()`.
      return state.lines.length === 0 || state.discardRequested
        ? state
        : freeze({ ...state, discardRequested: true });
    case "discardCancelled":
      return state.discardRequested ? freeze({ ...state, discardRequested: false }) : state;
    case "discardConfirmed":
      // The table stays selected: discarding the draft is not leaving the table.
      return state.discardRequested
        ? freeze({ ...initialOrderDraftState, tableId: state.tableId, zoneId: state.zoneId })
        : state;
    case "submissionStarted":
      // Idempotent on purpose: a double tap on the primary action must not
      // start a second hand-over, and an open composer is not a finished draft.
      return state.lines.length === 0 || state.composer !== undefined || state.submission.status === "sending"
        ? state
        : freeze({
          ...state,
          discardRequested: false,
          submission: Object.freeze({ failure: undefined, status: "sending" }),
        });
    case "submissionSucceeded":
      return state.submission.status === "sending"
        ? freeze({ ...state, submission: Object.freeze({ failure: undefined, status: "sent" }) })
        : state;
    case "submissionFailed":
      return state.submission.status === "sending"
        ? freeze({ ...state, submission: Object.freeze({ failure: event.failure, status: "failed" }) })
        : state;
    default:
      return state;
  }
}

/** The products of one category this draft may offer: active ones only. */
export function orderableProducts(catalog: MenuCatalogV1, categoryId: string): readonly MenuProductV1[] {
  return Object.freeze(catalog.products
    .filter((product) => product.categoryId === categoryId && product.active)
    .slice()
    .sort(byDisplayOrder));
}

/** The categories this draft may offer: active ones with at least one product. */
export function orderableCategories(
  catalog: MenuCatalogV1,
): readonly { readonly categoryId: string; readonly name: string }[] {
  return Object.freeze(catalog.categories
    .filter((category) => category.active && orderableProducts(catalog, category.categoryId).length > 0)
    .slice()
    .sort(byDisplayOrder)
    .map((category) => Object.freeze({ categoryId: category.categoryId, name: category.name })));
}

/**
 * The modifier groups a product may offer, with only the options the catalog
 * still publishes as active. An inactive group is not offered at all.
 */
export function orderableGroups(catalog: MenuCatalogV1, productId: string): readonly MenuModifierGroupV1[] {
  return Object.freeze(catalog.modifierGroups
    .filter((group) => group.productId === productId && group.active)
    .slice()
    .sort(byDisplayOrder)
    .slice(0, DRAFT_MAX_GROUPS)
    .map((group) => Object.freeze({
      ...group,
      options: Object.freeze(group.options
        .filter((option) => option.active)
        .slice(0, DRAFT_MAX_SELECTIONS_PER_GROUP)),
    })));
}

export function findProduct(catalog: MenuCatalogV1, productId: string): MenuProductV1 | undefined {
  return catalog.products.find((product) => product.productId === productId);
}

export function findOption(group: MenuModifierGroupV1, optionId: string): MenuModifierOptionV1 | undefined {
  return group.options.find((option) => option.optionId === optionId);
}

/** How many units of one option the composer holds; `0` when unselected. */
export function selectedOptionQuantity(
  groups: readonly ModifierGroupSelectionV1[],
  groupId: string,
  optionId: string,
): number {
  return groups.find((group) => group.groupId === groupId)
    ?.selections.find((selection) => selection.optionId === optionId)?.quantity ?? 0;
}

/** The units selected inside one group, which is what its bounds measure. */
export function selectedGroupQuantity(groups: readonly ModifierGroupSelectionV1[], groupId: string): number {
  return groups.find((group) => group.groupId === groupId)
    ?.selections.reduce((total, selection) => total + selection.quantity, 0) ?? 0;
}

/**
 * What still prevents this composition from being offered, in operational
 * Spanish. An empty list means the interface may offer it; the server decides.
 */
export function composerIssues(
  groups: readonly MenuModifierGroupV1[],
  composer: OrderDraftComposer,
): readonly string[] {
  const issues: string[] = [];
  if (!isCountableQuantity(composer.quantity)) {
    issues.push(`La cantidad debe ser un entero entre ${DRAFT_MIN_QUANTITY} y ${DRAFT_MAX_QUANTITY}.`);
  }
  for (const group of groups) {
    const selected = selectedGroupQuantity(composer.modifierGroups, group.groupId);
    if (selected < group.minimumQuantity) issues.push(`«${group.name}» requiere al menos ${group.minimumQuantity}.`);
    if (selected > group.maximumQuantity) issues.push(`«${group.name}» admite como máximo ${group.maximumQuantity}.`);
    const selections = composer.modifierGroups.find((entry) => entry.groupId === group.groupId)?.selections ?? [];
    for (const selection of selections) {
      const option = findOption(group, selection.optionId);
      if (option === undefined) {
        issues.push(`«${group.name}» tiene una opción que el catálogo ya no publica.`);
      } else if (option.maximumQuantity !== null && selection.quantity > option.maximumQuantity) {
        issues.push(`«${option.name}» admite como máximo ${option.maximumQuantity}.`);
      }
    }
  }
  // A selection for a group the product no longer publishes can only appear
  // when the catalog changed under an open composer; refuse it instead of
  // offering something the contract would reject.
  if (composer.modifierGroups.some((entry) => !groups.some((group) => group.groupId === entry.groupId))) {
    issues.push("El catálogo cambió: vuelve a elegir los modificadores de este producto.");
  }
  return Object.freeze(issues);
}

/** Extra units of one option the contract still allows on top of the current selection. */
export function remainingOptionCapacity(
  group: MenuModifierGroupV1,
  option: MenuModifierOptionV1,
  groups: readonly ModifierGroupSelectionV1[],
): number {
  const inGroup = group.maximumQuantity - selectedGroupQuantity(groups, group.groupId);
  const inOption = option.maximumQuantity === null
    ? DRAFT_MAX_QUANTITY
    : option.maximumQuantity - selectedOptionQuantity(groups, group.groupId, option.optionId);
  return Math.max(0, Math.min(inGroup, inOption, DRAFT_MAX_QUANTITY));
}

export function orderDraftFailureMessage(failure: OrderDraftFailure): string {
  if (failure === "conflict") {
    return "La comanda cambió en el servidor mientras la editabas. Vuelve a consultarla antes de reenviarla.";
  }
  if (failure === "notConnected") {
    return "El envío de comandas todavía no está conectado con el servidor. "
      + "El borrador permanece solo en este dispositivo.";
  }
  if (failure === "stale") {
    return "El borrador ya no coincide con el catálogo publicado. Revisa las líneas antes de volver a enviarlo.";
  }
  return failureMessage(failure);
}

function byDisplayOrder(
  left: { readonly displayOrder: number },
  right: { readonly displayOrder: number },
): number {
  return left.displayOrder - right.displayOrder;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isCountableQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value >= DRAFT_MIN_QUANTITY && value <= DRAFT_MAX_QUANTITY;
}

/**
 * Sets one option to an exact quantity, dropping it at `0`. Returns `undefined`
 * when the request is not representable, so the reducer can ignore it instead
 * of storing a selection the contract refuses.
 */
function withOptionQuantity(
  groups: readonly ModifierGroupSelectionV1[],
  groupId: string,
  optionId: string,
  quantity: number,
): readonly ModifierGroupSelectionV1[] | undefined {
  if (quantity !== 0 && !isCountableQuantity(quantity)) return undefined;
  const current = groups.find((group) => group.groupId === groupId);
  const selections = (current?.selections ?? []).filter((selection) => selection.optionId !== optionId);
  if (quantity > 0) {
    if (selections.length + 1 > DRAFT_MAX_SELECTIONS_PER_GROUP) return undefined;
    selections.push(Object.freeze({ optionId, quantity }));
  }
  const others = groups.filter((group) => group.groupId !== groupId);
  if (selections.length === 0) return Object.freeze(others);
  if (current === undefined && others.length + 1 > DRAFT_MAX_GROUPS) return undefined;
  const next = Object.freeze({ groupId, selections: Object.freeze(selections) });
  return Object.freeze(current === undefined
    ? [...others, next]
    : groups.map((group) => (group.groupId === groupId ? next : group)));
}

function freeze(state: OrderDraftState): OrderDraftState {
  return Object.freeze(state);
}
