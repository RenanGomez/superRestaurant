import type { BranchScope } from "./index.js";

export interface CustomerCommandInputV1 {
  readonly schemaVersion: 1;
  readonly scope: BranchScope;
  readonly customerId: string;
  readonly expectedVersion: number;
  readonly eventId: string;
  readonly deviceId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}
export interface CustomerPhoneInputV1 {
  readonly contactId: string;
  readonly label: string;
  readonly displayValue: string;
}
/** Full replacement; normalized phone keys are computed by the server. */
export interface SaveCustomerProfileCommandV1 extends CustomerCommandInputV1 {
  readonly displayName: string;
  readonly phones: readonly CustomerPhoneInputV1[];
}
export interface CustomerAddressFieldsV1 {
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
/** Saving never carries forward address validation; incomplete drafts are allowed. */
export interface SaveCustomerAddressCommandV1 extends CustomerCommandInputV1 {
  readonly addressId: string;
  readonly address: CustomerAddressFieldsV1;
}
/** Actor, validation time and evidence are derived server-side. */
export interface ValidateCustomerAddressCommandV1 extends CustomerCommandInputV1 {
  readonly addressId: string;
}
export interface CustomerPhoneV1 extends CustomerPhoneInputV1 {
  readonly normalizedValue: string;
}
export interface CustomerProfileRecordV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly customerId: string;
  readonly displayName: string;
  readonly phones: readonly CustomerPhoneV1[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}
export interface CustomerAddressValidationV1 {
  readonly branchId: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly validatedAt: string;
}
export interface CustomerAddressRecordV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly customerId: string;
  readonly addressId: string;
  readonly address: CustomerAddressFieldsV1;
  readonly validation: CustomerAddressValidationV1 | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}
export interface CustomerProfileMutationResultV1 {
  readonly schemaVersion: 1;
  readonly record: CustomerProfileRecordV1;
  readonly replayed: boolean;
}
export interface CustomerAddressMutationResultV1 {
  readonly schemaVersion: 1;
  readonly record: CustomerAddressRecordV1;
  readonly replayed: boolean;
}
export const CUSTOMER_SEARCH_MODES = Object.freeze(["phone", "name", "address"] as const);
export type CustomerSearchModeV1 = (typeof CUSTOMER_SEARCH_MODES)[number];
export interface CustomerSearchCursorV1 {
  readonly updatedAt: string;
  readonly customerId: string;
}
export interface SearchCustomerDirectoryQueryV1 {
  readonly schemaVersion: 1;
  readonly scope: BranchScope;
  readonly mode: CustomerSearchModeV1;
  readonly query: string;
  readonly limit: number;
  readonly cursor: CustomerSearchCursorV1 | null;
}
export interface CustomerSearchAddressV1 {
  readonly addressId: string;
  readonly label: string;
  readonly streetLine: string | null;
  readonly neighborhood: string | null;
  readonly locality: string | null;
  readonly version: number;
  readonly validatedForRequestedBranch: boolean;
}
export interface CustomerSearchCandidateV1 {
  readonly customerId: string;
  readonly displayName: string;
  readonly phones: readonly CustomerPhoneInputV1[];
  readonly addresses: readonly CustomerSearchAddressV1[];
  readonly version: number;
  readonly updatedAt: string;
}
export interface CustomerDirectorySearchResultV1 {
  readonly schemaVersion: 1;
  readonly scope: BranchScope;
  readonly candidates: readonly CustomerSearchCandidateV1[];
  readonly nextCursor: CustomerSearchCursorV1 | null;
}
export interface ReadCustomerDirectoryQueryV1 {
  readonly schemaVersion: 1;
  readonly scope: BranchScope;
  readonly customerId: string;
}
export interface CustomerDirectoryDetailAddressV1 {
  readonly addressId: string;
  readonly address: CustomerAddressFieldsV1;
  readonly version: number;
  readonly updatedAt: string;
  readonly validatedForRequestedBranch: boolean;
}
export interface CustomerDirectoryDetailV1 {
  readonly schemaVersion: 1;
  readonly scope: BranchScope;
  readonly customer: Readonly<{
    customerId: string;
    displayName: string;
    phones: readonly CustomerPhoneInputV1[];
    version: number;
    updatedAt: string;
  }>;
  readonly addresses: readonly CustomerDirectoryDetailAddressV1[];
  readonly addressesTruncated: boolean;
}

