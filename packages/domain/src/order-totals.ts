import {
  DomainError,
  DiscountExceedsAmountError,
  DuplicateOrderItemIdError,
  InvalidQuantityError,
  InvalidOrderDiscountAllocationStrategyError,
  InvalidSnapshotError,
  InvalidTaxRateError,
  InvalidTimeZoneError,
  NegativeMoneyAmountError,
} from "./errors.js";
import { Money } from "./money.js";

export interface ExactRatio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface ModifierPriceSnapshot {
  readonly modifierId: string;
  readonly name: string;
  /** Present for snapshots resolved by the modifier-group domain API. */
  readonly groupId?: string;
  /** Historical group label, never re-read from the current catalog. */
  readonly groupName?: string;
  /** Versioned allowlist from which this modifier was authorized. */
  readonly groupCatalogVersion?: string;
  readonly unitPrice: Money;
  readonly quantity: number;
}

export interface TaxSnapshot {
  readonly taxId: string;
  readonly name: string;
  /** Version of the jurisdictional/configured rule that supplied this rate and formula. */
  readonly taxRuleVersion: string;
  /** Tax as a fraction of the tax-exclusive amount; for example, 16/100. */
  readonly rate: ExactRatio;
  readonly inclusion: "included" | "excluded";
}

export interface AppliedDiscountSnapshot {
  readonly discountId: string;
  /** Version of the configured rule that authorized this applied reduction. */
  readonly discountRuleVersion: string;
  readonly amount: Money;
}

/** The persisted algorithm identity prevents a later release from silently repricing history. */
export const ORDER_DISCOUNT_ALLOCATION_STRATEGY = "largest-remainder-post-tax-line-total-v1";
export type OrderDiscountAllocationStrategy = typeof ORDER_DISCOUNT_ALLOCATION_STRATEGY;

export interface OrderDiscountSnapshot extends AppliedDiscountSnapshot {
  readonly allocationStrategy: OrderDiscountAllocationStrategy;
}

/** Historical catalog facts needed to reproduce an order item. */
export interface OrderItemPriceSnapshot {
  readonly catalogVersion: string;
  readonly productId: string;
  readonly name: string;
  readonly sku?: string;
  /** Historical preparation station selected when the line was created. */
  readonly stationId: string;
  /** Historical sales unit; quantity belongs to the immutable order-item input. */
  readonly unit: string;
  readonly unitPrice: Money;
  readonly modifiers: readonly ModifierPriceSnapshot[];
  readonly tax?: TaxSnapshot;
}

export interface OrderItemPricingInput {
  readonly orderItemId: string;
  readonly snapshot: OrderItemPriceSnapshot;
  readonly quantity: number;
  /** An explicit minor-unit reduction applied before that line's tax. */
  readonly lineDiscount?: AppliedDiscountSnapshot;
}

export interface OrderPricingInput {
  /** The currency and IANA zone frozen by the order, never inferred from a client locale. */
  readonly currency: string;
  readonly timeZone: string;
  readonly lines: readonly OrderItemPricingInput[];
  /** An explicit minor-unit reduction allocated after all line taxes. */
  readonly orderDiscount?: OrderDiscountSnapshot;
  /** Explicit, non-negative and positioned after discounts; tax treatment remains policy-dependent. */
  readonly tip?: Money;
}

export interface CalculatedOrderItemTotals {
  readonly input: OrderItemPricingInput;
  readonly unitAmount: Money;
  readonly grossBeforeLineDiscount: Money;
  readonly lineDiscount: Money;
  readonly subtotalBeforeTax: Money;
  readonly taxableAmount: Money;
  readonly taxAmount: Money;
  readonly total: Money;
}

export interface CalculatedOrderLineTotals extends CalculatedOrderItemTotals {
  readonly orderDiscount: Money;
  readonly totalAfterOrderDiscount: Money;
}

