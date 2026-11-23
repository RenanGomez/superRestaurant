import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { configureApiApp } from "../app-setup.js";
import { DATABASE_CLIENT } from "../database.js";

let unavailable = false;
let stalled = false;
@Module({ providers: [{ provide: DATABASE_CLIENT, useValue: { query: async () => {
  if (stalled) return new Promise(() => undefined);
  if (unavailable) throw new Error("secret database detail");
  return { rows: [] };
} } }] })
class ProbeModule {}

test("health, readiness and metrics report bounded operational information", async () => {
  const originalToken = process.env.METRICS_TOKEN;
  delete process.env.METRICS_TOKEN;
  const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get("x-correlation-id") ?? "", /^[0-9a-f-]{36}$/u);
    const supplied = await fetch(`${base}/health`, { headers: { "x-correlation-id": "valid-id-123" } });
    assert.equal(supplied.headers.get("x-correlation-id"), "valid-id-123");
    const invalid = await fetch(`${base}/health`, { headers: { "x-correlation-id": "bad!" } });
    assert.match(invalid.headers.get("x-correlation-id") ?? "", /^[0-9a-f-]{36}$/u);
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    unavailable = true;
    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: "unavailable" });
    unavailable = false;
    stalled = true;
    const start = performance.now();
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    assert.ok(performance.now() - start >= 1_800 && performance.now() - start < 5_000);
    stalled = false;
    assert.equal((await fetch(`${base}/metrics`)).status, 404);
    process.env.METRICS_TOKEN = "test-service-token";
    assert.equal((await fetch(`${base}/metrics`)).status, 401);
    assert.equal((await fetch(`${base}/metrics`, { headers: { authorization: "Bearer wrong" } })).status, 401);
    const headers = { authorization: "Bearer test-service-token" };
    const before = await (await fetch(`${base}/metrics`, { headers })).json() as Record<string, number>;
    await fetch(`${base}/health`);
    const after = await (await fetch(`${base}/metrics`, { headers })).json() as Record<string, number>;
    assert.ok(after.requests! >= before.requests! + 2);
    assert.ok(after.errors! >= before.errors!);
    assert.ok(after.latencyMsTotal! >= before.latencyMsTotal!);
    assert.equal((await fetch(`${base}/health/extra`)).status, 404);
  } finally {
    unavailable = false;
    stalled = false;
    if (originalToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = originalToken;
    await app.close();
  }
});

test("access log contains validated scope and correlation ID without query data", async () => {
  const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");
  const logs: string[] = [];
  const original = console.info;
  console.info = (message: unknown) => { logs.push(String(message)); };
  try {
    const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
    const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
    await fetch(`${await app.getUrl()}/unknown?restaurantId=${restaurantId}&branchId=${branchId}&secret=hidden`, { headers: { "x-correlation-id": "request-123" } });
    const log = JSON.parse(logs[0]!) as Record<string, unknown>;
    assert.equal(log.restaurantId, restaurantId);
    assert.equal(log.branchId, branchId);
    assert.equal(log.correlationId, "request-123");
    assert.doesNotMatch(logs[0]!, /hidden/u);
  } finally {
    console.info = original;
    await app.close();
  }
});
