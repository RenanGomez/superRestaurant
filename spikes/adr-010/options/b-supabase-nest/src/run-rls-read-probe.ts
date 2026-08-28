import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseNestAdr010Adapter } from "./adapter.js";
import { withAdr010BAuthenticatedFixtures } from "./auth-bootstrap.js";
import { requireSupabaseGateIntegrationOptIn } from "./config.js";

/**
 * Explicit remote probe for the Authenticated publishable-key read boundary.
 * It is intentionally not part of normal CI and does not execute a product
 * mutation or claim any ADR gate is proven.
 */
const config = requireSupabaseGateIntegrationOptIn(process.env);
const adapter = new SupabaseNestAdr010Adapter(config);

const readCount = async (client: SupabaseClient, table: "restaurants" | "branches", id: string): Promise<number> => {
  const { data, error } = await client.schema("adr010_b").from(table).select("id").eq("id", id);
  if (error !== null) throw new Error("ADR-010 RLS read probe failed.");
  return data.length;
};

const expectCount = (actual: number, expected: number): void => {
  if (actual !== expected) throw new Error("ADR-010 RLS read probe observed an unexpected row count.");
};

try {
  // Reuse the option-B adapter's verified structural-fixture preparation;
  // Auth membership rows reference these fixed restaurants and branches.
  await adapter.migrateFromEmpty();
  await withAdr010BAuthenticatedFixtures(config, async ({ users, revokeBranchMembership }) => {
  const amber = users.find((user) => user.fixtureKey === "amber");
  const cobalt = users.find((user) => user.fixtureKey === "cobalt");
  if (amber === undefined || cobalt === undefined) throw new Error("ADR-010 RLS probe fixture setup was incomplete.");

  // Each publishable-key client can read its own restaurant and branches.
  expectCount(await readCount(amber.client, "restaurants", amber.restaurantId), 1);
  expectCount(await readCount(cobalt.client, "restaurants", cobalt.restaurantId), 1);
  expectCount(await readCount(amber.client, "branches", amber.branchIds[0] ?? ""), 1);
  expectCount(await readCount(cobalt.client, "branches", cobalt.branchIds[0] ?? ""), 1);

  // Cross-restaurant reads must be filtered by RLS, not merely by client code.
  expectCount(await readCount(amber.client, "restaurants", cobalt.restaurantId), 0);
  expectCount(await readCount(cobalt.client, "restaurants", amber.restaurantId), 0);
  expectCount(await readCount(amber.client, "branches", cobalt.branchIds[0] ?? ""), 0);
  expectCount(await readCount(cobalt.client, "branches", amber.branchIds[0] ?? ""), 0);

  // Membership revocation is server-only and must take effect on the next read
  // from the already-authenticated publishable-key client.
  const revokedBranchId = amber.branchIds[0];
  if (revokedBranchId === undefined) throw new Error("ADR-010 RLS probe fixture has no branch to revoke.");
    await revokeBranchMembership("amber", revokedBranchId);
    expectCount(await readCount(amber.client, "branches", revokedBranchId), 0);
  });
} finally {
  await adapter.close();
}