export interface CalculatedOrderTotals {
  readonly input: OrderPricingInput;
  readonly lines: readonly CalculatedOrderLineTotals[];
  readonly grossBeforeLineDiscount: Money;
  readonly lineDiscountTotal: Money;
  readonly subtotalBeforeOrderDiscount: Money;
  readonly taxTotal: Money;
  readonly orderDiscount: Money;
  readonly orderDiscountSnapshot?: OrderDiscountSnapshot;
  readonly tip: Money;
  readonly total: Money;
}

/**
 * Calculates a line strictly from its price snapshot. Inputs and the returned
 * record are deeply frozen. Taxes use exact ratios and Money's documented
 * half-away-from-zero rounding; there is intentionally no country-specific
 * fiscal rule beyond the supplied included/excluded flag. Persistence or API
 * layers must invoke this again from their stored snapshots; client totals are
 * never accepted as the source of truth.
 */
export function calculateOrderItemTotals(input: OrderItemPricingInput): CalculatedOrderItemTotals {
  return atPricingBoundary("order item pricing input", () => calculateOrderItemTotalsFromCanonical(
    normalizeOrderItemPricingInput(input),
  ));
}

function calculateOrderItemTotalsFromCanonical(input: OrderItemPricingInput): CalculatedOrderItemTotals {
  assertText(input.orderItemId, "orderItemId");
  assertPositiveQuantity(input.quantity);
  const snapshot = clonePriceSnapshot(input.snapshot);
  const currency = snapshot.unitPrice.currency;
  const unitAmount = sumMoney(
    [snapshot.unitPrice, ...snapshot.modifiers.map((modifier) => modifier.unitPrice.multiplyRatio(BigInt(modifier.quantity), 1n))],
    currency,
  );
  const grossBeforeLineDiscount = unitAmount.multiplyRatio(BigInt(input.quantity), 1n);
  const lineDiscount = input.lineDiscount === undefined
    ? zero(currency)
    : cloneDiscount(input.lineDiscount, currency, "line discount").amount;

  if (lineDiscount.compare(grossBeforeLineDiscount) === 1) {
    throw new DiscountExceedsAmountError("line");
  }

  const subtotalBeforeTax = grossBeforeLineDiscount.subtract(lineDiscount);
  const { taxableAmount, taxAmount, total } = calculateTax(subtotalBeforeTax, snapshot.tax);

  return deepFreeze({
    input: cloneOrderItemInput(input, snapshot),
    unitAmount,
    grossBeforeLineDiscount,
    lineDiscount,
    subtotalBeforeTax,
    taxableAmount,
    taxAmount,
    total,
  });
}

/**
 * Applies the plan's order: unit+modifiers, quantity, line discount, line tax,
 * order discount, then tip. The order discount is allocated in minor units by
 * greatest remainder, with an orderItemId lexical tie-break, so allocated
 * amounts always sum exactly to the explicit order discount.
 */
export function calculateOrderTotals(input: OrderPricingInput): CalculatedOrderTotals {
  return atPricingBoundary("order pricing input", () => calculateOrderTotalsFromCanonical(
    normalizeOrderPricingInput(input),
  ));
}