const commonKeys = ["schemaVersion", "scope", "customerId", "expectedVersion", "eventId", "deviceId", "idempotencyKey", "occurredAt"] as const;
const addressKeys = ["label", "streetLine", "unit", "neighborhood", "locality", "region", "countryCode", "postalCode", "references", "instructions", "coordinates"] as const;

export function parseSaveCustomerProfileCommandV1(value: unknown): SaveCustomerProfileCommandV1 | undefined {
  const fields = record(value, [...commonKeys, "displayName", "phones"]);
  const base = fields === undefined ? undefined : common(fields);
  if (fields === undefined || base === undefined || !text(fields.displayName, 120)) return undefined;
  const items = array(fields.phones);
  if (items === undefined) return undefined;
  const phones: CustomerPhoneInputV1[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    const phone = record(item, ["contactId", "label", "displayValue"]);
    const contactId = phone === undefined ? undefined : uuid(phone.contactId);
    if (phone === undefined || contactId === undefined || ids.has(contactId)
      || !text(phone.label, 40) || !text(phone.displayValue, 80)) return undefined;
    ids.add(contactId);
    phones.push(Object.freeze({ contactId, label: phone.label, displayValue: phone.displayValue }));
  }
  return Object.freeze({ ...base, displayName: fields.displayName, phones: Object.freeze(phones) });
}

export function parseSaveCustomerAddressCommandV1(value: unknown): SaveCustomerAddressCommandV1 | undefined {
  const fields = record(value, [...commonKeys, "addressId", "address"]);
  const base = fields === undefined ? undefined : common(fields);
  const addressId = fields === undefined ? undefined : uuid(fields.addressId);
  const address = fields === undefined ? undefined : parseAddressFields(fields.address);
  return base === undefined || addressId === undefined || address === undefined
    ? undefined : Object.freeze({ ...base, addressId, address });
}

export function parseValidateCustomerAddressCommandV1(value: unknown): ValidateCustomerAddressCommandV1 | undefined {
  const fields = record(value, [...commonKeys, "addressId"]);
  const base = fields === undefined ? undefined : common(fields);
  const addressId = fields === undefined ? undefined : uuid(fields.addressId);
  // Validation can only target an existing version, never create an address.
  return base === undefined || addressId === undefined || base.expectedVersion === 0
    ? undefined : Object.freeze({ ...base, addressId });
}

export function parseCustomerProfileMutationResultV1(value: unknown): CustomerProfileMutationResultV1 | undefined {
  const fields = record(value, ["schemaVersion", "record", "replayed"]);
  const parsed = fields === undefined ? undefined : parseCustomerProfileRecordV1(fields.record);
  return fields === undefined || fields.schemaVersion !== 1 || typeof fields.replayed !== "boolean" || parsed === undefined
    ? undefined : Object.freeze({ schemaVersion: 1, record: parsed, replayed: fields.replayed });
}

export function parseCustomerAddressMutationResultV1(value: unknown): CustomerAddressMutationResultV1 | undefined {
  const fields = record(value, ["schemaVersion", "record", "replayed"]);
  const parsed = fields === undefined ? undefined : parseCustomerAddressRecordV1(fields.record);
  return fields === undefined || fields.schemaVersion !== 1 || typeof fields.replayed !== "boolean" || parsed === undefined
    ? undefined : Object.freeze({ schemaVersion: 1, record: parsed, replayed: fields.replayed });
}

