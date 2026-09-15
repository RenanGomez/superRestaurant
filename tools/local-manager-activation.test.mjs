import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";

import { createPasswordAttempt, createPasswordSetterHandler } from "./local-admin-password-setter.mjs";
import {
  BRANCH_NAME,
  MANAGER_EMAIL,
  MANAGER_SETTER,
  RESTAURANT_NAME,
  RESTAURANT_TIME_ZONE,
  updateManagerCredentials,
  verifyExistingManager,
} from "./local-manager-activation.mjs";

const id = "existing-manager-id";

function database(rows) {
  const calls = [];
  return {
    calls,
    async connect() { calls.push("connect"); },
    async query(sql, values) { calls.push([sql, values]); return sql.trimStart().startsWith("select") ? { rows } : { rows: [] }; },
    async end() { calls.push("end"); },
  };
}

function authUser(overrides = {}) {
  return { id, email: MANAGER_EMAIL, confirmed_at: null, email_confirmed_at: null, last_sign_in_at: null, ...overrides };
}

test("manager preflight proves the exact active scope and rolls back", async () => {
  const db = database([{ id, email: MANAGER_EMAIL }]);
  const result = await verifyExistingManager(db, { getUserById: async () => ({ data: { user: authUser() }, error: null }) });
  assert.equal(result, id);
  const select = db.calls.find((call) => Array.isArray(call) && call[0].trimStart().startsWith("select"));
  assert.deepEqual(select[1], [MANAGER_EMAIL, "manager", RESTAURANT_NAME, RESTAURANT_TIME_ZONE, BRANCH_NAME]);
  assert.match(select[0], /not exists[\s\S]+app\.system_admins/u);
  assert.match(select[0], /count\(\*\)[\s\S]+app\.memberships/u);
  assert.equal(db.calls.some((call) => Array.isArray(call) && call[0] === "ROLLBACK"), true);
  assert.equal(db.calls.at(-1), "end");
});

test("manager preflight rejects confirmed, signed-in or mismatched identities", async () => {
  for (const user of [authUser({ confirmed_at: "now" }), authUser({ last_sign_in_at: "now" }), authUser({ email: "other@example.com" })]) {
    const db = database([{ id, email: MANAGER_EMAIL }]);
    await assert.rejects(verifyExistingManager(db, { getUserById: async () => ({ data: { user }, error: null }) }), /IDENTITY/u);
    assert.equal(db.calls.some((call) => Array.isArray(call) && call[0] === "ROLLBACK"), true);
  }
});

test("credential update confirms email in the same provider operation", async () => {
  const calls = [];
  const result = await updateManagerCredentials({
    async updateUserById(userId, attributes) {
      calls.push([userId, attributes.password === "strong manager password", attributes.email_confirm]);
      return { data: { user: authUser({ email_confirmed_at: "now" }) }, error: null };
    },
  }, id, "strong manager password");
  assert.deepEqual(calls, [[id, true, true]]);
  assert.equal(result.error, null);
});

test("credential update fails closed when confirmation is absent", async () => {
  const result = await updateManagerCredentials({
    updateUserById: async () => ({ data: { user: authUser() }, error: null }),
  }, id, "strong manager password");
  assert.match(result.error.message, /CONFIRMATION/u);
});

test("shared one-attempt guard validates the manager identity", async () => {
  const calls = [];
  const attempt = createPasswordAttempt({
    preflight: async () => id,
    targetEmail: MANAGER_EMAIL,
    claim: async () => { calls.push("claim"); },
    updatePassword: async () => ({ data: { user: authUser({ email_confirmed_at: "now" }) }, error: null }),
    record: async (state) => { calls.push(state); },
  });
  await attempt("strong manager password", "strong manager password");
  await assert.rejects(attempt("strong manager password", "strong manager password"), /ALREADY_ATTEMPTED/u);
  assert.deepEqual(calls, ["claim", "updated"]);
});

test("shared loopback form can render the fixed manager account", async () => {
  const handler = createPasswordSetterHandler(async () => {}, "csrf", {
    email: MANAGER_EMAIL,
    heading: "Activar cuenta manager de Vittorinos",
    label: "manager",
    setter: MANAGER_SETTER,
  });
  const request = { method: "GET", url: "/", headers: { host: new URL(MANAGER_SETTER).host }, socket: { remoteAddress: "127.0.0.1" } };
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await handler(request, response);
  assert.equal(response.status, 200);
  assert.match(response.body, /Activar cuenta manager de Vittorinos/u);
  assert.match(response.body, new RegExp(MANAGER_EMAIL.replace(".", "\\."), "u"));
});