function calculateOrderTotalsFromCanonical(input: OrderPricingInput): CalculatedOrderTotals {
  const expectedCurrency = new Money(0, input.currency).currency;
  assertTimeZone(input.timeZone);
  const calculatedItems = input.lines.map(calculateOrderItemTotalsFromCanonical);
  assertUniqueOrderItemIds(calculatedItems);
  for (const item of calculatedItems) {
    assertCurrency(item.total, expectedCurrency);
  }

  const subtotalBeforeOrderDiscount = sumMoney(calculatedItems.map((item) => item.total), expectedCurrency);
  const orderDiscount = input.orderDiscount === undefined
    ? zero(expectedCurrency)
    : cloneOrderDiscount(input.orderDiscount, expectedCurrency).amount;
  if (orderDiscount.compare(subtotalBeforeOrderDiscount) === 1) {
    throw new DiscountExceedsAmountError("order");
  }

  const allocatedOrderDiscounts = allocateOrderDiscount(orderDiscount, calculatedItems, input.orderDiscount?.allocationStrategy);
  const lines = calculatedItems.map((item, index) => {
    const allocated = allocatedOrderDiscounts[index];
    if (allocated === undefined) {
      throw new Error("Order discount allocation must return one result per line.");
    }
    return deepFreeze({ ...item, orderDiscount: allocated, totalAfterOrderDiscount: item.total.subtract(allocated) });
  });
  const tip = input.tip === undefined ? zero(expectedCurrency) : cloneNonNegativeMoney(input.tip, expectedCurrency, "tip");
  const totalAfterOrderDiscount = sumMoney(lines.map((line) => line.totalAfterOrderDiscount), expectedCurrency);

  return deepFreeze({
    input: cloneOrderPricingInput(input),
    lines,
    grossBeforeLineDiscount: sumMoney(calculatedItems.map((item) => item.grossBeforeLineDiscount), expectedCurrency),
    lineDiscountTotal: sumMoney(calculatedItems.map((item) => item.lineDiscount), expectedCurrency),
    subtotalBeforeOrderDiscount,
    taxTotal: sumMoney(calculatedItems.map((item) => item.taxAmount), expectedCurrency),
    orderDiscount,
    ...(input.orderDiscount === undefined ? {} : { orderDiscountSnapshot: cloneOrderDiscount(input.orderDiscount, expectedCurrency) }),
    tip,
    total: totalAfterOrderDiscount.add(tip),
  });
}

function calculateTax(subtotal: Money, tax: TaxSnapshot | undefined): {
  readonly taxableAmount: Money;
  readonly taxAmount: Money;
  readonly total: Money;
} {
  if (tax === undefined) {
    return { taxableAmount: subtotal, taxAmount: zero(subtotal.currency), total: subtotal };
  }

  const snapshot = cloneTaxSnapshot(tax);
  if (snapshot.inclusion === "included") {
    const taxAmount = subtotal.multiplyRatio(snapshot.rate.numerator, snapshot.rate.denominator + snapshot.rate.numerator);
    return { taxableAmount: subtotal.subtract(taxAmount), taxAmount, total: subtotal };
  }

  const taxAmount = subtotal.multiplyRatio(snapshot.rate.numerator, snapshot.rate.denominator);
  return { taxableAmount: subtotal, taxAmount, total: subtotal.add(taxAmount) };
}

function allocateOrderDiscount(
  orderDiscount: Money,
  items: readonly CalculatedOrderItemTotals[],
  strategy: OrderDiscountAllocationStrategy | undefined,
): readonly Money[] {
  if (orderDiscount.amountMinor === 0 || items.length === 0) {
    return items.map((item) => zero(item.total.currency));
  }
  if (strategy !== ORDER_DISCOUNT_ALLOCATION_STRATEGY) {
    throw new InvalidOrderDiscountAllocationStrategyError(strategy ?? "");
  }

  const totalMinor = items.reduce((sum, item) => sum + BigInt(item.total.amountMinor), 0n);
  const discountMinor = BigInt(orderDiscount.amountMinor);
  const allocations = items.map((item, index) => {
    const product = discountMinor * BigInt(item.total.amountMinor);
    return { index, orderItemId: item.input.orderItemId, amount: product / totalMinor, remainder: product % totalMinor };
  });
  const allocatedMinor = allocations.reduce((sum, allocation) => sum + allocation.amount, 0n);
  const remainderUnits = discountMinor - allocatedMinor;
  const ranked = [...allocations].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    // Do not use localeCompare here: ICU/locale data may differ by device. IDs are
    // compared by their exact UTF-16 code units so persisted allocation is portable.
    if (left.orderItemId < right.orderItemId) {
      return -1;
    }
    if (left.orderItemId > right.orderItemId) {
      return 1;
    }
    return 0;
  });

  for (let index = 0; index < Number(remainderUnits); index += 1) {
    const allocation = ranked[index];
    if (allocation === undefined) {
      throw new Error("Order discount remainder allocation exceeded the available lines.");
    }
    allocation.amount += 1n;
  }

  return allocations.map((allocation, index) => {
    const item = items[index];
    if (item === undefined) {
      throw new Error("Order discount allocation item is missing.");
    }
    return new Money(Number(allocation.amount), item.total.currency);
  });
}

