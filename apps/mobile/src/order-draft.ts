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

/**
 * One product with its selected modifiers and quantity, whether it is still
 * being configured or already a line. Validation only ever needs this shape,
 * so the same rules apply to a composition and to a line about to be handed
 * over — a line can never be checked less strictly than the composer was.
 */
export interface OrderDraftComposition {
  readonly modifierGroups: readonly ModifierGroupSelectionV1[];
  readonly productId: string;
  readonly quantity: number;
}

/** One line of the draft. No price is stored here; the catalog carries them. */
export interface OrderDraftLine extends OrderDraftComposition {
  readonly draftLineId: string;
}

/** The product currently being configured, before it becomes a line. */
export interface OrderDraftComposer extends OrderDraftComposition {
  /** Set while editing an existing line, so committing replaces it in place. */
  readonly replacingLineId: string | undefined;
}

/**
 * What an open in-screen confirmation is asking about. The two destinations are
 * deliberately distinct: `discardDraft` empties the draft and stays on the
 * table, `leaveTable` empties it *and* returns to the plan. Collapsing them
 * into one boolean is what let "Volver a mesas" throw a draft away silently.
 */
export type OrderDraftConfirmation = "discardDraft" | "leaveTable";

export interface OrderDraftState {
  readonly composer: OrderDraftComposer | undefined;
  readonly lines: readonly OrderDraftLine[];
  readonly nextLineSerial: number;
  /** The confirmation currently open inside the screen. Never `confirm()`. */
  readonly pendingConfirmation: OrderDraftConfirmation | undefined;
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
  | { readonly type: "confirmationCancelled" }
  | { readonly type: "confirmationConfirmed" }
  | { readonly type: "confirmationRequested"; readonly intent: OrderDraftConfirmation }
  | { readonly type: "contextReleased" }
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
  lines: Object.freeze([]),
  nextLineSerial: 1,
  pendingConfirmation: undefined,
  submission: idleSubmission,
  tableId: undefined,
  zoneId: undefined,
});

/** Whether anything would be lost by emptying this draft right now. */
export function orderDraftHasContent(state: OrderDraftState): boolean {
  return state.lines.length > 0 || state.composer !== undefined;
}

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
      const emptied = lines.length === 0 && composer === undefined;
      return freeze({
        ...state,
        composer,
        lines: Object.freeze(lines),
        // A confirmation about losing the draft is meaningless once the draft
        // is already empty, so it closes instead of staying open over nothing.
        pendingConfirmation: emptied ? undefined : state.pendingConfirmation,
        submission: idleSubmission,
      });
    }
    case "confirmationRequested":
      // Destructive actions are confirmed inside the screen; never with a
      // platform `alert()`, `confirm()` or `prompt()`. With nothing composed
      // there is nothing to warn about: leaving is immediate and a second tap
      // on an already-released table changes nothing.
      if (!orderDraftHasContent(state)) {
        return event.intent === "leaveTable" ? initialOrderDraftState : state;
      }
      return state.pendingConfirmation === event.intent
        ? state
        : freeze({ ...state, pendingConfirmation: event.intent });
    case "confirmationCancelled":
      return state.pendingConfirmation === undefined
        ? state
        : freeze({ ...state, pendingConfirmation: undefined });
    case "confirmationConfirmed":
      // Which destination was confirmed is read from the state, so "discard and
      // stay" can never be answered with "discard and leave", or the reverse.
      if (state.pendingConfirmation === undefined) return state;
      if (state.pendingConfirmation === "leaveTable") return initialOrderDraftState;
      // The table stays selected: discarding the draft is not leaving the
      // table. The serial keeps running so a later line cannot reuse a handle
      // this table already showed.
      return freeze({
        ...initialOrderDraftState,
        nextLineSerial: state.nextLineSerial,
        tableId: state.tableId,
        zoneId: state.zoneId,
      });
    case "submissionStarted":
      // Idempotent on purpose: a double tap on the primary action must not
      // start a second hand-over, and an open composer is not a finished draft.
      return state.lines.length === 0 || state.composer !== undefined || state.submission.status === "sending"
        ? state
        : freeze({
          ...state,
          pendingConfirmation: undefined,
          submission: Object.freeze({ failure: undefined, status: "sending" }),
        });
    case "submissionSucceeded":
      // The accepted lines leave the draft. Keeping them would let a second tap,
      // an edit or one new line re-offer what the server already took. The table
      // and the success notice stay, so the next comanda for the same table
      // starts empty and carries only lines composed after the acceptance; the
      // serial keeps running so no new handle repeats a delivered one.
      return state.submission.status === "sending"
        ? freeze({
          ...state,
          composer: undefined,
          lines: Object.freeze([]),
          pendingConfirmation: undefined,
          submission: Object.freeze({ failure: undefined, status: "sent" }),
        })
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
 * **Every** active modifier group of a product, with every active option, in
 * catalog order and deliberately **not** truncated.
 *
 * This is the set validation must judge against. `MenuCatalogV1` allows far
 * more groups per product than one `AddOrderItemCommandV1` may carry, so the
 * list the screen renders is capped — and a required group sitting past that
 * cap used to be invisible to the checks as well, which let a line be handed
 * over while the published catalog still demanded a selection it did not have.
 * Presentation truncates; validation never does.
 */
export function activeProductGroups(catalog: MenuCatalogV1, productId: string): readonly MenuModifierGroupV1[] {
  return Object.freeze(catalog.modifierGroups
    .filter((group) => group.productId === productId && group.active)
    .slice()
    .sort(byDisplayOrder)
    .map((group) => Object.freeze({
      ...group,
      options: Object.freeze(group.options.filter((option) => option.active)),
    })));
}

