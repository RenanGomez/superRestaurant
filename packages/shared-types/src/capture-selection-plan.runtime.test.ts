import {
  parseCaptureSelectionPlanV1,
  parseReplaceCaptureSelectionPlanCommandV1,
  parseCaptureSelectionPlanProjectionV1,
  parseCaptureSelectionPlanSummaryV1,
  parseCaptureWorkspaceV4,
} from "./index.js";

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const scope = {
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
};
const catalogVersion = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const lineId = "a72573ec-6224-4857-bc4a-f3d1d07b6d83";
const productId = "9544c299-d25b-44ce-98ed-d30116610887";
const groupId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const optionId = "c483b6e7-e102-4cc5-a887-d30712c85e52";

const minimalPlan = {
  schemaVersion: 1,
  catalogVersion,
  lines: [],
};

const fullLine = {
  lineId,
  productId,
  variantId: null,
  quantity: 3,
  modifierGroups: [
    { groupId, selections: [{ optionId, quantity: 2 }] },
  ],
  note: "sin cebolla",
};

const maximalPlan = {
  schemaVersion: 1,
  catalogVersion,
  lines: [fullLine],
};

expect(parseCaptureSelectionPlanV1(minimalPlan) !== undefined, "minimal (empty) plan parses");
expect(Object.isFrozen(parseCaptureSelectionPlanV1(minimalPlan)), "minimal plan is frozen");
const parsedMax = parseCaptureSelectionPlanV1(maximalPlan);
const parsedMaxLine = parsedMax?.lines[0];
expect(parsedMax !== undefined && Object.isFrozen(parsedMax.lines) && parsedMaxLine !== undefined
  && Object.isFrozen(parsedMaxLine) && Object.isFrozen(parsedMaxLine.modifierGroups[0]), "maximal plan parses frozen deeply");

expect(parseCaptureSelectionPlanV1({ ...minimalPlan, extra: "nope" }) === undefined, "rejects extra key");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [fullLine, { ...fullLine }],
}) === undefined, "rejects duplicate lineId");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{
    ...fullLine,
    modifierGroups: [
      { groupId, selections: [{ optionId, quantity: 1 }] },
      { groupId, selections: [] },
    ],
  }],
}) === undefined, "rejects duplicate groupId");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{
    ...fullLine,
    modifierGroups: [{
      groupId,
      selections: [{ optionId, quantity: 1 }, { optionId, quantity: 2 }],
    }],
  }],
}) === undefined, "rejects duplicate optionId");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{ ...fullLine, quantity: 0 }],
}) === undefined, "rejects quantity zero");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{ ...fullLine, quantity: 1.5 }],
}) === undefined, "rejects non-integer quantity");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{ ...fullLine, note: "" }],
}) === undefined, "rejects empty note");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{ ...fullLine, note: "bad\u0000char" }],
}) === undefined, "rejects note with control characters");
expect(parseCaptureSelectionPlanV1({ ...minimalPlan, catalogVersion: "not-a-uuid" }) === undefined,
  "rejects non-uuid catalogVersion");
expect(parseCaptureSelectionPlanV1({ ...minimalPlan, schemaVersion: 2 }) === undefined,
  "rejects unknown schemaVersion");

const hostile = Object.create({ schemaVersion: 1 });
hostile.catalogVersion = catalogVersion;
hostile.lines = [];
expect(parseCaptureSelectionPlanV1(hostile) === undefined, "rejects non-plain prototype");

const common = {
  schemaVersion: 1,
  scope,
  captureDraftId: catalogVersion,
  expectedVersion: 3,
  eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  idempotencyKey: "9544c299-d25b-44ce-98ed-d30116610887",
  deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
  occurredAt: "2026-09-15T18:00:00.000Z",
};
const command = {
  ...common,
  attentionLeaseId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
  plan: minimalPlan,
};
const parsedCommand = parseReplaceCaptureSelectionPlanCommandV1(command);
expect(parsedCommand !== undefined && Object.isFrozen(parsedCommand), "command parses frozen");
expect(parseReplaceCaptureSelectionPlanCommandV1({ ...command, plan: { ...minimalPlan, schemaVersion: 2 } }) === undefined,
  "command rejects invalid nested plan");
expect(parseReplaceCaptureSelectionPlanCommandV1({ ...command, price: 100 }) === undefined,
  "command rejects extra key (no client-supplied prices)");
expect(parseReplaceCaptureSelectionPlanCommandV1({ ...command, expectedVersion: 0 }) === undefined,
  "command requires positive expectedVersion");

const projection = {
  schemaVersion: 1,
  catalogVersion,
  currency: "MXN",
  subtotalMinor: 200,
  lineCount: 1,
  lines: [{
    lineId,
    productId,
    variantId: null,
    productName: "Tacos",
    quantity: 2,
    unitPriceMinor: 100,
    lineTotalMinor: 200,
    note: null,
    modifiers: [{ groupId, optionId, name: "Extra queso", quantity: 1, unitPriceMinor: 10 }],
  }],
};
expect(parseCaptureSelectionPlanProjectionV1(projection) !== undefined, "projection parses");
expect(parseCaptureSelectionPlanProjectionV1({ ...projection, subtotalMinor: -1 }) === undefined,
  "projection rejects negative subtotal");
expect(parseCaptureSelectionPlanProjectionV1({ ...projection, subtotalMinor: 1.5 }) === undefined,
  "projection rejects float subtotal");
expect(parseCaptureSelectionPlanProjectionV1({ ...projection, lineCount: 2 }) === undefined,
  "projection rejects mismatched lineCount");
expect(parseCaptureSelectionPlanProjectionV1({ ...projection, currency: "mxn" }) === undefined,
  "projection requires uppercase ISO currency");