export function parseSearchCustomerDirectoryQueryV1(value: unknown): SearchCustomerDirectoryQueryV1 | undefined {
  const fields = record(value, ["schemaVersion", "scope", "mode", "query", "limit", "cursor"]);
  const scope = fields === undefined ? undefined : parseScope(fields.scope);
  const mode = fields !== undefined && typeof fields.mode === "string" && CUSTOMER_SEARCH_MODES.includes(fields.mode as CustomerSearchModeV1)
    ? fields.mode as CustomerSearchModeV1 : undefined;
  if (fields === undefined || fields.schemaVersion !== 1 || scope === undefined || mode === undefined
    || !integer(fields.limit, 1, 20) || !text(fields.query, mode === "address" ? 200 : 120)
    || (mode === "phone" && normalizePhone(fields.query) === undefined)) return undefined;
  const cursor = fields.cursor === null ? null : parseSearchCursor(fields.cursor);
  return cursor === undefined ? undefined : Object.freeze({ schemaVersion: 1, scope, mode, query: fields.query, limit: fields.limit, cursor });
}

export function parseCustomerDirectorySearchResultV1(value: unknown): CustomerDirectorySearchResultV1 | undefined {
  const fields = record(value, ["schemaVersion", "scope", "candidates", "nextCursor"]);
  const scope = fields === undefined ? undefined : parseScope(fields.scope);
  const items = fields === undefined ? undefined : boundedArray(fields.candidates, 20);
  const nextCursor = fields?.nextCursor === null ? null : parseSearchCursor(fields?.nextCursor);
  if (fields === undefined || fields.schemaVersion !== 1 || scope === undefined || items === undefined || nextCursor === undefined) return undefined;
  const candidates: CustomerSearchCandidateV1[] = [];
  const customerIds = new Set<string>();
  for (const item of items) {
    const candidate = parseSearchCandidate(item);
    if (candidate === undefined || customerIds.has(candidate.customerId)) return undefined;
    const previous = candidates.at(-1);
    if (previous !== undefined && (candidate.updatedAt > previous.updatedAt
      || (candidate.updatedAt === previous.updatedAt && candidate.customerId <= previous.customerId))) return undefined;
    customerIds.add(candidate.customerId);
    candidates.push(candidate);
  }
  if (nextCursor !== null && (candidates.length === 0 || nextCursor.customerId !== candidates.at(-1)?.customerId
    || nextCursor.updatedAt !== candidates.at(-1)?.updatedAt)) return undefined;
  return Object.freeze({ schemaVersion: 1, scope, candidates: Object.freeze(candidates), nextCursor });
}

export function parseReadCustomerDirectoryQueryV1(value: unknown): ReadCustomerDirectoryQueryV1 | undefined {
  const fields = record(value, ["schemaVersion", "scope", "customerId"]);
  const scope = fields === undefined ? undefined : parseScope(fields.scope);
  const customerId = fields === undefined ? undefined : uuid(fields.customerId);
  return fields === undefined || fields.schemaVersion !== 1 || scope === undefined || customerId === undefined
    ? undefined : Object.freeze({ schemaVersion: 1, scope, customerId });
}

