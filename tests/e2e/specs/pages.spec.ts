import { expect, test, type Page } from "@playwright/test";
import { observePlayback, sourceStartObservation } from "../src/playback-observation";

const analyticsEnabled = process.env.E2E_PAGES_ANALYTICS_ENABLED === "1";
const audits = new WeakMap<Page, { api: string[]; collectors: { method: string; type: string }[]; errors: string[] }>();
test.beforeEach(async ({ page }) => {
  const audit = { api: [] as string[], collectors: [] as { method: string; type: string }[], errors: [] as string[] };
  audits.set(page, audit);
  await page.route(/analytics-ingress[^/]*\.bitmovin\.com/i, async (route) => {
    const request = route.request();
    audit.collectors.push({ method: request.method(), type: request.resourceType() });
    await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/api/")) audit.api.push(url.pathname);
  });
  page.on("pageerror", (error) => audit.errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(audits.get(page)?.api, "static pages must never query a backend API").toEqual([]);
  if (!analyticsEnabled) expect(audits.get(page)?.collectors, "an unconfigured collector must not send requests").toEqual([]);
  expect(audits.get(page)?.errors, "the production application must not raise uncaught errors").toEqual([]);
});

async function openApp(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect.poll(() => videoState(page)).toMatchObject({ ready: true });
}

async function videoState(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("#player video");
    if (!video) return { ready: false, time: 0, frames: 0, duration: 0 };
    const frames = (video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount
      ?? video.getVideoPlaybackQuality().totalVideoFrames;
    return {
      ready: video.readyState >= 3 && video.videoWidth > 0 && frames > 0,
      time: video.currentTime, frames, duration: video.duration,
    };
  });
}

async function expectPlayback(page: Page): Promise<void> {
  // Native HLS may suspend frame presentation while the player is offscreen.
  await page.locator("#player").scrollIntoViewIfNeeded();
  await expect.poll(() => videoState(page)).toMatchObject({ ready: true });
  const initial = await videoState(page);
  expect(initial.duration).toBeGreaterThan(59);
  expect(initial.duration).toBeLessThan(61);
  await expect.poll(async () => {
    const current = await videoState(page);
    return current.time > initial.time + 0.3 && current.frames > initial.frames;
  }).toBe(true);
}

async function openSettings(page: Page): Promise<void> {
  await page.locator("#player").hover();
  await page.locator(".bmpui-ui-settingstogglebutton").click();
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      overflow: document.documentElement.scrollWidth - width,
      elements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => !element.closest("pre, code") && element.getBoundingClientRect().right > width + 1)
        .slice(0, 8).map((element) => ({
          tag: element.tagName, id: element.id, className: element.getAttribute("class"),
          width: element.getBoundingClientRect().width, minWidth: getComputedStyle(element).minWidth,
        })),
    };
  });
  expect(result.overflow, JSON.stringify(result)).toBeLessThanOrEqual(1);
}

