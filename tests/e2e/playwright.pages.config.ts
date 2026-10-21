import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const directory = process.env.E2E_PAGES_DIR;
if (!directory) throw new Error("Set E2E_PAGES_DIR to the composed public Pages artifact.");
const root = resolve(directory);
for (const file of ["index.html", "ja/index.html", "web/index.html", "web/guide.html",
  "guide/index.html", "ja/guide/index.html"]) {
  if (!existsSync(resolve(root, file))) throw new Error("The Pages artifact is missing a required HTML entry.");
}
const port = Number(process.env.E2E_PAGES_PORT ?? 5214);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("E2E_PAGES_PORT must be an integer from 1024 to 65535.");
}
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./specs",
  testMatch: ["pages.spec.ts", "user-guide.spec.ts", "api-explorer.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `${origin}/player-lab/web/`,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `python3 ${quote(resolve(__dirname, "serve-pages.py"))} --directory ${quote(root)} --port ${port}`,
    // Probe the server's bound address without DNS; browser URLs retain localhost.
    url: `http://127.0.0.1:${port}/player-lab/web/`,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