export function parseCustomerDirectoryDetailV1(value: unknown): CustomerDirectoryDetailV1 | undefined {
  const fields = record(value, ["schemaVersion", "scope", "customer", "addresses", "addressesTruncated"]);
  const scope = fields === undefined ? undefined : parseScope(fields.scope);
  const customerFields = fields === undefined ? undefined
    : record(fields.customer, ["customerId", "displayName", "phones", "version", "updatedAt"]);
  const customerId = customerFields === undefined ? undefined : uuid(customerFields.customerId);
  const phoneItems = customerFields === undefined ? undefined : boundedArray(customerFields.phones, 20);
  const addressItems = fields === undefined ? undefined : boundedArray(fields.addresses, 20);
  if (fields === undefined || fields.schemaVersion !== 1 || scope === undefined || customerFields === undefined
    || customerId === undefined || !text(customerFields.displayName, 120)
    || !integer(customerFields.version, 1, Number.MAX_SAFE_INTEGER) || !timestamp(customerFields.updatedAt)
    || phoneItems === undefined || addressItems === undefined || typeof fields.addressesTruncated !== "boolean"
    || (fields.addressesTruncated && addressItems.length !== 20)) return undefined;
  const phones = parseDisplayPhones(phoneItems);
  if (phones === undefined) return undefined;
  const addresses: CustomerDirectoryDetailAddressV1[] = [];
  const addressIds = new Set<string>();
  for (const item of addressItems) {
    const addressFields = record(item, ["addressId", "address", "version", "updatedAt", "validatedForRequestedBranch"]);
    const addressId = addressFields === undefined ? undefined : uuid(addressFields.addressId);
    const address = addressFields === undefined ? undefined : parseAddressFields(addressFields.address);
    if (addressFields === undefined || addressId === undefined || address === undefined || addressIds.has(addressId)
      || !integer(addressFields.version, 1, Number.MAX_SAFE_INTEGER) || !timestamp(addressFields.updatedAt)
      || typeof addressFields.validatedForRequestedBranch !== "boolean") return undefined;
    if (addressFields.validatedForRequestedBranch
      && (address.streetLine === null || address.locality === null || address.countryCode === null)) return undefined;
    addressIds.add(addressId);
    addresses.push(Object.freeze({ addressId, address, version: addressFields.version,
      updatedAt: addressFields.updatedAt, validatedForRequestedBranch: addressFields.validatedForRequestedBranch }));
  }
  const customer = Object.freeze({ customerId, displayName: customerFields.displayName,
    phones, version: customerFields.version, updatedAt: customerFields.updatedAt });
  return Object.freeze({ schemaVersion: 1, scope, customer, addresses: Object.freeze(addresses),
    addressesTruncated: fields.addressesTruncated });
}

export function parseCustomerProfileRecordV1(value: unknown): CustomerProfileRecordV1 | undefined {
  const fields = record(value, ["schemaVersion", "restaurantId", "customerId", "displayName", "phones", "version", "createdAt", "updatedAt", "deletedAt"]);
  const restaurantId = fields === undefined ? undefined : uuid(fields.restaurantId);
  const customerId = fields === undefined ? undefined : uuid(fields.customerId);
  const metadata = fields === undefined ? undefined : metadataFields(fields);
  const items = fields === undefined ? undefined : array(fields.phones);
  if (fields === undefined || fields.schemaVersion !== 1 || restaurantId === undefined || customerId === undefined
    || !text(fields.displayName, 120) || metadata === undefined || items === undefined) return undefined;
  const phones: CustomerPhoneV1[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    const phone = record(item, ["contactId", "label", "displayValue", "normalizedValue"]);
    const contactId = phone === undefined ? undefined : uuid(phone.contactId);
    if (phone === undefined || contactId === undefined || ids.has(contactId) || !text(phone.label, 40)
      || !text(phone.displayValue, 80) || normalizePhone(phone.displayValue) !== phone.normalizedValue) return undefined;
    ids.add(contactId);
    phones.push(Object.freeze({ contactId, label: phone.label, displayValue: phone.displayValue,
      normalizedValue: phone.normalizedValue as string }));
  }
  return Object.freeze({ schemaVersion: 1, restaurantId, customerId, displayName: fields.displayName,
    phones: Object.freeze(phones), ...metadata });
}

export function parseCustomerAddressRecordV1(value: unknown): CustomerAddressRecordV1 | undefined {
  const fields = record(value, ["schemaVersion", "restaurantId", "customerId", "addressId", "address", "validation", "version", "createdAt", "updatedAt", "deletedAt"]);
  const restaurantId = fields === undefined ? undefined : uuid(fields.restaurantId);
  const customerId = fields === undefined ? undefined : uuid(fields.customerId);
  const addressId = fields === undefined ? undefined : uuid(fields.addressId);
  const metadata = fields === undefined ? undefined : metadataFields(fields);
  const address = fields === undefined ? undefined : parseAddressFields(fields.address);
  if (fields === undefined || fields.schemaVersion !== 1 || restaurantId === undefined || customerId === undefined
    || addressId === undefined || metadata === undefined || address === undefined) return undefined;
  let validation: CustomerAddressValidationV1 | null = null;
  if (fields.validation !== null) {
    const evidence = record(fields.validation, ["branchId", "eventId", "actorId", "deviceId", "validatedAt"]);
    const branchId = evidence === undefined ? undefined : uuid(evidence.branchId);
    const eventId = evidence === undefined ? undefined : uuid(evidence.eventId);
    const actorId = evidence === undefined ? undefined : uuid(evidence.actorId);
    const deviceId = evidence === undefined ? undefined : uuid(evidence.deviceId);
    if (evidence === undefined || branchId === undefined || eventId === undefined || actorId === undefined
      || deviceId === undefined || !timestamp(evidence.validatedAt) || evidence.validatedAt > metadata.updatedAt
      || address.streetLine === null || address.locality === null || address.countryCode === null) return undefined;
    validation = Object.freeze({ branchId, eventId, actorId, deviceId, validatedAt: evidence.validatedAt });
  }
  return Object.freeze({ schemaVersion: 1, restaurantId, customerId, addressId, address, validation, ...metadata });
}

