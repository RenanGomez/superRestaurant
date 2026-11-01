import assert from "node:assert/strict";
import test from "node:test";

import { type ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { SupabaseAuthGuard } from "./auth/authentication.js";
import { MenuCatalogImagesController } from "./menu-catalog-images.controller.js";
import { MenuCatalogImageApplicationError, MenuCatalogImageService } from "./menu-catalog-images.js";

const actorId = "8cc7eb84-af2a-4e84-95de-967c39af86ab";

async function authenticatedRequest(): Promise<object> {
  const request = { headers: { authorization: `Bearer ${"x".repeat(20)}` } };
  const guard = new SupabaseAuthGuard({ verifyAccessToken: async () => ({ actorId }) }, new Reflector());
  const context = {
    getClass: () => MenuCatalogImagesController,
    getHandler: () => MenuCatalogImagesController.prototype.copy,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  assert.equal(await guard.canActivate(context), true);
  return request;
}

function controllerWithCopy(copy: MenuCatalogImageService["copy"]): MenuCatalogImagesController {
  return new MenuCatalogImagesController({ copy } as unknown as MenuCatalogImageService);
}

test("copy controller returns the service result for an authenticated request", async () => {
  const result = Object.freeze({
    imagePath: "1e37ae13-8507-484c-969f-2176f77b7000/products/9544c299-d25b-44ce-98ed-d30116610887/00000000000000000000000000000000.jpg",
    publicUrl: "https://example.test/image.jpg",
    schemaVersion: 1 as const,
  });
  const controller = controllerWithCopy(async () => result);
  assert.deepEqual(await controller.copy(await authenticatedRequest(), {}), result);
});

test("copy controller maps request, authorization and missing-source errors", async () => {
  const cases = [
    ["request", 400],
    ["authorization", 403],
    ["not_found", 404],
  ] as const;
  for (const [code, status] of cases) {
    const controller = controllerWithCopy(async () => { throw new MenuCatalogImageApplicationError(code); });
    await assert.rejects(
      controller.copy(await authenticatedRequest(), {}),
      (error: unknown) => error instanceof HttpException && error.getStatus() === status,
    );
  }
});
