import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { URL } from "node:url";
import { EMAIL } from "./local-admin-recovery.mjs";
import { SETTER, createPasswordAttempt, createPasswordSetterHandler, validatePassword } from "./local-admin-password-setter.mjs";

const id = "test-existing-admin";
const password = "correct horse battery staple";

function fixture(overrides = {}) {
  const calls = [];
  const deps = {
    preflight: async () => { calls.push("preflight"); return id; },
    updatePassword: async (userId, value) => { calls.push(["update", userId, value === password]); return { data: { user: { id, email: EMAIL } }, error: null }; },
    claim: async () => { calls.push("claim"); },
    record: async (state, stage) => { calls.push(["record", state, stage]); },
    ...overrides,
  };
  return { calls, attempt: createPasswordAttempt(deps) };
}

test("password validation permits correction before any one-time attempt", async () => {
  const fixtureValue = fixture();
  for (const values of [["short", "short"], [password, "different"], ["x".repeat(129), "x".repeat(129)]]) await assert.rejects(fixtureValue.attempt(...values), /INVALID_INPUT/u);
  await fixtureValue.attempt(password, password);
  assert.deepEqual(fixtureValue.calls, ["preflight", "claim", ["update", id, true], ["record", "updated", undefined]]);
});

test("one valid submission updates only the fixed existing identity", async () => {
  const fixtureValue = fixture();
  await fixtureValue.attempt(password, password);
  await assert.rejects(fixtureValue.attempt(password, password), /ALREADY_ATTEMPTED/u);
  assert.equal(fixtureValue.calls.filter((value) => Array.isArray(value) && value[0] === "update").length, 1);
});

test("journal collision prevents the remote update", async () => {
  const fixtureValue = fixture({ claim: async () => { throw new Error("exists"); } });
  await assert.rejects(fixtureValue.attempt(password, password), /ALREADY_ATTEMPTED/u);
  assert.equal(fixtureValue.calls.some((value) => Array.isArray(value) && value[0] === "update"), false);
});

test("provider failures are sanitized, journaled and never retried", async () => {
  const fixtureValue = fixture({ updatePassword: async () => { throw new Error(`SECRET ${password}`); } });
  await assert.rejects(fixtureValue.attempt(password, password), (error) => error.message === "LOCAL_PASSWORD_SET_UPDATE");
  assert.deepEqual(fixtureValue.calls.at(-1), ["record", "failed", "update"]);
  await assert.rejects(fixtureValue.attempt(password, password), /ALREADY_ATTEMPTED/u);
});

test("mismatched provider identity fails closed", async () => {
  const fixtureValue = fixture({ updatePassword: async () => ({ data: { user: { id: "other", email: EMAIL } }, error: null }) });
  await assert.rejects(fixtureValue.attempt(password, password), /UPDATE/u);
  assert.deepEqual(fixtureValue.calls.at(-1), ["record", "failed", "update"]);
});

async function request(handler, { method = "GET", url = "/", headers = {}, body = "" } = {}) {
  const input = Readable.from([body]);
  Object.assign(input, { method, url, headers: { host: new URL(SETTER).host, ...headers }, socket: { remoteAddress: "127.0.0.1" } });
  const output = { writeHead(status, values) { this.status = status; this.headers = values; }, end(value) { this.body = value; } };
  await handler(input, output);
  return output;
}

const encodedPassword = encodeURIComponent(password);
const validPost = { method: "POST", url: "/set-password", headers: { origin: SETTER, "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }, body: `nonce=fake-csrf&password=${encodedPassword}&confirmation=${encodedPassword}` };

test("GET is inert and returns a no-store password form", async () => {
  let calls = 0;
  const output = await request(createPasswordSetterHandler(async () => { calls++; }, "fake-csrf"));
  assert.equal(output.status, 200);
  assert.equal(calls, 0);
  assert.match(output.body, /type="password"/u);
  assert.match(output.body, /Comprobar navegador/u);
  assert.match(output.headers["Cache-Control"], /no-store/u);
  assert.equal(output.headers["Referrer-Policy"], "no-referrer");
});

test("POST accepts exact, omitted and opaque local browser metadata", async () => {
  for (const headers of [validPost.headers, { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "sec-fetch-site": "same-origin" }, { "content-type": "application/x-www-form-urlencoded" }, { origin: "null", "content-type": "APPLICATION/X-WWW-FORM-URLENCODED", "sec-fetch-site": "none" }]) {
    let calls = 0;
    const output = await request(createPasswordSetterHandler(async () => { calls++; }, "fake-csrf"), { ...validPost, headers });
    assert.equal(output.status, 200);
    assert.equal(calls, 1);
  }
});

test("POST rejects cross-origin, bad host, fetch context, nonce and extra fields", async () => {
  let calls = 0;
  const handler = createPasswordSetterHandler(async () => { calls++; }, "fake-csrf");
  const cases = [
    { ...validPost, headers: { ...validPost.headers, origin: "https://evil.example" } },
    { ...validPost, headers: { ...validPost.headers, host: "evil.example" } },
    { ...validPost, headers: { ...validPost.headers, "sec-fetch-site": "cross-site" } },
    { ...validPost, body: validPost.body.replace("fake-csrf", "wrong") },
    { ...validPost, body: `${validPost.body}&password=duplicate` },
    { ...validPost, body: `${validPost.body}&extra=value` },
  ];
  for (const options of cases) assert.equal((await request(handler, options)).status, 403);
  assert.equal(calls, 0);
});

test("browser probe exercises transport and nonce without calling the password attempt", async () => {
  let calls = 0;
  const handler = createPasswordSetterHandler(async () => { calls++; }, "fake-csrf");
  const output = await request(handler, { method: "POST", url: "/probe", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "nonce=fake-csrf" });
  assert.equal(output.status, 200);
  assert.match(output.body, /Navegador compatible/u);
  assert.equal(calls, 0);
  assert.equal((await request(handler, { method: "POST", url: "/probe", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "nonce=wrong" })).status, 403);
});

test("invalid passwords stay out of the response and can be corrected", async () => {
  const fixtureValue = fixture();
  const handler = createPasswordSetterHandler(fixtureValue.attempt, "fake-csrf");
  const invalid = await request(handler, { ...validPost, body: "nonce=fake-csrf&password=visible-secret&confirmation=different" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.includes("visible-secret"), false);
  assert.deepEqual(fixtureValue.calls, []);
  assert.equal((await request(handler, validPost)).status, 200);
});

test("remote errors never echo credentials and do not offer an automatic retry", async () => {
  const output = await request(createPasswordSetterHandler(async () => { throw new Error(`SECRET ${password}`); }, "fake-csrf"), validPost);
  assert.equal(output.status, 409);
  assert.equal(output.body.includes(password), false);
  assert.match(output.body, /No se realizará otro intento automáticamente/u);
});

test("standalone validator has inclusive documented bounds", () => {
  for (const length of [12, 128]) assert.equal(validatePassword("x".repeat(length), "x".repeat(length)).length, length);
});
