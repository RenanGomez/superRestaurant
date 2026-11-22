import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "ci-smoke.spec.ts",
  use: { baseURL: "http://127.0.0.1:8082", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 800 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    { command: "pnpm --filter @super-restaurant/api start", url: "http://127.0.0.1:3000/api/v1/health", env: { NODE_ENV: "test" }, timeout: 120_000 },
    { command: "pnpm --filter @super-restaurant/web dev --port 8082", url: "http://127.0.0.1:8082/login", timeout: 120_000 },
  ],
});
