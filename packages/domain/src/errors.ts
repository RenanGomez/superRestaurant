/** Base class for business-rule violations that callers may handle by code. */
export abstract class DomainError extends Error {
  public abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMoneyAmountError extends DomainError {
  public readonly code = "INVALID_MONEY_AMOUNT";

  public constructor(amountMinor: number) {
    super("Money amountMinor must be a safe integer.");
    this.amountMinor = amountMinor;
  }

  public readonly amountMinor: number;
}

export class InvalidCurrencyError extends DomainError {
  public readonly code = "INVALID_CURRENCY";

  public constructor(currency: string) {
    super("Currency must use the three uppercase-letter ISO-4217 code format.");
    this.currency = currency;
  }

  public readonly currency: string;
}

export class CurrencyMismatchError extends DomainError {
  public readonly code = "CURRENCY_MISMATCH";

  public constructor(leftCurrency: string, rightCurrency: string) {
    super("Money operations require matching currencies.");
    this.leftCurrency = leftCurrency;
    this.rightCurrency = rightCurrency;
  }

  public readonly leftCurrency: string;
  public readonly rightCurrency: string;
}

export class MoneyOverflowError extends DomainError {
  public readonly code = "MONEY_OVERFLOW";

  public constructor() {
    super("Money operation exceeds the JavaScript safe-integer range.");
  }
}

export class InvalidRatioError extends DomainError {
  public readonly code = "INVALID_RATIO";

  public constructor() {
    super("Money ratios require a positive integer denominator.");
  }
}

export class InvalidMoneyRoundingModeError extends DomainError {
  public readonly code = "INVALID_MONEY_ROUNDING_MODE";

  public constructor(roundingMode: unknown) {
    super("Money ratios require a supported rounding mode.");
    this.roundingMode = roundingMode;
  }

  public readonly roundingMode: unknown;
}

export class InvalidQuantityError extends DomainError {
  public readonly code = "INVALID_QUANTITY";

  public constructor(quantity: number) {
    super("Quantity must be a positive safe integer.");
    this.quantity = quantity;
  }

  public readonly quantity: number;
}

export class InvalidTaxRateError extends DomainError {
  public readonly code = "INVALID_TAX_RATE";

  public constructor() {
    super("Tax rates require bigint numerator and denominator values, with a non-negative numerator and positive denominator.");
  }
}

export class NegativeMoneyAmountError extends DomainError {
  public readonly code = "NEGATIVE_MONEY_AMOUNT";

  public constructor(field: string) {
    super(`${field} cannot be negative.`);
    this.field = field;
  }

  public readonly field: string;
}

export class DiscountExceedsAmountError extends DomainError {
  public readonly code = "DISCOUNT_EXCEEDS_AMOUNT";

  public constructor(scope: "line" | "order") {
    super(`${scope} discount cannot exceed the amount it discounts.`);
    this.scope = scope;
  }

  public readonly scope: "line" | "order";
}

export class DuplicateOrderItemIdError extends DomainError {
  public readonly code = "DUPLICATE_ORDER_ITEM_ID";

  public constructor(orderItemId: string) {
    super("Order item ids must be unique when allocating an order discount.");
    this.orderItemId = orderItemId;
  }

  public readonly orderItemId: string;
}

export class OrderItemNotFoundError extends DomainError {
  public readonly code = "ORDER_ITEM_NOT_FOUND";

  public constructor(orderItemId: string) {
    super("The order does not contain the requested item.");
    this.orderItemId = orderItemId;
  }

  public readonly orderItemId: string;
}

export class OrderItemCancellationScopeMismatchError extends DomainError {
  public readonly code = "ORDER_ITEM_CANCELLATION_SCOPE_MISMATCH";

  public constructor() {
    super("Order item cancellation audit evidence must belong to the order branch.");
  }
}

export class OrderCancellationRequiresItemCancellationError extends DomainError {
  public readonly code = "ORDER_CANCELLATION_REQUIRES_ITEM_CANCELLATION";

