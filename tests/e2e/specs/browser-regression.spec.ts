import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { startFinalizationServer } from "../src/finalization-server";
import { armSeek, expectCompletedSeek, expectMovingVideo, expectVisiblePixels, hasVisiblePixels, observePlayback, seekObservation } from "../src/playback-observation";

const field = (page: Page, label: RegExp) => page.locator("#config-panel .config-field").filter({
  has: page.locator(".config-field-label", { hasText: label }),
});

test.beforeEach(async ({ page }) => {
  // Test collector delivery is covered separately; these cases use no account API.
  await page.route(/analytics-ingress[^/]*\.bitmovin\.com/i, route => route.fulfill({
    status: 204, headers: { "Access-Control-Allow-Origin": "*" },
  }));
});

async function openApp(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect.poll(() => page.locator("#player video").evaluate((video: HTMLVideoElement) =>
    video.readyState >= 3 && video.videoWidth > 0 && video.currentTime > 0)).toBe(true);
}

test("applied configuration excludes drafts and copies through the browser clipboard", async ({ page }) => {
  await openApp(page);
  await page.locator(".config-code > summary").click();
  const code = page.getByRole("textbox", { name: "Applied configuration code", exact: true });
  const title = field(page, /^title/).locator("input");
  await title.fill("Cross-browser applied title");
  await title.blur();
  await page.getByRole("button", { name: "Refresh code", exact: true }).click();
  await expect(code).not.toHaveValue(/Cross-browser applied title/);
  const reload = page.getByRole("button", { name: /Reload the source to apply/ });
  await reload.click();
  await expect(reload).toBeDisabled();
  // Reload disables its staging button before asynchronous source loading ends.
  // The code panel deliberately requires Refresh after that load completes.
  await expect(async () => {
    await page.getByRole("button", { name: "Refresh code", exact: true }).click();
    await expect(code).toHaveValue(/Cross-browser applied title/, { timeout: 250 });
  }).toPass({ timeout: 25_000, intervals: [100, 250, 500] });
  await expect(code).toHaveValue(/YOUR_PLAYER_KEY/);
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  // No clipboard mock or unsupported Chromium-only permission grant.
  await expect(page.locator(".config-code [role=status]")).toHaveText("Copied.");
  const expected = (await code.inputValue()).replace(/\s+/g, " ").trim();
  await title.fill("");
  await title.press("ControlOrMeta+V");
  // A single-line input normalizes pasted line breaks; retain every code token.
  await expect.poll(async () => (await title.inputValue()).replace(/\s+/g, " ").trim()).toBe(expected);
});

test("the native HLS subtitle rendition is selected in the existing settings menu", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
  await page.getByRole("button", { name: "VOD + Multi-audio", exact: true }).click();
  await page.locator("#player").hover();
  await page.locator(".bmpui-ui-settingstogglebutton").click();
  await page.getByRole("menuitem", { name: /^Subtitles/ }).click();
  await page.getByRole("menuitem", { name: "German test subtitles", exact: true }).click();
  await page.locator(".bmpui-ui-settingstogglebutton").click();
  await page.locator("#player").scrollIntoViewIfNeeded();
  const subtitle = page.locator(".bmpui-ui-subtitle-overlay");
  await expect(subtitle).toContainText("Deutscher Untertiteltest:");
  await expectVisiblePixels(subtitle);
  // A text-only assertion would also accept a transparent ancestor.
  const parent = subtitle.locator("..");
  const originalStyle = await parent.getAttribute("style");
  try {
    await parent.evaluate(element => (element as HTMLElement).style.opacity = "0");
    expect(await hasVisiblePixels(subtitle)).toBe(false);
  } finally {
    await parent.evaluate((element, style) => style === null ? element.removeAttribute("style") : element.setAttribute("style", style), originalStyle);
  }
  await expectVisiblePixels(subtitle);
  await expectMovingVideo(page);
});

test.describe("controlled live rewind through the existing application GUI", () => {
  let media: Awaited<ReturnType<typeof startFinalizationServer>>;
  test.beforeAll(async () => {
    if (!process.env.E2E_PAGES_DIR) throw new Error("Set E2E_PAGES_DIR to the composed Pages artifact.");
    const port = Number(process.env.E2E_CROSS_BROWSER_LIVE_PORT ?? 5350);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid live fixture port.");
    media = await startFinalizationServer(resolve(process.env.E2E_PAGES_DIR, "web/media/vod-baseline"), port);
  });
  test.afterAll(async () => { await media?.close(); });
  test.beforeEach(() => media.reset());

  for (const format of ["hls", "dash"] as const) {
    test(`${format.toUpperCase()} rewinds, returns to live, and switches to finite VOD`, async ({ page }) => {
      await page.route("**/assets/main-*.js", async route => {
        const response = await route.fetch();
        const body = await response.text();
        const reference = format === "hls"
          ? "https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8"
          : "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd";
        expect(body.split(reference)).toHaveLength(2);
        // Substitute the public fixture address only; SDK/UI code is unchanged.
        await route.fulfill({ response, body: body.replace(reference,
          `${media.origin}/${format === "hls" ? "master.m3u8" : "manifest.mpd"}`) });
      });
      await openApp(page);
      await page.getByRole("button", { name: "Live (DVR)", exact: true }).click();
      await observePlayback(page);
      await page.getByRole("button", { name: format === "hls" ? "Live HLS" : "Live DASH + DVR", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__playbackObservation?.sourceLoaded ?? 0)).toBe(1);
      const state = page.locator(".panel-readout");
      await expect(state).toContainText(/mode:\s*live-dvr/);
      await expectMovingVideo(page);
      // A no-op click cannot reuse earlier completion events or an edge readout.
      const negative = await armSeek(page);
      const rewind = page.getByRole("button", { name: "-10s", exact: true });
      await rewind.evaluate(button => button.addEventListener("click", event => {
        event.stopImmediatePropagation();
        button.setAttribute("data-blocked-test-click", "1");
      }, { capture: true, once: true }));
      await rewind.click();
      await expect(rewind).toHaveAttribute("data-blocked-test-click", "1");
      await expectMovingVideo(page);
      expect(await seekObservation(page, negative, -10)).toMatchObject({ sdkCompleted: false, nativeCompleted: false });
      const behind = await armSeek(page);
      await page.getByRole("button", { name: "-10s", exact: true }).click();
      await expectCompletedSeek(page, behind, -10);
      const edge = await armSeek(page);
      await page.getByRole("button", { name: "Go to live edge", exact: true }).click();
      await expectCompletedSeek(page, edge, 0);
      await expect.poll(() => media.counts().mediaRequests).toBeGreaterThan(0);
      await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
      await expect(state).toContainText(/mode:\s*vod/);
      await expect(page.locator('#player [class*="livebutton"]')).toBeHidden();
      await expect.poll(() => page.locator("#player video").evaluate((video: HTMLVideoElement) =>
        Number.isFinite(video.duration) && video.duration > 59 && video.duration < 61
        && !video.paused && video.currentTime > 0)).toBe(true);
    });
  }
});
