import { types as nodeTypes } from "node:util";
import { createCustomerProfile, createCustomerAddress, validateCustomerAddress,
  type CustomerProfile, type CustomerAddress, type CustomerAddressInput, type CustomerAddressValidation } from "@super-restaurant/domain";
import type { BranchScope } from "@super-restaurant/shared-types";

interface CustomerRecordMetadataV1 {
  readonly schemaVersion: 1;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}
export interface PersistedCustomerProfileRecordV1 extends CustomerRecordMetadataV1 {
  readonly profile: CustomerProfile;
}
export interface PersistedCustomerAddressRecordV1 extends CustomerRecordMetadataV1 {
  readonly address: CustomerAddress;
}
export class CustomerPersistenceCodecError extends Error {
  public constructor() { super("CUSTOMER_PERSISTENCE_RECORD_REJECTED"); this.name = "CustomerPersistenceCodecError"; }
}
const metadataKeys = ["schemaVersion", "version", "createdAt", "updatedAt", "deletedAt"] as const;
const addressKeys = ["addressId", "customerId", "restaurantId", "label", "streetLine", "unit", "neighborhood",
  "locality", "region", "countryCode", "postalCode", "references", "instructions", "coordinates"] as const;

/** Branch is the authorized operation context; profiles belong to Restaurant, not one Branch. */
export function decodeCustomerProfileRecord(value: unknown, authorizedScope: BranchScope): PersistedCustomerProfileRecordV1 {
  try {
    const restaurantId = scopeRestaurant(authorizedScope);
    const record = exact(detach(value), [...metadataKeys, "profile"]);
    const metadata = readMetadata(record);
    const profile = exact(record.profile, ["schemaVersion", "customerId", "restaurantId", "displayName", "phones"]);
    if (profile.schemaVersion !== 1 || canonicalUuid(profile.restaurantId) !== restaurantId) throw rejected();
    canonicalUuid(profile.customerId);
    if (!Array.isArray(profile.phones)) throw rejected();
    const phones = profile.phones.map((value: unknown) => {
      const phone = exact(value, ["contactId", "label", "displayValue", "normalizedValue"]);
      return { contactId: canonicalUuid(phone.contactId), label: phone.label as string, displayValue: phone.displayValue as string };
    });
    const stable = createCustomerProfile({ customerId: profile.customerId as string, restaurantId,
      displayName: profile.displayName as string, phones });
    for (let index = 0; index < stable.phones.length; index++) {
      if (stable.phones[index]!.normalizedValue !== (profile.phones[index] as Record<string, unknown>).normalizedValue) throw rejected();
    }
    return Object.freeze({ ...metadata, profile: stable });
  } catch { throw rejected(); }
}

/** Retains validated directory facts, but does not authorize delivery or resolve customer references. */
export function decodeCustomerAddressRecord(value: unknown, authorizedScope: BranchScope): PersistedCustomerAddressRecordV1 {
  try {
    const restaurantId = scopeRestaurant(authorizedScope);
    const record = exact(detach(value), [...metadataKeys, "address"]);
    const metadata = readMetadata(record);
    const address = exact(record.address, [...addressKeys, "schemaVersion", "validation"]);
    if (address.schemaVersion !== 1 || canonicalUuid(address.restaurantId) !== restaurantId) throw rejected();
    canonicalUuid(address.addressId);
    canonicalUuid(address.customerId);
    const input: Record<string, unknown> = {};
    for (const key of addressKeys) input[key] = address[key];
    let stable = createCustomerAddress(input as unknown as CustomerAddressInput);
    if (address.validation !== null) {
      const validation = exact(address.validation, ["restaurantId", "branchId", "eventId", "actorId", "deviceId", "validatedAt"]);
      for (const key of ["restaurantId", "branchId", "eventId", "actorId", "deviceId"] as const) canonicalUuid(validation[key]);
      const validatedAt = timestamp(validation.validatedAt);
      if (validatedAt < metadata.createdAt || validatedAt > metadata.updatedAt) throw rejected();
      stable = validateCustomerAddress(stable, validation as unknown as CustomerAddressValidation);
    }
    return Object.freeze({ ...metadata, address: stable });
  } catch { throw rejected(); }
}
export function encodeCustomerProfileRecord(value: PersistedCustomerProfileRecordV1, scope: BranchScope): PersistedCustomerProfileRecordV1 {
  return decodeCustomerProfileRecord(value, scope);
}
export function encodeCustomerAddressRecord(value: PersistedCustomerAddressRecordV1, scope: BranchScope): PersistedCustomerAddressRecordV1 {
  return decodeCustomerAddressRecord(value, scope);
}
function readMetadata(record: Record<string, unknown>): CustomerRecordMetadataV1 {
  if (record.schemaVersion !== 1 || typeof record.version !== "number" || !Number.isSafeInteger(record.version) || record.version < 1) throw rejected();
  const createdAt = timestamp(record.createdAt);
  const updatedAt = timestamp(record.updatedAt);
  const deletedAt = record.deletedAt === null ? null : timestamp(record.deletedAt);
  if (updatedAt < createdAt || (deletedAt !== null && (deletedAt < createdAt || deletedAt !== updatedAt))) throw rejected();
  return { schemaVersion: 1, version: record.version, createdAt, updatedAt, deletedAt };
}
function scopeRestaurant(scope: BranchScope): string {
  const stable = exact(detach(scope), ["restaurantId", "branchId"]);
  canonicalUuid(stable.branchId);
  return canonicalUuid(stable.restaurantId);
}
function canonicalUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) throw rejected();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(value).toISOString() !== value) throw rejected();
  return value;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw rejected();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || keys.some(key => !actual.includes(key))) throw rejected();
  return value as Record<string, unknown>;
}
/** Only JSON-compatible own data; proxies/accessors are rejected before traversing their payload. */
function detach(value: unknown, depth = 0): unknown {
  if (depth > 10) throw rejected();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || nodeTypes.isProxy(value)) throw rejected();
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value as unknown;
    if (typeof length !== "number" || length > 20 || Reflect.ownKeys(value).length !== length + 1) throw rejected();
    return Array.from({ length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw rejected();
      return detach(descriptor.value, depth + 1);
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw rejected();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key === "__proto__") throw rejected();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw rejected();
    result[key] = detach(descriptor.value, depth + 1);
  }
  return result;
}
function rejected(): CustomerPersistenceCodecError { return new CustomerPersistenceCodecError(); }