  public constructor(orderItemId: string, status: string) {
    super("An order cannot be cancelled while a sent, preparing, ready, or delivered item remains active.");
    this.orderItemId = orderItemId;
    this.status = status;
  }

  public readonly orderItemId: string;
  public readonly status: string;
}

export class OrderClosureRequiresItemCompletionError extends DomainError {
  public readonly code = "ORDER_CLOSURE_REQUIRES_ITEM_COMPLETION";

  public constructor(orderItemId: string, status: string) {
    super("An order cannot be closed while an item is still pending, sent, preparing, or ready.");
    this.orderItemId = orderItemId;
    this.status = status;
  }

  public readonly orderItemId: string;
  public readonly status: string;
}

export class OrderItemMutationNotAllowedError extends DomainError {
  public readonly code = "ORDER_ITEM_MUTATION_NOT_ALLOWED";

  public constructor(orderState: string) {
    super(`Order items cannot be mutated while their order is ${orderState}.`);
    this.orderState = orderState;
  }

  public readonly orderState: string;
}

export class InvalidOrderAggregateError extends DomainError {
  public readonly code = "INVALID_ORDER_AGGREGATE";

  public constructor(field: string) {
    super(`Order aggregate is invalid at ${field}.`);
    this.field = field;
  }

  public readonly field: string;
}

export class OrderAggregateNotImmutableError extends DomainError {
  public readonly code = "ORDER_AGGREGATE_NOT_IMMUTABLE";

  public constructor() {
    super("Order aggregate and all retained historical facts must be frozen.");
  }
}

export class InvalidOrderChannelError extends DomainError {
  public readonly code = "INVALID_ORDER_CHANNEL";

  public constructor(channel: unknown) {
    super("Order channel must be table, counter, takeout, or delivery.");
    this.channel = channel;
  }

  public readonly channel: unknown;
}

export class InvalidOrderTableAssignmentError extends DomainError {
  public readonly code = "INVALID_ORDER_TABLE_ASSIGNMENT";

  public constructor(channel: string) {
    super("Only table orders may declare a non-empty tableId, and every table order requires one.");
    this.channel = channel;
  }

  public readonly channel: string;
}

export class OrderItemScopeMismatchError extends DomainError {
  public readonly code = "ORDER_ITEM_SCOPE_MISMATCH";

  public constructor() {
    super("Every order item must match its order restaurant and branch scope.");
  }
}

export class InvalidSnapshotError extends DomainError {
  public readonly code = "INVALID_SNAPSHOT";

  public constructor(field: string) {
    super(`${field} must be a non-empty snapshot value.`);
    this.field = field;
  }

  public readonly field: string;
}

export class InvalidTimeZoneError extends DomainError {
  public readonly code = "INVALID_TIME_ZONE";

  public constructor(timeZone: string) {
    super("Time zone must be a valid IANA time zone identifier.");
    this.timeZone = timeZone;
  }

  public readonly timeZone: string;
}

export class InvalidOrderDiscountAllocationStrategyError extends DomainError {
  public readonly code = "INVALID_ORDER_DISCOUNT_ALLOCATION_STRATEGY";

  public constructor(strategy: string) {
    super("Order discounts require a supported, versioned allocation strategy.");
    this.strategy = strategy;
  }

  public readonly strategy: string;
}

export class InvalidOrderTransitionError extends DomainError {
  public readonly code = "INVALID_ORDER_TRANSITION";

  public constructor(from: string, to: string) {
    super(`Order cannot transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }

  public readonly from: string;
  public readonly to: string;
}

export class InvalidOrderStateError extends DomainError {
  public readonly code = "INVALID_ORDER_STATE";

  public constructor(state: unknown) {
    super("Order state must be one of the declared lifecycle states.");
    this.state = state;
  }

  public readonly state: unknown;
}

export class OrderDoesNotAcceptNewLinesError extends DomainError {
  public readonly code = "ORDER_DOES_NOT_ACCEPT_NEW_LINES";

  public constructor(orderState: string) {
    super(`Orders in ${orderState} state do not accept new lines.`);
    this.orderState = orderState;
  }

  public readonly orderState: string;
}

export class InvalidOrderItemTransitionError extends DomainError {
  public readonly code = "INVALID_ORDER_ITEM_TRANSITION";

  public constructor(from: string, to: string) {
    super(`Order item cannot transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }

  public readonly from: string;
  public readonly to: string;
}

export class OrderItemCancellationReasonRequiredError extends DomainError {
  public readonly code = "ORDER_ITEM_CANCELLATION_REASON_REQUIRED";

