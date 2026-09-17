import { parseSaveCustomerProfileCommandV1, parseSaveCustomerAddressCommandV1, parseValidateCustomerAddressCommandV1,
  parseCustomerProfileMutationResultV1, parseCustomerAddressMutationResultV1,
  parseSearchCustomerDirectoryQueryV1, parseCustomerDirectorySearchResultV1,
  parseReadCustomerDirectoryQueryV1, parseCustomerDirectoryDetailV1 } from "./index.js";

const expect = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
const id = "abcdef01-2345-4678-9abc-0123456789ab";
const base = { schemaVersion: 1, scope: { restaurantId: id, branchId: id }, customerId: id,
  eventId: id, deviceId: id, idempotencyKey: id, expectedVersion: 0, occurredAt: "2026-09-16T10:00:00.000Z" };
const phone = { contactId: id, label: "Casa", displayValue: "+52 (642) 123-4567" };
const profile = { ...base, displayName: "Ana", phones: [phone] };
const parsed = parseSaveCustomerProfileCommandV1(profile);
expect(parsed !== undefined && Object.isFrozen(parsed) && Object.isFrozen(parsed.scope)
  && Object.isFrozen(parsed.phones) && Object.isFrozen(parsed.phones[0]), "detached frozen profile");
phone.label = "Edited";
expect(parsed?.phones[0]?.label === "Casa", "input edits do not change parsed contact");
expect(parseSaveCustomerProfileCommandV1({ ...profile, customerId: id.toUpperCase() })?.customerId === id, "UUID canonicalization");
expect(parseSaveCustomerProfileCommandV1({ ...profile, phones: [] }) !== undefined, "customer without contact allowed in draft");
expect(parseSaveCustomerProfileCommandV1({ ...profile, phones: [phone, { ...phone, contactId: id.toUpperCase() }] }) === undefined, "canonical duplicate contact IDs rejected");
for (const extra of [{ actorId: id }, { restaurantId: id }, { normalizedValue: "123" }, { version: 1 }]) {
  expect(parseSaveCustomerProfileCommandV1({ ...profile, ...extra }) === undefined, "extra authority fields rejected");
}
expect(parseSaveCustomerProfileCommandV1({ ...profile, phones: [{ ...phone, normalizedValue: "123" }] }) === undefined, "server normalization cannot be supplied");
for (const expectedVersion of [-1, 0.5, Number.MAX_SAFE_INTEGER, Infinity]) {
  expect(parseSaveCustomerProfileCommandV1({ ...profile, expectedVersion }) === undefined, "incrementable CAS version");
}
for (const occurredAt of ["infinity", "2026-02-30T10:00:00.000Z", "2026-09-16T10:00:00Z"]) {
  expect(parseSaveCustomerProfileCommandV1({ ...profile, occurredAt }) === undefined, "canonical real UTC date");
}
expect(parseSaveCustomerProfileCommandV1({ ...profile, scope: { ...base.scope, branchId: "bad" } }) === undefined, "exact UUID scope");
const address = { label: "Casa", streetLine: null, unit: null, neighborhood: null, locality: null,
  region: null, countryCode: null, postalCode: null, references: null, instructions: null,
  coordinates: { latitudeE6: 27_000_000, longitudeE6: -109_000_000 } };
const command = { ...base, addressId: id, address };
const saved = parseSaveCustomerAddressCommandV1(command);
expect(saved !== undefined && Object.isFrozen(saved.address) && Object.isFrozen(saved.address.coordinates), "incomplete address parses with detached coordinates");
address.coordinates.latitudeE6 = 0;
expect(saved?.address.coordinates?.latitudeE6 === 27_000_000, "point detached");
for (const extra of [{ validation: null }, { validatedAt: base.occurredAt }, { validated: true }, { actorId: id }]) {
  expect(parseSaveCustomerAddressCommandV1({ ...command, address: { ...address, ...extra } }) === undefined, "address authority extras rejected");
}
for (const coordinates of [{ latitudeE6: 90_000_001, longitudeE6: 0 }, { latitudeE6: 0, longitudeE6: -180_000_001 }, { latitudeE6: 0.5, longitudeE6: 0 }]) {
  expect(parseSaveCustomerAddressCommandV1({ ...command, address: { ...address, coordinates } }) === undefined, "invalid point");
}
expect(parseSaveCustomerAddressCommandV1({ ...command, address: { ...address, countryCode: "mx" } }) === undefined, "country syntax");
expect(parseSaveCustomerAddressCommandV1({ ...command, address: { ...address, instructions: "private\n" } }) === undefined, "control characters rejected");
expect(parseValidateCustomerAddressCommandV1({ ...base, addressId: id }) === undefined, "validate cannot create");
const validation = { ...base, expectedVersion: 1, addressId: id };
expect(parseValidateCustomerAddressCommandV1(validation) !== undefined, "explicit versioned validation command");
expect(parseValidateCustomerAddressCommandV1({ ...validation, validatedAt: base.occurredAt }) === undefined, "no client validation timestamp");
let invoked = false;
const accessor = { ...profile };
Object.defineProperty(accessor, "displayName", { enumerable: true, get: () => { invoked = true; return "private"; } });
expect(parseSaveCustomerProfileCommandV1(accessor) === undefined && !invoked, "no accessor execution");
expect(parseSaveCustomerProfileCommandV1(new Proxy(profile, { ownKeys: () => { throw new Error("private"); } })) === undefined, "hostile proxy sanitized");
expect(parseSaveCustomerProfileCommandV1({ ...profile, phones: new Array(1) }) === undefined, "sparse array");
expect(parseSaveCustomerProfileCommandV1({ ...profile, phones: new Proxy([phone], { getOwnPropertyDescriptor: () => { throw new Error("private"); } }) }) === undefined, "hostile array sanitized");
const point = { ...address.coordinates };
Object.defineProperty(point, "latitudeE6", { enumerable: true, get: () => { invoked = true; return 0; } });
expect(parseSaveCustomerAddressCommandV1({ ...command, address: { ...address, coordinates: point } }) === undefined && !invoked, "no point getter execution");

