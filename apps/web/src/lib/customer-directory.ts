import {
  parseSearchCustomerDirectoryQueryV1, parseReadCustomerDirectoryQueryV1,
  parseSaveCustomerProfileCommandV1, parseSaveCustomerAddressCommandV1,
  parseValidateCustomerAddressCommandV1, parseCustomerDirectorySearchResultV1,
  parseCustomerDirectoryDetailV1, parseCustomerProfileMutationResultV1,
  parseCustomerAddressMutationResultV1,
} from "@super-restaurant/shared-types";

export type CustomerRequestResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "conflict" | "missing" | "unavailable" };

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