  public constructor() {
    super("Cancelling an item after it has been sent requires a non-empty reason.");
  }
}

export class OrderItemCancellationAuthorizationRequiredError extends DomainError {
  public readonly code = "ORDER_ITEM_CANCELLATION_AUTHORIZATION_REQUIRED";

  public constructor() {
    super("Cancelling an item after it has been sent requires explicit authorization.");
  }
}

export class OrderItemCancellationAuditContextRequiredError extends DomainError {
  public readonly code = "ORDER_ITEM_CANCELLATION_AUDIT_CONTEXT_REQUIRED";

  public constructor() {
    super(
      "Cancelling an item after it has been sent requires actor, branch, device, and timestamp audit context.",
    );
  }
}

export class InvalidOrderAuditContextError extends DomainError {
  public readonly code = "INVALID_ORDER_AUDIT_CONTEXT";

  public constructor(field: string) {
    super(`Order audit ${field} must be a valid immutable event value.`);
    this.field = field;
  }

  public readonly field: string;
}

export class OrderAuditReasonRequiredError extends DomainError {
  public readonly code = "ORDER_AUDIT_REASON_REQUIRED";

  public constructor(operation: string) {
    super(`Order audit operation ${operation} requires a non-empty reason.`);
    this.operation = operation;
  }

  public readonly operation: string;
}

export class OrderAuditAuthorizationRequiredError extends DomainError {
  public readonly code = "ORDER_AUDIT_AUTHORIZATION_REQUIRED";

  public constructor(operation: string) {
    super(`Order audit operation ${operation} requires an explicit verified authorization.`);
    this.operation = operation;
  }

  public readonly operation: string;
}

export type MenuEntityKind = "category" | "product" | "modifier group";

export class DuplicateMenuEntityIdError extends DomainError {
  public readonly code = "DUPLICATE_MENU_ENTITY_ID";

  public constructor(entity: MenuEntityKind, entityId: string) {
    super(`Menu ${entity} ids must be unique within a catalog.`);
    this.entity = entity;
    this.entityId = entityId;
  }

  public readonly entity: MenuEntityKind;
  public readonly entityId: string;
}

export class DuplicateMenuProductSkuError extends DomainError {
  public readonly code = "DUPLICATE_MENU_PRODUCT_SKU";

  public constructor(sku: string) {
    super("Menu product SKUs must be unique within a restaurant catalog when provided.");
    this.sku = sku;
  }

  public readonly sku: string;
}

export class MenuCatalogRestaurantMismatchError extends DomainError {
  public readonly code = "MENU_CATALOG_RESTAURANT_MISMATCH";

  public constructor(entity: MenuEntityKind, entityId: string) {
    super(`Menu ${entity} must belong to the catalog restaurant.`);
    this.entity = entity;
    this.entityId = entityId;
  }

  public readonly entity: MenuEntityKind;
  public readonly entityId: string;
}

export class MenuCatalogVersionMismatchError extends DomainError {
  public readonly code = "MENU_CATALOG_VERSION_MISMATCH";

  public constructor(entity: MenuEntityKind, entityId: string) {
    super(`Menu ${entity} must belong to the catalog version.`);
    this.entity = entity;
    this.entityId = entityId;
  }

  public readonly entity: MenuEntityKind;
  public readonly entityId: string;
}

export class MenuProductCategoryNotFoundError extends DomainError {
  public readonly code = "MENU_PRODUCT_CATEGORY_NOT_FOUND";

  public constructor(productId: string, categoryId: string) {
    super("A menu product must reference a category in the same catalog.");
    this.productId = productId;
    this.categoryId = categoryId;
  }

