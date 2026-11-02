import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../src/browser-test";
import { installCompatibleDashFixture } from "../src/compatible-dash";

async function captureComparison(page: Page, testInfo: TestInfo, layout: string, language: string): Promise<void> {
  const body = await page.locator("#app").screenshot();
  await testInfo.attach(`comparison-${language}-${layout}.png`, { body, contentType: "image/png" });
  const directory = process.env.E2E_COMPARISON_CAPTURE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `web-comparison-${layout}-${language}.png`), body);
  }
}

for (const language of ["en", "ja"] as const) {
  test(`the ${language} comparison keeps playback visible, measures seeks and supports a fresh run`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("comparison.html");
    await page.getByRole("button", { name: language === "ja" ? "日本語" : "English", exact: true }).click();
    const measure = () => page.getByRole("button", { name: language === "ja" ? /^(計測する|再計測)$/ : /^(Measure|Measure again)$/, exact: true });
    await expect(measure()).toBeEnabled();
    expect(await page.locator(".demo-stage iframe").count()).toBe(0);
    await measure().click();
    await expect(page.getByRole("button", { name: language === "ja" ? "中止" : "Stop", exact: true })).toBeVisible();
    await expect(page.locator('.demo-bar-row[data-metric="startup"][data-value-ms]:not([data-value-ms=""])')).toHaveCount(3);
    await expect(page.locator('.demo-bar-row[data-metric="seek"][data-value-ms]:not([data-value-ms=""])')).toHaveCount(3);
    await expect(measure()).toBeEnabled();
    const video = page.frameLocator(".demo-stage iframe").locator("video");
    const time = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
    await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(time + 0.4);
    await expect(video).toHaveJSProperty("paused", false);
    await page.locator(".demo-details summary").click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: language === "ja" ? "JSONを保存" : "Save JSON", exact: true }).click();
    const download = await pending;
    const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(exported.trials).toHaveLength(3);
    expect(JSON.stringify(exported)).not.toMatch(/https?:|blob:|license|password|token|metadata|authorization|userAgent/i);
    for (const trial of exported.trials) {
      expect(trial.startup.status).toBe("success"); expect(trial.seek.status).toBe("success");
      expect(trial.seek.latencyMs).toBeGreaterThan(0);
    }
    await captureComparison(page, testInfo, "single", language);
    await page.getByRole("button", { name: language === "ja" ? "並べて表示" : "Side by side", exact: true }).click();
    await expect(page.locator(".demo-stage iframe")).toHaveCount(3);
    await expect.poll(async () => {
      const states = await Promise.all(page.frames().filter((frame) => frame.url().includes("demo=1")).map((frame) =>
        frame.locator("video").evaluate((element) => ({ paused: (element as HTMLVideoElement).paused, time: (element as HTMLVideoElement).currentTime }))));
      return states.length === 3 && states.every((state) => !state.paused && state.time > 3);
    }).toBe(true);
    await captureComparison(page, testInfo, "parallel", language);
    await measure().click();
    await expect(page.locator('.demo-bar-row[data-metric="startup"][data-value-ms]:not([data-value-ms=""])')).toHaveCount(3);
    await expect(measure()).toBeEnabled();
    // A second run replaces, rather than appends to, the visible cohort.
    await expect(page.locator('.demo-bar-row[data-metric="seek"][data-value-ms]:not([data-value-ms=""])')).toHaveCount(3);
  });
}