/**
 * The public calculators accept values from persistence and transport boundaries.
 * Detach every supported field through own data descriptors before calculating so
 * getters, inherited values, proxies that change reads, and exotic prototypes
 * cannot influence monetary arithmetic after validation.
 */
function normalizeOrderPricingInput(value: unknown): OrderPricingInput {
  const input = asPlainRecord(value, "order pricing input");
  const currency = ownData(input, "currency", "currency");
  // Keep the existing validation order: currency and time zone precede lines.
  const normalizedCurrency = new Money(0, currency as string).currency;
  const timeZone = ownData(input, "timeZone", "timeZone");
  assertTimeZone(timeZone as string);
  const lines = ownDataArray(input, "lines", "lines").map((line) => normalizeOrderItemPricingInput(line));
  const orderDiscount = optionalOwnData(input, "orderDiscount", "order discount");
  const tip = optionalOwnData(input, "tip", "tip");

  return deepFreeze({
    currency: normalizedCurrency,
    timeZone: timeZone as string,
    lines,
    ...(orderDiscount === undefined ? {} : { orderDiscount: normalizeOrderDiscount(orderDiscount, normalizedCurrency) }),
    ...(tip === undefined ? {} : { tip: normalizeNonNegativeMoney(tip, normalizedCurrency, "tip") }),
  });
}

function normalizeOrderItemPricingInput(value: unknown): OrderItemPricingInput {
  const input = asPlainRecord(value, "order item pricing input");
  const orderItemId = ownData(input, "orderItemId", "orderItemId");
  assertText(orderItemId as string, "orderItemId");
  const quantity = ownData(input, "quantity", "quantity");
  assertPositiveQuantity(quantity as number);
  const snapshot = normalizePriceSnapshot(ownData(input, "snapshot", "snapshot"));
  const lineDiscount = optionalOwnData(input, "lineDiscount", "line discount");

  return deepFreeze({
    orderItemId: orderItemId as string,
    snapshot,
    quantity: quantity as number,
    ...(lineDiscount === undefined
      ? {}
      : { lineDiscount: normalizeDiscount(lineDiscount, snapshot.unitPrice.currency, "line discount") }),
  });
}

function normalizePriceSnapshot(value: unknown): OrderItemPriceSnapshot {
  const snapshot = asPlainRecord(value, "price snapshot");
  const catalogVersion = ownData(snapshot, "catalogVersion", "catalogVersion");
  const productId = ownData(snapshot, "productId", "productId");
  const name = ownData(snapshot, "name", "name");
  const sku = optionalOwnData(snapshot, "sku", "sku");
  const stationId = ownData(snapshot, "stationId", "stationId");
  const unit = ownData(snapshot, "unit", "unit");
  assertText(catalogVersion as string, "catalogVersion");
  assertText(productId as string, "productId");
  assertText(name as string, "name");
  if (sku !== undefined) assertText(sku as string, "sku");
  assertText(stationId as string, "stationId");
  assertText(unit as string, "unit");
  const unitPrice = normalizeNonNegativeMoney(ownData(snapshot, "unitPrice", "unit price"), undefined, "unit price");
  const modifiers = ownDataArray(snapshot, "modifiers", "modifiers").map((modifier) => normalizeModifier(modifier, unitPrice.currency));
  const tax = optionalOwnData(snapshot, "tax", "tax snapshot");

  return deepFreeze({
    catalogVersion: catalogVersion as string,
    productId: productId as string,
    name: name as string,
    ...(sku === undefined ? {} : { sku: sku as string }),
    stationId: stationId as string,
    unit: unit as string,
    unitPrice,
    modifiers,
    ...(tax === undefined ? {} : { tax: normalizeTaxSnapshot(tax) }),
  });
}

