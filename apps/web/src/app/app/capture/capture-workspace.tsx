"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type {
  BranchScope,
  CaptureAssignmentCandidateV1,
  CaptureDeliveryInstructionSuggestionV1,
  CaptureDeliveryInstructionSuggestionsV1,
  CaptureCustomerSnapshotV1,
  CaptureDraftDetailV1,
  CaptureDraftDetailV2,
  CaptureDraftSummaryV1,
  CaptureTrayItemV2,
  CapturePaymentBasisV1,
  CapturePaymentIntentMethodV1,
  CapturePaymentIntentProjectionV1,
  CapturePaymentIntentV1,
  CaptureFulfillmentChannelV1,
  CaptureFulfillmentSnapshotV1,
  CaptureMutationResultV1,
  CaptureRepeatOrderPlanSummaryV1,
  CaptureSelectionPlanProjectionV1,
  CaptureSourceChannelV1,
  CaptureWorkspaceV5,
  CaptureWorkTrayResultV1,
  CaptureWorkTrayResultV2,
  DeliveryQuoteV1,
  CustomerDirectoryDetailV1,
  CustomerDirectorySearchResultV1,
  CustomerRecentOrderListV1,
  CustomerRepeatOrderCaptureResultV1,
  CustomerRepeatOrderPreviewIssueV1,
  CustomerRepeatOrderPreviewV1,
  MenuCatalogStateV1,
  MenuModifierGroupV1,
  MenuProductV1,
} from "@super-restaurant/shared-types";

import { captureDeviceId, clearPendingCaptureAutosave, persistPendingCaptureAutosave, readPendingCaptureAutosave,
  rehydrateCaptureWorkspace, shortCaptureDraftId, shouldRenewLease } from "../../../lib/capture-workspace";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { applyLineChange, buildSelectionPlan, type SelectionPlanLineDraft,
  type SelectionPlanModifierGroupDraft } from "../../../lib/capture-selection";
import type { CaptureConfirmationContext } from "../../../lib/capture-confirmation-context";
import { ariaKeyShortcut, dispatchShortcut, searchFocusTarget, type ShortcutTable } from "../../../lib/shortcut-dispatch";
import { formatDeliveryQuote } from "../../../lib/delivery-zones";
import {
  deliveryQuoteBlocksConfirm, deliveryQuoteScheduledForInputValue, isSwitchingToAnotherCapture,
  paymentIntentBlocksConfirm,
} from "../../../lib/capture-payment";
import type { CaptureWorkspaceOperation, CaptureWorkspaceResult } from "./actions";
import { CaptureMenu } from "./capture-menu";
import { CapturePayment } from "./capture-payment";
import { CaptureTicket } from "./capture-ticket";
import { ProductSheet } from "./product-sheet";

const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const input = "min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const messages = {
  invalid: "Revisa la selección. La dirección debe estar completa y validada para esta sucursal.",
  denied: "Tu sesión o permisos ya no permiten operar esta captura.",
  conflict: "Otra estación tomó esta captura o se venció tu tiempo de atención. Vuelve a tomarla.",
  missing: "La captura o ficha ya no está disponible.",
  unavailable: "No se pudo confirmar el resultado. Tu selección local sigue visible; reintenta exactamente la misma operación.",
} as const;
const issueLabels: Record<CustomerRepeatOrderPreviewIssueV1["code"], string> = {
  historical_item_cancelled: "La línea histórica estaba cancelada.",
  product_removed: "El producto ya no existe en el catálogo.",
  product_inactive: "El producto está inactivo.",
  category_inactive: "La categoría del producto está inactiva.",
  historical_modifier_unmapped: "Un modificador histórico no se puede relacionar con el catálogo actual.",
  modifier_group_unavailable: "Un grupo de modificadores ya no está disponible para este producto.",
  modifier_group_inactive: "Un grupo de modificadores está inactivo.",
  modifier_option_removed: "Una opción de modificador ya no existe.",
  modifier_option_inactive: "Una opción de modificador está inactiva.",
  modifier_quantity_invalid: "La cantidad de un modificador ya no es válida.",
  modifier_group_requirements_changed: "Cambiaron los requisitos de selección de modificadores.",
  product_price_changed: "Cambió el precio del producto.",
  modifier_price_changed: "Cambió el precio de un modificador.",
  variant_required: "El producto ahora se vende por tamaño; agrégalo de nuevo eligiendo el tamaño.",
};

interface CaptureWorkspaceParameters {
  readonly scope: BranchScope;
  readonly action: (operation: CaptureWorkspaceOperation, input: unknown) => Promise<CaptureWorkspaceResult>;
  readonly confirmationContext?: CaptureConfirmationContext;
  readonly canManageAssignment: boolean;
  readonly catalog: MenuCatalogStateV1;
  readonly reloadCatalog: (scope: BranchScope) => Promise<MenuCatalogStateV1 | undefined>;
}
type ActionReply = Awaited<ReturnType<CaptureWorkspaceParameters["action"]>>;

