import {
  parseAutosaveCaptureDraftCommandV1,
  parseCaptureMutationResultV1,
  parseCaptureAssignmentDirectoryRequestV1,
  parseCaptureAssignmentDirectoryV1,
  parseCaptureDeliveryInstructionSuggestionsRequestV1,
  parseCaptureDeliveryInstructionSuggestionsV1,
  parseCaptureWorkspaceRequestV3,
  parseCaptureWorkspaceRequestV4,
  parseCaptureWorkspaceV3,
  parseCaptureWorkspaceV4,
  parseCaptureWorkTrayRequestV1,
  parseCaptureWorkTrayResultV1,
  parseClaimCaptureDraftCommandV1,
  parseConfirmCaptureDraftCommandV2,
  parseCreateCaptureDraftCommandV1,
  parseReplaceCaptureSelectionPlanCommandV1,
  parseSetCaptureCustomerCommandV1,
  parseSetCaptureFulfillmentCommandV1,
  parseSetCaptureDeliveryInstructionsCommandV1,
  parseSetCaptureDeliveryInstructionsResultV1,
  parseTakeoverCaptureDraftCommandV1,
  parseTransferCaptureDraftCommandV1,
  type CaptureCustomerSnapshotV1,
  type CaptureDraftDetailV2,
  type AutosaveCaptureDraftCommandV1,
  type BranchScope,
  type CaptureFulfillmentChannelV1,
  type CaptureFulfillmentSnapshotV1,
  type CaptureRepeatOrderPlanSummaryV1,
  type CaptureSelectionPlanProjectionV1,
  type CaptureSelectionPlanSummaryV1,
  type CaptureSourceChannelV1,
} from "@super-restaurant/shared-types";
export type CaptureRequestResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "conflict" | "missing" | "unavailable" };
export type CaptureOperation = "autosave" | "confirm" | "create" | "claim" | "customer" | "deliveryInstructions"
  | "deliveryInstructionSuggestions" | "fulfillment" | "assignmentCandidates" | "selectionPlan" | "takeover"
  | "transfer" | "tray" | "workspace";
export interface CaptureKeyValueStore {
  readonly getItem: (key: string) => string | null;
  readonly removeItem: (key: string) => void;
  readonly setItem: (key: string, value: string) => void;
}
const deviceKey = "superrestaurant.capture.device.v1";
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const pendingKey = (scope: BranchScope) => `superrestaurant.capture.pending-autosave.v1:${scope.restaurantId}:${scope.branchId}`;

export function captureDeviceId(store: CaptureKeyValueStore | undefined, create: () => string): string {
  const stored = store?.getItem(deviceKey);
  if (stored !== null && stored !== undefined && canonicalUuid.test(stored)) return stored;
  const generated = create();
  if (!canonicalUuid.test(generated)) throw new Error("CAPTURE_DEVICE_ID_REJECTED");
  store?.setItem(deviceKey, generated);
  return generated;
}

export function persistPendingCaptureAutosave(store: CaptureKeyValueStore | undefined, input: unknown): AutosaveCaptureDraftCommandV1 | undefined {
  const command = parseAutosaveCaptureDraftCommandV1(input);
  if (store === undefined || command === undefined) return command;
  store.setItem(pendingKey(command.scope), JSON.stringify(command));
  return command;
}

export function readPendingCaptureAutosave(store: CaptureKeyValueStore | undefined, scope: BranchScope): AutosaveCaptureDraftCommandV1 | undefined {
  if (store === undefined) return undefined;
  try {
    const raw = store.getItem(pendingKey(scope));
    if (raw === null) return undefined;
    const command = parseAutosaveCaptureDraftCommandV1(JSON.parse(raw));
    return command?.scope.restaurantId === scope.restaurantId && command.scope.branchId === scope.branchId ? command : undefined;
  } catch { return undefined; }
}