function normalizeModifier(value: unknown, currency: string): ModifierPriceSnapshot {
  const modifier = asPlainRecord(value, "modifier snapshot");
  const modifierId = ownData(modifier, "modifierId", "modifierId");
  const name = ownData(modifier, "name", "modifier name");
  const quantity = ownData(modifier, "quantity", "modifier quantity");
  const groupId = optionalOwnData(modifier, "groupId", "modifier groupId");
  const groupName = optionalOwnData(modifier, "groupName", "modifier group name");
  const groupCatalogVersion = optionalOwnData(modifier, "groupCatalogVersion", "modifier group catalogVersion");
  assertText(modifierId as string, "modifierId");
  assertText(name as string, "modifier name");
  assertPositiveQuantity(quantity as number);
  const hasGroupIdentity = groupId !== undefined || groupName !== undefined || groupCatalogVersion !== undefined;
  if (hasGroupIdentity) {
    assertText(groupId as string, "modifier groupId");
    assertText(groupName as string, "modifier group name");
    assertText(groupCatalogVersion as string, "modifier group catalogVersion");
  }

  return deepFreeze({
    modifierId: modifierId as string,
    name: name as string,
    ...(hasGroupIdentity
      ? { groupId: groupId as string, groupName: groupName as string, groupCatalogVersion: groupCatalogVersion as string }
      : {}),
    unitPrice: normalizeNonNegativeMoney(ownData(modifier, "unitPrice", "modifier unit price"), currency, "modifier unit price"),
    quantity: quantity as number,
  });
}

function normalizeTaxSnapshot(value: unknown): TaxSnapshot {
  const tax = asPlainRecord(value, "tax snapshot");
  const taxId = ownData(tax, "taxId", "taxId");
  const name = ownData(tax, "name", "tax name");
  const taxRuleVersion = ownData(tax, "taxRuleVersion", "taxRuleVersion");
  const inclusion = ownData(tax, "inclusion", "tax inclusion");
  assertText(taxId as string, "taxId");
  assertText(name as string, "tax name");
  assertText(taxRuleVersion as string, "taxRuleVersion");
  if (inclusion !== "included" && inclusion !== "excluded") throw new InvalidSnapshotError("tax inclusion");

  const rate = asTaxRateRecord(optionalOwnData(tax, "rate", "tax rate"));
  const numerator = optionalOwnData(rate, "numerator", "tax rate numerator");
  const denominator = optionalOwnData(rate, "denominator", "tax rate denominator");
  if (typeof numerator !== "bigint" || typeof denominator !== "bigint" || numerator < 0n || denominator <= 0n) {
    throw new InvalidTaxRateError();
  }

  return deepFreeze({
    taxId: taxId as string,
    name: name as string,
    taxRuleVersion: taxRuleVersion as string,
    rate: deepFreeze({ numerator, denominator }),
    inclusion,
  });
}

function normalizeDiscount(value: unknown, currency: string, field: string): AppliedDiscountSnapshot {
  const discount = asPlainRecord(value, field);
  const discountId = ownData(discount, "discountId", "discountId");
  const discountRuleVersion = ownData(discount, "discountRuleVersion", "discountRuleVersion");
  assertText(discountId as string, "discountId");
  assertText(discountRuleVersion as string, "discountRuleVersion");
  return deepFreeze({
    discountId: discountId as string,
    discountRuleVersion: discountRuleVersion as string,
    amount: normalizeNonNegativeMoney(ownData(discount, "amount", `${field} amount`), currency, field),
  });
}

function normalizeOrderDiscount(value: unknown, currency: string): OrderDiscountSnapshot {
  const discount = asPlainRecord(value, "order discount");
  const allocationStrategy = ownData(discount, "allocationStrategy", "order discount allocation strategy");
  if (allocationStrategy !== ORDER_DISCOUNT_ALLOCATION_STRATEGY) {
    throw new InvalidOrderDiscountAllocationStrategyError(typeof allocationStrategy === "string" ? allocationStrategy : "");
  }
  return deepFreeze({
    ...normalizeDiscount(discount, currency, "order discount"),
    allocationStrategy,
  });
}

