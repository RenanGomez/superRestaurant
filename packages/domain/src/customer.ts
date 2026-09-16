import { DomainError } from "./errors.js";

export interface CustomerPhoneInput {
  readonly contactId: string;
  readonly label: string;
  readonly displayValue: string;
}
export interface CustomerPhone {
  readonly contactId: string;
  readonly label: string;
  readonly displayValue: string;
  readonly normalizedValue: string;
}
export interface CustomerProfileInput {
  readonly customerId: string;
  readonly restaurantId: string;
  readonly displayName: string;
  readonly phones: readonly CustomerPhoneInput[];
}
export interface CustomerProfile {
  readonly schemaVersion: 1;
  readonly customerId: string;
  readonly restaurantId: string;
  readonly displayName: string;
  readonly phones: readonly CustomerPhone[];
}
export interface CustomerPartySnapshot {
  readonly schemaVersion: 1;
  readonly customerId: string;
  readonly restaurantId: string;
  readonly displayName: string;
  readonly contactId: string;
  readonly phoneDisplayValue: string;
  readonly phoneNormalizedValue: string;
}
export interface CustomerAddressInput {
  readonly addressId: string;
  readonly customerId: string;
  readonly restaurantId: string;
  readonly label: string;
  readonly streetLine: string | null;
  readonly unit: string | null;
  readonly neighborhood: string | null;
  readonly locality: string | null;
  readonly region: string | null;
  readonly countryCode: string | null;
  readonly postalCode: string | null;
  readonly references: string | null;
  readonly instructions: string | null;
  readonly coordinates: Readonly<{ latitudeE6: number; longitudeE6: number }> | null;
}
export interface CustomerAddressValidation {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly validatedAt: string;
}
export interface CustomerAddress extends CustomerAddressInput {
  readonly schemaVersion: 1;
  readonly validation: CustomerAddressValidation | null;
}
export interface CustomerFulfillmentSnapshot extends CustomerAddressInput {
  readonly schemaVersion: 1;
  readonly validation: CustomerAddressValidation;
}
const addressKeys = ["addressId", "customerId", "restaurantId", "label", "streetLine", "unit",
  "neighborhood", "locality", "region", "countryCode", "postalCode", "references", "instructions", "coordinates"] as const;
const validationKeys = ["restaurantId", "branchId", "eventId", "actorId", "deviceId", "validatedAt"] as const;
export class InvalidCustomerProfileError extends DomainError {
  public readonly code = "INVALID_CUSTOMER_PROFILE";
  public constructor(public readonly field: string) { super("The customer profile is invalid."); }
}
export class CustomerScopeRejectedError extends DomainError {
  public readonly code = "CUSTOMER_SCOPE_REJECTED";
  public constructor() { super("The customer does not belong to the authorized restaurant."); }
}

/** Formatting-only search key, not verification of dialability, ownership or country. */
export function normalizeCustomerPhone(displayValue: string): string {
  text(displayValue, "phone", 80);
  if (!/^[+0-9 ().-]+$/u.test(displayValue)) throw invalid("phone");
  const normalized = displayValue.replace(/[ ().-]/gu, "");
  if (!/^\+?[0-9]{1,20}$/u.test(normalized)) throw invalid("phone");
  // Keep an explicit + and all digits; never guess a country code or strip leading zeroes.
  return normalized;
}

export function createCustomerProfile(input: CustomerProfileInput): CustomerProfile {
  const fields = record(input, ["customerId", "restaurantId", "displayName", "phones"]);
  text(fields.customerId, "customerId", 200);
  text(fields.restaurantId, "restaurantId", 200);
  text(fields.displayName, "displayName", 120);
  const phoneInputs = arrayValues(fields.phones);
  const phones: CustomerPhone[] = [];
  const ids = new Set<string>();
  // Snapshot array elements without invoking accessors on untrusted inputs.
  for (const phoneInput of phoneInputs) {
    const phone = createPhone(phoneInput as CustomerPhoneInput);
    if (ids.has(phone.contactId)) throw invalid("contactId");
    ids.add(phone.contactId);
    phones.push(phone);
  }
  return Object.freeze({ schemaVersion: 1, customerId: fields.customerId, restaurantId: fields.restaurantId,
    displayName: fields.displayName, phones: Object.freeze(phones) });
}