test("the built HLS app decodes video under the real project prefix without a dev fallback", async ({ page, request }) => {
  const manifest = page.waitForResponse((response) => response.url().endsWith("/vod-baseline/master.m3u8") && response.status() === 200);
  await openApp(page);
  expect((await manifest).headers()["content-type"]).toContain("mpegurl");
  await expectPlayback(page);
  const entry = await request.get("./");
  expect(entry.status()).toBe(200);
  const html = await entry.text();
  expect(html).toMatch(/src="\/player-lab\/web\/assets\/[^\"]+\.js"/);
  expect(html).not.toContain("@vite/client");
  for (const path of ["missing-page.html", "src/main.ts", "@vite/client"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  expect((await request.head("media/vod-baseline/manifest.mpd")).headers()["content-type"]).toContain("application/dash+xml");
});

test("the bundled DASH preset advances playback and decoded frames", async ({ page }) => {
  await openApp(page);
  const manifest = page.waitForResponse((response) => response.url().endsWith("/vod-baseline/manifest.mpd") && response.status() === 200);
  await page.getByRole("button", { name: "VOD DASH", exact: true }).click();
  await manifest;
  await expectPlayback(page);
});

test("the app and customization guide decode their inline favicon under the project prefix", async ({ page, request }) => {
  const siteIcon = await request.get("../assets/favicon.svg");
  expect(siteIcon.status()).toBe(200);
  const expectedSvg = await siteIcon.text();
  for (const entry of ["./", "guide.html"]) {
    await page.goto(entry);
    const icon = page.locator('head link[rel~="icon"]');
    expect(await icon.count(), entry).toBe(1);
    await expect(icon).toHaveAttribute("type", "image/svg+xml");
    const resolved = await icon.evaluate(async (element: HTMLLinkElement) => {
      const url = new URL(element.href);
      const response = await fetch(url.href);
      const source = await response.text();
      const svg = new DOMParser().parseFromString(source, "image/svg+xml");
      const image = new Image();
      image.src = url.href;
      await image.decode();
      return { source, protocol: url.protocol, status: response.status,
        namespace: svg.documentElement.namespaceURI, root: svg.documentElement.localName,
        width: image.naturalWidth, height: image.naturalHeight };
    });
    expect(resolved, entry).toEqual({ source: expectedSvg, protocol: "data:", status: 200,
      namespace: "http://www.w3.org/2000/svg", root: "svg", width: 30, height: 30 });
  }
});

test("all fourteen original themes render their UI and construction code", async ({ page }) => {
  await openApp(page);
  const themes = page.locator("#ui-theme-bar .theme-btn");
  await expect(themes).toHaveCount(14);
  await expect(page.locator(".theme-cat-label")).toHaveCount(3);
  const sources = new Set<string>();
  for (let index = 0; index < 14; index++) {
    const button = themes.nth(index);
    const label = (await button.textContent())!.trim();
    await button.click();
    await expect(page.locator(".theme-btn.active")).toHaveText(label);
    await expect(page.locator("#player .bmpui-ui-uicontainer")).toHaveCount(1);
    if (label === "Default (Bitmovin)") {
      await expect(page.locator("#player .bmpui-ui-settingstogglebutton")).toHaveCount(1);
    } else {
      const skin = label === "Live (DVR)" ? "live" : label.toLowerCase();
      await expect(page.locator(`#player .bmpui-ui-skin-${skin}`)).toHaveCount(1);
    }
    const construction = page.locator("#ui-construction .theme-diff");
    const code = await construction.locator(".theme-diff-code").textContent();
    expect(code?.trim().length, label).toBeGreaterThan(30);
    expect(code, label).not.toMatch(/[぀-ヿ一-龯]/);
    sources.add((await construction.locator(".theme-diff-codesrc").textContent())!);
    await expect(page.locator("#ui-construction .ui-config-preview code")).toHaveText("const uiConfig = {};");
    await expect(page.locator(".ui-theme-bar-code")).not.toBeEmpty();
  }
  expect(sources.size).toBeGreaterThanOrEqual(8);
  await expect(page.locator("#config-panel .config-band-dynamic .config-group")).toHaveCount(4);
  await expect(page.locator("#config-panel .config-band-static .config-group")).toHaveCount(11);
  await expectPlayback(page);
});

test("the app and guide keep language, relative navigation and document width at mobile and desktop sizes", async ({ page }, testInfo) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);
    for (const [language, label] of [["en", "English"], ["ja", "日本語"]] as const) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expectNoDocumentOverflow(page);
      await testInfo.attach(`pages-app-${language}-${width}`, { body: await page.screenshot(), contentType: "image/png" });
      await expect(page.locator(".ui-guide-link")).toHaveAttribute("href", "./guide.html");
      await page.locator(".ui-guide-link").click();
      await expect(page).toHaveURL(/\/player-lab\/web\/guide\.html$/);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page.locator("#architecture")).toBeVisible();
      await expect(page.locator("#custom-component")).toBeVisible();
      await expectNoDocumentOverflow(page);
      await testInfo.attach(`pages-guide-${language}-${width}`, { body: await page.screenshot(), contentType: "image/png" });
      await expect(page.locator(".guide-back")).toHaveAttribute("href", "./index.html");
      await page.locator(".guide-back").click();
      await expect(page).toHaveURL(/\/player-lab\/web\/index\.html$/);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      // Finish the returned app's initial load before the next navigation.
      await expect.poll(() => videoState(page)).toMatchObject({ ready: true });
    }
  }
});