function normalizeNonNegativeMoney(value: unknown, currency: string | undefined, field: string): Money {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Money.prototype) {
    throw new InvalidSnapshotError(field);
  }
  const money = value as Record<string, unknown>;
  const amountMinor = ownData(money, "amountMinor", `${field} amountMinor`);
  const moneyCurrency = ownData(money, "currency", `${field} currency`);
  const normalized = new Money(amountMinor as number, moneyCurrency as string);
  if (currency !== undefined) assertCurrency(normalized, currency);
  if (normalized.amountMinor < 0) throw new NegativeMoneyAmountError(field);
  return normalized;
}

function asPlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidSnapshotError(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidSnapshotError(field);
  return value as Record<string, unknown>;
}

function asTaxRateRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidTaxRateError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidTaxRateError();
  return value as Record<string, unknown>;
}

function ownData(record: Record<string, unknown>, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidSnapshotError(field);
  return descriptor.value;
}

function optionalOwnData(record: Record<string, unknown>, key: string, field: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new InvalidSnapshotError(field);
  return descriptor.value;
}

function ownDataArray(record: Record<string, unknown>, key: string, field: string): readonly unknown[] {
  return asDataArray(ownData(record, key, field), field);
}

function asDataArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new InvalidSnapshotError(field);
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) {
    throw new InvalidSnapshotError(field);
  }
  const values: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    values.push(ownData(value as unknown as Record<string, unknown>, String(index), field));
  }
  return values;
}

function atPricingBoundary<T>(field: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new InvalidSnapshotError(field);
  }
}

function cloneOrderPricingInput(input: OrderPricingInput): OrderPricingInput {
  return deepFreeze({
    currency: new Money(0, input.currency).currency,
    timeZone: input.timeZone,
    lines: input.lines.map((line) => cloneOrderItemInput(line, clonePriceSnapshot(line.snapshot))),
    ...(input.orderDiscount === undefined ? {} : { orderDiscount: cloneOrderDiscount(input.orderDiscount, input.currency) }),
    ...(input.tip === undefined ? {} : { tip: cloneNonNegativeMoney(input.tip, input.currency, "tip") }),
  });
}

function cloneOrderItemInput(input: OrderItemPricingInput, snapshot: OrderItemPriceSnapshot): OrderItemPricingInput {
  return deepFreeze({
    orderItemId: input.orderItemId,
    snapshot,
    quantity: input.quantity,
    ...(input.lineDiscount === undefined
      ? {}
      : { lineDiscount: cloneDiscount(input.lineDiscount, snapshot.unitPrice.currency, "line discount") }),
  });
}

function clonePriceSnapshot(snapshot: OrderItemPriceSnapshot): OrderItemPriceSnapshot {
  assertText(snapshot.catalogVersion, "catalogVersion");
  assertText(snapshot.productId, "productId");
  assertText(snapshot.name, "name");
  if (snapshot.sku !== undefined) {
    assertText(snapshot.sku, "sku");
  }
  assertText(snapshot.stationId, "stationId");
  assertText(snapshot.unit, "unit");
  const unitPrice = cloneNonNegativeMoney(snapshot.unitPrice, snapshot.unitPrice.currency, "unit price");
  const modifiers = snapshot.modifiers.map((modifier) => {
    assertText(modifier.modifierId, "modifierId");
    assertText(modifier.name, "modifier name");
    const hasGroupIdentity = modifier.groupId !== undefined
      || modifier.groupName !== undefined
      || modifier.groupCatalogVersion !== undefined;
    if (hasGroupIdentity) {
      assertText(modifier.groupId ?? "", "modifier groupId");
      assertText(modifier.groupName ?? "", "modifier group name");
      assertText(modifier.groupCatalogVersion ?? "", "modifier group catalogVersion");
    }
    assertPositiveQuantity(modifier.quantity);
    return deepFreeze({
      modifierId: modifier.modifierId,
      name: modifier.name,
      ...(hasGroupIdentity
        ? {
          groupId: modifier.groupId!,
          groupName: modifier.groupName!,
          groupCatalogVersion: modifier.groupCatalogVersion!,
        }
        : {}),
      unitPrice: cloneNonNegativeMoney(modifier.unitPrice, unitPrice.currency, "modifier unit price"),
      quantity: modifier.quantity,
    });
  });
  return deepFreeze({
    catalogVersion: snapshot.catalogVersion,
    productId: snapshot.productId,
    name: snapshot.name,
    ...(snapshot.sku === undefined ? {} : { sku: snapshot.sku }),
    stationId: snapshot.stationId,
    unit: snapshot.unit,
    unitPrice,
    modifiers,
    ...(snapshot.tax === undefined ? {} : { tax: cloneTaxSnapshot(snapshot.tax) }),
  });
}