const metadata = { schemaVersion: 1, restaurantId: id, customerId: id, version: 1,
  createdAt: base.occurredAt, updatedAt: base.occurredAt, deletedAt: null };
const profileRecord = { ...metadata, displayName: "Ana", phones: [{ ...phone, normalizedValue: "+526421234567" }] };
const profileResult = parseCustomerProfileMutationResultV1({ schemaVersion: 1, record: profileRecord, replayed: false });
expect(profileResult !== undefined && Object.isFrozen(profileResult.record.phones[0])
  && Object.isFrozen(profileResult.record.phones), "profile result is deeply frozen");
expect(parseCustomerProfileMutationResultV1({ schemaVersion: 1, record: { ...profileRecord,
  phones: [{ ...profileRecord.phones[0], normalizedValue: "526421234567" }] }, replayed: false }) === undefined,
"derived phone mismatch rejected");
expect(parseCustomerProfileMutationResultV1({ schemaVersion: 1, record: { ...profileRecord,
  phones: [profileRecord.phones[0], { ...profileRecord.phones[0], contactId: id.toUpperCase() }] }, replayed: false }) === undefined,
"canonical duplicate result contacts rejected");
for (const change of [{ version: 0 }, { updatedAt: "2026-09-15T10:00:00.000Z" },
  { deletedAt: "2026-09-17T10:00:00.000Z" }, { extra: true }]) {
  expect(parseCustomerProfileMutationResultV1({ schemaVersion: 1, record: { ...profileRecord, ...change }, replayed: false }) === undefined,
    "profile result metadata rejected");
}
const addressRecord = { ...metadata, addressId: id, address: { ...address, streetLine: "Uno 10", locality: "Navojoa", countryCode: "MX",
  coordinates: { latitudeE6: 27_000_000, longitudeE6: -109_000_000 } },
  validation: { branchId: id, eventId: id, actorId: id, deviceId: id, validatedAt: base.occurredAt } };
const addressResult = parseCustomerAddressMutationResultV1({ schemaVersion: 1, record: addressRecord, replayed: true });
expect(addressResult !== undefined && addressResult.replayed && Object.isFrozen(addressResult.record.address.coordinates)
  && Object.isFrozen(addressResult.record.validation), "validated address result parses deeply frozen");
expect(parseCustomerAddressMutationResultV1({ schemaVersion: 1, record: { ...addressRecord,
  address: { ...addressRecord.address, streetLine: null } }, replayed: false }) === undefined, "validated incomplete address rejected");
expect(parseCustomerAddressMutationResultV1({ schemaVersion: 1, record: { ...addressRecord,
  validation: { ...addressRecord.validation, validatedAt: "2026-09-17T10:00:00.000Z" } }, replayed: false }) === undefined,
"future validation relative to record rejected");
expect(parseCustomerAddressMutationResultV1({ schemaVersion: 1, record: { ...addressRecord, validation: null }, replayed: false }) !== undefined,
"unvalidated editable address result allowed");