test("long configuration API names fit the mobile page with a wider fallback font", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openApp(page);
  await page.locator(".config-group-blurb").evaluateAll((elements) => {
    for (const element of elements) element.style.fontFamily = "monospace";
  });
  await expect(page.locator(".config-group-blurb").filter({
    hasText: "set{Catchup,Fallback}Config(LowLatencySyncConfig)",
  })).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test("Pages hides server Analytics queries while preserving the configured collector", async ({ page }, testInfo) => {
  await openApp(page);
  await expect(page.locator(".analytics-panel")).toBeHidden();
  await expect(page.getByRole("heading", { name: /^Bitmovin Analytics/ })).toHaveCount(0);
  await expect(page.locator(".analytics-collector-notice")).toHaveCount(analyticsEnabled ? 1 : 0);
  if (analyticsEnabled) await expect(page.locator(".analytics-collector-notice")).toBeVisible();
  const buttons = page.locator(".analytics-preset");
  await expect(buttons).toHaveCount(4);
  for (const button of await buttons.all()) await expect(button).toBeDisabled();
  await buttons.evaluateAll((elements) => elements.forEach((button) => button.dispatchEvent(new MouseEvent("click", { bubbles: true }))));
  await expect(page.locator(".analytics-status")).toContainText("static host");
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(page.locator(".analytics-panel")).toBeHidden();
  await expect(page.getByRole("heading", { name: /^Bitmovin Analytics/ })).toHaveCount(0);
  if (analyticsEnabled) await expect(page.locator(".analytics-collector-notice")).toContainText("再生情報や端末情報");
  await expect(page.locator(".analytics-status")).toContainText("静的ファイル");
  await expectPlayback(page);
  if (analyticsEnabled) await expect.poll(() => audits.get(page)!.collectors.length).toBeGreaterThan(0);
  await testInfo.attach("intercepted-collector-request-types", {
    body: Buffer.from(JSON.stringify({ enabled: analyticsEnabled, count: audits.get(page)!.collectors.length,
      types: audits.get(page)!.collectors })), contentType: "application/json",
  });
});

test("the original audio menu selects the bundled alternate track", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
  await page.getByRole("button", { name: "VOD + Multi-audio", exact: true }).click();
  await expectPlayback(page);
  await openSettings(page);
  await page.getByRole("menuitem", { name: /^Audio/ }).click();
  await expect(page.getByRole("menuitem", { name: "English test track", exact: true })).toBeVisible();
  const alternate = page.waitForResponse((response) => /chunk-stream3-\d+\.m4s$/.test(response.url()) && response.status() === 200);
  await page.getByRole("menuitem", { name: "German test track", exact: true }).click();
  await alternate;
  await expectPlayback(page);
});

test("the subtitle menu enables and renders the bundled WebVTT cue", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
  const vtt = page.waitForResponse((response) => response.url().endsWith("/assets/sintel_en.vtt") && response.status() === 200);
  await page.getByRole("button", { name: "VOD + Subtitles", exact: true }).click();
  await openSettings(page);
  await page.getByRole("menuitem", { name: /^Subtitles/ }).click();
  await page.getByRole("menuitem", { name: "English", exact: true }).click();
  await vtt;
  await page.locator("#player video").evaluate((element: HTMLVideoElement) => { element.currentTime = 1.5; });
  await expect(page.locator(".bmpui-ui-subtitle-overlay")).toBeVisible();
  await expect(page.locator(".bmpui-ui-subtitle-overlay")).toContainText("This blade has a dark past.");
});

test("the seek bar displays a decoded sprite from the bundled thumbnail track", async ({ page }, testInfo) => {
  await openApp(page);
  await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
  await observePlayback(page);
  await page.getByRole("button", { name: "VOD + Sprites", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__playbackObservation?.sourceLoaded ?? 0)).toBe(1);
  await expectPlayback(page);
  const image = page.waitForResponse((response) => response.url().endsWith("/sprite-0.jpg") && response.status() === 200);
  await page.locator(".bmpui-ui-seekbar .bmpui-seekbar").hover({ position: { x: 20, y: 2 } });
  expect((await image).headers()["content-type"]).toContain("image/jpeg");
  const preview = page.locator(".bmpui-seekbar-thumbnail");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS("background-image", /sprite-0\.jpg/);
  await expect(preview).toHaveCSS("background-size", "1200% 100%");
  await expect(preview).toHaveCSS("background-position", "0% 0%");
  expect(await preview.evaluate((element: HTMLElement) => element.style.paddingBottom)).toBe("56.25%");
  const decoded = await preview.evaluate(async (element) => {
    const url = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(element).backgroundImage)?.[1];
    if (!url) return false;
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth === 1920 && image.naturalHeight === 90;
  });
  expect(decoded).toBe(true);
  await testInfo.attach("pages-sprite-preview", { body: await page.screenshot(), contentType: "image/png" });
});

