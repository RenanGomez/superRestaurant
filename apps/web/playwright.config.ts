import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const AUTH_FILE = "playwright/.auth/user.json";
const storageState = existsSync(AUTH_FILE) ? AUTH_FILE : undefined;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8082",
    channel: "chrome",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(storageState === undefined ? {} : { storageState }),
  },
  projects: [
    { name: "desktop", grepInvert: /@offline/, use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1366, height: 800 } } },
    { name: "mobile", grepInvert: /@offline/, use: { ...devices["Pixel 7"], channel: "chrome" } },
    { name: "offline", grep: /@offline/, use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1366, height: 800 } } },
  ],
});
