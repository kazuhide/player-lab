import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await page.evaluate(() => { (window as unknown as { viewerVideo: HTMLVideoElement | null }).viewerVideo = document.querySelector("video"); });
}

async function sameVideo(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { viewerVideo: HTMLVideoElement | null }).viewerVideo === document.querySelector("video"))).toBe(true);
}

test("previews highlights below the video and preserves playback through tabs, samples and language", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  const viewer = page.locator("#viewer-experiences");
  await expect(viewer).toBeVisible();
  expect(await viewer.evaluate(element => element.closest(".playback-section") !== null)).toBe(true);
  await expect(viewer.getByRole("tab")).toHaveCount(3);
  await expect(page.locator("#viewer-tab-highlights")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#viewer-highlight-list li")).not.toHaveCount(0);
  await page.locator("#viewer-highlight-budget").selectOption("10000");
  await expect(page.locator("#viewer-highlight-list li")).toHaveCount(1);
  await expect(page.locator("#viewer-highlight-total")).toHaveText(/6s|6秒/);
  await page.locator("#viewer-highlight-budget").selectOption("20000");
  await expect(page.locator("#viewer-highlight-list li")).toHaveCount(2);
  await expect(page.locator("#viewer-highlight-start")).toBeEnabled();
  const firstMs = Number(await page.locator("#viewer-highlight-list li").first().getAttribute("data-start-ms"));
  expect(firstMs).toBeGreaterThanOrEqual(0);
  await expect(page.locator("#viewer-highlight-return")).toBeDisabled();
  await page.locator("#viewer-highlight-start").click();
  await expect(viewer).toHaveAttribute("data-mode", "highlights");
  await expect.poll(() => page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime * 1000)).toBeGreaterThanOrEqual(firstMs - 100);
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await page.locator("#viewer-highlight-return").click();
  await expect(viewer).toHaveAttribute("data-mode", "full");
  await page.locator("#viewer-highlight-start").click();
  await expect(viewer).toHaveAttribute("data-mode", "highlights");
  const seek = page.getByRole("slider", { name: /^(Video timeline|再生位置)$/ }).first();
  const bounds = (await seek.boundingBox())!;
  await seek.click({ position: { x: bounds.width * .8, y: bounds.height / 2 } });
  await expect(viewer).toHaveAttribute("data-mode", "full");
  await expect.poll(() => page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(45);
  await page.locator("#viewer-highlight-start").click();
  await expect(viewer).toHaveAttribute("data-mode", "highlights");
  await page.locator("video").evaluate(video => { (video as HTMLVideoElement).playbackRate = 4; });
  await expect(page.locator("#viewer-highlight-list [data-clip-id='clip-2']")).toHaveAttribute("data-active", "true", { timeout: 10_000 });
  await expect(viewer).toHaveAttribute("data-mode", "full", { timeout: 10_000 });
  await expect(page.locator("#viewer-action-status")).toHaveText(/Highlights finished|見どころの再生が終了しました/);
  expect(await page.locator("video").evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
  expect(await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime)).toBeLessThan(47.5);
  await page.locator("video").evaluate(video => { (video as HTMLVideoElement).playbackRate = 1; });
  await page.locator("#viewer-tab-highlights").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#viewer-tab-history")).toBeFocused();
  await expect(page.locator("#viewer-panel-history")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.locator("#viewer-tab-preferences")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("#viewer-tab-highlights")).toBeFocused();
  await page.locator("#profile").selectOption("watched");
  await expect(page.locator("#viewer-highlight-start")).toBeDisabled();
  await page.locator("#profile").selectOption("sparse");
  await expect(page.locator("#viewer-highlight-start")).toBeEnabled();
  await page.locator("#language").click();
  await expect(page.locator("#viewer-tab-highlights")).toHaveText(/Highlights|見どころ/);
  await sameVideo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("uses one saved history at a time and distinguishes partial, empty and completed records", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  await page.locator("#viewer-tab-history").click();
  await page.locator("#viewer-history-example").selectOption("saved");
  const resume = page.locator("#viewer-history-resume");
  await expect(resume).toBeEnabled();
  const target = Number(await resume.getAttribute("data-time-ms"));
  await resume.click();
  await expect.poll(() => page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime * 1000)).toBeGreaterThanOrEqual(target - 100);
  await page.locator(".player-frame").hover();
  await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Pause|一時停止)$/ }).click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "paused");
  await expect(page.locator("#viewer-action-status")).toHaveText(/^(Paused|一時停止)$/);
  await resume.click();
  await expect(page.locator("#viewer-chapters [data-status='partial']")).not.toHaveCount(0);
  await page.locator("#viewer-history-unwatched").click();
  await expect.poll(() => page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(31.9);
  await page.locator("#viewer-data-details summary").click();
  await expect(page.locator("#viewer-data-json")).toContainText('"watchedMs": 38000');
  await expect(page.locator("#viewer-data-json")).toContainText('"resumeMs": 12000');
  await page.locator("#viewer-history-example").selectOption("partial");
  await expect(page.locator("#viewer-history-state")).toHaveText(/Partial history; missing sections are unknown|一部の履歴のみ。記録のない区間は不明です。/);
  await expect(page.locator("#viewer-chapters [data-status='unwatched']")).toHaveCount(0);
  await expect(page.locator("#viewer-data-json")).toContainText('"unwatchedRanges": null');
  await expect(page.locator("#viewer-history-unwatched")).toBeDisabled();
  await page.locator("#viewer-history-example").selectOption("unavailable");
  await expect(page.locator("#viewer-chapters [data-status='unknown']")).toHaveCount(4);
  await expect(page.locator("#viewer-history-unwatched")).toBeDisabled();
  await page.locator("#viewer-history-example").selectOption("completed");
  await expect(page.locator("#viewer-chapters [data-status='watched']")).not.toHaveCount(0);
  await expect(page.locator("#viewer-history-unwatched")).toBeDisabled();
  await page.locator("#viewer-history-example").selectOption("first");
  await expect(resume).toBeDisabled();
  await expect(page.locator("#viewer-chapters [data-status='unwatched']")).not.toHaveCount(0);
  await page.locator("#viewer-history-example").selectOption("saved");
  await page.locator("#viewer-use-history").uncheck();
  await expect(resume).toBeDisabled();
  await page.locator("#viewer-use-history").check();
  await expect(resume).toBeEnabled();
  await page.locator("#viewer-history-clear").click();
  await expect(resume).toBeDisabled();
  await expect(page.locator("#viewer-chapters [data-status='unknown']")).not.toHaveCount(0);
  await page.locator("#viewer-history-example").selectOption("saved");
  await expect(resume).toBeEnabled();
  await page.locator(".player-frame").hover();
  await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Pause|一時停止)$/ }).click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "paused");
  const chapter = page.locator("#viewer-chapters button").nth(2);
  await chapter.focus();
  const scrollY = await page.evaluate(() => window.scrollY);
  await chapter.press("Enter");
  await expect.poll(() => page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime)).toBeLessThan(31.5);
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await expect(chapter).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await sameVideo(page);
  expect(errors).toEqual([]);
});