  public readonly productId: string;
  public readonly categoryId: string;
}

export class MenuProductModifierGroupNotFoundError extends DomainError {
  public readonly code = "MENU_PRODUCT_MODIFIER_GROUP_NOT_FOUND";

  public constructor(productId: string, groupId: string) {
    super("A product modifier-group reference must resolve in the same catalog.");
    this.productId = productId;
    this.groupId = groupId;
  }

  public readonly productId: string;
  public readonly groupId: string;
}

export class MenuModifierGroupNotAllowedError extends DomainError {
  public readonly code = "MENU_MODIFIER_GROUP_NOT_ALLOWED";

  public constructor(productId: string, groupId: string) {
    super("The modifier group is not allowlisted for this menu product.");
    this.productId = productId;
    this.groupId = groupId;
  }

  public readonly productId: string;
  public readonly groupId: string;
}

export class DuplicateMenuModifierGroupSelectionError extends DomainError {
  public readonly code = "DUPLICATE_MENU_MODIFIER_GROUP_SELECTION";

  public constructor(groupId: string) {
    super("A modifier group can be selected only once for one menu product snapshot.");
    this.groupId = groupId;
  }

  public readonly groupId: string;
}

export class MenuProductNotFoundError extends DomainError {
  public readonly code = "MENU_PRODUCT_NOT_FOUND";

  public constructor(productId: string) {
    super("The selected product does not exist in this menu catalog.");
    this.productId = productId;
  }

  public readonly productId: string;
}

export class InactiveMenuCategoryError extends DomainError {
  public readonly code = "INACTIVE_MENU_CATEGORY";

  public constructor(categoryId: string) {
    super("A product in an inactive menu category cannot be sold.");
    this.categoryId = categoryId;
  }

  public readonly categoryId: string;
}

export class InactiveMenuProductError extends DomainError {
  public readonly code = "INACTIVE_MENU_PRODUCT";

  public constructor(productId: string) {
    super("An inactive menu product cannot produce an order-item snapshot.");
    this.productId = productId;
  }

  public readonly productId: string;
}

export class InvalidModifierGroupBoundsError extends DomainError {
  public readonly code = "INVALID_MODIFIER_GROUP_BOUNDS";

  public constructor(groupId: string, minimum: number, maximum: number) {
    super("Modifier group minimum and maximum quantities must be safe non-negative integers with minimum not greater than maximum.");
    this.groupId = groupId;
    this.minimum = minimum;
    this.maximum = maximum;
  }

  public readonly groupId: string;
  public readonly minimum: number;
  public readonly maximum: number;
}

export class InvalidModifierOptionMaximumError extends DomainError {
  public readonly code = "INVALID_MODIFIER_OPTION_MAXIMUM";

  public constructor(optionId: string, maximum: number) {
    super("Modifier option maximum quantity must be a safe positive integer when provided.");
    this.optionId = optionId;
    this.maximum = maximum;
  }

  public readonly optionId: string;
  public readonly maximum: number;
}

export class ModifierGroupOptionsRequiredError extends DomainError {
  public readonly code = "MODIFIER_GROUP_OPTIONS_REQUIRED";

  public constructor(groupId: string) {
    super("A modifier group must contain at least one catalog option.");
    this.groupId = groupId;
  }

  public readonly groupId: string;
}

export class DuplicateModifierOptionIdError extends DomainError {
  public readonly code = "DUPLICATE_MODIFIER_OPTION_ID";

  public constructor(groupId: string, optionId: string) {
    super("Modifier option ids must be unique within their group.");
    this.groupId = groupId;
    this.optionId = optionId;
  }

  public readonly groupId: string;
  public readonly optionId: string;
}

export class DuplicateModifierSelectionError extends DomainError {
  public readonly code = "DUPLICATE_MODIFIER_SELECTION";

  public constructor(groupId: string, optionId: string) {
    super("A modifier option can be selected only once; use its quantity instead.");
    this.groupId = groupId;
    this.optionId = optionId;
  }

