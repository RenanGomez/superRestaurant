/* global Headers */
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { URL } from "node:url";
import { BROKER, CALLBACK, EMAIL, PROJECT, createAttempt, createBrokerHandler, databaseConfig, validateActionLink, validateRecoveryRedirect, verifyExistingAdmin } from "./local-admin-recovery.mjs";

// Every provider/database/HTTP port is fake. Importing the tool performs no I/O.
const id = "test-existing-admin";
const action = `https://${PROJECT}.supabase.co/auth/v1/verify?token=fake-link&type=recovery&redirect_to=${encodeURIComponent(CALLBACK)}`;
const redirect = `${CALLBACK}#access_token=fake-access-token-long-enough&refresh_token=fake-refresh-token-long-enough&type=recovery`;
function fixture(overrides = {}) {
  const calls = [];
  const deps = {
    preflight: async () => { calls.push("preflight"); return id; },
    admin: { generateLink: async (input) => { calls.push(["generate", input]); return { error: null, data: { user: { id, email: EMAIL }, properties: { action_link: action } } }; } },
    fetcher: async (url, options) => { calls.push(["verify", url, options.redirect]); return { status: 303, headers: new Headers({ location: redirect }), body: { cancel: async () => {} } }; },
    claim: async () => { calls.push("claim"); },
    record: async (state) => { calls.push(["record", state]); },
    ...overrides,
  };
  return { calls, deps, attempt: createAttempt(deps) };
}

test("database destination is pinned and connection-string SSL options cannot disable TLS", () => {
  const config = databaseConfig(`postgresql://postgres:fake@db.${PROJECT}.supabase.co/postgres?sslmode=disable`, "fake-ca");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca, "fake-ca");
  assert.equal(config.connectionString, undefined);
  assert.equal(databaseConfig(`postgresql://postgres.${PROJECT}:fake@aws-0-us-west-1.pooler.supabase.com:6543/postgres`, "fake-ca").port, 6543);
  for (const url of ["postgresql://postgres:fake@evil.example/postgres", "postgresql://postgres.wrong:fake@aws-0-us-west-1.pooler.supabase.com/postgres"]) assert.throws(() => databaseConfig(url, "fake-ca"), /CONFIGURATION/u);
});

test("identity check reads active grant and Auth identity with rollback and close", async () => {
  const queries = [];
  const database = { connect: async () => {}, query: async (sql, params) => { queries.push([sql, params]); return { rows: [{ id, email: EMAIL }] }; }, end: async () => { queries.push(["end"]); } };
  assert.equal(await verifyExistingAdmin(database, { getUserById: async (input) => { assert.equal(input, id); return { data: { user: { id, email: EMAIL } }, error: null }; } }), id);
  assert.equal(queries[0][0], "BEGIN READ ONLY");
  assert.match(queries[1][0], /a.revoked_at is null/u);
  assert.deepEqual(queries[1][1], [EMAIL]);
  assert.deepEqual(queries.slice(-2), [["ROLLBACK", undefined], ["end"]]);
});

test("missing or mismatched identity fails closed and still rolls back", async () => {
  for (const rows of [[], [{ id, email: "other@example.test" }], [{ id, email: EMAIL }]]) {
    const queries = [];
    const database = { connect: async () => {}, query: async (sql) => { queries.push(sql); return { rows }; }, end: async () => {} };
    await assert.rejects(verifyExistingAdmin(database, { getUserById: async () => ({ data: { user: { id: "other", email: EMAIL } } }) }), /IDENTITY/u);
    assert.equal(queries.at(-1), "ROLLBACK");
  }
});

test("one attempt generates for the fixed existing account then verifies server-side without following redirects", async () => {
  const f = fixture();
  const target = await f.attempt();
  assert.equal(new URL(target).origin + new URL(target).pathname, CALLBACK);
  assert.deepEqual(f.calls[2], ["generate", { type: "recovery", email: EMAIL, options: { redirectTo: CALLBACK } }]);
  assert.deepEqual(f.calls[3], ["verify", action, "manual"]);
  assert.deepEqual(f.calls.at(-1), ["record", "delivered"]);
  await assert.rejects(f.attempt(), /ALREADY_ATTEMPTED/u);
});

test("concurrent attempts and persistent journal collisions cannot duplicate generation", async () => {
  const f = fixture();
  const result = await Promise.allSettled([f.attempt(), f.attempt()]);
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(f.calls.filter((item) => Array.isArray(item) && item[0] === "generate").length, 1);
  const restart = fixture({ claim: async () => { throw new Error("exists"); } });
  await assert.rejects(restart.attempt(), /ALREADY_ATTEMPTED/u);
  assert.equal(restart.calls.some((item) => Array.isArray(item) && item[0] === "generate"), false);
});