export function clearPendingCaptureAutosave(
  store: CaptureKeyValueStore | undefined,
  command: AutosaveCaptureDraftCommandV1,
): void {
  if (store === undefined) return;
  const current = readPendingCaptureAutosave(store, command.scope);
  if (current?.idempotencyKey === command.idempotencyKey) store.removeItem(pendingKey(command.scope));
}
const paths = { autosave: "/autosave", confirm: "/confirm", create: "", claim: "/claim", customer: "/customer",
  assignmentCandidates: "/assignment-candidates",
  deliveryInstructions: "/delivery-instructions", deliveryInstructionSuggestions: "/delivery-instruction-suggestions",
  fulfillment: "/fulfillment", selectionPlan: "/selection-plan",
  takeover: "/takeover", transfer: "/transfer", tray: "/tray", workspace: "/workspace" } as const;
const parsers = {
  autosave: parseAutosaveCaptureDraftCommandV1,
  confirm: parseConfirmCaptureDraftCommandV2,
  create: parseCreateCaptureDraftCommandV1,
  claim: parseClaimCaptureDraftCommandV1,
  customer: parseSetCaptureCustomerCommandV1,
  deliveryInstructions: parseSetCaptureDeliveryInstructionsCommandV1,
  fulfillment: parseSetCaptureFulfillmentCommandV1,
  takeover: parseTakeoverCaptureDraftCommandV1,
  transfer: parseTransferCaptureDraftCommandV1,
} as const;
type CaptureResponse = NonNullable<ReturnType<typeof parseCaptureMutationResultV1>>
  | NonNullable<ReturnType<typeof parseCaptureAssignmentDirectoryV1>>
  | NonNullable<ReturnType<typeof parseCaptureDeliveryInstructionSuggestionsV1>>
  | NonNullable<ReturnType<typeof parseCaptureWorkTrayResultV1>>
  | NonNullable<ReturnType<typeof parseCaptureWorkspaceV3>>
  | NonNullable<ReturnType<typeof parseCaptureWorkspaceV4>>
  | NonNullable<ReturnType<typeof parseSetCaptureDeliveryInstructionsResultV1>>;
