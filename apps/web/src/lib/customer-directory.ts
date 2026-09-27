import {
  parseSearchCustomerDirectoryQueryV1, parseReadCustomerDirectoryQueryV1,
  parseSaveCustomerProfileCommandV1, parseSaveCustomerAddressCommandV1,
  parseValidateCustomerAddressCommandV1, parseCustomerDirectorySearchResultV1,
  parseCustomerDirectoryDetailV1, parseCustomerProfileMutationResultV1,
  parseCustomerAddressMutationResultV1,
} from "@super-restaurant/shared-types";
import type {
  CustomerDirectorySearchResultV1,
  CustomerSearchModeV1,
} from "@super-restaurant/shared-types";

export type CustomerRequestResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "conflict" | "missing" | "unavailable" };

export interface CustomerDirectorySuggestion {
  readonly id: string;
  readonly customerId: string;
  readonly value: string;
  readonly context: string;
}

export interface CustomerAutocompleteRequest {
  readonly mode: CustomerSearchModeV1;
  readonly query: string;
}

const suggestionPartPattern = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;

function normalizedTerm(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-MX");
}

function suggestionParts(value: string): readonly string[] {
  return value.match(suggestionPartPattern) ?? [];
}

export function getCustomerAutocompleteRequest(mode: CustomerSearchModeV1, input: string): CustomerAutocompleteRequest | undefined {
  const query = input.trim();
  const maximum = mode === "address" ? 200 : 120;
  if (query === "" || query.length > maximum) return undefined;
  if (mode === "phone") return query.replace(/\D/gu, "").length >= 4 ? { mode, query } : undefined;
  const parts = suggestionParts(query).map(normalizedTerm);
  const prefix = parts.at(-1) ?? "";
  const hasUsefulPrefix = prefix.length >= 2 || (/^\d+$/u.test(prefix) && parts.slice(0, -1).some(part => part.length >= 2));
  return hasUsefulPrefix ? { mode, query } : undefined;
}

export function isCurrentCustomerAutocompleteRequest(
  request: CustomerAutocompleteRequest,
  mode: CustomerSearchModeV1,
  input: string,
): boolean {
  const current = getCustomerAutocompleteRequest(mode, input);
  return current !== undefined && current.mode === request.mode && current.query === request.query;
}

/** Suggestions are derived exclusively from the already-authorized result held by the browser. */
export function getCustomerDirectorySuggestions(
  result: CustomerDirectorySearchResultV1 | undefined,
  mode: CustomerSearchModeV1,
  input: string,
  limit = 8,
): readonly CustomerDirectorySuggestion[] {
  if (result === undefined || limit < 1 || input.trim() === "") return [];
  const values = suggestionParts(input);
  const endsWithSpace = /\s$/u.test(input);
  const prefix = endsWithSpace ? "" : normalizedTerm(values.at(-1) ?? "");
  const completed = (endsWithSpace ? values : values.slice(0, -1)).map(normalizedTerm);
  if (mode === "phone" && input.replace(/\D/gu, "").length < 4) return [];

  const suggestions = new Map<string, CustomerDirectorySuggestion>();
  for (const candidate of result.candidates) {
    const context = candidate.displayName;
    const sources = mode === "name"
      ? [candidate.displayName]
      : mode === "phone"
        ? candidate.phones.map(phone => phone.displayValue)
        : candidate.addresses.flatMap(address => [address.label, address.streetLine, address.neighborhood, address.locality].filter((part): part is string => part !== null));
    const searchableParts = sources.flatMap(suggestionParts).map(normalizedTerm);
    const hasCompletedTerms = completed.every(term => searchableParts.some(part => part.includes(term)));
    if (!hasCompletedTerms) continue;
    const offeredValues = mode === "phone" ? sources : sources.flatMap(suggestionParts);
    for (const value of offeredValues) {
      const normalizedValue = normalizedTerm(mode === "phone" ? value.replace(/\D/gu, "") : value);
      const normalizedPrefix = mode === "phone" ? input.replace(/\D/gu, "") : prefix;
      const matchesPrefix = mode === "phone" ? normalizedValue.includes(normalizedPrefix) : normalizedValue.startsWith(normalizedPrefix);
      const suggestionKey = `${candidate.customerId}:${normalizedValue}`;
      if (!matchesPrefix || completed.includes(normalizedValue) || suggestions.has(suggestionKey)) continue;
      suggestions.set(suggestionKey, { id: `${mode}-${suggestions.size}-${normalizedValue}`, customerId: candidate.customerId, value, context });
      if (suggestions.size >= Math.min(limit, 10)) return [...suggestions.values()];
    }
  }
  return [...suggestions.values()];
}

export function insertCustomerDirectorySuggestion(input: string, value: string, mode: CustomerSearchModeV1): string {
  if (mode === "phone") return `${value.trim()} `;
  const match = input.match(/^(.*\s)?\S*$/u);
  return `${match?.[1] ?? ""}${value.trim()} `;
}

export const customerOperations = {
  search: { input: parseSearchCustomerDirectoryQueryV1, output: parseCustomerDirectorySearchResultV1, path: "search" },
  detail: { input: parseReadCustomerDirectoryQueryV1, output: parseCustomerDirectoryDetailV1, path: "detail" },
  profile: { input: parseSaveCustomerProfileCommandV1, output: parseCustomerProfileMutationResultV1, path: "profile" },
  address: { input: parseSaveCustomerAddressCommandV1, output: parseCustomerAddressMutationResultV1, path: "address" },
  validate: { input: parseValidateCustomerAddressCommandV1, output: parseCustomerAddressMutationResultV1, path: "address/validate" },
} as const;

/** Called only by server actions. PII stays in POST bodies; no tokens cross the client boundary. */
export async function requestCustomerDirectory<K extends keyof typeof customerOperations>(
  token: string, baseUrl: string, operation: K, input: unknown,
): Promise<CustomerRequestResult<NonNullable<ReturnType<(typeof customerOperations)[K]["output"]>>>> {
  const codec = customerOperations[operation];
  const command = codec.input(input);
  if (command === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/customers/${codec.path}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied"
      : response.status === 404 ? "missing" : response.status === 400 ? "invalid" : "unavailable" };
    const value = codec.output(await response.json());
    if (value === undefined) return { ok: false, error: "unavailable" };
    const actualScope = "scope" in value ? value.scope : { restaurantId: value.record.restaurantId, branchId: command.scope.branchId };
    if (actualScope.restaurantId !== command.scope.restaurantId || actualScope.branchId !== command.scope.branchId) return { ok: false, error: "unavailable" };
    if ("customerId" in command) {
      const id = "customer" in value ? value.customer.customerId : "record" in value ? value.record.customerId : undefined;
      if (id !== command.customerId) return { ok: false, error: "unavailable" };
    }
    if ("addressId" in command && "record" in value && (!('addressId' in value.record) || value.record.addressId !== command.addressId)) return { ok: false, error: "unavailable" };
    if ("expectedVersion" in command && "record" in value
      && (typeof command.expectedVersion !== "number" || value.record.version !== command.expectedVersion + 1)) return { ok: false, error: "unavailable" };
    if (operation === "validate" && "record" in value && (!("validation" in value.record)
      || value.record.validation === null || value.record.validation.branchId !== command.scope.branchId)) return { ok: false, error: "unavailable" };
    return { ok: true, value } as CustomerRequestResult<NonNullable<ReturnType<(typeof customerOperations)[K]["output"]>>>;
  } catch { return { ok: false, error: "unavailable" }; }
}