/**
 * The modifier groups the screen may **present**, bounded by what one command
 * can carry. Use `activeProductGroups` for anything that decides whether a
 * line may be handed over: this list is allowed to be incomplete.
 */
export function orderableGroups(catalog: MenuCatalogV1, productId: string): readonly MenuModifierGroupV1[] {
  return Object.freeze(activeProductGroups(catalog, productId)
    .slice(0, DRAFT_MAX_GROUPS)
    .map((group) => Object.freeze({
      ...group,
      options: Object.freeze(group.options.slice(0, DRAFT_MAX_SELECTIONS_PER_GROUP)),
    })));
}

export function findProduct(catalog: MenuCatalogV1, productId: string): MenuProductV1 | undefined {
  return catalog.products.find((product) => product.productId === productId);
}

/**
 * Whether the catalog still publishes this product as orderable: the product
 * itself active, and its category still present and active. A product whose
 * category was retired is no longer reachable in the catalog the operator
 * browses, so it must not be reachable through a stale draft either.
 */
export function isOrderableProduct(catalog: MenuCatalogV1, productId: string): boolean {
  const product = findProduct(catalog, productId);
  if (product === undefined || !product.active) return false;
  const category = catalog.categories.find((entry) => entry.categoryId === product.categoryId);
  return category !== undefined && category.active;
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
  composer: OrderDraftComposition,
): readonly string[] {
  const issues: string[] = [];
  if (!isCountableQuantity(composer.quantity)) {
    issues.push(`La cantidad debe ser un entero entre ${DRAFT_MIN_QUANTITY} y ${DRAFT_MAX_QUANTITY}.`);
  }
  if (composer.modifierGroups.length > DRAFT_MAX_GROUPS) {
    issues.push(`Una línea admite como máximo ${DRAFT_MAX_GROUPS} grupos de modificadores.`);
  }
  for (const group of groups) {
    const selected = selectedGroupQuantity(composer.modifierGroups, group.groupId);
    if (selected < group.minimumQuantity) issues.push(`«${group.name}» requiere al menos ${group.minimumQuantity}.`);
    if (selected > group.maximumQuantity) issues.push(`«${group.name}» admite como máximo ${group.maximumQuantity}.`);
    const selections = composer.modifierGroups.find((entry) => entry.groupId === group.groupId)?.selections ?? [];
    if (selections.length > DRAFT_MAX_SELECTIONS_PER_GROUP) {
      issues.push(`«${group.name}» admite como máximo ${DRAFT_MAX_SELECTIONS_PER_GROUP} opciones distintas.`);
    }
    for (const selection of selections) {
      const option = findOption(group, selection.optionId);
      if (option === undefined) {
        issues.push(`«${group.name}» tiene una opción que el catálogo ya no publica.`);
      } else if (option.maximumQuantity !== null && selection.quantity > option.maximumQuantity) {
        issues.push(`«${option.name}» admite como máximo ${option.maximumQuantity}.`);
      }
      if (!isCountableQuantity(selection.quantity)) {
        issues.push(`«${group.name}» tiene una cantidad de opción que el contrato no acepta.`);
      }
    }
    // The reducer cannot produce a repeated option, but a line handed over is
    // never trusted to have come from it.
    if (new Set(selections.map((selection) => selection.optionId)).size !== selections.length) {
      issues.push(`«${group.name}» repite una opción.`);
    }
  }
  // A selection for a group the product no longer publishes can only appear
  // when the catalog changed under an open composer; refuse it instead of
  // offering something the contract would reject.
  if (composer.modifierGroups.some((entry) => !groups.some((group) => group.groupId === entry.groupId))) {
    issues.push("El catálogo cambió: vuelve a elegir los modificadores de este producto.");
  }
  const groupIds = composer.modifierGroups.map((entry) => entry.groupId);
  if (new Set(groupIds).size !== groupIds.length) {
    issues.push("Un grupo de modificadores aparece dos veces en esta línea.");
  }
  return Object.freeze(issues);
}

/**
 * Everything that stops one composed line from being handed over, judged
 * against the catalog as it stands *now*. This is the fail-closed check: it
 * re-derives the product and its active groups from the published catalog
 * rather than trusting the selections the reducer stored, so a catalog that
 * changed while the operator was composing — a retired product, a retired
 * group or option, a newly required minimum — is caught before anything is
 * offered rather than refused later by the server.
 */
export function draftLineIssues(catalog: MenuCatalogV1, line: OrderDraftComposition): readonly string[] {
  const product = findProduct(catalog, line.productId);
  if (product === undefined || !product.active) {
    return Object.freeze(["El catálogo publicado ya no incluye este producto."]);
  }
  if (!isOrderableProduct(catalog, line.productId)) {
    return Object.freeze(["La categoría de este producto ya no está publicada."]);
  }
  // Judged against every active group, never the truncated presentation list:
  // a required group past the visual cap still has to be satisfied.
  const groups = activeProductGroups(catalog, line.productId);
  const required = groups.filter((group) => group.minimumQuantity > 0);
  if (required.length > DRAFT_MAX_GROUPS) {
    // The catalog demands more mandatory groups than one command may carry, so
    // no draft of this product is expressible. Say so instead of sending a
    // command the contract would reject.
    return Object.freeze([
      `Este producto exige ${required.length} grupos obligatorios y una comanda admite `
      + `${DRAFT_MAX_GROUPS}. Pídelo en caja hasta que el catálogo se corrija.`,
    ]);
  }
  return composerIssues(groups, line);
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
