import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { configureApiApp } from "../app-setup.js";
import { DATABASE_CLIENT } from "../database.js";

let unavailable = false;
@Module({ providers: [{ provide: DATABASE_CLIENT, useValue: { query: async () => {
  if (unavailable) throw new Error("secret database detail");
  return { rows: [] };
} } }] })
class ProbeModule {}

test("health, readiness and metrics report bounded operational information", async () => {
  const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get("x-correlation-id") ?? "", /^[0-9a-f-]{36}$/u);
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    unavailable = true;
    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: "unavailable" });
    const metrics = await (await fetch(`${base}/metrics`)).json() as Record<string, number>;
    assert.equal(metrics.requests, 3);
    assert.equal(metrics.errors, 1);
    assert.ok(metrics.latencyMsTotal! >= 0);
    assert.equal((await fetch(`${base}/health/extra`)).status, 404);
  } finally {
    unavailable = false;
    await app.close();
  }
});