// variantId: required key, nullable uuid value.
const withoutKey = <T extends Record<string, unknown>>(record: T, key: keyof T): Record<string, unknown> => {
  const clone: Record<string, unknown> = { ...record };
  delete clone[key as string];
  return clone;
};
const variantId = "d1f1b6f6-9b0a-4a1a-8b1a-6a3c1a2b3c4d";
const fullLineWithoutVariantId = withoutKey(fullLine, "variantId");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [fullLineWithoutVariantId],
}) === undefined, "rejects line missing variantId key");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{ ...fullLine, variantId: null }],
})?.lines[0]?.variantId === null, "accepts variantId: null");
const parsedWithVariant = parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{ ...fullLine, variantId }],
});
expect(parsedWithVariant?.lines[0]?.variantId === variantId, "accepts and preserves uuid variantId");
expect(parseCaptureSelectionPlanV1({
  ...maximalPlan,
  lines: [{ ...fullLine, variantId: "not-a-uuid" }],
}) === undefined, "rejects non-uuid variantId");
expect(parseCaptureSelectionPlanProjectionV1({
  ...projection,
  lines: [{ ...projection.lines[0], variantId }],
})?.lines[0]?.variantId === variantId, "projection accepts and preserves uuid variantId");
const projectionLineWithoutVariantId = withoutKey({ ...projection.lines[0], variantId }, "variantId");
expect(parseCaptureSelectionPlanProjectionV1({
  ...projection,
  lines: [projectionLineWithoutVariantId],
}) === undefined, "projection rejects line missing variantId key");

// Workspace V4: widens V3 with a nullable selection-plan summary and a
// nullable, server-computed projection; exactly one of repeat/selection is
// non-null, and the projection (when present) must agree with the summary.
const detailV2 = {
  schemaVersion: 2,
  scope,
  captureDraftId: catalogVersion,
  folio: "CAP-000042",
  sourceChannel: "phone",
  fulfillmentChannel: "counter",
  status: "draft",
  attentionStatus: "claimed",
  ownerMembershipId: groupId,
  version: 2,
  updatedAt: "2026-09-15T18:00:00.000Z",
  attentionLeaseId: optionId,
  attentionLeaseExpiresAt: "2026-09-15T18:31:00.000Z",
  customerSnapshotRef: null,
  fulfillmentSnapshotRef: null,
  confirmedOrderId: null,
  deliveryInstructions: null,
};
const workspaceV4Base = {
  schemaVersion: 4,
  detail: detailV2,
  customerSnapshot: null,
  fulfillmentSnapshot: null,
  repeatOrderPlan: null,
  selectionPlan: { schemaVersion: 1, catalogVersion, appliedCaptureVersion: 2, lineCount: 1 },
  selectionProjection: null,
};
const parsedWorkspaceV4 = parseCaptureWorkspaceV4(workspaceV4Base);
expect(parsedWorkspaceV4 !== undefined && parsedWorkspaceV4.selectionPlan?.lineCount === 1,
  "workspace V4 rehydrates a bounded selection plan summary");
expect(parseCaptureWorkspaceV4({ ...workspaceV4Base, selectionProjection: projection }) !== undefined,
  "workspace V4 accepts a projection matching the stored summary");
expect(parseCaptureWorkspaceV4({
  ...workspaceV4Base,
  selectionProjection: { ...projection, lineCount: 5 },
}) === undefined, "workspace V4 rejects a projection mismatched with the summary");
expect(parseCaptureWorkspaceV4({
  ...workspaceV4Base,
  repeatOrderPlan: { schemaVersion: 1, customerId: catalogVersion, sourceOrderId: catalogVersion,
    catalogVersion, appliedCaptureVersion: 2, lineCount: 1 },
}) === undefined, "workspace V4 never carries both repeat and selection plans");
expect(parseCaptureSelectionPlanSummaryV1({
  schemaVersion: 1, catalogVersion, appliedCaptureVersion: 2, lineCount: 1,
}) !== undefined, "selection plan summary parses");
expect(parseCaptureSelectionPlanSummaryV1({
  schemaVersion: 1, catalogVersion, appliedCaptureVersion: 1, lineCount: 1,
}) === undefined, "selection plan summary requires an applied version past creation");

// Arrays: exact own-index elements only, no reliance on iterator protocol.
const arrayWithHole = [fullLine];
arrayWithHole.length = 2;
expect(parseCaptureSelectionPlanV1({ ...maximalPlan, lines: arrayWithHole }) === undefined,
  "rejects array with a hole");

const arrayWithThrowingGetter: unknown[] = [fullLine];
Object.defineProperty(arrayWithThrowingGetter, "1", {
  configurable: true,
  enumerable: true,
  get(): unknown {
    throw new Error("boom");
  },
});
(arrayWithThrowingGetter as { length: number }).length = 2;
expect(parseCaptureSelectionPlanV1({ ...maximalPlan, lines: arrayWithThrowingGetter }) === undefined,
  "array with a throwing getter returns undefined instead of propagating");

// A custom iterator (e.g. via a subclass with a shorter Symbol.iterator) can never
// influence parsing: parsing walks own numeric indices directly, never the iterator
// protocol. A subclass instance is also rejected outright because its prototype is
// not exactly `Array.prototype`.
class ShortIterableArray extends Array<unknown> {
  override [Symbol.iterator](): IterableIterator<unknown> {
    return [fullLine].values();
  }
}
const customIteratorArray = new ShortIterableArray(fullLine, { ...fullLine, lineId: catalogVersion });
expect(customIteratorArray.length === 2, "custom iterator fixture keeps its two own elements");
expect(parseCaptureSelectionPlanV1({ ...maximalPlan, lines: customIteratorArray }) === undefined,
  "rejects array subclass instance regardless of its custom iterator");