test("provider/network failures stay sanitized and never retry", async () => {
  for (const override of [{ admin: { generateLink: async () => { throw new Error("SECRET fake-access"); } } }, { fetcher: async () => { throw new Error("SECRET fake-link"); } }]) {
    const f = fixture(override);
    await assert.rejects(f.attempt(), (error) => /^LOCAL_RECOVERY_(GENERATION|VERIFICATION)$/u.test(error.message));
    assert.deepEqual(f.calls.at(-1), ["record", "failed"]);
    await assert.rejects(f.attempt(), /ALREADY_ATTEMPTED/u);
  }
});

test("identity or journal failures happen before generation", async () => {
  const f = fixture({ preflight: async () => { throw new Error("failure"); } });
  await assert.rejects(f.attempt(), /IDENTITY/u);
  assert.deepEqual(f.calls, []);
});

test("provider action links are pinned to the project, action and exact callback", () => {
  assert.equal(validateActionLink(action), action);
  for (const bad of [action.replace(PROJECT, "wrong"), action.replace("type=recovery", "type=invite"), action.replace("/auth/v1/verify", "/evil"), action.replace(encodeURIComponent(CALLBACK), encodeURIComponent("https://evil.example"))]) assert.throws(() => validateActionLink(bad));
});

test("redirect rejects provider errors, incomplete or duplicated tokens and fallback routes", () => {
  for (const bad of [redirect.replace("/auth/callback", "/"), redirect.replace("localhost:8082", "evil.example"), redirect + "&error=expired", redirect.replace("refresh_token=fake-refresh-token-long-enough&", ""), redirect + "&access_token=second", redirect.replace("type=recovery", "type=invite"), redirect.replace("#", "?error=expired#")]) assert.throws(() => validateRecoveryRedirect(bad));
});

test("token format matches callback bounds and rejects whitespace", () => {
  for (const token of ["short", "x".repeat(8193), "a".repeat(20) + " ", "a".repeat(20) + "\n"]) {
    assert.throws(() => validateRecoveryRedirect(redirect.replace("fake-access-token-long-enough", encodeURIComponent(token))), /CALLBACK/u);
  }
  for (const length of [20, 8192]) assert.doesNotThrow(() => validateRecoveryRedirect(redirect.replace("fake-access-token-long-enough", "x".repeat(length))));
});

async function request(handler, { method = "GET", url = "/", headers = {}, body = "" } = {}) {
  const input = Readable.from([body]);
  Object.assign(input, { method, url, headers: { host: new URL(BROKER).host, ...headers }, socket: { remoteAddress: "127.0.0.1" } });
  const output = { writeHead(status, values) { this.status = status; this.headers = values; }, end(value) { this.body = value; } };
  await handler(input, output);
  return output;
}
const validPost = { method: "POST", url: "/recover", headers: { origin: BROKER, "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }, body: "nonce=fake-csrf" };

test("GET does not generate and broker rejects cross-origin, bad host and wrong nonce", async () => {
  let calls = 0;
  const handler = createBrokerHandler(async () => { calls++; return redirect; }, "fake-csrf");
  assert.equal((await request(handler)).status, 200);
  for (const options of [{ ...validPost, headers: { ...validPost.headers, origin: "https://evil.example" } }, { ...validPost, headers: { ...validPost.headers, host: "evil.example" } }, { ...validPost, body: "nonce=wrong" }, { ...validPost, body: "nonce=fake-csrf&nonce=other" }]) assert.equal((await request(handler, options)).status, 403);
  assert.equal(calls, 0);
});

test("delivery uses no-store memory HTML, location.replace and never a Location header", async () => {
  const handler = createBrokerHandler(async () => redirect, "fake-csrf");
  const output = await request(handler, validPost);
  assert.equal(output.status, 200);
  assert.equal(output.headers["Referrer-Policy"], "no-referrer");
  assert.match(output.headers["Cache-Control"], /no-store/u);
  assert.equal(output.headers.Location, undefined);
  assert.match(output.body, /location.replace/u);
  assert.equal(output.body.includes(action), false);
});

test("HTML errors never echo thrown credentials; script payload is safely escaped", async () => {
  const error = await request(createBrokerHandler(async () => { throw new Error("SECRET fake-access"); }, "fake-csrf"), validPost);
  assert.equal(error.status, 409);
  assert.equal(error.body.includes("fake-access"), false);
  const output = await request(createBrokerHandler(async () => `${redirect}</script><script>bad()</script>`, "fake-csrf"), validPost);
  assert.equal(output.body.includes("<script>bad"), false);
  assert.match(output.body, /\\u003c/u);
});
