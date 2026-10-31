import { defineConfig } from '@playwright/test';

const port = Number(process.env.BROWSER_TEST_PORT ?? 19051);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid browser test port');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.spec.mjs',
  forbidOnly: true,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 15_000,
  globalTimeout: 180_000,
  expect: { timeout: 4_000 },
  reporter: 'line',
  use: { baseURL, browserName: 'chromium', serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: ['en', 'ja'].flatMap(language => ['desktop', 'mobile'].map(size => ({
    name: `${language}-${size}`,
    use: { locale: language === 'ja' ? 'ja-JP' : 'en-US', viewport: size === 'mobile' ? { width: 320, height: 780 } : { width: 1280, height: 900 } },
  }))),
  webServer: {
    command: 'node browser/server.mjs',
    url: `${baseURL}/api/config`,
    env: { BROWSER_TEST_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 10_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
  },
});
