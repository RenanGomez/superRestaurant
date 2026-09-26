import {
  DomainError,
  DuplicateModifierOptionIdError,
  InactiveModifierOptionError,
  InvalidModifierOptionMaximumError,
  InvalidQuantityError,
  InvalidSnapshotError,
  ModifierGroupMaximumExceededError,
  ModifierGroupMinimumNotMetError,
  ModifierOptionMaximumExceededError,
  ModifierOptionNotInGroupError,
} from "./errors.js";
import {
  validateModifierGroupCatalog,
  type ModifierGroupCatalog,
  type ModifierOptionSelection,
  type ValidatedModifierGroupCatalog,
} from "./modifiers.js";
import { Money } from "./money.js";

export interface ModifierGroupTemplateOptionCatalog {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  /** Global cap for every binding of this template option. */
  readonly maximumQuantity?: number;
}

/**
 * Reusable vocabulary only. Product-specific bounds, prices and defaults belong
 * to a binding so publishing a new template never changes historical releases.
 */
export interface ModifierGroupTemplateCatalog {
  readonly id: string;
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly name: string;
  readonly active: boolean;
  readonly options: readonly ModifierGroupTemplateOptionCatalog[];
}

export interface ModifierTemplateOptionBinding {
  readonly optionId: string;
  readonly unitPrice: Money;
  /** A variant may tighten, but never widen, the template cap. */
  readonly maximumQuantity?: number;
  /** Zero excludes this option from the default selection. */
  readonly defaultQuantity: number;
}

export interface ModifierGroupTemplateBinding {
  readonly groupId: string;
  readonly productId: string;
  readonly name: string;
  readonly active: boolean;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
  /** Ordered allowlist for this product/variant instance. */
  readonly options: readonly ModifierTemplateOptionBinding[];
}

export interface ValidatedModifierGroupTemplateCatalog {
  readonly id: string;
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly name: string;
  readonly active: boolean;
  readonly options: readonly Readonly<ModifierGroupTemplateOptionCatalog>[];
}

/** Existing modifier authority plus the template/default facts required by S5. */
export interface InstantiatedModifierGroupCatalog extends ValidatedModifierGroupCatalog {
  readonly templateId: string;
  readonly defaultSelections: readonly ModifierOptionSelection[];
}

export function validateModifierGroupTemplateCatalog(
  value: ModifierGroupTemplateCatalog,
): ValidatedModifierGroupTemplateCatalog {
  return atTemplateBoundary("modifier group template", () => {
    const template = normalizeTemplate(value);
    assertText(template.id, "modifier template id");
    assertText(template.restaurantId, "modifier template restaurantId");
    assertText(template.catalogVersion, "modifier template catalogVersion");
    assertText(template.name, "modifier template name");
    assertBoolean(template.active, "modifier template active");
    if (template.options.length === 0) throw new InvalidSnapshotError("modifier template options");

    const ids = new Set<string>();
    const options = template.options.map((option) => {
      assertText(option.id, "modifier template option id");
      assertText(option.name, "modifier template option name");
      assertBoolean(option.active, "modifier template option active");
      if (ids.has(option.id)) throw new DuplicateModifierOptionIdError(template.id, option.id);
      ids.add(option.id);
      assertOptionalMaximum(option.id, option.maximumQuantity);
      return Object.freeze({ ...option });
    });

    return deepFreeze({ ...template, options });
  });
}

/**
 * Instantiates one reusable template through the existing modifier-group model.
 * This function does not price fractions or infer missing defaults.
 */
export function instantiateModifierGroupTemplate(
  templateValue: ModifierGroupTemplateCatalog,
  bindingValue: ModifierGroupTemplateBinding,
): InstantiatedModifierGroupCatalog {
  return atTemplateBoundary("modifier template binding", () => {
    const template = validateModifierGroupTemplateCatalog(templateValue);
    const binding = normalizeBinding(bindingValue);
    assertText(binding.groupId, "modifier template binding groupId");
    assertText(binding.productId, "modifier template binding productId");
    assertText(binding.name, "modifier template binding name");
    assertBoolean(binding.active, "modifier template binding active");

    const templateOptions = new Map(template.options.map((option) => [option.id, option]));
    const boundIds = new Set<string>();
    const defaults: ModifierOptionSelection[] = [];
    let defaultTotal = 0;
    const options = binding.options.map((bound) => {
      assertText(bound.optionId, "modifier template binding optionId");
      if (boundIds.has(bound.optionId)) throw new DuplicateModifierOptionIdError(binding.groupId, bound.optionId);
      boundIds.add(bound.optionId);
      const source = templateOptions.get(bound.optionId);
      if (source === undefined) throw new ModifierOptionNotInGroupError(binding.groupId, bound.optionId);
      assertOptionalMaximum(bound.optionId, bound.maximumQuantity);
      if (
        source.maximumQuantity !== undefined
        && bound.maximumQuantity !== undefined
        && bound.maximumQuantity > source.maximumQuantity
      ) throw new InvalidModifierOptionMaximumError(bound.optionId, bound.maximumQuantity);
      assertDefaultQuantity(bound.defaultQuantity);
      const maximumQuantity = bound.maximumQuantity ?? source.maximumQuantity;
      if (maximumQuantity !== undefined && bound.defaultQuantity > maximumQuantity) {
        throw new ModifierOptionMaximumExceededError(
          binding.groupId,
          bound.optionId,
          maximumQuantity,
          bound.defaultQuantity,
        );
      }
      if (!source.active && bound.defaultQuantity > 0) {
        throw new InactiveModifierOptionError(binding.groupId, bound.optionId);
      }
      if (bound.defaultQuantity > 0) {
        defaults.push(Object.freeze({ optionId: bound.optionId, quantity: bound.defaultQuantity }));
        defaultTotal += bound.defaultQuantity;
      }
      return Object.freeze({
        active: source.active,
        id: source.id,
        ...(maximumQuantity === undefined ? {} : { maximumQuantity }),
        name: source.name,
        unitPrice: new Money(bound.unitPrice.amountMinor, bound.unitPrice.currency),
      });
    });

    if (defaultTotal > binding.maximumQuantity) {
      throw new ModifierGroupMaximumExceededError(binding.groupId, binding.maximumQuantity, BigInt(defaultTotal));
    }
    if (defaultTotal < binding.minimumQuantity) {
      throw new ModifierGroupMinimumNotMetError(binding.groupId, binding.minimumQuantity, BigInt(defaultTotal));
    }
    const group: ModifierGroupCatalog = {
      active: template.active && binding.active,
      catalogVersion: template.catalogVersion,
      id: binding.groupId,
      maximumQuantity: binding.maximumQuantity,
      minimumQuantity: binding.minimumQuantity,
      name: binding.name,
      options,
      productId: binding.productId,
      restaurantId: template.restaurantId,
    };
    const validated = validateModifierGroupCatalog(group);
    return deepFreeze({
      ...validated,
      defaultSelections: defaults,
      templateId: template.id,
    });
  });
}