export function CaptureWorkspace({ scope, action, confirmationContext, canManageAssignment, catalog: initialCatalog,
  reloadCatalog }: CaptureWorkspaceParameters): ReactNode {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [catalogReloading, setCatalogReloading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [deviceId] = useState(() => captureDeviceId(typeof window === "undefined" ? undefined : window.localStorage,
    () => crypto.randomUUID()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof messages>();
  const [errorOperation, setErrorOperation] = useState<CaptureWorkspaceOperation>();
  const [errorCode, setErrorCode] = useState<string>();
  const [pending, setPending] = useState<{ operation: CaptureWorkspaceOperation; command: unknown }>();
  const [capture, setCapture] = useState<CaptureDraftDetailV1 | CaptureDraftDetailV2>();
  const [leaseClock, setLeaseClock] = useState(() => Date.now());
  const [tray, setTray] = useState<readonly (CaptureDraftSummaryV1 | CaptureTrayItemV2)[]>([]);
  const lastInteractionAt = useRef(0);
  const [assignmentCandidates, setAssignmentCandidates] = useState<readonly CaptureAssignmentCandidateV1[]>([]);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [noSaleOpen, setNoSaleOpen] = useState(false);
  const [noSaleReason, setNoSaleReason] = useState("");
  const [noSaleNotice, setNoSaleNotice] = useState(false);
  const [holdNotice, setHoldNotice] = useState(false);
  const [takeoverDraftId, setTakeoverDraftId] = useState("");
  const [takeoverReason, setTakeoverReason] = useState("");
  const [takeoverConfirmed, setTakeoverConfirmed] = useState(false);
  const [results, setResults] = useState<CustomerDirectorySearchResultV1>();
  const [customer, setCustomer] = useState<CustomerDirectoryDetailV1>();
  const [customerSnapshot, setCustomerSnapshot] = useState<CaptureCustomerSnapshotV1 | null>(null);
  const [fulfillmentSnapshot, setFulfillmentSnapshot] = useState<CaptureFulfillmentSnapshotV1 | null>(null);
  const [repeatOrderPlan, setRepeatOrderPlan] = useState<CaptureRepeatOrderPlanSummaryV1 | null>(null);
  const [recentOrders, setRecentOrders] = useState<CustomerRecentOrderListV1>();
  const [repeatPreview, setRepeatPreview] = useState<CustomerRepeatOrderPreviewV1>();
  const [selectedContact, setSelectedContact] = useState<string>();
  const [selectedAddress, setSelectedAddress] = useState<string>();
  const [sourceChannel, setSourceChannel] = useState<CaptureSourceChannelV1>("phone");
  const [fulfillmentChannel, setFulfillmentChannel] = useState<CaptureFulfillmentChannelV1 | null>("delivery");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [deliveryInstructionSuggestions, setDeliveryInstructionSuggestions] = useState<readonly CaptureDeliveryInstructionSuggestionV1[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuoteV1 | null>(null);
  const [paymentIntent, setPaymentIntentState] = useState<CapturePaymentIntentV1 | null>(null);
  const [paymentProjection, setPaymentProjection] = useState<CapturePaymentIntentProjectionV1 | null>(null);
  // H25: the pricing basis alone (no method/tender/tip), present whenever the lines are priced,
  // even before any payment intent exists -- lets the "Cobro" summary and cash shortcuts show
  // real numbers before the operator picks a method.
  const [paymentBasis, setPaymentBasis] = useState<CapturePaymentBasisV1 | null>(null);
  const [paymentIntentNotice, setPaymentIntentNotice] = useState<string>();
  const [quoteError, setQuoteError] = useState<string>();
  // True once the scheduled-delivery time has been edited after a quote was already frozen for a
  // DIFFERENT time: the frozen quote's fee/coverage/promise were computed for the old time, so it
  // must never be shown as confirmable until a fresh quote replaces it. Never computed locally --
  // just a flag that the confirm button and a re-quote prompt key off of.
  const [quoteRequestedForDiffers, setQuoteRequestedForDiffers] = useState(false);
  const [selectionProjection, setSelectionProjection] = useState<CaptureSelectionPlanProjectionV1 | null>(null);
  const [sheetProduct, setSheetProduct] = useState<MenuProductV1>();
  const [sheetGroups, setSheetGroups] = useState<readonly MenuModifierGroupV1[]>([]);
  const [sheetConfirmedTotalMinor, setSheetConfirmedTotalMinor] = useState<number | null>();
  const [sheetEditLine, setSheetEditLine] = useState<SelectionPlanLineDraft>();
  const [sheetError, setSheetError] = useState<string>();
  const [instructionsFeedback, setInstructionsFeedback] = useState<"saving" | "saved" | string>();
  const instructionsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionFeedback, setSelectionFeedback] = useState<"saving" | "saved" | string>();
  const selectionFeedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [selectionBusyLineId, setSelectionBusyLineId] = useState<string>();
  const [noteSheetLineId, setNoteSheetLineId] = useState<string>();
  const [noteSheetDraft, setNoteSheetDraft] = useState("");
  const productSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (selectionFeedbackTimer.current) clearTimeout(selectionFeedbackTimer.current);
    if (instructionsTimer.current) clearTimeout(instructionsTimer.current);
  }, []);
  useEffect(() => {
    if (capture?.status !== "draft" || capture.attentionLeaseExpiresAt === null) return;
    const timer = window.setInterval(() => setLeaseClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [capture?.status, capture?.attentionLeaseExpiresAt]);
  useEffect(() => {
    lastInteractionAt.current = Date.now();
    const interacted = () => { lastInteractionAt.current = Date.now(); };
    window.addEventListener("pointerdown", interacted);
    window.addEventListener("keydown", interacted);
    return () => {
      window.removeEventListener("pointerdown", interacted);
      window.removeEventListener("keydown", interacted);
    };
  }, []);
  useEffect(() => {
    if (capture?.status !== "draft" || capture.attentionLeaseId === null
      || capture.attentionLeaseExpiresAt === null) return;
    const captureDraftId = capture.captureDraftId;
    const attentionLeaseId = capture.attentionLeaseId;
    let expiresAt = capture.attentionLeaseExpiresAt;
    let lastAttemptAt = Date.now();
    let inFlight = false;
    let active = true;
    let conflictSeen = false;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (inFlight || conflictSeen || now - lastAttemptAt < 90_000
        || !shouldRenewLease(now, lastInteractionAt.current, document.visibilityState === "visible", expiresAt)) return;
      lastAttemptAt = now;
      inFlight = true;
      void (async () => {
        let reply: ActionReply;
        try { reply = await action("renew", { schemaVersion: 1, scope, captureDraftId, attentionLeaseId }); }
        catch { reply = { ok: false, error: "unavailable" }; }
        inFlight = false;
        if (!active) return;
        if (reply.ok && "attentionLeaseExpiresAt" in reply.value) {
          expiresAt = reply.value.attentionLeaseExpiresAt;
          setCapture((current) => current?.captureDraftId === captureDraftId && current.attentionLeaseId === attentionLeaseId
            ? { ...current, attentionLeaseExpiresAt: expiresAt } : current);
          setLeaseClock(Date.now());
        } else if (!reply.ok && reply.error === "conflict") {
          conflictSeen = true;
          const code = "code" in reply ? reply.code : undefined;
          setError("conflict"); setErrorOperation("renew"); setErrorCode(code);
          if (code === "CAPTURE_CONFLICT") {
            try {
              const fresh = await action("workspace", { schemaVersion: 3, scope, captureDraftId });
              if (active && fresh.ok && "customerSnapshot" in fresh.value) {
                applyWorkspace(fresh.value as CaptureWorkspaceV5);
                setError(undefined); setErrorOperation(undefined); setErrorCode(undefined);
                conflictSeen = false;
                lastAttemptAt = Date.now();
              }
            } catch { /* Keep the conflict visible until the operator returns to the tray. */ }
          }
        }
      })();
    }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [capture?.captureDraftId, capture?.attentionLeaseId, capture?.status, action, scope]);

  function invalidateQuote(): void {
    setQuoteError(undefined);
  }

  async function run(operation: CaptureWorkspaceOperation, command: unknown): Promise<ActionReply | undefined> {
    if (busy) return undefined;
    const persistedAutosave = operation === "autosave"
      ? persistPendingCaptureAutosave(typeof window === "undefined" ? undefined : window.localStorage, command)
      : undefined;
    setBusy(true);
    setError(undefined);
    setErrorOperation(undefined);
    setErrorCode(undefined);
    let reply: ActionReply;
    try { reply = await action(operation, command); }
    catch { reply = { ok: false, error: "unavailable", command }; }
    setBusy(false);
    if (!reply.ok) {
      setError(reply.error);
      setErrorOperation(operation);
      setErrorCode("code" in reply ? reply.code : undefined);
      setPending(reply.error === "unavailable" ? { operation, command: reply.command ?? command } : undefined);
      if (persistedAutosave !== undefined && reply.error !== "unavailable") {
        clearPendingCaptureAutosave(window.localStorage, persistedAutosave);
      }
      return reply;
    }
    if (persistedAutosave !== undefined) clearPendingCaptureAutosave(window.localStorage, persistedAutosave);
    setPending(undefined);
    const value = reply.value;
    if (operation === "assignmentCandidates") {
      setAssignmentCandidates((value as { candidates: readonly CaptureAssignmentCandidateV1[] }).candidates);
    }
    else if (operation === "recentOrders") setRecentOrders(value as CustomerRecentOrderListV1);
    else if (operation === "repeatPreview") setRepeatPreview(value as CustomerRepeatOrderPreviewV1);
    else if (operation === "repeatOrder") {
      const repeated = value as CustomerRepeatOrderCaptureResultV1;
      setCapture(repeated.capture.detail);
      setRepeatPreview(repeated.preview);
    }
    else if ("items" in value && "captureDraftId" in value) {
      setDeliveryInstructionSuggestions((value as CaptureDeliveryInstructionSuggestionsV1).items);
    }
    else if ("items" in value) setTray((value as CaptureWorkTrayResultV1 | CaptureWorkTrayResultV2).items);
    else if ("customerSnapshot" in value) applyWorkspace(value as CaptureWorkspaceV5);
    else if ("replayed" in value) {
      const mutation = value as CaptureMutationResultV1;
      if (mutation.detail.captureDraftId !== capture?.captureDraftId
        || mutation.detail.fulfillmentSnapshotRef !== capture.fulfillmentSnapshotRef) {
        invalidateQuote();
        setQuoteRequestedForDiffers(false);
        setDeliveryQuote(null);
        setPaymentIntentState(null);
        setPaymentProjection(null);
      }
      setCapture(mutation.detail);
      if ("deliveryInstructions" in value) {
        setDeliveryInstructions(typeof value.deliveryInstructions === "string" ? value.deliveryInstructions : "");
      }
      setCustomerSnapshot(current => current?.snapshotRef === mutation.detail.customerSnapshotRef ? current : null);
      setFulfillmentSnapshot(current => current?.snapshotRef === mutation.detail.fulfillmentSnapshotRef ? current : null);
      if (mutation.detail.status !== "draft" || mutation.detail.customerSnapshotRef !== customerSnapshot?.snapshotRef) {
        setRepeatOrderPlan(null);
      }
      if (mutation.detail.customerSnapshotRef === null) setSelectedContact(undefined);
      if (mutation.detail.fulfillmentSnapshotRef === null) setSelectedAddress(undefined);
      setSourceChannel(mutation.detail.sourceChannel);
      setFulfillmentChannel(mutation.detail.fulfillmentChannel);
    } else if ("candidates" in value) setResults(value as CustomerDirectorySearchResultV1);
    else setCustomer(value as CustomerDirectoryDetailV1);
    return reply;
  }

  function applyWorkspace(value: CaptureWorkspaceV5): void {
    const hydrated = rehydrateCaptureWorkspace(value);
    if (hydrated === undefined) {
      setError("unavailable");
      return;
    }
    // H17: opening a DIFFERENT capture must never carry over UI state that only ever meant
    // something for the one just left -- otherwise a scheduled-for time, a stale-quote flag or a
    // cash-tender notice from the previous capture silently applies to this one before its own
    // hydration (below) has a chance to establish the truth.
    if (isSwitchingToAnotherCapture(capture?.captureDraftId, hydrated.detail.captureDraftId)) {
      setScheduledFor("");
      setPaymentIntentNotice(undefined);
      setError(undefined);
      setErrorOperation(undefined);
      setErrorCode(undefined);
    }
    setQuoteError(undefined);
    setQuoteRequestedForDiffers(false);
    setCapture(hydrated.detail);
    setCustomerSnapshot(hydrated.customerSnapshot);
    setFulfillmentSnapshot(hydrated.fulfillmentSnapshot);
    setRepeatOrderPlan(hydrated.repeatOrderPlan);
    setSelectionProjection(hydrated.selectionProjection);
    setDeliveryQuote(hydrated.deliveryQuote);
    setPaymentIntentState(hydrated.paymentIntent);
    setPaymentProjection(hydrated.paymentProjection);
    setPaymentBasis(hydrated.paymentBasis);
    setRecentOrders((current) => current?.customerId === hydrated.customerSnapshot?.customerId ? current : undefined);
    setRepeatPreview((current) => current?.customerId === hydrated.customerSnapshot?.customerId ? current : undefined);
    setSelectedContact(hydrated.customerSnapshot?.contactId);
    setSelectedAddress(hydrated.fulfillmentSnapshot?.addressId);
    setSourceChannel(hydrated.sourceChannel);
    setFulfillmentChannel(hydrated.fulfillmentChannel);
    setDeliveryInstructions(hydrated.deliveryInstructions ?? "");
    // H15: a rehydrated capture with a scheduled (non-ASAP) frozen quote must prefill the
    // scheduled-for field from that quote -- otherwise the field reads "" (ASAP) while
    // `quoteMatchesRequestedTime` compares against the quote's actual scheduledFor and never
    // matches, permanently blocking confirm. Never clobbers a value the operator already typed.
    const rehydratedScheduledFor = deliveryQuoteScheduledForInputValue(hydrated.deliveryQuote);
    if (rehydratedScheduledFor !== "") {
      setScheduledFor((current) => (current === "" ? rehydratedScheduledFor : current));
    }
  }

  useEffect(() => { void (async () => {
    const pendingAutosave = readPendingCaptureAutosave(window.localStorage, scope);
    if (pendingAutosave !== undefined) {
      const replay = await run("autosave", pendingAutosave);
      if (replay?.ok) await refreshWorkspace(pendingAutosave.captureDraftId);
      if (replay === undefined || !replay.ok) return;
    }
    await run("tray", { schemaVersion: 2, scope, limit: 20 });
    if (canManageAssignment) await run("assignmentCandidates", { schemaVersion: 1, scope });
  })(); }, []);

  function base(): Record<string, unknown> {
    if (capture === undefined || capture.attentionLeaseId === null) throw new Error("CAPTURE_NOT_EDITABLE");
    return { schemaVersion: 1, scope, captureDraftId: capture.captureDraftId, expectedVersion: capture.version,
      attentionLeaseId: capture.attentionLeaseId, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      deviceId, occurredAt: new Date().toISOString() };
  }

  function selectionDraftLines(): readonly SelectionPlanLineDraft[] {
    return (selectionProjection?.lines ?? []).map((line) => {
      const byGroup = new Map<string, SelectionPlanModifierGroupDraft["selections"][number][]>();
      for (const modifier of line.modifiers) {
        const existing = byGroup.get(modifier.groupId) ?? [];
        existing.push({ optionId: modifier.optionId, quantity: modifier.quantity });
        byGroup.set(modifier.groupId, existing);
      }
      const modifierGroups: SelectionPlanModifierGroupDraft[] = [...byGroup.entries()]
        .map(([groupId, selections]) => ({ groupId, selections }));
      return { lineId: line.lineId, productId: line.productId, variantId: line.variantId, quantity: line.quantity, modifierGroups, note: line.note };
    });
  }

  /**
   * Replaces the whole selection plan; on an uncertain transport result it replays exactly once
   * with the same idempotency key. Returns the server-priced projection on success (`null` if the
   * plan is now empty) so callers can show a confirmed amount without ever summing locally.
   */
  async function sendSelectionPlan(
    lines: readonly SelectionPlanLineDraft[],
  ): Promise<CaptureSelectionPlanProjectionV1 | null | undefined> {
    if (capture === undefined || capture.attentionLeaseId === null || catalog.catalog === null) return undefined;
    if (selectionFeedbackTimer.current) clearTimeout(selectionFeedbackTimer.current);
    setSelectionFeedback("saving");
    const command = { ...base(), plan: buildSelectionPlan(lines, catalog.catalog.catalogVersion) };
    let reply = await run("selectionPlan", command);
    if (reply !== undefined && !reply.ok && reply.error === "unavailable") {
      reply = await run("selectionPlan", (reply as { command?: unknown }).command ?? command);
    }
    if (reply?.ok !== true) {
      setSelectionFeedback(reply?.ok === false ? messages[reply.error] : "No se pudo guardar el pedido.");
      return undefined;
    }
    const hydrated = rehydrateCaptureWorkspace(reply.value);
    if (hydrated === undefined) {
      setSelectionFeedback("No se pudo verificar el pedido guardado.");
      return undefined;
    }
    setSelectionFeedback("saved");
    selectionFeedbackTimer.current = setTimeout(() => setSelectionFeedback(undefined), 2000);
    return hydrated.selectionProjection;
  }

  function openProduct(product: MenuProductV1, groups: readonly MenuModifierGroupV1[]): void {
    if (locked || selectionBusy) return;
    if (groups.length === 0 && !product.variants?.some((variant) => variant.active)) {
      void addDirect(product.productId);
      return;
    }
    setSheetProduct(product);
    setSheetGroups(groups);
    setSheetEditLine(undefined);
    setSheetError(undefined);
  }

  function openEditLine(lineId: string): void {
    if (locked || catalog.catalog === null) return;
    const line = selectionDraftLines().find((candidate) => candidate.lineId === lineId);
    const product = catalog.catalog.products.find((candidate) => candidate.productId === line?.productId);
    if (line === undefined || product === undefined) {
      setError("invalid"); return;
    }
    setSheetEditLine(line);
    setSheetProduct(product);
    setSheetGroups(catalog.catalog.modifierGroups.filter((group) => group.productId === product.productId));
    setSheetError(undefined);
  }

  async function addDirect(productId: string): Promise<void> {
    setSelectionBusy(true);
    await sendSelectionPlan(applyLineChange(selectionDraftLines(),
      { type: "add", lineId: crypto.randomUUID(), productId, variantId: null, quantity: 1, modifierGroups: [], note: null }));
    setSelectionBusy(false);
  }

  async function addFromSheet(
    quantity: number,
    modifierGroups: readonly SelectionPlanModifierGroupDraft[],
    note: string | null,
    variantId: string | null,
  ): Promise<void> {
    if (sheetProduct === undefined) return;
    const productId = sheetProduct.productId;
    const lineId = sheetEditLine?.lineId ?? crypto.randomUUID();
    setSelectionBusy(true);
    const currentLines = selectionDraftLines();
    // One server replacement of the whole plan keeps the edit atomic and preserves its line ID.
    const nextLines = sheetEditLine === undefined
      ? applyLineChange(currentLines, { type: "add", lineId, productId, variantId, quantity, modifierGroups, note })
      : currentLines.map((line) => line.lineId === lineId
        ? { lineId, productId, variantId, quantity, modifierGroups, note } : line);
    const projection = await sendSelectionPlan(nextLines);
    setSelectionBusy(false);
    if (projection === undefined) { setSheetError(error === "conflict" ? messages.conflict : "No se pudo guardar la línea. Reintenta."); return; }
    // Match by the freshly generated lineId, never by productId+modifiers: a prior line with the
    // same product/selection but a different note (or merged by applyLineChange's own note-aware
    // matching) must not be mistaken for the one just confirmed.
    const matched = (projection?.lines ?? []).find((line) => line.lineId === lineId)
      ?? (projection?.lines ?? []).find((line) => line.productId === productId
        && line.variantId === variantId && sameProjectionModifiers(line.modifiers, modifierGroups) && line.note === note);
    setSheetConfirmedTotalMinor(matched?.lineTotalMinor ?? null);
    window.setTimeout(() => {
      setSheetProduct(undefined); setSheetGroups([]); setSheetConfirmedTotalMinor(undefined);
      setSheetEditLine(undefined); setSheetError(undefined);
    }, 900);
  }

  /** Recovers from a `selectionPlan` conflict caused by a stale `catalogVersion`: re-reads the
   * catalog (read-only) and the workspace, but never retries the write that failed. */
  async function reloadMenu(): Promise<void> {
    if (capture === undefined) return;
    setCatalogReloading(true);
    const fresh = await reloadCatalog(scope);
    if (fresh !== undefined) setCatalog(fresh);
    setCatalogReloading(false);
    setError(undefined);
    setErrorOperation(undefined);
    await refreshWorkspace(capture.captureDraftId);
  }

  async function changeLineQuantity(lineId: string, delta: 1 | -1): Promise<void> {
    setSelectionBusyLineId(lineId);
    await sendSelectionPlan(applyLineChange(selectionDraftLines(), { type: delta === 1 ? "increment" : "decrement", lineId }));
    setSelectionBusyLineId(undefined);
  }

  async function removeLine(lineId: string): Promise<void> {
    setSelectionBusyLineId(lineId);
    await sendSelectionPlan(applyLineChange(selectionDraftLines(), { type: "remove", lineId }));
    setSelectionBusyLineId(undefined);
  }

  function openNoteSheet(lineId: string, currentNote: string | null): void {
    if (locked || selectionBusy) return;
    setNoteSheetLineId(lineId);
    setNoteSheetDraft(currentNote ?? "");
  }

  async function saveLineNote(): Promise<void> {
    const lineId = noteSheetLineId;
    if (lineId === undefined) return;
    const trimmed = noteSheetDraft.trim();
    setSelectionBusyLineId(lineId);
    const saved = await sendSelectionPlan(applyLineChange(selectionDraftLines(),
      { type: "setNote", lineId, note: trimmed.length === 0 ? null : trimmed }));
    setSelectionBusyLineId(undefined);
    if (saved === undefined) return;
    setNoteSheetLineId(undefined);
    setNoteSheetDraft("");
  }

  function create(): void {
    setNoSaleNotice(false);
    setHoldNotice(false);
    void run("create", { schemaVersion: 1, scope, captureDraftId: crypto.randomUUID(), expectedVersion: 0,
      sourceChannel, fulfillmentChannel, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), deviceId,
      occurredAt: new Date().toISOString() });
  }

  async function refreshWorkspace(captureDraftId: string): Promise<void> {
    const reply = await run("workspace", { schemaVersion: 3, scope, captureDraftId });
    if (!reply?.ok || !("customerSnapshot" in reply.value) || reply.value.customerSnapshot === null) {
      setRecentOrders(undefined);
      setRepeatPreview(undefined);
      setDeliveryInstructionSuggestions([]);
      return;
    }
    await run("recentOrders", { schemaVersion: 1, scope,
      customerId: reply.value.customerSnapshot.customerId, limit: 20 });
    if (reply.value.detail.fulfillmentChannel === "delivery") {
      await run("deliveryInstructionSuggestions", { schemaVersion: 1, scope, captureDraftId });
    } else {
      setDeliveryInstructionSuggestions([]);
    }
  }

  function recover(item: CaptureDraftSummaryV1 | CaptureTrayItemV2): void {
    const command = { schemaVersion: 1, scope, captureDraftId: item.captureDraftId, expectedVersion: item.version,
      eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), deviceId, occurredAt: new Date().toISOString() };
    setNoSaleNotice(false);
    setHoldNotice(false);
    void (async () => {
      const reply = await run("claim", command);
      if (reply?.ok) await refreshWorkspace(item.captureDraftId);
    })();
  }

  function transferCapture(): void {
    if (!canManageAssignment || capture === undefined || transferTarget === "" || !transferConfirmed) return;
    void (async () => {
      const reply = await run("transfer", { ...base(), targetMembershipId: transferTarget });
      if (!reply?.ok) return;
      reset();
      await run("tray", { schemaVersion: 2, scope, limit: 20 });
      await run("assignmentCandidates", { schemaVersion: 1, scope });
    })();
  }

  function takeOverCapture(): void {
    const item = tray.find((candidate) => candidate.captureDraftId === takeoverDraftId);
    const reason = takeoverReason.trim();
    if (!canManageAssignment || item === undefined || item.attentionStatus !== "claimed"
      || reason.length === 0 || !takeoverConfirmed) return;
    void (async () => {
      const reply = await run("takeover", { schemaVersion: 1, scope, captureDraftId: item.captureDraftId,
        expectedVersion: item.version, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
        deviceId, occurredAt: new Date().toISOString(), reason });
      if (!reply?.ok) return;
      setTakeoverDraftId(""); setTakeoverReason(""); setTakeoverConfirmed(false);
      await refreshWorkspace(item.captureDraftId);
      await run("tray", { schemaVersion: 2, scope, limit: 20 });
    })();
  }

  function openNoSale(): void {
    if (locked) return;
    setNoSaleReason("");
    setNoSaleOpen(true);
  }

  function holdCapture(): void {
    if (locked) return;
    void (async () => {
      const reply = await run("hold", base());
      if (!reply?.ok) return;
      reset();
      setHoldNotice(true);
      await run("tray", { schemaVersion: 2, scope, limit: 20 });
    })();
  }

  function cancelNoSale(): void {
    setNoSaleOpen(false);
    setNoSaleReason("");
  }

  /** Shared success handler for `noSale`, reached from both the first attempt and a later
   * retry of a `pending` (lost-response) command: either way, a successful close must return
   * to the tray with the same notice exactly once. */
  async function afterNoSaleApplied(): Promise<void> {
    setNoSaleOpen(false);
    setNoSaleReason("");
    reset();
    setNoSaleNotice(true);
    await run("tray", { schemaVersion: 2, scope, limit: 20 });
  }

  function confirmNoSale(): void {
    const reason = noSaleReason.trim();
    if (capture === undefined || reason.length === 0) return;
    void (async () => {
      const reply = await run("noSale", { ...base(), reason });
      if (reply?.ok) await afterNoSaleApplied();
    })();
  }

  function autosave(nextSource: CaptureSourceChannelV1, nextFulfillment: CaptureFulfillmentChannelV1 | null): void {
    if (capture === undefined || capture.attentionLeaseId === null) return;
    const command = { ...base(), sourceChannel: nextSource, fulfillmentChannel: nextFulfillment,
      customerSnapshotRef: capture.customerSnapshotRef, fulfillmentSnapshotRef: capture.fulfillmentSnapshotRef };
    void run("autosave", command);
  }

  function changeSource(event: ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value as CaptureSourceChannelV1;
    setSourceChannel(next);
    autosave(next, fulfillmentChannel);
  }

  function changeFulfillment(event: ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value === "" ? null : event.target.value as CaptureFulfillmentChannelV1;
    setFulfillmentChannel(next);
    if (next !== "delivery") setDeliveryInstructions("");
    if (next !== "delivery") setDeliveryInstructionSuggestions([]);
    invalidateQuote();
    autosave(sourceChannel, next);
  }

  async function saveDeliveryInstructions(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (capture === undefined || fulfillmentChannel !== "delivery") return;
    const normalized = deliveryInstructions.trim();
    const command = { ...base(), deliveryInstructions: normalized === "" ? null : normalized };
    if (instructionsTimer.current) clearTimeout(instructionsTimer.current);
    setInstructionsFeedback("saving");
    const reply = await run("deliveryInstructions", command);
    if (reply?.ok) {
      setInstructionsFeedback("saved");
      instructionsTimer.current = setTimeout(() => setInstructionsFeedback(undefined), 2000);
    } else setInstructionsFeedback(reply?.ok === false ? messages[reply.error] : "No se pudieron guardar las instrucciones.");
  }

  async function requestDeliveryQuote(): Promise<void> {
    if (capture === undefined || capture.attentionLeaseId === null || fulfillmentChannel !== "delivery"
      || fulfillmentSnapshot === null) return;
    const scheduledDate = scheduledFor === "" ? null : new Date(scheduledFor);
    if (scheduledDate !== null && !Number.isFinite(scheduledDate.getTime())) {
      setQuoteError("Introduce una fecha y hora válidas."); return;
    }
    const scheduled = scheduledDate?.toISOString() ?? null;
    const now = Date.now();
    if (scheduled !== null && (Date.parse(scheduled) - now < 30 * 60_000
      || Date.parse(scheduled) - now > 7 * 24 * 60 * 60_000)) {
      setQuoteError("Programa entre 30 minutos y 7 días a partir de ahora."); return;
    }
    setQuoteError(undefined);
    const command = { ...base(), scheduledFor: scheduled };
    let reply = await run("deliveryQuote", command);
    if (reply !== undefined && !reply.ok && reply.error === "unavailable") {
      reply = await run("deliveryQuote", (reply as { command?: unknown }).command ?? command);
    }
    if (reply !== undefined && !reply.ok) setQuoteError(messages[reply.error]);
  }

  /**
   * Fixes/replaces the stated payment intent. A `CAPTURE_PAYMENT_INTENT_INSUFFICIENT` conflict is
   * a normal outcome of choosing too small a cash tender, not a lease/version conflict: it must not
   * lock the workspace or force a return to the tray, only surface a local notice next to the step.
   */
  // H27: reports success back to the caller (rather than firing and forgetting) so a rejected
  // custom cash tender (e.g. insufficient) never gets recorded as "already applied" -- the
  // operator must be able to immediately retype/resend the same amount once it would actually
  // cover the total (a later tip change, for instance), instead of it staying stuck as a no-op.
  async function setPaymentIntent(
    method: CapturePaymentIntentMethodV1,
    tenderedAmountMinor: number | null,
    tipMinor: number,
  ): Promise<boolean> {
    if (capture === undefined || capture.attentionLeaseId === null) return false;
    const command = { ...base(), method, tenderedAmountMinor, tipMinor };
    let reply = await run("paymentIntent", command);
    if (reply !== undefined && !reply.ok && reply.error === "unavailable") {
      reply = await run("paymentIntent", (reply as { command?: unknown }).command ?? command);
    }
    if (reply !== undefined && !reply.ok && reply.error === "conflict" && reply.code === "CAPTURE_PAYMENT_INTENT_INSUFFICIENT") {
      setError(undefined);
      setErrorOperation(undefined);
      setPaymentIntentNotice("El monto no cubre el total.");
      return false;
    }
    if (reply?.ok === true) setPaymentIntentNotice(undefined);
    return reply?.ok === true;
  }

  function refreshPaymentIntent(): void {
    if (paymentIntent === null) return;
    void setPaymentIntent(paymentIntent.method, paymentIntent.tenderedAmountMinor, paymentIntent.tipMinor);
  }

  function confirmCapture(): void {
    if (capture === undefined || capture.status !== "draft" || capture.attentionLeaseId === null
      || confirmationContext === undefined || fulfillmentChannel === null || activeShift === undefined
      || (fulfillmentChannel === "dine_in" && selectedTableId === "")
      || (fulfillmentChannel === "delivery" && (customerSnapshot === null || fulfillmentSnapshot === null))) return;
    void run("confirm", {
      ...base(),
      schemaVersion: 2,
      orderId: crypto.randomUUID(),
      shiftId: activeShift.shiftId,
      tableId: fulfillmentChannel === "dine_in" ? selectedTableId : null,
      currency: confirmationContext.currency,
      timeZone: confirmationContext.timeZone,
    });
  }

  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run("search", { schemaVersion: 1, scope, mode: String(data.get("mode")),
      query: String(data.get("query") ?? "").trim(), limit: 20, cursor: null });
  }

  function read(customerId: string): void { void run("detail", { schemaVersion: 1, scope, customerId }); }

  function selectCustomer(contactId: string): void {
    if (customer === undefined || capture === undefined) return;
    setRecentOrders(undefined);
    setRepeatPreview(undefined);
    setSelectedContact(contactId);
    setSelectedAddress(undefined);
    invalidateQuote();
    const command = { ...base(), customerId: customer.customer.customerId, contactId,
      expectedCustomerVersion: customer.customer.version };
    void (async () => {
      const reply = await run("customer", command);
      if (reply?.ok) await refreshWorkspace(capture.captureDraftId);
    })();
  }

  function selectAddress(addressId: string, version: number): void {
    if (capture?.customerSnapshotRef === null || capture?.customerSnapshotRef === undefined) return;
    setSelectedAddress(addressId);
    invalidateQuote();
    const command = { ...base(), customerSnapshotRef: capture.customerSnapshotRef, addressId,
      expectedAddressVersion: version };
    void (async () => {
      const reply = await run("fulfillment", command);
      if (reply?.ok) await refreshWorkspace(capture.captureDraftId);
    })();
  }

  function previewOrder(orderId: string): void {
    if (customerSnapshot === null) return;
    setRepeatPreview(undefined);
    void run("repeatPreview", { schemaVersion: 1, scope, customerId: customerSnapshot.customerId, orderId });
  }

  function repeatOrder(): void {
    if (capture === undefined || customerSnapshot === null || repeatPreview === undefined) return;
    const captureDraftId = capture.captureDraftId;
    void (async () => {
      const reply = await run("repeatOrder", { ...base(), customerId: customerSnapshot.customerId,
        sourceOrderId: repeatPreview.sourceOrderId });
      if (reply?.ok) await refreshWorkspace(captureDraftId);
    })();
  }

  function retryPending(): void {
    if (pending === undefined) return;
    void (async () => {
      const reply = await run(pending.operation, pending.command);
      if (reply?.ok && ["autosave", "claim", "customer", "deliveryInstructions", "fulfillment", "repeatOrder", "takeover"].includes(pending.operation)) {
        const target = typeof pending.command === "object" && pending.command !== null && "captureDraftId" in pending.command
          ? pending.command.captureDraftId : undefined;
        if (typeof target === "string") await refreshWorkspace(target);
      }
      if (reply?.ok && pending.operation === "transfer") {
        reset();
        await run("tray", { schemaVersion: 2, scope, limit: 20 });
        await run("assignmentCandidates", { schemaVersion: 1, scope });
      }
      if (reply?.ok && pending.operation === "noSale") await afterNoSaleApplied();
      if (reply?.ok && pending.operation === "hold") {
        reset();
        setHoldNotice(true);
        await run("tray", { schemaVersion: 2, scope, limit: 20 });
      }
    })();
  }

  function reset(): void {
    invalidateQuote();
    setQuoteRequestedForDiffers(false);
    setDeliveryQuote(null); setPaymentIntentState(null); setPaymentProjection(null); setPaymentBasis(null);
    setPaymentIntentNotice(undefined);
    setCapture(undefined); setResults(undefined); setCustomer(undefined); setCustomerSnapshot(null);
    setFulfillmentSnapshot(null); setSelectedContact(undefined); setSelectedAddress(undefined); setPending(undefined);
    setRepeatOrderPlan(null);
    setSelectionProjection(null); setSheetProduct(undefined); setSheetGroups([]); setSelectionBusy(false); setSelectionBusyLineId(undefined);
    if (selectionFeedbackTimer.current) clearTimeout(selectionFeedbackTimer.current);
    setSelectionFeedback(undefined);
    setSheetConfirmedTotalMinor(undefined);
    setRecentOrders(undefined); setRepeatPreview(undefined);
    setError(undefined); setErrorOperation(undefined); setErrorCode(undefined); setSourceChannel("phone"); setFulfillmentChannel("delivery");
    setDeliveryInstructions("");
    setDeliveryInstructionSuggestions([]);
    setSelectedTableId("");
    setScheduledFor("");
    setTransferTarget("");
    setTransferConfirmed(false);
    setNoSaleOpen(false);
    setNoSaleReason("");
  }

  const locked = busy || capture?.status !== "draft" || capture?.attentionLeaseId === null
    || error === "denied" || error === "conflict";
  const leaseExpired = capture?.status === "draft" && capture.attentionLeaseExpiresAt !== null
    && Date.parse(capture.attentionLeaseExpiresAt) <= leaseClock;
  const paymentBlocksConfirm = paymentIntentBlocksConfirm(paymentIntent, paymentProjection);
  const multipleShifts = (confirmationContext?.shifts.length ?? 0) > 1;
  const activeShift = confirmationContext?.shifts.length === 1 ? confirmationContext.shifts[0] : undefined;
  // H21: covers every fact that can make a delivery quote unusable at confirm time -- missing,
  // never covered, already expired by the client's own clock (a courtesy warning; the server is
  // still the one that actually enforces expiry, H14), or simply for a different requested time
  // -- not just the time comparison this used to be limited to. `quoteRequestedForDiffers` is
  // still OR'd in separately: it is local-only UI state (set the instant the operator edits the
  // field, before `deliveryQuote` itself changes) that `deliveryQuoteBlocksConfirm`'s pure
  // comparison against the server's frozen facts can't see, and applyWorkspace clears it on any
  // unrelated mutation, so it never masks a legitimate re-quote (H11).
  const quoteBlockReason = deliveryQuoteBlocksConfirm(fulfillmentChannel, deliveryQuote, scheduledFor, new Date());
  const quoteBlocksConfirm = fulfillmentChannel === "delivery"
    && (quoteRequestedForDiffers || quoteBlockReason !== null);
  const canConfirm = confirmationContext !== undefined && activeShift !== undefined && fulfillmentChannel !== null
    && (fulfillmentChannel !== "dine_in" || selectedTableId !== "")
    && (fulfillmentChannel !== "delivery" || (customerSnapshot !== null && fulfillmentSnapshot !== null))
    && !paymentBlocksConfirm && !quoteBlocksConfirm;
  useEffect(() => {
    const shortcuts: ShortcutTable = busy ? {} : error === "conflict" || capture?.status === "confirmed"
      ? { reset: ariaKeyShortcut("reset") }
      : capture === undefined ? { create: ariaKeyShortcut("create") }
        : locked ? {} : { search: ariaKeyShortcut("search") };
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.repeat || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const id = dispatchShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        altKey: event.altKey, targetTag: target?.tagName,
        targetIsEditable: target instanceof HTMLElement && target.isContentEditable }, shortcuts);
      if (id === undefined) return;
      event.preventDefault();
      if (id === "create") create();
      else if (id === "reset") reset();
      else if (searchFocusTarget(capture?.status === "draft") === "menu") productSearchRef.current?.focus();
      else searchInputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  const menuConflict = error === "conflict" && errorOperation === "selectionPlan";
  // H10: confirm_capture_draft_v3 refused to confirm a delivery order because the frozen quote is
  // missing, expired, or never covered the address; the fix is always the same -- re-quote.
  const confirmQuoteInvalid = error === "conflict" && errorOperation === "confirm"
    && errorCode === "CAPTURE_DELIVERY_QUOTE_INVALID";
  return <div className={`flex flex-col gap-4 ${capture?.status === "draft" ? "pb-20 sm:pb-0" : ""}`} aria-busy={busy}>
    <div role={error === undefined ? "status" : "alert"} aria-live="polite"
      className={error === undefined ? "text-sm text-text-muted" : "rounded-lg border border-border bg-error-bg p-4 text-sm"}>
      {busy ? "Guardando en el servidor…" : error === undefined ? capture === undefined ? "Crea o recupera un borrador para comenzar."
        : `Borrador ${capture.folio} · versión ${capture.version}`
        : menuConflict ? "El menú cambió; vuelve a cargar."
        : confirmQuoteInvalid ? "La cotización de entrega falta, venció o no cubre la dirección"
        : errorOperation === "renew" && errorCode === "CAPTURE_LEASE_TAKEN" ? "Otra estación tomó esta captura"
        : messages[error]}
      {menuConflict && <button className={`${button} ml-3`} disabled={busy || catalogReloading}
        onClick={() => void reloadMenu()}>{catalogReloading ? "Recargando…" : "Recargar menú"}</button>}
      {confirmQuoteInvalid && <button className={`${button} ml-3`} disabled={busy}
        onClick={() => void requestDeliveryQuote()}>Cotizar entrega</button>}
      {!menuConflict && !confirmQuoteInvalid && pending !== undefined && <button className={`${button} ml-3`} onClick={retryPending}>Reintentar misma operación</button>}
      {!menuConflict && error === "conflict" && <button className={`${button} ml-3`} disabled={busy}
        onClick={() => { reset(); void run("tray", { schemaVersion: 2, scope, limit: 20 }); }}>{errorCode === "CAPTURE_LEASE_TAKEN" ? "Ver borradores" : "Retomar"}</button>}
      {capture?.status === "confirmed" && <button className={`${button} ml-3`}
        aria-keyshortcuts={ariaKeyShortcut("reset")} disabled={busy} onClick={reset}>Volver a la bandeja</button>}
    </div>
    {leaseExpired && error !== "conflict" && <div role="alert" className="rounded-lg border border-border bg-error-bg p-3 text-sm">
      Se venció tu tiempo de atención; vuelve a tomarla.
      <button type="button" className={`${button} ml-3`} disabled={busy}
        onClick={() => { reset(); void run("tray", { schemaVersion: 2, scope, limit: 20 }); }}>Retomar</button>
    </div>}
    {capture === undefined ? <>
      {holdNotice && <div role="status" className="rounded-lg border border-border bg-surface p-3 text-sm">Captura guardada para después.</div>}
      {noSaleNotice && <div role="status" className="rounded-lg border border-border bg-surface p-3 text-sm">
        Captura cancelada.
      </div>}
      <section className={panel}><h2 className="font-heading text-lg font-semibold">Abrir captura</h2>
        <p className="my-2 text-sm text-text-muted">Crea un borrador durable para una llamada con entrega a domicilio.</p>
        <button className={button} onClick={create} aria-keyshortcuts={ariaKeyShortcut("create")}
          disabled={busy}>Nueva captura telefónica</button></section>
      {tray.length > 0 && <section className={panel}><h2 className="font-heading text-lg font-semibold">Borradores recuperables</h2>
        <p className="my-2 text-sm text-text-muted">Retoma una captura de esta sucursal para seguir atendiéndola.</p>
        <div className="grid gap-2">{tray.map((item) => <button key={item.captureDraftId} title={item.captureDraftId} className={`${button} min-w-0 text-left`}
          disabled={busy} onClick={() => recover(item)}><strong className="block break-words">{"customer" in item && item.customer !== null ? item.customer.displayName : "Sin cliente"}</strong>
           {"customer" in item && item.customer !== null && <span className="block break-all text-sm">{item.customer.phone}</span>}
           <span className="block text-xs text-text-muted">Captura {shortCaptureDraftId(item.captureDraftId)} · {item.folio}</span>
           <span className="block text-xs text-text-muted">{sourceLabel(item.sourceChannel)} · {item.fulfillmentChannel ? fulfillmentLabel(item.fulfillmentChannel) : "Sin entrega"} · {formatDate(item.updatedAt, confirmationContext?.timeZone)}</span>
           {"totalMinor" in item && item.totalMinor !== null && item.currency !== null && <span className="block text-sm">Ítems: {formatMinorUnits(item.totalMinor, item.currency)}</span>}
          {item.ownerMembershipId !== null && <span className="block text-xs text-text-muted">Asignada a {assignmentCandidates.find((candidate) => candidate.membershipId === item.ownerMembershipId)?.displayLabel ?? "otro operador"}</span>}
        </button>)}</div>
        {canManageAssignment && tray.some((item) => item.attentionStatus === "claimed") && <div className="mt-5 border-t border-border pt-4">
          <h3 className="font-heading font-semibold">Apropiación supervisada</h3>
          <p className="mt-1 text-sm text-text-muted">Úsala sólo cuando otro operador no pueda continuar. El motivo queda auditado y la captura pasa a tu atención.</p>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm" htmlFor="capture-takeover-draft">Captura asignada
              <select id="capture-takeover-draft" className={input} value={takeoverDraftId}
                onChange={(event) => setTakeoverDraftId(event.target.value)} disabled={busy}>
                <option value="">Selecciona una captura</option>
                {tray.filter((item) => item.attentionStatus === "claimed").map((item) => <option
                  key={item.captureDraftId} value={item.captureDraftId}>{item.folio} · versión {item.version}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm" htmlFor="capture-takeover-reason">Motivo obligatorio
              <textarea id="capture-takeover-reason" className={`${input} min-h-24 resize-y`} maxLength={500}
                value={takeoverReason} onChange={(event) => setTakeoverReason(event.target.value)} disabled={busy} />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="min-h-5 min-w-5 shrink-0 focus-visible:outline-2 focus-visible:outline-accent"
              checked={takeoverConfirmed} onChange={(event) => setTakeoverConfirmed(event.target.checked)} disabled={busy} />
              Confirmo que el operador actual no puede continuar y que esta reasignación quedará auditada.
            </label>
            <button type="button" className={button} onClick={takeOverCapture}
              disabled={busy || takeoverDraftId === "" || takeoverReason.trim().length === 0 || !takeoverConfirmed}>
              Tomar control de la captura
            </button>
          </div>
        </div>}
      </section>}
    </> : <>
      {capture.status === "confirmed" && <section className={panel} data-testid="confirmed-capture">
        <h2 className="font-heading text-lg font-semibold">Captura convertida en orden</h2>
        <p className="mt-2 text-sm">La captura quedó cerrada y ya no admite cambios.</p>
        <p className="mt-1 break-all text-xs text-text-muted">Orden: {capture.confirmedOrderId}</p>
      </section>}
      <section className={panel}><h2 className="font-heading text-lg font-semibold">Canal y cumplimiento</h2>
        <div className="mt-3 flex flex-wrap gap-3"><label className="text-sm">Origen <select value={sourceChannel} onChange={changeSource}
          className={`${input} ml-2`} disabled={locked}><option value="phone">Teléfono</option><option value="whatsapp_manual">WhatsApp manual</option>
          <option value="counter">Mostrador</option><option value="table">Mesa</option><option value="self_service">Autoservicio</option></select></label>
        <label className="text-sm">Cumplimiento <select value={fulfillmentChannel ?? ""} onChange={changeFulfillment}
          className={`${input} ml-2`} disabled={locked || fulfillmentSnapshot !== null}><option value="">Sin definir</option><option value="delivery">Domicilio</option>
          <option value="pickup" disabled={fulfillmentSnapshot !== null}>Recoger</option><option value="counter" disabled={fulfillmentSnapshot !== null}>Mostrador</option>
          <option value="dine_in" disabled={fulfillmentSnapshot !== null}>Mesa</option></select></label></div>
      </section>
      <section className={panel}><h2 className="font-heading text-lg font-semibold">1. Cliente</h2>
        <form onSubmit={search} className="mt-3 flex flex-wrap gap-3"><label className="grid gap-1 text-sm" htmlFor="capture-search-mode">Buscar por
          <select id="capture-search-mode" name="mode" className={input} disabled={locked}>
          <option value="phone">Teléfono</option><option value="name">Nombre</option><option value="address">Dirección</option></select>
          </label>
          <label className="grid flex-1 gap-1 text-sm" htmlFor="capture-search-query">Consulta
            <input id="capture-search-query" ref={searchInputRef} name="query" required maxLength={200}
              aria-keyshortcuts={ariaKeyShortcut("search")} className={`${input} min-w-48 w-full`}
              placeholder="Teléfono, nombre o dirección" disabled={locked}/>
          </label>
          <button className={button} disabled={locked}>Buscar</button></form>
        {results !== undefined && <div className="mt-3 grid gap-2">{results.candidates.length === 0 ? <p className="text-sm">Sin coincidencias.</p>
          : results.candidates.map((item) => <button key={item.customerId} className={`${button} text-left`} disabled={locked}
            onClick={() => read(item.customerId)}><strong className="block">{item.displayName}</strong>
            <span className="text-xs text-text-muted">{item.phones.map((phone) => phone.displayValue).join(" · ")}</span></button>)}</div>}
      </section>
      {customer !== undefined && <section className={panel}><h2 className="font-heading text-lg font-semibold">Elegir teléfono · {customer.customer.displayName}</h2>
        <div className="mt-3 grid gap-2">{customer.customer.phones.map((phone) => <button key={phone.contactId} className={`${button} text-left`}
          disabled={locked} onClick={() => selectCustomer(phone.contactId)}><span>{phone.label}: {phone.displayValue}</span>
          {selectedContact === phone.contactId && <span className="ml-2 text-accent">Selección local</span>}</button>)}</div></section>}
      {customerSnapshot !== null && <section className={panel} data-testid="rehydrated-customer-snapshot">
        <h2 className="font-heading text-lg font-semibold">Cliente guardado</h2><p className="mt-2"><strong>{customerSnapshot.displayName}</strong><br />
          {customerSnapshot.phoneDisplayValue}</p>{fulfillmentSnapshot !== null && <p className="mt-2 text-sm">
          <strong>{fulfillmentSnapshot.label}</strong><br />{[fulfillmentSnapshot.streetLine, fulfillmentSnapshot.unit,
            fulfillmentSnapshot.neighborhood, fulfillmentSnapshot.locality].filter(Boolean).join(", ")}</p>}
        <p className="mt-2 text-xs text-text-muted">Datos congelados al guardar esta captura.</p></section>}
      {customerSnapshot !== null && <section className={panel} data-testid="customer-recent-orders">
        <h2 className="font-heading text-lg font-semibold">Pedidos recientes</h2>
        <p className="mt-1 text-sm text-text-muted">Consulta lo que el cliente pidió antes en esta sucursal y revisa los cambios antes de repetirlo.</p>
        {recentOrders === undefined ? <p className="mt-3 text-sm text-text-muted">Cargando historial…</p>
          : recentOrders.orders.length === 0 ? <p className="mt-3 text-sm">Este cliente todavía no tiene pedidos confirmados en la sucursal.</p>
            : <div className="mt-3 grid gap-3">{recentOrders.orders.map((order) => <article key={order.orderId}
              className="rounded-lg border border-border bg-bg p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><strong className="block">{formatDate(order.confirmedAt)}</strong>
                  <span className="text-xs text-text-muted">{fulfillmentLabel(order.fulfillmentChannel)} · {orderStatusLabel(order.status)}</span></div>
                <button type="button" className={button} disabled={locked} onClick={() => previewOrder(order.orderId)}>
                  Revisar para repetir
                </button>
              </div>
              <ul className="mt-3 grid gap-2 text-sm">{order.items.map((item) => <li key={item.orderItemId}>
                <span className={item.status === "cancelled" ? "line-through text-text-muted" : ""}>
                  {item.quantity} × {item.productName} · {money(item.unitPriceMinor, order.currency)} c/u
                </span>
                {item.modifiers.length > 0 && <span className="block pl-4 text-xs text-text-muted">
                  {item.modifiers.map((modifier) => `${modifier.quantity} × ${modifier.name}`).join(" · ")}
                </span>}
              </li>)}</ul>
            </article>)}</div>}
      </section>}
      {repeatPreview !== undefined && <section className={panel} data-testid="repeat-order-preview">
        <h2 className="font-heading text-lg font-semibold">Vista previa para repetir</h2>
        <p className="mt-1 text-sm">
          <strong>{repeatPreview.readyLineCount}</strong> {repeatPreview.readyLineCount === 1 ? "línea disponible" : "líneas disponibles"}
          {repeatPreview.blockedLineCount > 0 && <> · <strong>{repeatPreview.blockedLineCount}</strong> {repeatPreview.blockedLineCount === 1 ? "línea bloqueada" : "líneas bloqueadas"}</>}
        </p>
        <p className="mt-1 text-xs text-text-muted">Los precios y las opciones se comparan con el catálogo vigente. Las líneas bloqueadas no se prepararán.</p>
        <div className="mt-3 grid gap-3">{repeatPreview.lines.map((line) => <article key={line.sourceOrderItemId}
          className={`rounded-lg border p-3 ${line.status === "blocked" ? "border-[oklch(75%_0.13_25)] bg-error-bg" : "border-border bg-bg"}`}>
          <div className="flex flex-wrap justify-between gap-2"><strong>{line.quantity} × {line.currentName ?? line.historicalName}</strong>
            <span className="text-sm">{line.currentUnitPriceMinor === null ? "No disponible" : `${money(line.currentUnitPriceMinor, repeatPreview.currency)} c/u`}</span></div>
          {line.currentName !== null && line.currentName !== line.historicalName && <p className="mt-1 text-xs text-text-muted">Antes: {line.historicalName}</p>}
          {line.issues.length > 0 && <ul className="mt-2 grid gap-1 text-xs">{line.issues.map((issue) => <li
            key={`${issue.code}:${issue.groupId ?? ""}:${issue.modifierId ?? ""}`}
            className={issue.severity === "blocking" ? "font-semibold" : "text-text-muted"}>
            {issueLabels[issue.code]}{issue.historicalAmountMinor !== null && issue.currentAmountMinor !== null
              ? ` ${money(issue.historicalAmountMinor, repeatPreview.currency)} → ${money(issue.currentAmountMinor, repeatPreview.currency)}` : ""}
          </li>)}</ul>}
        </article>)}</div>
        {repeatPreview.blockedLineCount > 0 && <p role="alert" className="mt-3 text-sm">
          Revisa las líneas bloqueadas: no se agregarán a la captura. El resto puede prepararse de forma segura.
        </p>}
        <button type="button" className={`${button} mt-4`} onClick={repeatOrder}
          disabled={locked || repeatPreview.readyLineCount === 0}>
          Preparar {repeatPreview.readyLineCount} {repeatPreview.readyLineCount === 1 ? "línea" : "líneas"} en la captura
        </button>
      </section>}
      {repeatOrderPlan !== null && <section className={panel} data-testid="rehydrated-repeat-order-plan">
        <h2 className="font-heading text-lg font-semibold">Pedido repetido preparado</h2>
        <p className="mt-2 text-sm">{repeatOrderPlan.lineCount} {repeatOrderPlan.lineCount === 1 ? "línea lista" : "líneas listas"} para esta captura.</p>
        <p className="mt-1 text-xs text-text-muted">La preparación se conserva al recargar. Al confirmar, el servidor validará nuevamente cada selección y usará los precios vigentes.</p>
      </section>}
      {capture.status === "draft" && <section className={`${panel} flex min-h-[520px] flex-col overflow-hidden p-0`} data-testid="capture-menu-section">
        <h2 className="p-4 font-heading text-lg font-semibold">2. Menú</h2>
        {selectionFeedback !== undefined && <p className="px-4 pb-2 text-sm" role={selectionFeedback === "saving" || selectionFeedback === "saved" ? "status" : "alert"}>
          {selectionFeedback === "saving" ? "Guardando pedido…" : selectionFeedback === "saved" ? "Pedido guardado" : selectionFeedback}
        </p>}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <CaptureMenu catalog={catalog.catalog} currency={catalog.catalog?.currency ?? "MXN"}
            lineQuantities={(selectionProjection?.lines ?? []).reduce(
              (map, line) => map.set(line.productId, (map.get(line.productId) ?? 0) + line.quantity),
              new Map<string, number>())}
            busy={selectionBusy || selectionBusyLineId !== undefined} searchInputRef={productSearchRef}
            onSelectProduct={openProduct} />
          <CaptureTicket projection={selectionProjection} catalog={catalog.catalog} busyLineId={selectionBusyLineId} locked={locked}
            onEdit={openEditLine}
            onIncrement={(lineId) => void changeLineQuantity(lineId, 1)}
            onDecrement={(lineId) => void changeLineQuantity(lineId, -1)}
            onRemove={(lineId) => void removeLine(lineId)}
            onEditNote={openNoteSheet}
            onHold={holdCapture} onNoSale={openNoSale} />
        </div>
      </section>}
      {noteSheetLineId !== undefined && <div className="fixed inset-0 z-30 flex items-end justify-center bg-[oklch(10%_0.02_250_/_.45)] sm:items-center"
        role="dialog" aria-modal="true" aria-labelledby="capture-line-note-title"
        onClick={(event) => { if (event.target === event.currentTarget) { setNoteSheetLineId(undefined); setNoteSheetDraft(""); } }}>
        <div className="grid w-full max-w-md gap-3 rounded-t-2xl bg-surface p-4 sm:rounded-2xl">
          <h2 id="capture-line-note-title" className="font-heading text-lg font-semibold">Nota para cocina</h2>
          <label className="grid gap-1 text-sm" htmlFor="capture-line-note-text">Instrucción (opcional)
            <textarea id="capture-line-note-text" className={`${input} min-h-24 resize-y`} maxLength={200}
              value={noteSheetDraft} onChange={(event) => setNoteSheetDraft(event.target.value.slice(0, 200))} />
          </label>
          <span className="text-xs text-text-muted">{noteSheetDraft.length}/200</span>
          {selectionFeedback !== undefined && <p role={selectionFeedback === "saving" || selectionFeedback === "saved" ? "status" : "alert"} className="text-sm">
            {selectionFeedback === "saving" ? "Guardando…" : selectionFeedback === "saved" ? "Guardado" : selectionFeedback}
          </p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="min-h-11 min-w-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => { setNoteSheetLineId(undefined); setNoteSheetDraft(""); }}>Cancelar</button>
            <button type="button" className="min-h-11 min-w-11 rounded-lg border border-border bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent"
              disabled={selectionBusyLineId !== undefined} onClick={() => void saveLineNote()}>Guardar</button>
          </div>
        </div>
      </div>}
      {noSaleOpen && <div className="fixed inset-0 z-30 flex items-end justify-center bg-[oklch(10%_0.02_250_/_.45)] sm:items-center"
        role="dialog" aria-modal="true" aria-labelledby="capture-no-sale-title"
        onClick={(event) => { if (event.target === event.currentTarget) cancelNoSale(); }}>
        <div className="grid w-full max-w-md gap-3 rounded-t-2xl bg-surface p-4 sm:rounded-2xl">
          <h2 id="capture-no-sale-title" className="font-heading text-lg font-semibold">Cancelar captura</h2>
          <p className="text-sm text-text-muted">Queda registrada como cancelada con el motivo. Esta acción no se puede deshacer.</p>
          <label className="grid gap-1 text-sm" htmlFor="capture-no-sale-reason">Motivo obligatorio
            <textarea id="capture-no-sale-reason" className={`${input} min-h-24 resize-y`} maxLength={500}
              value={noSaleReason} onChange={(event) => setNoSaleReason(event.target.value)} disabled={busy} autoFocus />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={button} disabled={busy} onClick={cancelNoSale}>Volver</button>
            <button type="button" className={button} disabled={busy || noSaleReason.trim().length === 0}
              onClick={confirmNoSale}>Confirmar</button>
          </div>
        </div>
      </div>}
      {sheetProduct !== undefined && <ProductSheet key={`${sheetProduct.productId}:${sheetEditLine?.lineId ?? "new"}`} product={sheetProduct} groups={sheetGroups}
        currency={catalog.catalog?.currency ?? "MXN"} busy={selectionBusy} confirmedTotalMinor={sheetConfirmedTotalMinor}
        initialLine={sheetEditLine} error={sheetError} showVariants
        onClose={() => { setSheetProduct(undefined); setSheetGroups([]); setSheetConfirmedTotalMinor(undefined); setSheetEditLine(undefined); setSheetError(undefined); }}
        onAdd={(quantity, modifierGroups, note, variantId) => void addFromSheet(quantity, modifierGroups, note, variantId)} />}
      {customer !== undefined && capture.customerSnapshotRef !== null && <section className={panel}><h2 className="font-heading text-lg font-semibold">3. Entrega · dirección validada</h2>
        <div className="mt-3 grid gap-2">{customer.addresses.map((item) => <button key={item.addressId} className={`${button} text-left`}
          disabled={locked || !item.validatedForRequestedBranch} onClick={() => selectAddress(item.addressId, item.version)}><strong className="block">{item.address.label}</strong>
          <span className="block text-xs text-text-muted">{[item.address.streetLine, item.address.neighborhood, item.address.locality].filter(Boolean).join(", ")}</span>
          <span className="text-xs text-accent">{item.validatedForRequestedBranch ? selectedAddress === item.addressId ? "Selección local" : "Validada para esta sucursal" : "Pendiente de validación"}</span>
        </button>)}</div><a href="/app/customers" className="mt-3 inline-block text-sm font-semibold text-accent underline">Editar o validar direcciones en Directorio</a></section>}
      {fulfillmentChannel === "delivery" && <section className={panel}>
        <h2 className="font-heading text-lg font-semibold">3. Entrega · instrucciones</h2>
        <p className="mt-1 text-sm text-text-muted">Se guardan en esta captura; nunca modifican la dirección del cliente ni se heredan automáticamente.</p>
        {deliveryInstructionSuggestions.length > 0 && <div className="mt-3 rounded-lg border border-border bg-bg p-3">
          <p className="text-sm font-semibold">Usadas antes por este cliente en esta sucursal</p>
          <p className="mt-1 text-xs text-text-muted">Últimos 180 días, máximo cinco. Elige una para copiarla; no se aplica ni guarda sola.</p>
          <ul className="mt-2 grid gap-2">{deliveryInstructionSuggestions.map((suggestion) => <li key={suggestion.deliveryInstructions}>
            <button type="button" className={`${button} w-full text-left`} disabled={locked}
              onClick={() => setDeliveryInstructions(suggestion.deliveryInstructions)}>
              <span className="block">{suggestion.deliveryInstructions}</span>
              <span className="block text-xs text-text-muted">Usada {suggestion.usageCount} {suggestion.usageCount === 1 ? "vez" : "veces"} · última {suggestion.lastUsedAt.slice(0, 10)}</span>
            </button>
          </li>)}</ul>
        </div>}
        <form className="mt-3 grid gap-3" onSubmit={saveDeliveryInstructions}>
          <label className="grid gap-1 text-sm" htmlFor="capture-delivery-instructions">Indicaciones opcionales</label>
          <textarea id="capture-delivery-instructions" maxLength={500} rows={3} className={`${input} min-h-24 resize-y`}
            value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)}
            disabled={locked} placeholder="Ej. Tocar dos veces; no dejar con vigilancia" />
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-text-muted">{deliveryInstructions.length}/500</span>
            <button className={button} disabled={locked}>{instructionsFeedback === "saving" ? "Guardando…" : "Guardar instrucciones"}</button></div>
          {instructionsFeedback !== undefined && instructionsFeedback !== "saving" && <p role={instructionsFeedback === "saved" ? "status" : "alert"} className="text-sm">{instructionsFeedback === "saved" ? "Guardado" : instructionsFeedback}</p>}
        </form>
      </section>}
      {fulfillmentChannel === "delivery" && fulfillmentSnapshot !== null && capture.status === "draft" && <section className={panel} data-testid="delivery-quote">
        <h2 className="font-heading text-lg font-semibold">3. Entrega · cotización</h2>
        <p className="mt-1 text-sm text-text-muted">La cobertura, tarifa y promesa se calculan en el servidor para la dirección guardada.</p>
        <form className="mt-3 grid gap-3" onSubmit={(event) => { event.preventDefault(); void requestDeliveryQuote(); }}>
          <label className="grid gap-1 text-sm" htmlFor="capture-scheduled-for">Programar entrega (opcional)
            <input id="capture-scheduled-for" type="datetime-local" className={input} value={scheduledFor}
              onChange={(event) => {
                setScheduledFor(event.target.value);
                invalidateQuote();
                if (deliveryQuote !== null) setQuoteRequestedForDiffers(true);
              }} disabled={busy} /></label>
          <p className="text-xs text-text-muted">Entre 30 minutos y 7 días. La hora se convierte a ISO al solicitar la cotización.</p>
          <button type="submit" className={button} disabled={busy}>{busy ? "Cotizando…" : "Cotizar entrega"}</button>
        </form>
        {quoteError && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{quoteError}</p>}
        {quoteBlocksConfirm && <div role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">
          <p>{quoteBlockReason === "missing" ? "Aún no hay cotización de entrega: cotiza antes de convertir en orden."
            : quoteBlockReason === "not_covered" ? "La dirección no tiene cobertura de entrega."
              : quoteBlockReason === "expired" ? "La cotización expiró: vuelve a cotizar antes de convertir en orden."
                : "La cotización mostrada es de otra hora: vuelve a cotizar antes de convertir en orden."}</p>
          <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => void requestDeliveryQuote()}>
            Cotizar entrega
          </button>
        </div>}
        {deliveryQuote && <div role="status" className="mt-3 grid gap-1 rounded-lg border border-border bg-bg p-3 text-sm">
          <strong>{formatDeliveryQuote(deliveryQuote, "es-MX").status}</strong>
          <p>Tarifa: {formatDeliveryQuote(deliveryQuote, "es-MX").fee}</p>
          <p>Ventana prometida: {formatDeliveryQuote(deliveryQuote, "es-MX").window}</p>
          <p>Expira: {formatDeliveryQuote(deliveryQuote, "es-MX").expiry}</p>
        </div>}
      </section>}
      {capture.status === "draft" && (selectionProjection !== null && selectionProjection.lines.length > 0
        || repeatOrderPlan !== null) && <>
        {/* H28: keyed by captureDraftId so React remounts it (and resets its local
          customTender/appliedTenderMinor) on every capture switch, instead of carrying state from
          the capture the operator just left onto the one they just opened. */}
        <CapturePayment key={capture.captureDraftId}
          projection={paymentProjection} basis={paymentBasis} intent={paymentIntent} deliveryQuote={deliveryQuote}
          fulfillment={fulfillmentChannel}
          currency={paymentProjection?.currency ?? paymentBasis?.currency ?? confirmationContext?.currency ?? "MXN"}
          busy={busy} onSetIntent={setPaymentIntent}
          onRefreshIntent={refreshPaymentIntent}
          errorNotice={paymentIntentNotice ?? (errorOperation === "paymentIntent" && error !== undefined ? messages[error] : undefined)} />
        {paymentIntentNotice !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm">{paymentIntentNotice}</p>}
      </>}
      <details className={panel}><summary className="min-h-11 cursor-pointer font-semibold">Más</summary>
      {capture.status === "draft" && canManageAssignment && <section className={panel} data-testid="capture-transfer">
        <h2 className="font-heading text-lg font-semibold">Pasar la captura a otro operador</h2>
        <p className="mt-1 text-sm text-text-muted">El otro operador la verá en su bandeja y podrá continuar donde la dejaste.</p>
        {assignmentCandidates.length === 0 ? <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm">Nadie más de esta sucursal tiene sesión activa ahora. Puedes dejarla en espera y otro operador la retomará desde la bandeja.</p>
            <button type="button" className={button} disabled={locked} onClick={holdCapture}>Guardar para después</button>
          </div>
          : <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm" htmlFor="capture-transfer-target">Operador destino
              <select id="capture-transfer-target" className={input} value={transferTarget}
                onChange={(event) => { setTransferTarget(event.target.value); setTransferConfirmed(false); }} disabled={locked}>
                <option value="">Selecciona un operador</option>
                {assignmentCandidates.map((candidate) => <option key={candidate.membershipId} value={candidate.membershipId}>
                  {candidate.displayLabel} · {candidate.roles.join(", ")}
                </option>)}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="min-h-5 min-w-5 shrink-0 focus-visible:outline-2 focus-visible:outline-accent"
              checked={transferConfirmed} onChange={(event) => setTransferConfirmed(event.target.checked)} disabled={locked || transferTarget === ""} />
              Confirmo que el operador seleccionado continuará esta captura y dejaré de poder editarla.
            </label>
            <button type="button" className={button} onClick={transferCapture}
              disabled={locked || transferTarget === "" || !transferConfirmed}>Transferir de forma segura</button>
          </div>}
      </section>}
      </details>
      {capture.status === "draft" && <section className={panel} data-testid="capture-confirmation">
        <h2 className="font-heading text-lg font-semibold">5. Confirmar</h2>
        {confirmationContext === undefined ? <p role="alert" className="mt-2 text-sm text-text-muted">
          No fue posible leer el turno, moneda o zona horaria de esta sucursal. Recarga antes de confirmar.
        </p> : <>
          <p className="mt-2 text-sm text-text-muted">
            La orden usará {confirmationContext.currency} y {confirmationContext.timeZone}, definidos por el servidor.
          </p>
          {activeShift !== undefined && <p className="mt-2 text-sm">Turno: <strong>{activeShift.name}</strong></p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {fulfillmentChannel === "dine_in" && <label className="grid gap-1 text-sm" htmlFor="capture-table">Mesa
              <select id="capture-table" className={input} value={selectedTableId}
                onChange={(event) => setSelectedTableId(event.target.value)}
                disabled={locked || confirmationContext.tables === null}>
                <option value="">Selecciona una mesa</option>
                {confirmationContext.tables?.map((table) => <option key={table.tableId} value={table.tableId}>
                  {table.name} · {table.capacity} personas
                </option>)}
              </select>
            </label>}
          </div>
          {confirmationContext.shifts.length === 0 && <p role="alert" className="mt-2 text-sm text-text-muted">
            No hay turno abierto. <a href="/app/caja" className="font-semibold text-accent underline">Abrir turno en Caja</a>.
          </p>}
          {multipleShifts && <p role="alert" className="mt-2 text-sm text-error">
            Hay más de un turno abierto; avisa al administrador.
          </p>}
          {fulfillmentChannel === "dine_in" && confirmationContext.tables === null && <p role="alert" className="mt-2 text-sm text-text-muted">
            No fue posible leer el plano de mesas; la confirmación permanece bloqueada.
          </p>}
          {fulfillmentChannel === "delivery" && (customerSnapshot === null || fulfillmentSnapshot === null) && <p className="mt-2 text-sm text-text-muted">
            Falta {customerSnapshot === null && fulfillmentSnapshot === null ? "guardar un cliente y una dirección validada"
              : customerSnapshot === null ? "guardar un cliente" : "guardar una dirección validada"} para confirmar el domicilio.
          </p>}
          {repeatOrderPlan !== null && <p role="status" className="mt-2 text-sm text-text-muted">
            El servidor volverá a cotizar este pedido con el catálogo vigente. Si algún producto o modificador ya no es válido, la confirmación se detendrá sin crear una orden parcial.
          </p>}
          {paymentBlocksConfirm && <p role="alert" className="mt-2 text-sm text-text-muted">
            {paymentProjection?.status === "stale"
              ? "Cambió el pedido: confirma de nuevo el cobro antes de convertir la captura en orden."
              : "El monto no cubre el total: ajusta el cobro antes de convertir la captura en orden."}
          </p>}
          <button type="button" className={`${button} mt-4`} onClick={confirmCapture} disabled={locked || !canConfirm}>
            {multipleShifts ? "Hay más de un turno abierto; avisa al administrador"
              : activeShift === undefined ? "No hay turno abierto" : "Convertir captura en orden"}
          </button>
        </>}
      </section>}
      {capture.status === "draft" && <aside className="rounded-xl border border-[oklch(80%_0.08_75)] bg-[oklch(96%_0.03_75)] p-4 text-sm"><strong>Captura abierta.</strong> Los cambios se guardan en el servidor. Si se vence tu tiempo de atención, vuelve a tomarla desde la bandeja.</aside>}
    </>}
    <details className={panel}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:outline-2 focus-visible:outline-accent">Atajos</summary>
      <ul className="mt-2 grid gap-2 text-sm">
        <li><kbd>N</kbd> — Nueva captura desde la bandeja.</li>
        <li><kbd>/</kbd> — Enfocar la búsqueda de productos si el menú está visible; si no, la búsqueda de cliente.</li>
        <li><kbd>Esc</kbd> — Volver a la bandeja tras un conflicto o una captura confirmada.</li>
      </ul>
    </details>
  </div>;
}

/** Best-effort UI match between a projected line's flat modifiers and the requested draft groups; only used to pick which confirmed amount to show, never to compute money. */
function sameProjectionModifiers(
  projected: readonly { readonly groupId: string; readonly optionId: string; readonly quantity: number }[],
  requested: readonly SelectionPlanModifierGroupDraft[],
): boolean {
  const canonical = (entries: readonly { readonly groupId: string; readonly optionId: string; readonly quantity: number }[]) =>
    [...entries].map((entry) => `${entry.groupId}:${entry.optionId}:${entry.quantity}`).sort();
  const projectedKeys = canonical(projected);
  const requestedKeys = canonical(requested.flatMap((group) => group.selections.map((selection) =>
    ({ groupId: group.groupId, optionId: selection.optionId, quantity: selection.quantity }))));
  return projectedKeys.length === requestedKeys.length && projectedKeys.every((key, index) => key === requestedKeys[index]);
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", { currency, style: "currency" }).format(amountMinor / 100);
}

function formatDate(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}

function fulfillmentLabel(value: CaptureFulfillmentChannelV1): string {
  return { counter: "Mostrador", delivery: "Domicilio", dine_in: "Mesa", pickup: "Para recoger" }[value];
}

function sourceLabel(value: CaptureSourceChannelV1): string {
  return { phone: "Teléfono", whatsapp_manual: "WhatsApp", counter: "Mostrador", table: "Mesa", self_service: "Autoservicio", integration: "Integración" }[value];
}

function orderStatusLabel(value: CustomerRecentOrderListV1["orders"][number]["status"]): string {
  return { cancelled: "Cancelado", closed: "Cerrado", draft: "Borrador", open: "Abierto", paid: "Pagado",
    partially_paid: "Pago parcial" }[value];
}