function common(fields: Record<string, unknown>): CustomerCommandInputV1 | undefined {
  const scope = parseScope(fields.scope);
  const customerId = uuid(fields.customerId);
  const eventId = uuid(fields.eventId);
  const deviceId = uuid(fields.deviceId);
  const idempotencyKey = uuid(fields.idempotencyKey);
  if (fields.schemaVersion !== 1 || scope === undefined
    || customerId === undefined || eventId === undefined || deviceId === undefined || idempotencyKey === undefined
    || !integer(fields.expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1) || !timestamp(fields.occurredAt)) return undefined;
  return Object.freeze({ schemaVersion: 1, scope,
    customerId, eventId, deviceId, idempotencyKey, expectedVersion: fields.expectedVersion, occurredAt: fields.occurredAt });
}
function parseScope(value: unknown): BranchScope | undefined {
  const fields = record(value, ["restaurantId", "branchId"]);
  const restaurantId = fields === undefined ? undefined : uuid(fields.restaurantId);
  const branchId = fields === undefined ? undefined : uuid(fields.branchId);
  return restaurantId === undefined || branchId === undefined ? undefined
    : Object.freeze({ restaurantId, branchId }) as BranchScope;
}
function parseSearchCursor(value: unknown): CustomerSearchCursorV1 | undefined {
  const fields = record(value, ["updatedAt", "customerId"]);
  const customerId = fields === undefined ? undefined : uuid(fields.customerId);
  return fields === undefined || customerId === undefined || !timestamp(fields.updatedAt) ? undefined
    : Object.freeze({ updatedAt: fields.updatedAt, customerId });
}
function parseSearchCandidate(value: unknown): CustomerSearchCandidateV1 | undefined {
  const fields = record(value, ["customerId", "displayName", "phones", "addresses", "version", "updatedAt"]);
  const customerId = fields === undefined ? undefined : uuid(fields.customerId);
  const phoneItems = fields === undefined ? undefined : boundedArray(fields.phones, 20);
  const addressItems = fields === undefined ? undefined : boundedArray(fields.addresses, 20);
  if (fields === undefined || customerId === undefined || !text(fields.displayName, 120)
    || !integer(fields.version, 1, Number.MAX_SAFE_INTEGER) || !timestamp(fields.updatedAt)
    || phoneItems === undefined || addressItems === undefined) return undefined;
  const phones = parseDisplayPhones(phoneItems);
  if (phones === undefined) return undefined;
  const addresses: CustomerSearchAddressV1[] = [];
  const addressIds = new Set<string>();
  for (const item of addressItems) {
    const address = record(item, ["addressId", "label", "streetLine", "neighborhood", "locality", "version", "validatedForRequestedBranch"]);
    const addressId = address === undefined ? undefined : uuid(address.addressId);
    if (address === undefined || addressId === undefined || addressIds.has(addressId) || !text(address.label, 40)
      || !integer(address.version, 1, Number.MAX_SAFE_INTEGER) || typeof address.validatedForRequestedBranch !== "boolean") return undefined;
    for (const key of ["streetLine", "neighborhood", "locality"] as const) {
      if (address[key] !== null && !text(address[key], 200)) return undefined;
    }
    addressIds.add(addressId);
    addresses.push(Object.freeze({ addressId, label: address.label, streetLine: address.streetLine as string | null,
      neighborhood: address.neighborhood as string | null, locality: address.locality as string | null,
      version: address.version, validatedForRequestedBranch: address.validatedForRequestedBranch }));
  }
  return Object.freeze({ customerId, displayName: fields.displayName, phones: Object.freeze(phones),
    addresses: Object.freeze(addresses), version: fields.version, updatedAt: fields.updatedAt });
}
function parseDisplayPhones(items: readonly unknown[]): readonly CustomerPhoneInputV1[] | undefined {
  const phones: CustomerPhoneInputV1[] = [];
  const contactIds = new Set<string>();
  for (const item of items) {
    const phone = record(item, ["contactId", "label", "displayValue"]);
    const contactId = phone === undefined ? undefined : uuid(phone.contactId);
    if (phone === undefined || contactId === undefined || contactIds.has(contactId) || !text(phone.label, 40)
      || !text(phone.displayValue, 80) || normalizePhone(phone.displayValue) === undefined) return undefined;
    contactIds.add(contactId);
    phones.push(Object.freeze({ contactId, label: phone.label, displayValue: phone.displayValue }));
  }
  return Object.freeze(phones);
}
function metadataFields(fields: Record<string, unknown>): Readonly<{ version: number; createdAt: string; updatedAt: string; deletedAt: string | null }> | undefined {
  if (!integer(fields.version, 1, Number.MAX_SAFE_INTEGER) || !timestamp(fields.createdAt) || !timestamp(fields.updatedAt)
    || fields.updatedAt < fields.createdAt) return undefined;
  const deletedAt = fields.deletedAt === null ? null : timestamp(fields.deletedAt) ? fields.deletedAt : undefined;
  if (deletedAt === undefined || (deletedAt !== null && deletedAt !== fields.updatedAt)) return undefined;
  return Object.freeze({ version: fields.version, createdAt: fields.createdAt, updatedAt: fields.updatedAt, deletedAt });
}
function parseAddressFields(value: unknown): CustomerAddressFieldsV1 | undefined {
  const fields = record(value, addressKeys);
  if (fields === undefined || !text(fields.label, 40)) return undefined;
  for (const key of ["streetLine", "unit", "neighborhood", "locality", "region", "postalCode", "references", "instructions"] as const) {
    if (fields[key] !== null && !text(fields[key], key === "references" || key === "instructions" ? 500 : 200)) return undefined;
  }
  if (fields.countryCode !== null && (typeof fields.countryCode !== "string" || !/^[A-Z]{2}$/u.test(fields.countryCode))) return undefined;
  let coordinates: CustomerAddressFieldsV1["coordinates"] = null;
  if (fields.coordinates !== null) {
    const point = record(fields.coordinates, ["latitudeE6", "longitudeE6"]);
    if (point === undefined || !integer(point.latitudeE6, -90_000_000, 90_000_000)
      || !integer(point.longitudeE6, -180_000_000, 180_000_000)) return undefined;
    coordinates = Object.freeze({ latitudeE6: point.latitudeE6, longitudeE6: point.longitudeE6 });
  }
  return Object.freeze({ ...fields, coordinates }) as unknown as CustomerAddressFieldsV1;
}
function normalizePhone(value: unknown): string | undefined {
  if (!text(value, 80) || !/^[+0-9 ().-]+$/u.test(value)) return undefined;
  const normalized = value.replace(/[ ().-]/gu, "");
  return /^\+?[0-9]{1,20}$/u.test(normalized) ? normalized : undefined;
}
function uuid(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value) ? value.toLowerCase() : undefined;
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some(key => !ownKeys.includes(key))) return undefined;
    const stable: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      stable[key] = descriptor.value;
    }
    return stable;
  } catch { return undefined; }
}
function array(value: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value as unknown;
    if (!integer(length, 0, 20) || Reflect.ownKeys(value).length !== length + 1) return undefined;
    const stable: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      stable.push(descriptor.value);
    }
    return stable;
  } catch { return undefined; }
}
function boundedArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  const values = array(value);
  return values !== undefined && values.length <= maximum ? values : undefined;
}