/** Minimal immutable party facts selected explicitly; directory edits cannot change history. */
export function snapshotCustomerParty(profile: CustomerProfile, authorizedRestaurantId: string, contactId: string): CustomerPartySnapshot {
  const fields = record(profile, ["schemaVersion", "customerId", "restaurantId", "displayName", "phones"]);
  if (fields.schemaVersion !== 1) throw invalid("schemaVersion");
  text(authorizedRestaurantId, "restaurantId", 200);
  if (fields.restaurantId !== authorizedRestaurantId) throw new CustomerScopeRejectedError();
  text(contactId, "contactId", 200);
  const phoneInputs = arrayValues(fields.phones);
  const inputs: CustomerPhoneInput[] = [];
  for (const phoneInput of phoneInputs) {
    const phone = record(phoneInput, ["contactId", "label", "displayValue", "normalizedValue"]);
    const stable = createPhone({ contactId: phone.contactId as string, label: phone.label as string, displayValue: phone.displayValue as string });
    if (phone.normalizedValue !== stable.normalizedValue) throw invalid("normalizedValue");
    inputs.push({ contactId: stable.contactId, label: stable.label, displayValue: stable.displayValue });
  }
  const stable = createCustomerProfile({ customerId: fields.customerId as string, restaurantId: authorizedRestaurantId,
    displayName: fields.displayName as string, phones: inputs });
  const selected = stable.phones.find((phone) => phone.contactId === contactId);
  if (selected === undefined) throw invalid("contactId");
  return Object.freeze({ schemaVersion: 1, customerId: stable.customerId, restaurantId: stable.restaurantId,
    displayName: stable.displayName, contactId: selected.contactId,
    phoneDisplayValue: selected.displayValue, phoneNormalizedValue: selected.normalizedValue });
}

/** Saving/editing a directory address always leaves it unverified, even with coordinates. */
export function createCustomerAddress(input: CustomerAddressInput): CustomerAddress {
  const fields = record(input, addressKeys);
  for (const key of ["addressId", "customerId", "restaurantId"] as const) text(fields[key], key, 200);
  text(fields.label, "label", 40);
  for (const key of ["streetLine", "unit", "neighborhood", "locality", "region", "postalCode"] as const) {
    if (fields[key] !== null) text(fields[key], key, 200);
  }
  for (const key of ["references", "instructions"] as const) {
    if (fields[key] !== null) text(fields[key], key, 500);
  }
  if (fields.countryCode !== null && (typeof fields.countryCode !== "string" || !/^[A-Z]{2}$/u.test(fields.countryCode))) throw invalid("countryCode");
  if (fields.coordinates !== null) {
    const coordinates = record(fields.coordinates, ["latitudeE6", "longitudeE6"]);
    if (typeof coordinates.latitudeE6 !== "number" || !Number.isSafeInteger(coordinates.latitudeE6)
      || Math.abs(coordinates.latitudeE6) > 90_000_000
      || typeof coordinates.longitudeE6 !== "number" || !Number.isSafeInteger(coordinates.longitudeE6)
      || Math.abs(coordinates.longitudeE6) > 180_000_000) throw invalid("coordinates");
    fields.coordinates = Object.freeze({ latitudeE6: coordinates.latitudeE6, longitudeE6: coordinates.longitudeE6 });
  }
  return Object.freeze({ ...fields, schemaVersion: 1, validation: null }) as unknown as CustomerAddress;
}

/** Pure operator attestation. API must supply authenticated actor, scope and server timestamp. */
export function validateCustomerAddress(address: CustomerAddress, context: CustomerAddressValidation): CustomerAddress {
  const stable = readAddress(address);
  const validation = readAddressValidation(context);
  if (stable.restaurantId !== validation.restaurantId) throw new CustomerScopeRejectedError();
  if (stable.streetLine === null || stable.locality === null || stable.countryCode === null) throw invalid("addressIncomplete");
  return Object.freeze({ ...stable, validation });
}

