import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./diagnostics",
  testMatch: "intentional-failure.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: "line",
  use: { browserName: "chromium", channel: "chromium", headless: true, trace: "off", video: "off", screenshot: "off" },
});
