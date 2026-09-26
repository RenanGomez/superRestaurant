import {
  parseAssessOrderItemChangeImpactRequestV1,
  parseOrderItemChangeImpactProjectionV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const pendingUnpaidRequest = {
  capturedAmountMinor: 0,
  financialCompensationPending: false,
  inventoryCommitment: "none",
  itemStatus: "pending",
  operation: "cancel",
  orderStatus: "open",
  schemaVersion: 1,
} as const;

const parsedPendingRequest = parseAssessOrderItemChangeImpactRequestV1(pendingUnpaidRequest);
expect(parsedPendingRequest !== undefined && Object.isFrozen(parsedPendingRequest), "valid request parses frozen");

for (const invalid of [
  { ...pendingUnpaidRequest, extra: true },
  { ...pendingUnpaidRequest, operation: "invalid" },
  { ...pendingUnpaidRequest, itemStatus: "future" },
  { ...pendingUnpaidRequest, capturedAmountMinor: -1 },
  { ...pendingUnpaidRequest, capturedAmountMinor: 1.5 },
  { ...pendingUnpaidRequest, financialCompensationPending: "false" },
  { ...pendingUnpaidRequest, inventoryCommitment: "maybe" },
  { ...pendingUnpaidRequest, orderStatus: "future" },
  { ...pendingUnpaidRequest, schemaVersion: 2 },
]) expect(parseAssessOrderItemChangeImpactRequestV1(invalid) === undefined, `request rejects invalid facts: ${JSON.stringify(invalid)}`);

const accessor = Object.defineProperty({ ...pendingUnpaidRequest }, "operation", { get: () => "cancel", enumerable: true });
expect(parseAssessOrderItemChangeImpactRequestV1(accessor) === undefined, "accessor is not invoked");
expect(parseAssessOrderItemChangeImpactRequestV1(Object.assign(Object.create({}), pendingUnpaidRequest)) === undefined, "prototype rejected");
expect(
  parseAssessOrderItemChangeImpactRequestV1(new Proxy(pendingUnpaidRequest, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "hostile proxy fails closed",
);

const pendingUnpaidProjection = {
  ...pendingUnpaidRequest,
  authorization: "standard",
  blockReason: null,
  execution: "eligible",
  financial: "none",
  inventory: "none",
  policyDecisions: [],
  production: "none",
  productionDestination: null,
  refundObligation: "none",
  reprintAvailable: false,
  replacementLineRequired: false,
} as const;
const parsedPendingProjection = parseOrderItemChangeImpactProjectionV1(pendingUnpaidProjection);
expect(parsedPendingProjection !== undefined, "pending unpaid change parses as eligible");
expect(parsedPendingProjection !== undefined && Object.isFrozen(parsedPendingProjection), "projection is frozen");
expect(
  parsedPendingProjection !== undefined && Object.isFrozen(parsedPendingProjection.policyDecisions),
  "policyDecisions is frozen",
);

const sentReplacementProjection = {
  capturedAmountMinor: 0,
  financialCompensationPending: false,
  inventoryCommitment: "reserved",
  itemStatus: "sent",
  operation: "replace",
  orderStatus: "open",
  schemaVersion: 1,
  authorization: "elevated",
  blockReason: null,
  execution: "eligible",
  financial: "none",
  inventory: "release_required",
  policyDecisions: ["authorization_role", "inventory_disposition"],
  production: "correction_required",
  productionDestination: "kds_primary",
  refundObligation: "none",
  reprintAvailable: true,
  replacementLineRequired: true,
} as const;
expect(
  parseOrderItemChangeImpactProjectionV1(sentReplacementProjection) !== undefined,
  "sent replacement exposes correction, authorization and reserved inventory",
);

// Approved decision 6: captured/settled money never blocks by itself; it only
// creates a refund obligation. A partially paid cancellation with captured
// money on the line stays eligible.
const partiallyPaidCancelProjection = {
  capturedAmountMinor: 15_900,
  financialCompensationPending: false,
  inventoryCommitment: "consumed",
  itemStatus: "preparing",
  operation: "cancel",
  orderStatus: "partially_paid",
  schemaVersion: 1,
  authorization: "elevated",
  blockReason: null,
  execution: "eligible",
  financial: "none",
  inventory: "compensation_required",
  policyDecisions: ["authorization_role", "inventory_disposition"],
  production: "correction_required",
  productionDestination: "kds_primary",
  refundObligation: "pending",
  reprintAvailable: true,
  replacementLineRequired: false,
} as const;
expect(
  parseOrderItemChangeImpactProjectionV1(partiallyPaidCancelProjection) !== undefined,
  "partially paid cancellation with captured money is eligible with a pending refund obligation",
);

// An already-pending compensation (a distinct input fact) is the only thing
// that blocks — never captured money by itself.
const pendingCompensationBlockedProjection = {
  capturedAmountMinor: 15_900,
  financialCompensationPending: true,
  inventoryCommitment: "consumed",
  itemStatus: "preparing",
  operation: "cancel",
  orderStatus: "partially_paid",
  schemaVersion: 1,
  authorization: "elevated",
  blockReason: "financial_compensation_required",
  execution: "blocked",
  financial: "compensation_required",
  inventory: "compensation_required",
  policyDecisions: ["authorization_role", "financial_atomicity", "inventory_disposition"],
  production: "correction_required",
  productionDestination: "kds_primary",
  refundObligation: "pending",
  reprintAvailable: true,
  replacementLineRequired: false,
} as const;
expect(
  parseOrderItemChangeImpactProjectionV1(pendingCompensationBlockedProjection) !== undefined,
  "an already-pending compensation blocks the change",
);

const deliveredReplaceProjection = {
  capturedAmountMinor: 0,
  financialCompensationPending: false,
  inventoryCommitment: "unknown",
  itemStatus: "delivered",
  operation: "replace",
  orderStatus: "open",
  schemaVersion: 1,
  authorization: "elevated",
  blockReason: "post_delivery_adjustment_required",
  execution: "blocked",
  financial: "none",
  inventory: "review_required",
  policyDecisions: ["authorization_role", "inventory_disposition"],
  production: "post_delivery_adjustment_required",
  productionDestination: "kds_primary",
  refundObligation: "none",
  reprintAvailable: true,
  replacementLineRequired: true,
} as const;
expect(parseOrderItemChangeImpactProjectionV1(deliveredReplaceProjection) !== undefined, "delivered lines require post-delivery adjustment");

for (const invalid of [
  { ...pendingUnpaidProjection, extra: true },
  { ...pendingUnpaidProjection, execution: "blocked" },
  { ...pendingUnpaidProjection, authorization: "elevated" },
  { ...pendingUnpaidProjection, blockReason: "already_cancelled" },
  { ...pendingUnpaidProjection, productionDestination: "kds_primary" },
  { ...pendingUnpaidProjection, reprintAvailable: true },
  { ...sentReplacementProjection, policyDecisions: ["inventory_disposition", "authorization_role"] },
  { ...sentReplacementProjection, policyDecisions: ["authorization_role", "inventory_disposition", "production_destinations"] },
  { ...sentReplacementProjection, replacementLineRequired: false },
  { ...sentReplacementProjection, productionDestination: null },
  { ...sentReplacementProjection, reprintAvailable: false },
  { ...partiallyPaidCancelProjection, execution: "blocked", blockReason: "financial_compensation_required" },
  { ...partiallyPaidCancelProjection, refundObligation: "none" },
  { ...pendingCompensationBlockedProjection, execution: "eligible", blockReason: null },
]) expect(parseOrderItemChangeImpactProjectionV1(invalid) === undefined, `projection rejects inconsistent facts: ${JSON.stringify(invalid)}`);

const projectionAccessor = Object.defineProperty({ ...pendingUnpaidProjection }, "execution", { get: () => "eligible", enumerable: true });
expect(parseOrderItemChangeImpactProjectionV1(projectionAccessor) === undefined, "projection accessor is not invoked");
expect(
  parseOrderItemChangeImpactProjectionV1(Object.assign(Object.create({}), pendingUnpaidProjection)) === undefined,
  "projection prototype rejected",
);
expect(
  parseOrderItemChangeImpactProjectionV1(new Proxy(pendingUnpaidProjection, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "projection hostile proxy fails closed",
);

// Idempotency: parsing the same valid input twice yields bit-exact frozen output.
const firstParse = parseOrderItemChangeImpactProjectionV1(sentReplacementProjection);
const secondParse = parseOrderItemChangeImpactProjectionV1(sentReplacementProjection);
expect(
  firstParse !== undefined && secondParse !== undefined && JSON.stringify(firstParse) === JSON.stringify(secondParse),
  "repeated parsing of the same valid input is idempotent",
);
