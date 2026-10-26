import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_GENERATED_CODE_PORT ?? 5233);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid generated-code test port.");

export default defineConfig({
  testDir: "./specs", testMatch: "generated-code.spec.ts", workers: 1, retries: 0,
  timeout: 90_000, expect: { timeout: 20_000 }, reporter: "list",
  outputDir: process.env.GENERATED_CODE_RESULTS ?? "test-results/generated-code",
  use: { baseURL: `http://localhost:${port}`, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome", headless: true },
  webServer: {
    command: `pnpm exec vite --config vite.generated-code.config.ts --mode pages --port ${port} --strictPort`,
    url: `http://localhost:${port}`, reuseExistingServer: false, timeout: 60_000,
  },
});