test("the original config GUI applies runtime, source reload and player recreation changes", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Premiere", exact: true }).click();
  const field = (label: RegExp) => page.locator("#config-panel .config-field").filter({
    has: page.locator(".config-field-label", { hasText: label }),
  });
  const volume = field(/^volume \(0/).locator("input");
  await volume.fill("25");
  await volume.blur();
  const speed = field(/^playbackSpeed/).locator("input");
  await speed.fill("1.25");
  await speed.blur();
  await expect.poll(() => page.locator("#player video").evaluate((video: HTMLVideoElement) => ({
    volume: video.volume, rate: video.playbackRate,
  }))).toEqual({ volume: 0.25, rate: 1.25 });

  const title = field(/^title/).locator("input");
  await title.fill("Pages source configuration");
  await title.blur();
  const offset = field(/^options\.startOffset \(s\)/).locator("input");
  await offset.fill("5");
  await offset.blur();
  const reload = page.getByRole("button", { name: /Reload the source to apply/ });
  await expect(reload).toBeEnabled();
  await observePlayback(page);
  await reload.click();
  await expect(reload).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__playbackObservation?.sourceLoaded ?? 0)).toBe(1);
  await expect(page.locator(".bmpui-label-metadata-title")).toHaveText("Pages source configuration");
  await expectPlayback(page);
  // A slow reader may observe several seconds of legitimate playback after startup.
  await expect.poll(async () => (await videoState(page)).time).toBeGreaterThanOrEqual(8.2);
  const reloaded = await sourceStartObservation(page);
  expect(reloaded).toMatchObject({ sameOwner: true, sourceLoaded: 1, sameSource: true });
  expect(reloaded.firstPlayingTime).not.toBeNull();
  expect(reloaded.firstPlayingTime!).toBeGreaterThanOrEqual(4.9);
  expect(reloaded.firstPlayingTime!).toBeLessThan(8);

  const playback = page.locator("#config-panel .config-group").filter({ has: page.getByText("Playback", { exact: true }) });
  await playback.locator("summary").click();
  await field(/^autoplay/).locator("input").uncheck();
  const initialVolume = field(/^volume \(initial/).locator("input");
  await initialVolume.fill("40");
  await initialVolume.blur();
  const previousVideo = await page.locator("#player video").elementHandle();
  expect(previousVideo).not.toBeNull();
  const recreate = page.getByRole("button", { name: /Recreate the player to apply/ });
  await expect(recreate).toBeEnabled();
  await recreate.click();
  await expect(recreate).toBeDisabled();
  await expect.poll(() => previousVideo!.evaluate((video) => video.isConnected)).toBe(false);
  expect(await sourceStartObservation(page)).toMatchObject({ sameOwner: false, firstPlayingTime: null });
  await expect.poll(() => page.locator("#player video").evaluate((video: HTMLVideoElement) => ({
    paused: video.paused, muted: video.muted, volume: video.volume,
  }))).toEqual({ paused: true, muted: true, volume: 0.4 });
  await expect(page.locator(".panel-log")).toContainText(/sourceloaded/i);
  await expect(page.locator(".bmpui-label-metadata-title")).toHaveText("Pages source configuration");
  await page.locator("#player").scrollIntoViewIfNeeded();
  await page.locator("#player").hover();
  await page.locator(".bmpui-ui-playbacktogglebutton").click();
  await expectPlayback(page);
  await previousVideo!.dispose();
});

test("source start observations retain zero offsets and reject a replaced source", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Premiere", exact: true }).click();
  const title = page.locator("#config-panel .config-field").filter({
    has: page.locator(".config-field-label", { hasText: /^title/ }),
  }).locator("input");
  const offset = page.locator("#config-panel .config-field").filter({
    has: page.locator(".config-field-label", { hasText: /^options\.startOffset \(s\)/ }),
  }).locator("input");
  await offset.fill("0");
  await offset.blur();
  await title.fill("Zero offset source");
  await title.blur();
  const reload = page.getByRole("button", { name: /Reload the source to apply/ });
  await observePlayback(page);
  await reload.click();
  await expectPlayback(page);
  const initial = await sourceStartObservation(page);
  expect(initial).toMatchObject({ sameOwner: true, sourceLoaded: 1, sameSource: true });
  expect(initial.firstPlayingTime).not.toBeNull();
  expect(initial.firstPlayingTime!).toBeGreaterThanOrEqual(0);
  expect(initial.firstPlayingTime!).toBeLessThan(4.9);

  await title.fill("Replacement source");
  await title.blur();
  await reload.click();
  await expect.poll(() => page.evaluate(() => window.__playbackObservation?.sourceLoaded ?? 0)).toBe(2);
  await expectPlayback(page);
  expect(await sourceStartObservation(page)).toEqual({
    sameOwner: true, sourceLoaded: 2, sameSource: false, firstPlayingTime: null,
  });
});
