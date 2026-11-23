import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";
import { buildCustomerQuickCreateCommand, normalizeCustomerSearchQuery, shouldOfferCustomerQuickCreate } from "./customer-quick-create.js";

test("normalizeCustomerSearchQuery strips phone separators and collapses name whitespace", () => {
  assert.equal(normalizeCustomerSearchQuery("phone", " +52 (642) 123-4567 "), "526421234567");
  assert.equal(normalizeCustomerSearchQuery("name", "  Ana   María  "), "Ana María");
  assert.equal(normalizeCustomerSearchQuery("address", "  Calle  5  "), "Calle 5");
  assert.equal(normalizeCustomerSearchQuery("phone", "abc"), "");
});

test("shouldOfferCustomerQuickCreate only offers a seedable phone or name", () => {
  assert.equal(shouldOfferCustomerQuickCreate("phone", "642"), false);
  assert.equal(shouldOfferCustomerQuickCreate("phone", "(642) 123"), true);
  assert.equal(shouldOfferCustomerQuickCreate("name", "A"), false);
  assert.equal(shouldOfferCustomerQuickCreate("name", "Ana"), true);
  assert.equal(shouldOfferCustomerQuickCreate("address", "Calle 5"), false);
  assert.equal(shouldOfferCustomerQuickCreate("name", "   "), false);
});

test("a quick-create retry keeps the full command and edits start a fresh attempt", () => {
  const scope = parseBranchScope({
    restaurantId: "11111111-1111-4111-8111-111111111111",
    branchId: "22222222-2222-4222-8222-222222222222",
  });
  if (scope === undefined) throw new Error("invalid fixture scope");
  let generated = 0;
  const newId = (): string => { generated += 1; return `id-${generated}`; };
  const input = { displayName: "Ana", phone: "+52 642 123 4567", scope,
    deviceId: "66666666-6666-4666-8666-666666666666", occurredAt: "2026-09-16T20:00:00.000Z" };

  const first = buildCustomerQuickCreateCommand(undefined, input, newId);
  const retry = buildCustomerQuickCreateCommand(first, input, newId);
  assert.equal(generated, 4);
  assert.deepEqual(retry, first);
  assert.equal(retry.phones[0]?.contactId, first.phones[0]?.contactId);
  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.equal(retry.customerId, first.customerId);

  const changed = buildCustomerQuickCreateCommand(first, { ...input, phone: "+52 642 000 0000" }, newId);
  assert.equal(generated, 8);
  assert.notEqual(changed.customerId, first.customerId);
  assert.notEqual(changed.phones[0]?.contactId, first.phones[0]?.contactId);
  assert.notEqual(changed.idempotencyKey, first.idempotencyKey);
});
