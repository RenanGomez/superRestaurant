import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const AUTH_FILE = process.env.E2E_AUTH_FILE ?? "playwright/.auth/user.json";
const storageState = existsSync(AUTH_FILE) ? AUTH_FILE : undefined;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:8082",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    ...(storageState === undefined ? {} : { storageState }),
  },
  projects: [
    { name: "desktop", testMatch: "ci-smoke.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 800 } } },
    { name: "mobile", testMatch: "ci-smoke.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    {
      name: "offline",
      testMatch: ["offline.spec.ts", "offline-conflicts.spec.ts"],
      timeout: 150_000,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 800 } },
    },
  ],
  webServer: [
    { command: "pnpm --filter @super-restaurant/api start", url: "http://127.0.0.1:3000/api/v1/health", env: { NODE_ENV: "test" }, timeout: 120_000 },
    { command: "pnpm --filter @super-restaurant/web dev --port 8082", url: "http://127.0.0.1:8082/login", timeout: 120_000 },
  ],
});