const searchQuery = { schemaVersion: 1, scope: base.scope, mode: "phone", query: "+52 (642) 123-4567", limit: 20, cursor: null };
const parsedSearch = parseSearchCustomerDirectoryQueryV1(searchQuery);
expect(parsedSearch !== undefined && Object.isFrozen(parsedSearch.scope), "bounded phone search parses");
for (const invalid of [
  { ...searchQuery, mode: "unknown" }, { ...searchQuery, query: "642 ext 1" }, { ...searchQuery, limit: 21 },
  { ...searchQuery, cursor: { updatedAt: base.occurredAt, customerId: "bad" } }, { ...searchQuery, actorId: id },
]) expect(parseSearchCustomerDirectoryQueryV1(invalid) === undefined, "invalid search query rejected");
expect(parseSearchCustomerDirectoryQueryV1({ ...searchQuery, mode: "name", query: "Ana" }) !== undefined, "name search");
expect(parseSearchCustomerDirectoryQueryV1({ ...searchQuery, mode: "address", query: "Navojoa" }) !== undefined, "address search");
const candidatePhone = { contactId: id, label: "Casa", displayValue: "+52 (642) 123-4567" };
const candidate = { customerId: id, displayName: "Ana", phones: [candidatePhone], addresses: [{
  addressId: id, label: "Casa", streetLine: "Uno 10", neighborhood: null, locality: "Navojoa", version: 3,
  validatedForRequestedBranch: true,
}], version: 1, updatedAt: base.occurredAt };
const cursor = { updatedAt: base.occurredAt, customerId: id };
const searchResult = parseCustomerDirectorySearchResultV1({ schemaVersion: 1, scope: base.scope, candidates: [candidate], nextCursor: cursor });
expect(searchResult !== undefined && Object.isFrozen(searchResult.candidates)
  && Object.isFrozen(searchResult.candidates[0]?.addresses[0]), "search results deeply frozen");
expect(parseCustomerDirectorySearchResultV1({ schemaVersion: 1, scope: base.scope, candidates: [candidate, candidate], nextCursor: null }) === undefined,
  "duplicate customer candidates rejected");
expect(parseCustomerDirectorySearchResultV1({ schemaVersion: 1, scope: base.scope, candidates: [candidate],
  nextCursor: { ...cursor, customerId: "abcdef02-2345-4678-9abc-0123456789ab" } }) === undefined, "cursor must match last item");
expect(parseCustomerDirectorySearchResultV1({ schemaVersion: 1, scope: base.scope, candidates: [{ ...candidate,
  addresses: [candidate.addresses[0], candidate.addresses[0]] }], nextCursor: null }) === undefined, "duplicate address identities rejected");
expect(parseCustomerDirectorySearchResultV1({ schemaVersion: 1, scope: base.scope, candidates: [{ ...candidate,
  phones: [{ ...candidatePhone, displayValue: "642 ext 1" }] }], nextCursor: null }) === undefined, "invalid search phone rejected");

const readQuery = { schemaVersion: 1, scope: base.scope, customerId: id };
expect(parseReadCustomerDirectoryQueryV1(readQuery) !== undefined, "exact customer detail query parses");
expect(parseReadCustomerDirectoryQueryV1({ ...readQuery, actorId: id }) === undefined, "detail query rejects actor");
const detail = { schemaVersion: 1, scope: base.scope, customer: {
  customerId: id, displayName: "Ana", phones: [candidatePhone], version: 1, updatedAt: base.occurredAt,
}, addresses: [{ addressId: id, address: addressRecord.address, version: 3,
  updatedAt: base.occurredAt, validatedForRequestedBranch: true }], addressesTruncated: false };
const parsedDetail = parseCustomerDirectoryDetailV1(detail);
expect(parsedDetail !== undefined && Object.isFrozen(parsedDetail.customer)
  && Object.isFrozen(parsedDetail.customer.phones) && Object.isFrozen(parsedDetail.addresses[0]?.address.coordinates),
"customer detail is deeply frozen");
expect(parseCustomerDirectoryDetailV1({ ...detail, customer: { ...detail.customer,
  phones: [{ ...candidatePhone, normalizedValue: "+526421234567" }] } }) === undefined,
"detail does not expose normalized phone keys");
expect(parseCustomerDirectoryDetailV1({ ...detail, addresses: [detail.addresses[0], detail.addresses[0]] }) === undefined,
"detail rejects duplicate addresses");
expect(parseCustomerDirectoryDetailV1({ ...detail, addresses: [{ ...detail.addresses[0],
  validatedBy: id }] }) === undefined, "detail does not expose validation audit evidence");
expect(parseCustomerDirectoryDetailV1({ ...detail, addressesTruncated: true }) === undefined,
"detail cannot claim truncation before the page is full");
for (const key of ["streetLine", "locality", "countryCode"] as const) {
  expect(parseCustomerDirectoryDetailV1({ ...detail, addresses: [{ ...detail.addresses[0],
    address: { ...addressRecord.address, [key]: null } }] }) === undefined,
  "validated detail requires complete delivery fields");
}
const secondCandidate = { ...candidate, customerId: "abcdef02-2345-4678-9abc-0123456789ab" };
expect(parseCustomerDirectorySearchResultV1({ schemaVersion: 1, scope: base.scope,
  candidates: [candidate, secondCandidate], nextCursor: null }) !== undefined, "equal-date candidates sorted by identity");
expect(parseCustomerDirectorySearchResultV1({ schemaVersion: 1, scope: base.scope,
  candidates: [secondCandidate, candidate], nextCursor: null }) === undefined, "reverse equal-date identities rejected");
expect(parseCustomerDirectorySearchResultV1({ schemaVersion: 1, scope: base.scope,
  candidates: [candidate, { ...secondCandidate, updatedAt: "2026-09-17T10:00:00.000Z" }], nextCursor: null }) === undefined,
"reverse chronological page rejected");
