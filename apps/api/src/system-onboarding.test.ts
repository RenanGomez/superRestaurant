import assert from "node:assert/strict";
import test from "node:test";
import { SystemOnboardingService } from "./system-onboarding.js";
const actor = "11111111-1111-4111-8111-111111111111";
const manager = "22222222-2222-4222-8222-222222222222";
const request = { idempotencyKey: "33333333-3333-4333-8333-333333333333", restaurant: { name: "Vittorinos Pizza", timeZone: "America/Hermosillo", currency: "MXN" }, branch: { name: "Sucursal Navojoa" }, manager: { email: "emmanuel.rgomez@gmail.com", role: "manager" as const }, seedProfile: "development_minimal_v1" as const };
function auth() { let deleted = 0; return { value: { findUserByEmail: async () => undefined, inviteUser: async () => ({ id: manager }), deleteUser: async () => { deleted += 1; } }, deleted: () => deleted }; }
test("system onboarding accepts invitation_pending and never returns a password", async () => {
  const a = auth(); const db = { query: async (sql: string) => ({ rows: [{ result: sql.includes("preflight") ? { status: "ready" } : { status: "invitation_pending", operationId: "44444444-4444-4444-8444-444444444444", restaurantId: actor, branchId: manager, managerEmail: request.manager.email, seedProfile: request.seedProfile } }] }) };
  const result = await new SystemOnboardingService(db, a.value).provision({ actorId: actor }, request);
  assert.equal(result.status, "invitation_pending"); assert.equal("password" in result, false); assert.equal(a.deleted(), 0);
});
test("system onboarding compensates a newly invited user when the database fails", async () => {
  const a = auth(); const db = { query: async (sql: string) => { if (sql.includes("preflight")) return { rows: [{ result: { status: "ready" } }] }; throw new Error("db unavailable"); } };
  await assert.rejects(() => new SystemOnboardingService(db, a.value).provision({ actorId: actor }, request)); assert.equal(a.deleted(), 1);
});
