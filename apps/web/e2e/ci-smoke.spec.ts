import { expect, test } from "@playwright/test";

test("public login and API health are available", async ({ page, request }) => {
  const health = await request.get("http://127.0.0.1:3000/api/v1/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: "ok" });
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
});