  public readonly groupId: string;
  public readonly optionId: string;
}

export class ModifierOptionNotInGroupError extends DomainError {
  public readonly code = "MODIFIER_OPTION_NOT_IN_GROUP";

  public constructor(groupId: string, optionId: string) {
    super("The selected modifier option does not belong to this group.");
    this.groupId = groupId;
    this.optionId = optionId;
  }

  public readonly groupId: string;
  public readonly optionId: string;
}

export class ModifierGroupMinimumNotMetError extends DomainError {
  public readonly code = "MODIFIER_GROUP_MINIMUM_NOT_MET";

  public constructor(groupId: string, minimum: number, selectedQuantity: bigint) {
    super("The selected modifier quantity is below this group's minimum.");
    this.groupId = groupId;
    this.minimum = minimum;
    this.selectedQuantity = selectedQuantity;
  }

  public readonly groupId: string;
  public readonly minimum: number;
  public readonly selectedQuantity: bigint;
}

export class ModifierGroupMaximumExceededError extends DomainError {
  public readonly code = "MODIFIER_GROUP_MAXIMUM_EXCEEDED";

  public constructor(groupId: string, maximum: number, selectedQuantity: bigint) {
    super("The selected modifier quantity exceeds this group's maximum.");
    this.groupId = groupId;
    this.maximum = maximum;
    this.selectedQuantity = selectedQuantity;
  }

  public readonly groupId: string;
  public readonly maximum: number;
  public readonly selectedQuantity: bigint;
}

export class ModifierOptionMaximumExceededError extends DomainError {
  public readonly code = "MODIFIER_OPTION_MAXIMUM_EXCEEDED";

  public constructor(groupId: string, optionId: string, maximum: number, selectedQuantity: number) {
    super("The selected modifier quantity exceeds this option's maximum.");
    this.groupId = groupId;
    this.optionId = optionId;
    this.maximum = maximum;
    this.selectedQuantity = selectedQuantity;
  }

  public readonly groupId: string;
  public readonly optionId: string;
  public readonly maximum: number;
  public readonly selectedQuantity: number;
}

export class InactiveModifierGroupError extends DomainError {
  public readonly code = "INACTIVE_MODIFIER_GROUP";

  public constructor(groupId: string) {
    super("An inactive modifier group cannot be selected.");
    this.groupId = groupId;
  }

  public readonly groupId: string;
}

export class InactiveModifierOptionError extends DomainError {
  public readonly code = "INACTIVE_MODIFIER_OPTION";

  public constructor(groupId: string, optionId: string) {
    super("An inactive modifier option cannot be selected.");
    this.groupId = groupId;
    this.optionId = optionId;
  }

  public readonly groupId: string;
  public readonly optionId: string;
}

export class ModifierGroupProductMismatchError extends DomainError {
  public readonly code = "MODIFIER_GROUP_PRODUCT_MISMATCH";

  public constructor(groupId: string, expectedProductId: string, selectedProductId: string) {
    super("The modifier group does not belong to the selected product.");
    this.groupId = groupId;
    this.expectedProductId = expectedProductId;
    this.selectedProductId = selectedProductId;
  }

  public readonly groupId: string;
  public readonly expectedProductId: string;
  public readonly selectedProductId: string;
}

export class ModifierGroupRestaurantMismatchError extends DomainError {
  public readonly code = "MODIFIER_GROUP_RESTAURANT_MISMATCH";

  public constructor(groupId: string, expectedRestaurantId: string, selectedRestaurantId: string) {
    super("The modifier group does not belong to the selected restaurant.");
    this.groupId = groupId;
    this.expectedRestaurantId = expectedRestaurantId;
    this.selectedRestaurantId = selectedRestaurantId;
  }

  public readonly groupId: string;
  public readonly expectedRestaurantId: string;
  public readonly selectedRestaurantId: string;
}

export class InvalidPaymentFieldError extends DomainError {
  public readonly code = "INVALID_PAYMENT_FIELD";

  public constructor(field: string) {
    super(`${field} must be a non-empty value.`);
    this.field = field;
  }

  public readonly field: string;
}

export class InvalidPaymentMethodError extends DomainError {
  public readonly code = "INVALID_PAYMENT_METHOD";