/** Freeze the explicitly selected customer's validated address, never current catalog references. */
export function snapshotCustomerFulfillment(address: CustomerAddress, party: CustomerPartySnapshot, authorizedRestaurantId: string, authorizedBranchId: string): CustomerFulfillmentSnapshot {
  const fields = record(address, [...addressKeys, "schemaVersion", "validation"]);
  const partyFields = record(party, ["schemaVersion", "customerId", "restaurantId", "displayName", "contactId", "phoneDisplayValue", "phoneNormalizedValue"]);
  text(authorizedRestaurantId, "restaurantId", 200);
  text(authorizedBranchId, "branchId", 200);
  if (fields.restaurantId !== authorizedRestaurantId || partyFields.restaurantId !== authorizedRestaurantId
    || fields.customerId !== partyFields.customerId) throw new CustomerScopeRejectedError();
  if (partyFields.schemaVersion !== 1) throw invalid("schemaVersion");
  for (const key of ["customerId", "contactId"] as const) text(partyFields[key], key, 200);
  text(partyFields.displayName, "displayName", 120);
  text(partyFields.phoneDisplayValue, "phone", 80);
  if (normalizeCustomerPhone(partyFields.phoneDisplayValue) !== partyFields.phoneNormalizedValue) throw invalid("normalizedValue");
  if (fields.validation === null) throw invalid("addressUnverified");
  const stable = validateCustomerAddress(address, readAddressValidation(fields.validation));
  const validation = readAddressValidation(fields.validation);
  if (validation.branchId !== authorizedBranchId) throw new CustomerScopeRejectedError();
  return Object.freeze({ ...stable, validation });
}

function readAddress(value: CustomerAddress): CustomerAddress {
  const fields = record(value, [...addressKeys, "schemaVersion", "validation"]);
  if (fields.schemaVersion !== 1) throw invalid("schemaVersion");
  const input: Record<string, unknown> = {};
  for (const key of addressKeys) input[key] = fields[key];
  return createCustomerAddress(input as unknown as CustomerAddressInput);
}
function readAddressValidation(value: unknown): CustomerAddressValidation {
  const fields = record(value, validationKeys);
  for (const key of validationKeys) text(fields[key], key, 200);
  const timestamp = fields.validatedAt;
  if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp)) throw invalid("validatedAt");
  try { if (new Date(timestamp).toISOString() !== timestamp) throw invalid("validatedAt"); }
  catch { throw invalid("validatedAt"); }
  return Object.freeze({ ...fields }) as unknown as CustomerAddressValidation;
}

function createPhone(input: CustomerPhoneInput): CustomerPhone {
  const fields = record(input, ["contactId", "label", "displayValue"]);
  text(fields.contactId, "contactId", 200);
  text(fields.label, "label", 40);
  text(fields.displayValue, "phone", 80);
  return Object.freeze({ contactId: fields.contactId, label: fields.label, displayValue: fields.displayValue,
    normalizedValue: normalizeCustomerPhone(fields.displayValue) });
}
function text(value: unknown, field: string, limit: number): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > limit || value !== value.trim()
    || /[\p{Cc}\p{Cf}]/u.test(value)) throw invalid(field);
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid("record");
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || keys.some((key) => !own.includes(key))) throw invalid("record");
    const detached: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw invalid("record");
      detached[key] = descriptor.value;
    }
    return detached;
  } catch { throw invalid("record"); }
}
function invalid(field: string): InvalidCustomerProfileError { return new InvalidCustomerProfileError(field); }
function arrayValues(value: unknown): readonly unknown[] {
  try {
    if (!Array.isArray(value)) throw invalid("phones");
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) throw invalid("phones");
    const length: unknown = lengthDescriptor.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 20) throw invalid("phones");
    const detached: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) throw invalid("phones");
      detached.push(descriptor.value);
    }
    return Object.freeze(detached);
  } catch { throw invalid("phones"); }
}
