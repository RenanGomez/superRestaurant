import {
  parseAutosaveCaptureDraftCommandV1,
  parseCaptureMutationResultV1,
  parseCaptureWorkspaceRequestV1,
  parseCaptureWorkspaceV1,
  parseCaptureWorkTrayRequestV1,
  parseCaptureWorkTrayResultV1,
  parseClaimCaptureDraftCommandV1,
  parseCreateCaptureDraftCommandV1,
  parseSetCaptureCustomerCommandV1,
  parseSetCaptureFulfillmentCommandV1,
  type CaptureCustomerSnapshotV1,
  type CaptureDraftDetailV1,
  type AutosaveCaptureDraftCommandV1,
  type BranchScope,
  type CaptureFulfillmentChannelV1,
  type CaptureFulfillmentSnapshotV1,
  type CaptureSourceChannelV1,
} from "@super-restaurant/shared-types";
export type CaptureRequestResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "conflict" | "missing" | "unavailable" };
export type CaptureOperation = "autosave" | "create" | "claim" | "customer" | "fulfillment" | "tray" | "workspace";
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
const paths = { autosave: "/autosave", create: "", claim: "/claim", customer: "/customer", fulfillment: "/fulfillment",
  tray: "/tray", workspace: "/workspace" } as const;
const parsers = {
  autosave: parseAutosaveCaptureDraftCommandV1,
  create: parseCreateCaptureDraftCommandV1,
  claim: parseClaimCaptureDraftCommandV1,
  customer: parseSetCaptureCustomerCommandV1,
  fulfillment: parseSetCaptureFulfillmentCommandV1,
} as const;
type CaptureResponse = NonNullable<ReturnType<typeof parseCaptureMutationResultV1>>
  | NonNullable<ReturnType<typeof parseCaptureWorkTrayResultV1>>
  | NonNullable<ReturnType<typeof parseCaptureWorkspaceV1>>;
export async function requestCapture(token: string, baseUrl: string, operation: CaptureOperation, input: unknown): Promise<CaptureRequestResult<CaptureResponse>> {
  if (operation === "tray") return requestCaptureTray(token, baseUrl, input);
  if (operation === "workspace") return requestCaptureWorkspace(token, baseUrl, input);
  const command = parsers[operation](input as never);
  if (command === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths[operation]}`, { method: "POST", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureMutationResultV1(await response.json());
    if (value === undefined || value.detail.scope.restaurantId !== command.scope.restaurantId
      || value.detail.scope.branchId !== command.scope.branchId || value.detail.captureDraftId !== command.captureDraftId
      || value.detail.version !== command.expectedVersion + 1) return { ok: false, error: "unavailable" };
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}

export interface RehydratedCaptureWorkspace {
  readonly customerSnapshot: CaptureCustomerSnapshotV1 | null;
  readonly detail: CaptureDraftDetailV1;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1 | null;
  readonly fulfillmentSnapshot: CaptureFulfillmentSnapshotV1 | null;
  readonly sourceChannel: CaptureSourceChannelV1;
}

/** Rehydrates only immutable snapshot facts returned for the Capture; it never accepts a live Customer record. */
export function rehydrateCaptureWorkspace(value: unknown): RehydratedCaptureWorkspace | undefined {
  const workspace = parseCaptureWorkspaceV1(value);
  return workspace === undefined ? undefined : Object.freeze({
    customerSnapshot: workspace.customerSnapshot,
    detail: workspace.detail,
    fulfillmentChannel: workspace.detail.fulfillmentChannel,
    fulfillmentSnapshot: workspace.fulfillmentSnapshot,
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

async function requestCaptureWorkspace(token: string, baseUrl: string, input: unknown): Promise<CaptureRequestResult<CaptureResponse>> {
  const command = parseCaptureWorkspaceRequestV1(input);
  if (command === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths.workspace}`, { method: "POST", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureWorkspaceV1(await response.json());
    if (value === undefined || value.detail.scope.restaurantId !== command.scope.restaurantId
      || value.detail.scope.branchId !== command.scope.branchId || value.detail.captureDraftId !== command.captureDraftId) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}
