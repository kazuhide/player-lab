import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const PUBLIC_SOURCE = "https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8";
const PRIVATE_DATA_PATH = "/__private/query-data";

function queryData(durationMs = 60_000, sessionCount = 10) {
  return {
    schemaVersion: 1,
    metricVersion: "watched-impression-incidence-v1",
    complete: true,
    content: { id: "example-video", revision: "fixture-v1", durationMs },
    source: { hls: PUBLIC_SOURCE },
    period: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" },
    generatedAt: "2026-01-02T00:00:00.000Z",
    sessionCount,
    bucketWidthMs: 2_000,
    buckets: Array.from({ length: Math.ceil(durationMs / 2_000) }, (_, index) => ({
      startMs: index * 2_000,
      endMs: Math.min((index + 1) * 2_000, durationMs),
      impressions: sessionCount === 0 ? 0 : index < 2 ? 10 : index >= 8 && index <= 11 ? 6 : index >= 18 && index <= 20 ? 8 : 0,
    })),
  };
}

test("keeps the ordinary synthetic demo free of private-data requests", async ({ page }) => {
  const privateRequests: string[] = [];
  page.on("request", request => { if (request.url().includes(PRIVATE_DATA_PATH)) privateRequests.push(request.url()); });
  await page.goto("/");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator(".data-badge")).toHaveText(/Synthetic data|合成データ/);
  await expect(page.locator("#profile")).toBeEnabled();
  await expect(page.locator("#scenario-method")).toBeHidden();
  expect(privateRequests).toEqual([]);
});

test("validates private data before starting playback and preserves missing replay measurements", async ({ page }, testInfo) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const received = new Promise<void>(resolve => { requested = resolve; });
  const accountRequests: string[] = [];
  page.on("request", request => {
    if (/analytics\/queries|analytics\/impressions|analytics\.bitmovin/.test(request.url())) accountRequests.push(request.url());
  });
  await page.route(`**${PRIVATE_DATA_PATH}`, async route => {
    requested();
    await pending;
    await route.fulfill({ json: queryData() });
  });
  await page.goto("/?data=private");
  await received;
  await expect(page.locator("video")).toHaveCount(0);
  release();
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator(".data-badge")).toHaveText("Query API");
  await expect(page.locator("#scenario-method")).toBeHidden();
  await expect(page.locator("#profile")).toBeDisabled();
  await expect(page.locator("#profile option")).toHaveCount(1);
  await expect(page.locator("#session-count")).toContainText("10");
  await expect(page.locator('input[value="reach"]')).toBeChecked();
  await expect(page.locator('input[value="replay"]')).toBeDisabled();
  await expect(page.locator('.metric-choice:has(input[value="reach"]) .metric-name'))
    .toHaveText(/Playback records reaching this section|区間を見た再生記録/);
  await expect(page.locator("#preview-replay")).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#preview-replay-empty")).toHaveText(/Not available|取得なし/);
  await expect(page.locator("#samples")).toBeHidden();
  await expect(page.locator("#samples-link")).toBeHidden();
  await expect(page.locator("#snapshot-link")).toHaveAttribute("href", new RegExp(`${PRIVATE_DATA_PATH}$`));
  await page.locator("#values summary").click();
  const lastRow = page.locator("#values-body tr").last();
  await expect(lastRow.locator("td").nth(1)).toHaveText(/Not available|取得なし/);
  await expect(lastRow.locator("td").nth(2)).toHaveText("0.0%");
  await page.locator("#configuration summary").click();
  await expect(page.locator("#configuration-code")).toContainText(PRIVATE_DATA_PATH);
  await expect(page.locator("#configuration-code")).toContainText("validatePrivateData");
  await expect(page.locator("#configuration-code")).not.toContainText(PUBLIC_SOURCE);
  await page.evaluate(() => { (window as unknown as { originalVideo: HTMLVideoElement | null }).originalVideo = document.querySelector("video"); });
  await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Play|再生)$/ }).click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await page.locator("#peaks button").last().click();
  await expect.poll(() => page.locator("video").evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(30);
  await page.locator("#language").click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await expect(page.locator('.metric-choice:has(input[value="reach"]) .metric-name'))
    .toHaveText(/Playback records reaching this section|区間を見た再生記録/);
  await expect(page.locator("#preview-replay-empty")).toHaveText(/Not available|取得なし/);
  if (await page.locator("html").getAttribute("lang") !== "ja") await page.locator("#language").click();
  await expect(page.locator("#source-title")).toHaveText("検証用動画");
  await expect(page.locator(".bmpui-label-metadata-title").first()).toHaveText("");
  expect(await page.evaluate(() => (window as unknown as { originalVideo: HTMLVideoElement | null }).originalVideo === document.querySelector("video"))).toBe(true);
  expect(accountRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if (process.env.PRIVATE_QUERY_CAPTURE_DIR) {
    await mkdir(process.env.PRIVATE_QUERY_CAPTURE_DIR, { recursive: true });
    await page.locator("#values summary").click();
    await page.locator("#configuration summary").click();
    await page.locator(".player-frame").hover();
    await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Pause|一時停止)$/ }).click();
    for (const language of ["en", "ja"]) {
      if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language").click();
      await page.locator(".player-frame").hover();
      await page.screenshot({ path: path.join(process.env.PRIVATE_QUERY_CAPTURE_DIR, `${testInfo.project.name}-${language}.png`), fullPage: true });
    }
  }
});

