import assert from "node:assert/strict";
import test from "node:test";

import { createAuthCallbackConsumer } from "./auth-callback.js";

const accessToken = "synthetic-access-token-for-local-tests";
const refreshToken = "synthetic-refresh-token-for-local-tests";
const completeTokens = `access_token=${accessToken}&refresh_token=${refreshToken}`;

function browserWith(hash: string, response: () => Promise<Response> = async () => new Response(null), search = "") {
  const requests: { input: string | URL | Request; init: RequestInit | undefined }[] = [];
  const scrubbed: (string | URL | null | undefined)[] = [];
  const location = { hash, search };
  const browser = {
    location,
    history: {
      replaceState(_data: unknown, _unused: string, url?: string | URL | null) {
        scrubbed.push(url);
        location.hash = "";
        location.search = "";
      },
    },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(location.hash, "", "fragment must be erased before the request");
      assert.equal(location.search, "", "query must be erased before the request");
      requests.push({ input, init });
      return response();
    },
  };
  return { browser, requests, scrubbed };
}

for (const type of ["recovery", "invite", undefined]) {
  test(`callback validates complete tokens with type ${String(type)} through the existing server endpoint`, async () => {
    const { browser, requests, scrubbed } = browserWith(`#${completeTokens}${type === undefined ? "" : `&type=${type}`}`);
    assert.equal(await createAuthCallbackConsumer()(browser), true);
    assert.deepEqual(scrubbed, ["/auth/callback"]);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      input: "/auth/callback/session",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken, refreshToken }),
        credentials: "same-origin",
        cache: "no-store",
      },
    });
  });
}

test("callback rejects explicit unsupported types, incomplete and malformed tokens without sending them", async () => {
  for (const hash of [
    "", "#type=recovery", `#${completeTokens}&type=signup`, `#${completeTokens}&type=`,
    `#access_token=${accessToken}`, `#refresh_token=${refreshToken}`,
    `#access_token=short&refresh_token=${refreshToken}`,
    `#access_token=${accessToken}&refresh_token=has%20spaces-but-long-enough`,
    `#access_token=${"x".repeat(8_193)}&refresh_token=${refreshToken}`,
  ]) {
    const { browser, requests, scrubbed } = browserWith(hash);
    assert.equal(await createAuthCallbackConsumer()(browser), false);
    assert.equal(requests.length, 0);
    assert.deepEqual(scrubbed, ["/auth/callback"]);
  }
});

test("provider error fields have priority over complete tokens in either fragment or query", async () => {
  for (const key of ["error", "error_code", "error_description"]) {
    for (const inQuery of [false, true]) {
      const error = `${key}=synthetic-provider-message`;
      const { browser, requests, scrubbed } = browserWith(
        `#${completeTokens}&type=recovery${inQuery ? "" : `&${error}`}`,
        undefined,
        inQuery ? `?${error}` : "",
      );
      assert.equal(await createAuthCallbackConsumer()(browser), false);
      assert.equal(requests.length, 0);
      assert.deepEqual(scrubbed, ["/auth/callback"]);
    }
  }
});

test("replayed effects share the in-flight and completed attempt after the URL is erased", async () => {
  let finish: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const { browser, requests, scrubbed } = browserWith(`#${completeTokens}`, () => pending);
  const consume = createAuthCallbackConsumer();
  const first = consume(browser);
  const replay = consume(browser);
  assert.equal(first, replay);
  assert.equal(requests.length, 1);
  assert.deepEqual(scrubbed, ["/auth/callback"]);
  assert.ok(finish);
  finish(new Response(null));
  assert.equal(await first, true);
  assert.equal(await replay, true);
  assert.equal(consume(browser), first);
  assert.equal(requests.length, 1);
});

test("rejected and expired server sessions fail closed and are never automatically retried", async () => {
  for (const status of [400, 401, 429, 500]) {
    const { browser, requests } = browserWith(`#${completeTokens}&type=recovery`, async () => new Response("ignored", { status }));
    const consume = createAuthCallbackConsumer();
    assert.equal(await consume(browser), false);
    assert.equal(await consume(browser), false);
    assert.equal(requests.length, 1);
  }
});

test("network failures yield only a boolean error and do not retry or expose the thrown error", async () => {
  const { browser, requests } = browserWith(`#${completeTokens}`, async () => { throw new Error(accessToken); });
  const consume = createAuthCallbackConsumer();
  assert.equal(await consume(browser), false);
  assert.equal(await consume(browser), false);
  assert.equal(requests.length, 1);
});

test("a failed URL scrub never sends session material", async () => {
  const { browser, requests } = browserWith(`#${completeTokens}`);
  browser.history.replaceState = () => { throw new Error("history unavailable"); };
  assert.equal(await createAuthCallbackConsumer()(browser), false);
  assert.equal(requests.length, 0);
});

test("separate mounted callbacks do not retain another attempt's result", async () => {
  const first = browserWith(`#${completeTokens}`);
  assert.equal(await createAuthCallbackConsumer()(first.browser), true);
  const second = browserWith("");
  assert.equal(await createAuthCallbackConsumer()(second.browser), false);
  assert.equal(second.requests.length, 0);
});