  public constructor(method: string) {
    super("Payment method must be one of the supported non-sensitive method identifiers.");
    this.method = method;
  }

  public readonly method: string;
}

export class PaymentAmountMustBePositiveError extends DomainError {
  public readonly code = "PAYMENT_AMOUNT_MUST_BE_POSITIVE";

  public constructor(kind: "payment" | "refund") {
    super(`${kind} amount must be positive.`);
    this.kind = kind;
  }

  public readonly kind: "payment" | "refund";
}

export class InvalidPaymentTransitionError extends DomainError {
  public readonly code = "INVALID_PAYMENT_TRANSITION";

  public constructor(from: string, to: string) {
    super(`Payment cannot transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }

  public readonly from: string;
  public readonly to: string;
}

export class PaymentTransitionIdempotencyConflictError extends DomainError {
  public readonly code = "PAYMENT_TRANSITION_IDEMPOTENCY_CONFLICT";

  public constructor(idempotencyKey: string) {
    super("A payment transition idempotency key cannot be reused with a different event or payload.");
    this.idempotencyKey = idempotencyKey;
  }

  public readonly idempotencyKey: string;
}

export class PaymentAuditEvidenceRequiredError extends DomainError {
  public readonly code = "PAYMENT_AUDIT_EVIDENCE_REQUIRED";

  public constructor(field: string) {
    super(`Payment mutation requires non-empty audit evidence for ${field}.`);
    this.field = field;
  }

  public readonly field: string;
}

export class PaymentAuthorizationRequiredError extends DomainError {
  public readonly code = "PAYMENT_AUTHORIZATION_REQUIRED";

  public constructor(action: "void" | "refund") {
    super(`${action} requires an explicit supervisor authorization.`);
    this.action = action;
  }

  public readonly action: "void" | "refund";
}

export class PaymentIdempotencyConflictError extends DomainError {
  public readonly code = "PAYMENT_IDEMPOTENCY_CONFLICT";

  public constructor(idempotencyKey: string) {
    super("A payment idempotency key cannot be reused with a different payload or scope.");
    this.idempotencyKey = idempotencyKey;
  }

  public readonly idempotencyKey: string;
}

export class RefundIdempotencyConflictError extends DomainError {
  public readonly code = "REFUND_IDEMPOTENCY_CONFLICT";

  public constructor(idempotencyKey: string) {
    super("A refund idempotency key cannot be reused with a different payload or scope.");
    this.idempotencyKey = idempotencyKey;
  }

  public readonly idempotencyKey: string;
}

export class DuplicateRefundIdError extends DomainError {
  public readonly code = "DUPLICATE_REFUND_ID";

  public constructor(refundId: string) {
    super("Refund ids must be unique within a payment.");
    this.refundId = refundId;
  }

  public readonly refundId: string;
}

export class RefundPaymentMismatchError extends DomainError {
  public readonly code = "REFUND_PAYMENT_MISMATCH";

  public constructor() {
    super("Refund identity and tenant scope must match its original payment.");
  }
}

export class PaymentNotCapturedError extends DomainError {
  public readonly code = "PAYMENT_NOT_CAPTURED";

  public constructor(state: string) {
    super("Only a captured payment can be refunded.");
    this.state = state;
  }

  public readonly state: string;
}

export class RefundExceedsRemainingAmountError extends DomainError {
  public readonly code = "REFUND_EXCEEDS_REMAINING_AMOUNT";

  public constructor() {
    super("Refund amount exceeds the payment's remaining refundable amount.");
  }
}

export class InvalidCashRegisterFieldError extends DomainError {
  public readonly code = "INVALID_CASH_REGISTER_FIELD";

  public constructor(field: string) {
    super(`${field} must be a non-empty value.`);
    this.field = field;
  }

  public readonly field: string;
}

export class CashRegisterOpeningAmountError extends DomainError {
  public readonly code = "CASH_REGISTER_OPENING_AMOUNT_INVALID";

  public constructor() {
    super("Cash register opening float cannot be negative.");
  }
}

export class CashRegisterCountedBalanceError extends DomainError {
  public readonly code = "CASH_REGISTER_COUNTED_BALANCE_INVALID";

  public constructor() {
    super("Cash register counted closing balance cannot be negative.");
  }
}

export class CashRegisterClosedError extends DomainError {
  public readonly code = "CASH_REGISTER_CLOSED";

  public constructor() {
    super("A closed cash register cannot accept movements.");
  }
}

export class CashRegisterAlreadyClosedError extends DomainError {
  public readonly code = "CASH_REGISTER_ALREADY_CLOSED";

  public constructor() {
    super("A cash register session can be closed only once and cannot be reopened.");
  }
}

export class CashRegisterCloseIdempotencyConflictError extends DomainError {
  public readonly code = "CASH_REGISTER_CLOSE_IDEMPOTENCY_CONFLICT";

  public constructor(idempotencyKey: string) {
    super("A cash register close idempotency key cannot be reused with a different event or payload.");
    this.idempotencyKey = idempotencyKey;
  }

  public readonly idempotencyKey: string;
}

export class CashRegisterCurrencyMismatchError extends DomainError {
  public readonly code = "CASH_REGISTER_CURRENCY_MISMATCH";

  public constructor() {
    super("Cash register amounts must use the register currency.");
  }
}

export class CashMovementAmountMustBePositiveError extends DomainError {
  public readonly code = "CASH_MOVEMENT_AMOUNT_MUST_BE_POSITIVE";

  public constructor() {
    super("Cash movement amount must be positive.");
  }
}

export class InvalidCashMovementTypeError extends DomainError {
  public readonly code = "INVALID_CASH_MOVEMENT_TYPE";

  public constructor(type: string) {
    super("Cash movement type is not supported.");
    this.type = type;
  }

  public readonly type: string;
}

export class CashMovementReferenceError extends DomainError {
  public readonly code = "CASH_MOVEMENT_REFERENCE_INVALID";

  public constructor() {
    super("Cash movement references must match the movement type.");
  }
}

export class CashMovementReasonRequiredError extends DomainError {
  public readonly code = "CASH_MOVEMENT_REASON_REQUIRED";

  public constructor() {
    super("Manual and compensating cash movements require a reason.");
  }
}

export class CashMovementScopeMismatchError extends DomainError {
  public readonly code = "CASH_MOVEMENT_SCOPE_MISMATCH";

  public constructor() {
    super("Cash movement scope must match its cash register session.");
  }
}

export class CashMovementIdempotencyConflictError extends DomainError {
  public readonly code = "CASH_MOVEMENT_IDEMPOTENCY_CONFLICT";

  public constructor(key: string) {
    super("A cash movement idempotency key cannot be reused with a different payload.");
    this.idempotencyKey = key;
  }

  public readonly idempotencyKey: string;
}

export class DuplicateCashMovementIdError extends DomainError {
  public readonly code = "DUPLICATE_CASH_MOVEMENT_ID";

  public constructor(id: string) {
    super("Cash movement ids must be unique within a cash register session.");
    this.movementId = id;
  }

  public readonly movementId: string;
}

export class CashMovementSequenceError extends DomainError {
  public readonly code = "CASH_MOVEMENT_SEQUENCE_ERROR";

  public constructor(deviceId: string, expected: number, received: number) {
    super("Cash movements must arrive in the expected monotonic device sequence.");
    this.deviceId = deviceId;
    this.expected = expected;
    this.received = received;
  }

  public readonly deviceId: string;
  public readonly expected: number;
  public readonly received: number;
}

export class CashMovementCompensationError extends DomainError {
  public readonly code = "CASH_MOVEMENT_COMPENSATION_INVALID";

  public constructor(message = "Cash compensation must reverse an existing movement.") {
    super(message);
  }
}

export class CashRegisterVarianceReasonRequiredError extends DomainError {
  public readonly code = "CASH_REGISTER_VARIANCE_REASON_REQUIRED";

  public constructor() {
    super("A non-zero cash register closing difference requires a reason.");
  }
}