export async function requestCapture(token: string, baseUrl: string, operation: CaptureOperation, input: unknown): Promise<CaptureRequestResult<CaptureResponse>> {
  if (operation === "assignmentCandidates") return requestCaptureAssignmentCandidates(token, baseUrl, input);
  if (operation === "tray") return requestCaptureTray(token, baseUrl, input);
  if (operation === "workspace") return requestCaptureWorkspace(token, baseUrl, input);
  if (operation === "selectionPlan") return requestCaptureSelectionPlan(token, baseUrl, input);
  if (operation === "deliveryInstructionSuggestions") {
    return requestCaptureDeliveryInstructionSuggestions(token, baseUrl, input);
  }
  const command = parsers[operation](input as never);
  if (command === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths[operation]}`, { method: "POST", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const body = await response.json();
    const value = operation === "deliveryInstructions"
      ? parseSetCaptureDeliveryInstructionsResultV1(body)
      : parseCaptureMutationResultV1(body);
    if (value === undefined || value.detail.scope.restaurantId !== command.scope.restaurantId
      || value.detail.scope.branchId !== command.scope.branchId || value.detail.captureDraftId !== command.captureDraftId
      || value.detail.version !== command.expectedVersion + 1) return { ok: false, error: "unavailable" };
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}

async function requestCaptureAssignmentCandidates(
  token: string,
  baseUrl: string,
  input: unknown,
): Promise<CaptureRequestResult<CaptureResponse>> {
  const request = parseCaptureAssignmentDirectoryRequestV1(input);
  if (request === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths.assignmentCandidates}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureAssignmentDirectoryV1(await response.json());
    if (value === undefined || value.scope.restaurantId !== request.scope.restaurantId
      || value.scope.branchId !== request.scope.branchId) return { ok: false, error: "unavailable" };
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}

async function requestCaptureDeliveryInstructionSuggestions(
  token: string,
  baseUrl: string,
  input: unknown,
): Promise<CaptureRequestResult<CaptureResponse>> {
  const request = parseCaptureDeliveryInstructionSuggestionsRequestV1(input);
  if (request === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths.deliveryInstructionSuggestions}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureDeliveryInstructionSuggestionsV1(await response.json());
    if (value === undefined || value.captureDraftId !== request.captureDraftId) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}

export interface RehydratedCaptureWorkspace {
  readonly customerSnapshot: CaptureCustomerSnapshotV1 | null;
  readonly deliveryInstructions: string | null;
  readonly detail: CaptureDraftDetailV2;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1 | null;
  readonly fulfillmentSnapshot: CaptureFulfillmentSnapshotV1 | null;
  readonly repeatOrderPlan: CaptureRepeatOrderPlanSummaryV1 | null;
  readonly selectionPlan: CaptureSelectionPlanSummaryV1 | null;
  readonly selectionProjection: CaptureSelectionPlanProjectionV1 | null;
  readonly sourceChannel: CaptureSourceChannelV1;
}

/** Rehydrates only immutable snapshot facts returned for the Capture; it never accepts a live Customer record. */
export function rehydrateCaptureWorkspace(value: unknown): RehydratedCaptureWorkspace | undefined {
  const workspace = parseCaptureWorkspaceV4(value);
  return workspace === undefined ? undefined : Object.freeze({
    customerSnapshot: workspace.customerSnapshot,
    deliveryInstructions: workspace.detail.deliveryInstructions,
    detail: workspace.detail,
    fulfillmentChannel: workspace.detail.fulfillmentChannel,
    fulfillmentSnapshot: workspace.fulfillmentSnapshot,
    repeatOrderPlan: workspace.repeatOrderPlan,
    selectionPlan: workspace.selectionPlan,
    selectionProjection: workspace.selectionProjection,
    sourceChannel: workspace.detail.sourceChannel,
  });
}

async function requestCaptureTray(token: string, baseUrl: string, input: unknown): Promise<CaptureRequestResult<CaptureResponse>> {
  const command = parseCaptureWorkTrayRequestV1(input);
  if (command === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths.tray}`, { method: "POST", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureWorkTrayResultV1(await response.json());
    if (value === undefined || value.items.length > command.limit || value.items.some((item) =>
      item.scope.restaurantId !== command.scope.restaurantId || item.scope.branchId !== command.scope.branchId)) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}

/**
 * Always requests CaptureWorkspaceV4 (server-priced `selectionProjection` included) so a saved
 * catalog selection survives a reload; the API still serves V1-V3 for older clients, but this
 * client accepts only the accepted-scope/captureDraftId-matching V4 shape.
 */
async function requestCaptureWorkspace(token: string, baseUrl: string, input: unknown): Promise<CaptureRequestResult<CaptureResponse>> {
  const commandV3 = parseCaptureWorkspaceRequestV3(input);
  const command = commandV3 === undefined ? undefined
    : { schemaVersion: 4 as const, scope: commandV3.scope, captureDraftId: commandV3.captureDraftId };
  if (command === undefined || parseCaptureWorkspaceRequestV4(command) === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths.workspace}`, { method: "POST", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureWorkspaceV4(await response.json());
    if (value === undefined || value.detail.scope.restaurantId !== command.scope.restaurantId
      || value.detail.scope.branchId !== command.scope.branchId || value.detail.captureDraftId !== command.captureDraftId) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}

/**
 * Replaces the catalog-derived selection plan on a claimed draft and returns the refreshed
 * CaptureWorkspaceV4 (server-priced `selectionProjection` included); the client only ever sends
 * ids and quantities via `ReplaceCaptureSelectionPlanCommandV1`, never a price or product name.
 */
async function requestCaptureSelectionPlan(token: string, baseUrl: string, input: unknown): Promise<CaptureRequestResult<CaptureResponse>> {
  const command = parseReplaceCaptureSelectionPlanCommandV1(input);
  if (command === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths.selectionPlan}`, { method: "POST", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureWorkspaceV4(await response.json());
    // The server accepts a replay whose draft has since advanced past expectedVersion+1 through
    // an unrelated mutation (see CaptureSelectionPlanService.replace), so the client must not
    // demand an exact match here either: a genuinely successful write is never older than that.
    if (value === undefined || value.detail.scope.restaurantId !== command.scope.restaurantId
      || value.detail.scope.branchId !== command.scope.branchId || value.detail.captureDraftId !== command.captureDraftId
      || value.detail.version < command.expectedVersion + 1) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}
