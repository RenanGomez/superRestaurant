import assert from "node:assert/strict";
import test from "node:test";

import { readLocalProxyTarget } from "./kds-proxy-target.js";

test("defaults to the local API and accepts the isolated smoke port", () => {
  assert.equal(readLocalProxyTarget(undefined), "http://127.0.0.1:3001");
  assert.equal(readLocalProxyTarget("http://localhost:4312"), "http://localhost:4312");
});

test("rejects non-local, credentialed, encrypted, or path-bearing proxy targets", () => {
  for (const value of [
    "https://127.0.0.1:4312",
    "http://api.example.com:4312",
    "http://user:password@127.0.0.1:4312",
    "http://127.0.0.1:4312/api",
    "not-a-url",
  ]) assert.throws(() => readLocalProxyTarget(value), /KDS_PROXY_TARGET_INVALID/u);
});
