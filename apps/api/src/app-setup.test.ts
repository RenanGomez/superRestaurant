import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { Body, Controller, Module, Post } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";

import { configureApiApp, JSON_BODY_SIZE_LIMIT } from "./app-setup.js";

@Controller("probe")
class ProbeController {
  @Post()
  echo(@Body() body: { readonly data: string }): { readonly length: number } {
    return { length: body.data.length };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

test("configureApiApp raises the JSON limit to 3mb, keeps the api/v1 prefix and stays bounded", async () => {
  assert.equal(JSON_BODY_SIZE_LIMIT, "3mb");
  const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/api/v1/probe`;
  const send = (size: number) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "a".repeat(size) }) });
  try {
    const accepted = await send(2_500_000);
    assert.equal(accepted.status, 201);
    assert.deepEqual(await accepted.json(), { length: 2_500_000 });
    assert.equal((await send(4_000_000)).status, 413);
  } finally {
    await app.close();
  }
});