test("keeps private fetch failures retryable without starting the default source", async ({ page }) => {
  let available = false;
  await page.route(`**${PRIVATE_DATA_PATH}`, route => available ? route.fulfill({ json: queryData() }) : route.fulfill({ status: 503 }));
  await page.goto("/?data=private");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#session-count")).toHaveText("—");
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator("#retry-data")).toBeVisible();
  available = true;
  await page.locator("#retry-data").click();
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
});

test("rejects an invalid private source before creating a Player", async ({ page }) => {
  const invalid = queryData();
  invalid.source.hls = "javascript:invalid";
  await page.route(`**${PRIVATE_DATA_PATH}`, route => route.fulfill({ json: invalid }));
  await page.goto("/?data=private");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "error");
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator(".pl-engagement-timeline:visible")).toHaveCount(0);
  await expect(page.locator("#preview-replay-empty")).toHaveText(/Not available|取得なし/);
});

test("uses the private duration to reject a mismatched video", async ({ page }) => {
  await page.route(`**${PRIVATE_DATA_PATH}`, route => route.fulfill({ json: queryData(90_000) }));
  await page.goto("/?data=private");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "mismatch", { timeout: 20_000 });
  await expect(page.locator(".pl-engagement-timeline:visible")).toHaveCount(0);
  for (const button of await page.locator("#peaks button").all()) await expect(button).toBeDisabled();
});

test("keeps absent replay unavailable when the private batch contains no playback records", async ({ page }) => {
  await page.route(`**${PRIVATE_DATA_PATH}`, route => route.fulfill({ json: queryData(60_000, 0) }));
  await page.goto("/?data=private");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "empty");
  await expect(page.locator("#session-count")).toContainText("0");
  await expect(page.locator("#preview-replay")).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#preview-replay-empty")).toHaveText(/Not available|取得なし/);
  await expect(page.locator('input[value="reach"]')).toBeDisabled();
  await expect(page.locator('input[value="replay"]')).toBeDisabled();
});

test("loads a fresh local private batch on browser refresh", async ({ page }) => {
  let loads = 0;
  await page.route(`**${PRIVATE_DATA_PATH}`, route => route.fulfill({ json: queryData(60_000, loads++ === 0 ? 10 : 11) }));
  await page.goto("/?data=private");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#session-count")).toContainText("10");
  await page.reload();
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#session-count")).toContainText("11");
  expect(loads).toBe(2);
});
