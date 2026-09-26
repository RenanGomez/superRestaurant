import {
  parseAssessOrderItemChangeImpactRequestV1,
  parseOrderItemChangeImpactProjectionV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const pendingUnpaidRequest = {
  capturedAmountMinor: 0,
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
  policyDecisions: ["authorization_role", "inventory_disposition", "production_destinations"],
  production: "correction_required",
  replacementLineRequired: true,
} as const;
expect(
  parseOrderItemChangeImpactProjectionV1(sentReplacementProjection) !== undefined,
  "sent replacement exposes correction, authorization and reserved inventory",
);

const paidCancelProjection = {
  capturedAmountMinor: 15_900,
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
  policyDecisions: ["authorization_role", "financial_atomicity", "inventory_disposition", "production_destinations"],
  production: "correction_required",
  replacementLineRequired: false,
} as const;
expect(parseOrderItemChangeImpactProjectionV1(paidCancelProjection) !== undefined, "paid change is blocked pending compensation");

const deliveredReplaceProjection = {
  capturedAmountMinor: 0,
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
  policyDecisions: ["authorization_role", "inventory_disposition", "production_destinations"],
  production: "post_delivery_adjustment_required",
  replacementLineRequired: true,
} as const;
expect(parseOrderItemChangeImpactProjectionV1(deliveredReplaceProjection) !== undefined, "delivered lines require post-delivery adjustment");

for (const invalid of [
  { ...pendingUnpaidProjection, extra: true },
  { ...pendingUnpaidProjection, execution: "blocked" },
  { ...pendingUnpaidProjection, authorization: "elevated" },
  { ...pendingUnpaidProjection, blockReason: "already_cancelled" },
  { ...sentReplacementProjection, policyDecisions: ["inventory_disposition", "authorization_role", "production_destinations"] },
  { ...sentReplacementProjection, replacementLineRequired: false },
  { ...paidCancelProjection, execution: "eligible", blockReason: null },
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