function normalizeTemplate(value: unknown): ModifierGroupTemplateCatalog {
  const record = asPlainRecord(value, "modifier group template");
  return deepFreeze({
    active: ownData(record, "active", "modifier template active") as boolean,
    catalogVersion: ownData(record, "catalogVersion", "modifier template catalogVersion") as string,
    id: ownData(record, "id", "modifier template id") as string,
    name: ownData(record, "name", "modifier template name") as string,
    options: ownDataArray(record, "options", "modifier template options").map((item) => {
      const option = asPlainRecord(item, "modifier template option");
      const maximumQuantity = optionalOwnData(option, "maximumQuantity", "modifier template option maximum");
      return Object.freeze({
        active: ownData(option, "active", "modifier template option active") as boolean,
        id: ownData(option, "id", "modifier template option id") as string,
        ...(maximumQuantity === undefined ? {} : { maximumQuantity: maximumQuantity as number }),
        name: ownData(option, "name", "modifier template option name") as string,
      });
    }),
    restaurantId: ownData(record, "restaurantId", "modifier template restaurantId") as string,
  });
}

function normalizeBinding(value: unknown): ModifierGroupTemplateBinding {
  const record = asPlainRecord(value, "modifier template binding");
  return deepFreeze({
    active: ownData(record, "active", "modifier template binding active") as boolean,
    groupId: ownData(record, "groupId", "modifier template binding groupId") as string,
    maximumQuantity: ownData(record, "maximumQuantity", "modifier template binding maximum") as number,
    minimumQuantity: ownData(record, "minimumQuantity", "modifier template binding minimum") as number,
    name: ownData(record, "name", "modifier template binding name") as string,
    options: ownDataArray(record, "options", "modifier template binding options").map((item) => {
      const option = asPlainRecord(item, "modifier template option binding");
      const maximumQuantity = optionalOwnData(option, "maximumQuantity", "modifier template binding option maximum");
      return Object.freeze({
        defaultQuantity: ownData(option, "defaultQuantity", "modifier template binding default quantity") as number,
        ...(maximumQuantity === undefined ? {} : { maximumQuantity: maximumQuantity as number }),
        optionId: ownData(option, "optionId", "modifier template binding optionId") as string,
        unitPrice: normalizeMoney(ownData(option, "unitPrice", "modifier template binding unitPrice")),
      });
    }),
    productId: ownData(record, "productId", "modifier template binding productId") as string,
  });
}

function normalizeMoney(value: unknown): Money {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Money.prototype) {
    throw new InvalidSnapshotError("modifier template binding unitPrice");
  }
  const record = value as Record<string, unknown>;
  return new Money(
    ownData(record, "amountMinor", "modifier template binding amountMinor") as number,
    ownData(record, "currency", "modifier template binding currency") as string,
  );
}

function assertDefaultQuantity(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new InvalidQuantityError(value);
}

function assertOptionalMaximum(optionId: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new InvalidModifierOptionMaximumError(optionId, value);
  }
}

function assertText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InvalidSnapshotError(field);
  }
}

function assertBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") throw new InvalidSnapshotError(field);
}

function asPlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidSnapshotError(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidSnapshotError(field);
  return value as Record<string, unknown>;
}

function ownData(record: Record<string, unknown>, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidSnapshotError(field);
  return descriptor.value;
}

function optionalOwnData(record: Record<string, unknown>, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new InvalidSnapshotError(field);
  return descriptor.value;
}

function ownDataArray(record: Record<string, unknown>, key: string, field: string): readonly unknown[] {
  const value = ownData(record, key, field);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new InvalidSnapshotError(field);
  const keys = Reflect.ownKeys(value);
  if (keys.some((item) => typeof item !== "string" || (item !== "length" && !/^(0|[1-9]\d*)$/u.test(item)))) {
    throw new InvalidSnapshotError(field);
  }
  return value.map((_, index) => ownData(value as unknown as Record<string, unknown>, String(index), field));
}

function atTemplateBoundary<T>(field: string, operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    if (error instanceof DomainError) throw error;
    throw new InvalidSnapshotError(field);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}