test("custom DASH uses DASH-capable engines and reports hls.js as unsupported", async ({ page }) => {
  await page.goto("comparison.html");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("combobox", { name: "Content", exact: true }).selectOption("custom");
  const fixture = await installCompatibleDashFixture(page);
  const media = new URL(fixture.url);
  media.searchParams.set("token", "do-not-export");
  await page.getByRole("textbox", { name: "Custom URL", exact: true }).fill(media.href);
  await page.getByRole("combobox", { name: "Format", exact: true }).selectOption("dash");
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  await expect(page.getByRole("button", { name: "Measure again", exact: true })).toBeEnabled();
  for (const engine of ["web-x", "shaka"]) {
    await expect(page.locator(`.demo-bar-row[data-engine="${engine}"][data-metric="startup"]`)).not.toHaveAttribute("data-value-ms", "");
  }
  await expect(page.locator('.demo-bar-row[data-engine="hls"][data-metric="startup"]')).toContainText("Unsupported");
  const visibleVideo = page.frameLocator(".demo-video-cell:not([hidden]) iframe").locator("video");
  await expect.poll(() => visibleVideo.evaluate((element) => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  await expect(visibleVideo).toHaveJSProperty("paused", false);
  await page.locator(".demo-details summary").click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save JSON", exact: true }).click();
  const content = await readFile((await (await pending).path())!, "utf8");
  expect(content).not.toContain("do-not-export"); expect(content).not.toContain(media.origin);
  await fixture.dispose();
});

test("DASH parser failures remain visible instead of being shown as zero-duration success", async ({ page }) => {
  await page.goto("comparison.html");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("combobox", { name: "Content", exact: true }).selectOption("custom");
  await page.getByRole("textbox", { name: "Custom URL", exact: true }).fill(new URL("media/vod-baseline/manifest.mpd", page.url()).href);
  await page.getByRole("combobox", { name: "Format", exact: true }).selectOption("dash");
  await expect(page.getByRole("button", { name: "Network change", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  await expect(page.getByRole("button", { name: "Measure again", exact: true })).toBeEnabled();
  const webx = page.locator('.demo-bar-row[data-engine="web-x"][data-metric="startup"]');
  await expect(webx).toHaveAttribute("data-value-ms", "");
  await expect(webx).toContainText("Failed");
  await expect(page.locator('.demo-bar-row[data-engine="shaka"][data-metric="startup"]')).not.toHaveAttribute("data-value-ms", "");
});

test("comparison controls and graphs fit narrow screens", async ({ page }, testInfo) => {
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("comparison.html");
    await page.getByRole("button", { name: "日本語", exact: true }).click();
    await page.getByRole("button", { name: "並べて表示", exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "計測する", exact: true }).focus();
    await expect(page.getByRole("button", { name: "計測する", exact: true })).toBeFocused();
    await testInfo.attach(`comparison-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }
});

test("switching away from an invalid custom URL still allows the default demo to start", async ({ page }) => {
  await page.goto("comparison.html");
  await page.getByRole("button", { name: "English", exact: true }).click();
  const content = page.getByRole("combobox", { name: "Content", exact: true });
  await content.selectOption("custom");
  await page.getByRole("textbox", { name: "Custom URL", exact: true }).fill("invalid media address");
  await content.selectOption("default");
  expect(await page.locator(".demo-toolbar").evaluate((form) => (form as HTMLFormElement).checkValidity())).toBe(true);
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible(); await stop.click(); await expect(stop).toBeHidden();
});

test("a cold network scenario controls each engine and leaves the benchmark outside its worker scope", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("comparison.html");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Network change", exact: true }).click();
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  await expect(page.getByRole("button", { name: "Measure again", exact: true })).toBeEnabled({ timeout: 120_000 });
  await page.locator(".demo-details summary").click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save JSON", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  expect(exported.trials).toHaveLength(3);
  for (const trial of exported.trials) {
    expect(trial.startup.status).toBe("success"); expect(trial.seek).toBeNull();
    expect(trial.networkPhases).toHaveLength(3);
    for (const phase of trial.networkPhases) {
      expect(phase.controlled).toBe(true); expect(phase.deliveredBytes).toBeGreaterThan(0);
    }
  }
  await expect(page.getByRole("img", { name: "Buffered playback time ahead", exact: true })).toBeVisible();
  await page.goto("startup-benchmark.html");
  await expect(page.locator("iframe")).toHaveCount(1);
  const frame = page.frames().find((item) => item.url().includes("comparison-runner.html"))!;
  expect(await frame.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});