function cloneTaxSnapshot(tax: TaxSnapshot): TaxSnapshot {
  if (!isRecord(tax)) {
    throw new InvalidSnapshotError("tax snapshot");
  }
  assertText(tax.taxId, "taxId");
  assertText(tax.name, "tax name");
  assertText(tax.taxRuleVersion, "taxRuleVersion");
  const rate = tax.rate;
  if (
    !isRecord(rate)
    || typeof rate.numerator !== "bigint"
    || typeof rate.denominator !== "bigint"
    || rate.numerator < 0n
    || rate.denominator <= 0n
  ) {
    throw new InvalidTaxRateError();
  }
  if (tax.inclusion !== "included" && tax.inclusion !== "excluded") {
    throw new InvalidSnapshotError("tax inclusion");
  }
  return deepFreeze({
    taxId: tax.taxId,
    name: tax.name,
    taxRuleVersion: tax.taxRuleVersion,
    rate: deepFreeze({ numerator: rate.numerator, denominator: rate.denominator }),
    inclusion: tax.inclusion,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneDiscount(discount: AppliedDiscountSnapshot, currency: string, field: string): AppliedDiscountSnapshot {
  assertText(discount.discountId, "discountId");
  assertText(discount.discountRuleVersion, "discountRuleVersion");
  return deepFreeze({
    discountId: discount.discountId,
    discountRuleVersion: discount.discountRuleVersion,
    amount: cloneNonNegativeMoney(discount.amount, currency, field),
  });
}

function cloneOrderDiscount(discount: OrderDiscountSnapshot, currency: string): OrderDiscountSnapshot {
  if (discount.allocationStrategy !== ORDER_DISCOUNT_ALLOCATION_STRATEGY) {
    throw new InvalidOrderDiscountAllocationStrategyError(discount.allocationStrategy);
  }
  const base = cloneDiscount(discount, currency, "order discount");
  return deepFreeze({ ...base, allocationStrategy: discount.allocationStrategy });
}

function cloneNonNegativeMoney(value: Money, currency: string, field: string): Money {
  const money = new Money(value.amountMinor, value.currency);
  assertCurrency(money, currency);
  if (money.amountMinor < 0) {
    throw new NegativeMoneyAmountError(field);
  }
  return money;
}

function assertCurrency(money: Money, currency: string): void {
  new Money(0, currency).add(money);
}

function sumMoney(values: readonly Money[], currency: string): Money {
  return values.reduce((total, value) => total.add(value), zero(currency));
}

function zero(currency: string): Money {
  return new Money(0, currency);
}

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new InvalidQuantityError(quantity);
  }
}

function assertText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidSnapshotError(field);
  }
}

function assertTimeZone(timeZone: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new InvalidTimeZoneError(timeZone);
  }
}

function assertUniqueOrderItemIds(items: readonly CalculatedOrderItemTotals[]): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.input.orderItemId)) {
      throw new DuplicateOrderItemIdError(item.input.orderItemId);
    }
    ids.add(item.input.orderItemId);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) {
      deepFreeze(child, seen);
    }
    Object.freeze(value);
  }
  return value;
}