test("restores real caption preferences with undo and distinguishes missing settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  await page.locator("#viewer-tab-history").click();
  await page.locator("#viewer-history-example").selectOption("saved");
  await page.locator("#viewer-tab-preferences").click();
  await expect(page.locator("#viewer-preference-subtitles")).toHaveAttribute("data-availability", "available");
  await expect(page.locator("#viewer-preference-audio")).toHaveAttribute("data-availability", "available");
  await expect(page.locator("#viewer-preferences-undo")).toBeDisabled();
  await page.locator("#viewer-preferences-apply").click();
  await expect(page.locator("#viewer-preferences-undo")).toBeEnabled();
  const stockSubtitles = page.locator(".bmpui-ui-subtitle-label:visible");
  await expect(stockSubtitles).toHaveText("朝の光が森を照らす。");
  await page.locator("#viewer-preferences-undo").click();
  await expect(stockSubtitles).toHaveCount(0);
  await page.locator("#viewer-tab-highlights").click();
  await expect(page.locator("#viewer-action-status")).toBeEmpty();
  await page.locator("#viewer-tab-preferences").click();
  await page.locator("#viewer-data-details summary").click();
  await expect(page.locator("#viewer-data-json")).toContainText("subtitle_enabled");
  await page.locator("#viewer-tab-history").click();
  await page.locator("#viewer-history-example").selectOption("unknown-settings");
  await page.locator("#viewer-tab-preferences").click();
  await expect(page.locator("#viewer-preference-subtitles")).toHaveAttribute("data-availability", "unknown");
  await expect(page.locator("#viewer-preferences-apply")).toBeDisabled();
  await expect(page.locator("#viewer-data-json")).toContainText('"subtitleEnabled": null');
  await sameVideo(page);
  expect(errors).toEqual([]);
});

test("never offers standard history for a private pack even when its content identity matches", async ({ page }) => {
  await page.route("**/__private/query-data", route => route.fulfill({ json: {
    schemaVersion: 1, metricVersion: "watched-impression-incidence-v1", complete: true,
    content: { id: "bbb-60s", revision: "bbb-60s-demo-v1", durationMs: 60_000 },
    source: { hls: "https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8" },
    period: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" },
    generatedAt: "2026-01-02T00:00:00.000Z", sessionCount: 1, bucketWidthMs: 2_000,
    buckets: Array.from({ length: 30 }, (_, index) => ({ startMs: index * 2000, endMs: (index + 1) * 2000, impressions: 1 })),
  } }));
  await page.goto("/?data=private");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#viewer-experiences")).toHaveAttribute("data-available", "false");
  await expect(page.locator("#viewer-highlight-start")).toBeDisabled();
  await page.locator("#viewer-tab-history").click();
  await expect(page.locator("#viewer-history-resume")).toBeDisabled();
  await expect(page.locator("#viewer-history-example")).toBeDisabled();
  await expect(page.locator("#viewer-chapters li")).toHaveCount(0);
  await page.locator("#viewer-tab-preferences").click();
  await expect(page.locator("#viewer-preferences-apply")).toBeDisabled();
});
