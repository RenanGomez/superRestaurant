import type { BranchScope, CustomerSearchModeV1, SaveCustomerProfileCommandV1 } from "@super-restaurant/shared-types";

/** Canonical form of the text an operator typed before asking the API or offering a quick create. */
export function normalizeCustomerSearchQuery(mode: CustomerSearchModeV1, input: string): string {
  const trimmed = input.trim();
  if (mode === "phone") return trimmed.replace(/\D/gu, "");
  return trimmed.replace(/\s+/gu, " ");
}

/**
 * A quick create is only offered when the typed data can seed a profile: a full enough phone or a
 * name. An address query alone cannot name a customer, and the phone threshold matches the
 * autocomplete request so the offer appears exactly when a search was possible.
 */
export function shouldOfferCustomerQuickCreate(mode: CustomerSearchModeV1, input: string): boolean {
  const query = normalizeCustomerSearchQuery(mode, input);
  if (mode === "phone") return query.length >= 4;
  if (mode === "name") return query.length >= 2;
  return false;
}

export interface CustomerQuickCreateInputV1 {
  readonly displayName: string;
  readonly phone: string;
  readonly scope: BranchScope;
  readonly deviceId: string;
  readonly occurredAt: string;
}

/**
 * Keeps one command for one quick-create attempt. Retrying the same name and phone reuses the whole
 * command, including its contactId and idempotency key, so a lost response is replayed instead of
 * looking like a new customer. Editing the seeded profile starts a new attempt with fresh ids.
 */
export function buildCustomerQuickCreateCommand(
  previous: SaveCustomerProfileCommandV1 | undefined,
  input: CustomerQuickCreateInputV1,
  newId: () => string,
): SaveCustomerProfileCommandV1 {
  if (previous !== undefined
    && previous.displayName === input.displayName
    && previous.phones.length === 1
    && previous.phones[0]?.displayValue === input.phone
    && previous.scope.restaurantId === input.scope.restaurantId
    && previous.scope.branchId === input.scope.branchId) {
    return previous;
  }
  return {
    schemaVersion: 1,
    scope: input.scope,
    customerId: newId(),
    expectedVersion: 0,
    eventId: newId(),
    deviceId: input.deviceId,
    idempotencyKey: newId(),
    occurredAt: input.occurredAt,
    displayName: input.displayName,
    phones: [{ contactId: newId(), label: "Principal", displayValue: input.phone }],
  };
}
