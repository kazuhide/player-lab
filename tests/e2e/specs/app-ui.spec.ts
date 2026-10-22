import { expect, test, type Page } from "@playwright/test";
import type { PlayerAPI } from "bitmovin-player";
import { resolve } from "node:path";

// App-level UI tests — these drive the REAL apps/web (with its custom UI), not the
// ui:false harness the other specs use. They guard the two things that were broken:
// the UI theme selector, and the live→VOD UI switch.
const APP = `http://localhost:${process.env.E2E_APP_PORT ?? "5175"}`;

/** Expose the real SDK instance only in the test response. Optionally disable
 * autoplay on its first construction; SDK methods and sources remain unchanged. */
async function captureAppPlayer(page: Page, autoplayFalse = false, captureUi = false): Promise<void> {
  await page.route("**/src/main.ts", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const constructor = /const instance = new Player\([^\n]+\);/g;
    expect(body.match(constructor), "the app constructor must be captured exactly once").toHaveLength(1);
    const teardown = "const old = player;";
    expect(body.split(teardown), "the capture must clear the reference during teardown").toHaveLength(2);
    const uiBuild = /uiManager = theme\.build\([^\n]+\);/g;
    if (captureUi) expect(body.match(uiBuild), "the UI config must be captured at the actual SDK binding").toHaveLength(1);
    await route.fulfill({
      response,
      body: body.replace(constructor, `${autoplayFalse ? "if (!window.__initialAutoplayFalseApplied) { config.playback = { ...config.playback, autoplay: false }; window.__initialAutoplayFalseApplied = true; }\n" : ""}$&\nwindow.player = instance;`)
        .replace(teardown, `${teardown}\nwindow.player = undefined;`)
        .replace(uiBuild, `$&${captureUi ? "\nwindow.__testUiConfig = uiManager.getConfig();" : ""}`),
    });
  });
  await page.goto(`${APP}/`);
  await expect.poll(() => page.evaluate(() => typeof window.player?.getSource === "function" ? window.player.getSource()?.title : undefined)).toContain("Tears of Steel");
}

function configField(page: Page, label: RegExp) {
  return page.locator("#config-panel .config-field").filter({
    has: page.locator(".config-field-label", { hasText: label }),
  });
}

test("@public live wall-clock text becomes hidden when the source becomes VOD", async ({ page }, testInfo) => {
  await captureAppPlayer(page);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Sports", exact: true }).click();
  const url = `/@fs/${resolve(testInfo.project.testDir, "../../../packages/ui-shared/src/components/WallClockLabel.ts")}`;
  const fixture = await page.evaluateHandle(async (url) => {
    const { WallClockLabel } = await import(/* @vite-ignore */ url);
    const { PlayerEvent } = window.player!.exports;
    const listeners = new Map<string, Set<() => void>>();
    const releases: (() => void)[] = [];
    let live = true;
    // Drive the real component with source events without replacing SDK getters.
    const player = {
      exports: { PlayerEvent },
      isLive: () => live,
      getCurrentTime: () => 1_700_000_000,
      on: (event: string, callback: () => void) => {
        const callbacks = listeners.get(event) ?? new Set<() => void>();
        callbacks.add(callback);
        listeners.set(event, callbacks);
      },
      off: (event: string, callback: () => void) => listeners.get(event)?.delete(callback),
    };
    const dispatch = { dispatch: () => {} };
    const manager = {
      onComponentShow: dispatch, onComponentHide: dispatch, onComponentViewModeChanged: dispatch,
      onRelease: { subscribe: (callback: () => void) => releases.push(callback) },
    };
    const label = new WallClockLabel({ id: "wall-clock-transition-fixture" });
    label.initialize();
    label.configure(player, manager);
    const element = label.getDomElement().get(0);
    document.querySelector("#player .bmpui-ui-controlbar")!.append(element);
    return {
      setLive(value: boolean) {
        live = value;
        for (const callback of listeners.get(PlayerEvent.SourceLoaded) ?? []) callback();
      },
      release() {
        releases.forEach((callback) => callback());
        label.release();
        element.remove();
      },
    };
  }, url);
  const label = page.locator("#wall-clock-transition-fixture");
  try {
    await expect(label).toBeVisible();
    await expect(label).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    const liveText = await label.innerText();
    await fixture.evaluate((fixture) => fixture.setLive(false));
    await expect(label).toHaveClass(/bmpui-hidden/);
    // Retained nonempty live text must not remain painted on the VOD controls.
    await expect(label).toHaveText(liveText);
    await expect(label).toHaveCSS("display", "none");
    await expect(label).toBeHidden();
    await fixture.evaluate((fixture) => fixture.setLive(true));
    await expect(label).not.toHaveClass(/bmpui-hidden/);
    await expect(label).toBeVisible();
  } finally {
    await fixture.evaluate((fixture) => fixture.release());
    await fixture.dispose();
  }
});

for (const language of ["en", "ja"] as const) {
  test(`@public detailed panels match the existing controls and support keyboard use (${language})`, async ({ page }) => {
    await page.goto(`${APP}/`);
    if (language === "en") await page.getByRole("button", { name: "English", exact: true }).click();
    const applied = page.locator(".config-code");
    await applied.locator("summary").focus();
    await applied.locator("summary").press("Enter");
    await expect(applied).toHaveAttribute("open", "");
    await expect(applied.locator("textarea")).toBeVisible();
    await expect(applied.locator("textarea")).toHaveAttribute("readonly", "");

    const explorer = page.locator(".api-explorer");
    await explorer.locator("summary").focus();
    await explorer.locator("summary").press("Space");
    await expect(explorer).toHaveAttribute("open", "");
    const search = explorer.locator('input[type="search"]');
    await expect(search).toBeVisible();
    await search.fill("SourceConfig.title");
    await explorer.locator("select[size]").selectOption("SourceConfig.title");

    const style = async (selector: string, properties: string[]) => page.locator(selector).first().evaluate((element, properties) => {
      const style = getComputedStyle(element);
      return properties.map(property => style.getPropertyValue(property));
    }, properties);
    const summaryProperties = ["font-family", "font-size", "font-weight", "line-height"];
    const summaryStyle = await style(".config-group > summary", summaryProperties);
    for (const selector of [".config-code > summary", ".api-explorer > summary"]) {
      expect(await style(selector, summaryProperties)).toEqual(summaryStyle);
    }
    const buttonProperties = ["font-family", "font-size", "color", "border-color", "border-radius", "padding"];
    const buttonStyle = await style("#control-panel button", buttonProperties);
    for (const selector of [".config-code button", ".api-explorer button"]) {
      expect(await style(selector, buttonProperties)).toEqual(buttonStyle);
    }
    const inputProperties = ["font-family", "font-size", "border-color", "border-radius"];
    expect(await style('.api-explorer input[type="search"]', inputProperties)).toEqual(
      await style('#config-panel input:not([type="checkbox"])', inputProperties),
    );
    const codeProperties = ["font-family", "font-size", "line-height", "background-color"];
    expect(await style(".config-code textarea", codeProperties)).toEqual(await style(".theme-diff-code", codeProperties));
    expect(await style(".api-event-log", codeProperties)).toEqual(await style(".panel-log", codeProperties));

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await search.focus();
      await expect(search).toBeFocused();
      expect(await search.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
      await search.press("Tab");
      await expect(explorer.locator(".api-explorer-list > select").first()).toBeFocused();
      const layout = await page.evaluate(() => {
        const code = document.querySelector(".config-code textarea")!.getBoundingClientRect();
        return { width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth,
          codeLeft: code.left, codeRight: code.right };
      });
      expect(layout.content, `document overflows at ${width}px`).toBeLessThanOrEqual(layout.width);
      expect(layout.codeLeft).toBeGreaterThanOrEqual(0);
      expect(layout.codeRight).toBeLessThanOrEqual(layout.width);
    }
  });

  test(`@public construction code and applied UI settings remain readable across widths (${language})`, async ({ page }) => {
    await page.goto(`${APP}/`);
    if (language === "en") await page.getByRole("button", { name: "English", exact: true }).click();
    for (const width of [760, 375, 880, 900, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole("button", { name: "Premiere", exact: true }).click();
      const construction = page.locator("#ui-construction");
      const snippet = construction.locator(".theme-diff .theme-diff-code");
      await snippet.scrollIntoViewIfNeeded();
      await expect(snippet, `construction code is clipped at ${width}px`).toBeInViewport({ ratio: 0.1 });
      const layout = await page.evaluate(() => {
        const player = document.querySelector("#player")!.getBoundingClientRect();
        const panel = document.querySelector("#ui-construction")!.getBoundingClientRect();
        const diff = document.querySelector("#ui-construction .theme-diff")!;
        const controls = document.querySelector("#control-panel")!.getBoundingClientRect();
        return { stacked: panel.top >= player.bottom - 1, playerHeight: player.height,
          panelHeight: panel.height, panelBottom: panel.bottom, controlsTop: controls.top,
          contentHeight: diff.scrollHeight, visibleContentHeight: diff.clientHeight };
      });
      if (layout.stacked) {
        expect(layout.visibleContentHeight, `stacked code must flow at ${width}px`).toBeGreaterThanOrEqual(layout.contentHeight - 1);
      } else {
        expect(Math.abs(layout.panelHeight - layout.playerHeight)).toBeLessThanOrEqual(1);
      }
      expect(layout.panelBottom).toBeLessThanOrEqual(layout.controlsTop);
      const preview = construction.locator(".ui-config-preview");
      // A normal pointer click also rejects a summary covered by the theme card.
      await preview.locator("summary").click({ timeout: 5000 });
      await expect(preview).toHaveAttribute("open", "");
      await preview.locator("code").scrollIntoViewIfNeeded();
      await expect(preview.locator("code")).toBeInViewport();
      const appliedCode = await preview.locator("code").innerText();
      expect(appliedCode).toMatch(/^const uiConfig = \{[\s\S]*\};$/);
      const applied = JSON.parse(appliedCode.slice("const uiConfig = ".length, -1));
      expect(applied).toStrictEqual({ metadata: {
        recommendations: [{ title: "VOD DASH (Big Buck Bunny)", resource: {
          dash: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd", title: "VOD DASH (Big Buck Bunny)",
        } }],
        markers: [{ time: 120, title: "Chapter 1" }, { time: 360, title: "Chapter 2" }, { time: 600, title: "Chapter 3" }],
      } });
      const diffBottom = await construction.locator(".theme-diff").evaluate((el) => el.getBoundingClientRect().bottom);
      const previewTop = await preview.evaluate((el) => el.getBoundingClientRect().top);
      expect(previewTop, "the applied settings follow the theme construction code").toBeGreaterThanOrEqual(diffBottom - 1);
    }
  });
}

test("@public network configuration validates drafts and source poster changes preserve the player", async ({ page }) => {
  await captureAppPlayer(page);
  await page.getByRole("button", { name: "English", exact:true }).click();
  const network = page.locator("#config-panel .config-group").filter({ has:page.getByText("Network", { exact:true }) });
  await expect(network).toHaveCount(1);
  await network.locator("summary").click();
  const original = await page.evaluateHandle(() => window.player);
  const baselineTimeout = await page.evaluate(() => window.player?.getConfig(false).network?.defaultRequestTimeout);
  const defaultTimeout = configField(page, /^defaultRequestTimeout \(s\)/).locator("input");
  await defaultTimeout.fill("12.5");
  await defaultTimeout.blur();
  await configField(page, /^requestApi$/).locator("select").selectOption("fetch");
  const manifest = configField(page, /^requestTimeout\[manifest\/dash\]/).locator("input");
  await manifest.fill("7.25");
  await manifest.blur();
  const video = configField(page, /^requestTimeout\[media\/video\]/).locator("input");
  await video.fill("-1");
  await video.blur();
  const recreate = page.getByRole("button", { name:/Recreate the player to apply/ });
  await expect(video).toHaveAttribute("aria-invalid", "true");
  await expect(recreate).toBeDisabled();
  expect(await original.evaluate((player) => player === window.player)).toBe(true);
  await video.fill("9.5");
  await video.blur();
  await expect(video).not.toHaveAttribute("aria-invalid", "true");
  await expect(recreate).toBeEnabled();
  await recreate.click();
  await expect.poll(() => original.evaluate((player) => player !== window.player)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const config = window.player?.getConfig(false).network;
    return { api:config?.requestApi, timeout:config?.defaultRequestTimeout,
      dash:config?.requestTimeout?.["manifest/dash"], video:config?.requestTimeout?.["media/video"] };
  })).toEqual({ api:"fetch", timeout:12.5, dash:7.25, video:9.5 });
  await original.dispose();

  const current = await page.evaluateHandle(() => window.player);
  const persistentPoster = configField(page, /^options\.persistentPoster/).locator("input");
  await persistentPoster.check();
  await page.getByRole("button", { name:/Reload the source to apply/ }).click();
  await expect.poll(() => page.evaluate(() => window.player?.getSource()?.options?.persistentPoster)).toBe(true);
  expect(await current.evaluate((player) => player === window.player)).toBe(true);
  await current.dispose();

  if (await network.getAttribute("open") === null) await network.locator("summary").click();
  await defaultTimeout.fill("");
  await defaultTimeout.blur();
  await recreate.click();
  await expect.poll(() => page.evaluate(() => window.player?.getConfig(false).network?.defaultRequestTimeout)).toBe(baselineTimeout);
  await expect.poll(() => page.evaluate(() => window.player?.getSource()?.options?.persistentPoster)).toBe(true);
});

test("@public initial UI language matches the SDK default and auto follows the browser", async ({ browser }) => {
  const context = await browser.newContext({ locale: "de-DE" });
  try {
    const page = await context.newPage();
    await captureAppPlayer(page, false, true);
    await page.getByRole("button", { name: "English", exact: true }).click();
    const language = page.getByRole("textbox", { name: /Player UI language/ });
    const fullscreen = page.locator("#player .bmpui-ui-fullscreentogglebutton").first();
    await expect(language).toHaveValue("en");
    await expect(fullscreen).toHaveAttribute("aria-label", "Fullscreen");
    await language.fill("auto");
    await language.blur();
    await expect(fullscreen).toHaveAttribute("aria-label", "Vollbild");
    expect(await page.evaluate(() => window.__testUiConfig?.localization?.language)).toBe("auto");
  } finally {
    await context.close();
  }
});

test("@public UI language and preference settings reach the SDK without recreating the player", async ({ page }) => {
  await captureAppPlayer(page, false, true);
  await page.getByRole("button", { name:"English", exact:true }).click();
  const original = await page.evaluateHandle(() => window.player);
  const ui = page.locator("#control-panel .panel-section").filter({ has:page.getByRole("heading", { name:"UI settings", exact:true }) });
  const language = ui.getByRole("textbox", { name:/Player UI language/ });
  await language.fill("de");
  await language.blur();
  await expect(page.locator("#player .bmpui-ui-fullscreentogglebutton").first()).toHaveAttribute("aria-label", "Vollbild");
  await ui.getByRole("checkbox", { name:/Follow subtitle language/ }).check();
  await ui.getByRole("checkbox", { name:/Remember playback preferences/ }).check();
  await ui.getByRole("checkbox", { name:/Resume VOD position/ }).check();
  await ui.getByRole("checkbox", { name:/Read timestamp from URL/ }).uncheck();
  await ui.getByRole("checkbox", { name:/Preference switch in default settings/ }).check();
  expect(await page.evaluate(() => {
    const config = window.__testUiConfig;
    return { language:config?.localization?.language, follow:config?.localization?.adaptLocalizationToSubtitleLanguage,
      preferences:config?.enablePersistentPreferences, resume:config?.enableResumeFromLastPosition,
      timestamp:config?.enableTimestampDeepLink, toggle:config?.showPersistentPreferencesToggle };
  })).toEqual({ language:"de", follow:true, preferences:true, resume:true, timestamp:false, toggle:true });
  await expect(page.locator("#player .bmpui-ui-persistentpreferencestogglebutton")).toHaveCount(0);
  await page.getByRole("button", { name:"Default (Bitmovin)", exact:true }).click();
  await expect(page.locator("#player .bmpui-ui-persistentpreferencestogglebutton")).toHaveCount(1);
  await page.getByRole("button", { name:"Neon", exact:true }).click();
  await expect(page.locator("#player .bmpui-ui-persistentpreferencestogglebutton")).toHaveCount(1);
  await expect(page.locator("#ui-construction .ui-config-preview code")).toContainText('"enablePersistentPreferences": true');
  expect(await original.evaluate((player) => player === window.player)).toBe(true);
  await language.fill("fr");
  await language.blur();
  expect(await page.evaluate(() => window.__testUiConfig?.localization)).toMatchObject({ language:"fr", adaptLocalizationToSubtitleLanguage:true });
  await ui.getByRole("checkbox", { name:/Disable UI storage/ }).check();
  await expect(page.locator("#player .bmpui-ui-persistentpreferencestogglebutton")).toHaveCount(0);
  await page.getByRole("button", { name:"Creator", exact:true }).click();
  expect(await page.evaluate(() => window.__testUiConfig?.localization)).toMatchObject({ language:"fr", adaptLocalizationToSubtitleLanguage:true });
  expect(await original.evaluate((player) => player === window.player)).toBe(true);
  await original.dispose();
});

test("@public SDK UI settings remove the speed control and preserve themed quick seek", async ({ page }) => {
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Premiere", exact: true }).click();
  const speed = page.locator("#player .bmpui-ui-playbackspeedselectbox");
  await expect(speed).toHaveCount(1);
  await expect(page.locator("#player .bmpui-ui-quickseekbutton")).toHaveCount(2);
  const toggle = page.getByRole("checkbox", { name: /Speed item in settings gear/ });
  await toggle.uncheck();
  await expect(speed).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator("#player .bmpui-ui-quickseekbutton")).toHaveCount(2);
  await toggle.check();
  await expect(speed).toHaveCount(1);
  await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
  await expect(page.locator("#player .bmpui-ui-quickseekbutton")).toHaveCount(0);
  await expect(page.locator("#player .bmpui-ui-captiontogglebutton")).toHaveCount(0);
  await expect(page.locator("#player .bmpui-ui-watermark")).toHaveCount(0);
});

test("@public SDK UI settings release excluded setting controls once", async ({ page }, testInfo) => {
  await captureAppPlayer(page);
  const helper = `/@fs/${resolve(testInfo.project.testDir, "../../../packages/ui-shared/test/browser-release.ts")}`;
  const results = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    return module.inspectExcludedSettingsRelease(window.player!);
  }, helper) as { factory: string; remainingSpeedControls: number; excludedSpeedControls: number; releasedExactlyOnce: boolean; stoppedLocalizing: boolean }[];
  expect(results).toHaveLength(4);
  for (const result of results) {
    expect(result.remainingSpeedControls, result.factory).toBe(0);
    expect(result.excludedSpeedControls, result.factory).toBe(1);
    expect(result.releasedExactlyOnce, JSON.stringify(result)).toBe(true);
    expect(result.stoppedLocalizing, result.factory).toBe(true);
  }
});

for (const scenario of ["released", "superseded", "active-failure", "active-abort", "released-failure", "released-intent", "pause", "released-pause", "external-source", "unload", "destroy", "play-failure", "superseded-unload-pending", "superseded-external-source", "superseded-unload", "destroy-before-notify", "destroy-notify-invalid", "external-source-play", "active-load-abort", "destroyed-failure", "pause-next-before-unload", "pause-next-after-unload", "pause-next-external-source", "pause-next-external-unload", "pause-next-after-external-unload", "pause-cancelled-load", "pause-receipt-destroy", "active-sdk-cancel", "active-destroy-cancel-message", "destroyed-sdk-cancel", "native-pause", "api-load-forwarding", "api-same-object", "api-unload-forwarding", "api-load-sync-throw", "api-unload-sync-throw", "api-successor", "api-genuine-failure"] as const) {
  test(`@public SDK recommendation promises retain ownership: ${scenario}`, async ({ page }, testInfo) => {
    await captureAppPlayer(page, scenario.startsWith("pause-"));
    if (scenario === "pause" || scenario === "released-pause" || scenario === "native-pause") {
      await expect.poll(() => page.evaluate(() => window.player!.isPlaying())).toBe(true);
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const helper = `/@fs/${resolve(testInfo.project.testDir, "../../../packages/ui-shared/test/browser-release.ts")}`;
    const result = await page.evaluate(async ({ url, scenario }) => {
      const module = await import(/* @vite-ignore */ url);
      return module.inspectRecommendationPromises(window.player!, scenario);
    }, { url: helper, scenario });
    const clicks = scenario === "superseded-external-source" || scenario === "pause-next-external-source" || scenario === "api-successor" ? 3
      : ["api-load-forwarding", "api-same-object", "api-genuine-failure"].includes(scenario) || scenario.startsWith("superseded") || scenario.startsWith("pause-next-") || scenario === "external-source" || scenario === "external-source-play" ? 2 : 1;
    const plays = ["api-load-sync-throw", "api-unload-sync-throw", "api-successor", "native-pause", "pause-next-before-unload", "pause-next-after-unload", "superseded", "superseded-unload-pending", "external-source-play", "active-abort", "released-intent", "play-failure"].includes(scenario) ? 1 : 0;
    expect(result).toEqual({ loads: clicks, plays, listeners: 0, pauseRestored: true, loadRestored: true, unloadRestored: true });
    if (scenario === "active-failure" || scenario === "released-failure" || scenario === "destroyed-failure" || scenario === "api-genuine-failure") {
      expect(errors).toEqual(["Recommendation fixture load failed"]);
    } else if (scenario === "play-failure") {
      expect(errors).toEqual(["Recommendation fixture play failed"]);
    } else if (scenario === "active-sdk-cancel") {
      expect(errors).toEqual(["Load call was cancelled by another load or unload call"]);
    } else if (scenario === "active-destroy-cancel-message") {
      expect(errors).toEqual(["Load was cancelled as the player is being destroyed"]);
    } else if (scenario === "active-load-abort") {
      expect(errors).toEqual(["Active recommendation load abort"]);
    } else if (scenario === "active-abort") {
      expect(errors).toEqual(["Active recommendation abort"]);
    } else {
      expect(errors).toEqual([]);
    }
  });
}

test("@public SDK recommendation promises survive real API invalidation before Destroy", async ({ page }, testInfo) => {
  await captureAppPlayer(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const helper = `/@fs/${resolve(testInfo.project.testDir, "../../../packages/ui-shared/test/browser-release.ts")}`;
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    return module.inspectRealRecommendationDestroy();
  }, helper);
  expect(result).toEqual({ plays: 0, invalidatedSynchronously: true, notifiedSynchronously: false, destroyNotified: true });
  expect(errors).toEqual([]);
});

for (const scenario of ["superseded", "paused-previous", "paused-current", "destroyed", "external-load", "external-same-object", "external-unload"] as const) {
  test(`@public SDK real recommendation race: ${scenario}`, async ({ page }, testInfo) => {
    await captureAppPlayer(page, true);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect.poll(() => page.evaluate(() => window.player!.getVideoElement().readyState)).toBeGreaterThanOrEqual(3);
    if (scenario.startsWith("paused-")) {
      await page.evaluate(() => window.player!.play());
      await expectDecodedPlayback(page);
    }
    const helper = `/@fs/${resolve(testInfo.project.testDir, "../../../packages/ui-shared/test/browser-release.ts")}`;
    try {
      const initial = await page.evaluate(async ({ url, scenario }) => {
        const module = await import(/* @vite-ignore */ url);
        return module.startRealRecommendationRace(window.player!, scenario);
      }, { url: helper, scenario });
      expect(initial).toEqual({ autoplay: false, playing: scenario.startsWith("paused-") });
      if (scenario === "external-unload") {
        await expect.poll(() => page.evaluate(() => window.player!.getSource())).toBeNull();
        expect(await page.evaluate(() => window.player!.isPlaying())).toBe(false);
        await page.waitForTimeout(100); // Drain the retired recommendation rejection after unload.
      } else if (scenario !== "destroyed") {
        await expect.poll(() => page.evaluate(() => window.player!.getSource()?.title))
          .toBe(scenario === "external-same-object" ? "Race recommendation A" : "Race recommendation B");
        await expect.poll(() => page.evaluate(() => window.player!.getVideoElement().readyState)).toBeGreaterThanOrEqual(3);
        if (scenario === "paused-current" || scenario.startsWith("external-")) {
          const before = await page.evaluate(() => window.player!.getVideoElement().currentTime);
          await page.waitForTimeout(300); // Span queued Paused delivery and load/play settlement.
          expect(await page.evaluate(() => ({ paused: window.player!.getVideoElement().paused,
            playing: window.player!.isPlaying(), time: window.player!.getVideoElement().currentTime })))
            .toEqual({ paused: true, playing: false, time: before });
        } else {
          await expectDecodedPlayback(page);
        }
      } else {
        await page.waitForTimeout(100); // Allow the retired real load promise to reject after Destroy.
      }
      expect(errors).toEqual([]);
    } finally {
      await page.evaluate(async (url) => {
        const module = await import(/* @vite-ignore */ url);
        module.releaseRealRecommendationRace(window.player!);
      }, helper);
    }
  });
}

async function expectDecodedPlayback(page: Page): Promise<void> {
  const before = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("#player video")!;
    return { time: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames };
  });
  await expect.poll(() => page.evaluate((before) => {
    const video = document.querySelector<HTMLVideoElement>("#player video");
    return !!video && !video.paused && video.currentTime > before.time + 0.2 &&
      video.getVideoPlaybackQuality().totalVideoFrames > before.frames;
  }, before)).toBe(true);
}

test("@public released factory controls stop localizing and release auxiliary children once", async ({ page }, testInfo) => {
  await captureAppPlayer(page);
  const helper = `/@fs/${resolve(testInfo.project.testDir, "../../../packages/ui-shared/test/browser-release.ts")}`;
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    return module.inspectFactoryRelease(window.player!);
  }, helper) as { stockReleased: number; results: {
    factory: string; auxiliaryComponents: number; unlistedSettingLabels: number; releasedExactlyOnce: boolean;
    localizedWhileActive: boolean; localizedAfterRelease: boolean; adoptedChildren: boolean;
    icons: number; iconsReleasedExactlyOnce: boolean; iconsStoppedLocalizing: boolean;
  }[] };
  expect(result.results).toHaveLength(9);
  expect(result.stockReleased, "release the discarded stock root, preserving its adopted children").toBe(1);
  expect(result.results.find((value) => value.factory === "Default")!.unlistedSettingLabels).toBeGreaterThan(0);
  for (const value of result.results) {
    expect(value.auxiliaryComponents, value.factory).toBeGreaterThan(0);
    expect(value.adoptedChildren, value.factory).toBe(true);
    expect(value.localizedWhileActive, value.factory).toBe(true);
    expect(value.releasedExactlyOnce, value.factory).toBe(true);
    expect(value.localizedAfterRelease, value.factory).toBe(false);
    expect(value.icons, value.factory).toBeGreaterThan(0);
    expect(value.iconsReleasedExactlyOnce, JSON.stringify(value)).toBe(true);
    expect(value.iconsStoppedLocalizing, value.factory).toBe(true);
  }
});

test("@public UI managers remove all owned source subscriptions on release", async ({ page }, testInfo) => {
  await captureAppPlayer(page);
  const helper = `/@fs/${resolve(testInfo.project.testDir, "../../../packages/ui-shared/test/browser-release.ts")}`;
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    return module.inspectManagerSourceSubscriptions(window.player!);
  }, helper) as { registered: number[]; remaining: number[] };
  expect(result.registered).toHaveLength(2);
  expect(result.registered.every((count) => count > 0)).toBe(true);
  expect(result.remaining).toEqual([0, 0]);
});

test("@public removed recommendation labels stop localizing and release once", async ({ page }, testInfo) => {
  await captureAppPlayer(page);
  const helper = `/@fs/${resolve(testInfo.project.testDir, "../../../packages/ui-shared/test/browser-release.ts")}`;
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    return module.inspectRecommendationControlRelease(window.player!);
  }, helper);
  expect(result).toEqual({ labels: 6, removedLabels: 2, removedReleased: true, allReleasedOnce: true, stoppedLocalizing: true });
});

async function openConfigGroup(page: Page, title: string): Promise<void> {
  const group = page.locator("#config-panel .config-group").filter({
    has: page.getByText(title, { exact: true }),
  });
  if (await group.getAttribute("open") === null) await group.locator("summary").click();
}

/** Read the control panel's derived mode + whether the LIVE button is visible. */
async function uiState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const ro = document.querySelector(".panel-readout")?.textContent ?? "";
    const lb = document.querySelector('[class*="livebutton"]');
    return {
      mode: /mode:\s*(\S+)/.exec(ro)?.[1],
      dvrAvailable: /dvrAvailable:\s*(\S+)/.exec(ro)?.[1],
      // Use the COMPUTED display, not the bmpui-hidden class: a CSS specificity bug once
      // left the "hidden" pill at display:flex (visible) on VOD while the class was set,
      // and a class-only check missed it. Actual visibility is what matters.
      liveButtonVisible: lb ? getComputedStyle(lb).display !== "none" : false,
    };
  });
}

test.describe("Web app UI", () => {
  test("theme selector swaps the UI build across all themes", async ({ page }) => {
    await page.goto(`${APP}/`);
    // Load a VOD source first: this is a composition test, and the stock theme's
    // quality-settings button only appears once a multi-rendition source is loaded —
    // so it must not hinge on whether the live default source is reachable.
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await page.waitForTimeout(3000);
    // Default theme is the custom Live (DVR) build → has the custom LIVE button, no stock settings button.
    await expect(page.locator('[class*="livebutton"]')).toHaveCount(1);
    await expect(page.locator('[class*="settingstogglebutton"]')).toHaveCount(0);

    // → Default (Bitmovin): the stock UI has a settings button and no custom LIVE button.
    await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
    await expect(page.locator('[class*="settingstogglebutton"]')).toHaveCount(1);
    await expect(page.locator('[class*="livebutton"]')).toHaveCount(0);

    // → Neon (Default UI + CSS): a CSS-only re-skin of the DEFAULT tree → the neon skin
    // class is present, and because it's the Default tree there is NO custom LIVE button.
    await page.getByRole("button", { name: "Neon", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-neon"]')).toHaveCount(1);
    await expect(page.locator('[class*="livebutton"]')).toHaveCount(0);
    // The selected theme button reads as active (blue). Guards a specificity regression:
    // `#ui-theme-bar button` (1,0,1) would otherwise outrank `.theme-btn.active` (0,2,0).
    const activeBg = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll(".theme-btn")).find((b) => b.classList.contains("active"));
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    expect(activeBg).toBe("rgb(43, 108, 255)");

    // → Glass (Default UI + CSS): another CSS-only re-skin of the Default tree → glass class, still no LIVE button.
    await page.getByRole("button", { name: "Glass", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-glass"]')).toHaveCount(1);
    await expect(page.locator('[class*="livebutton"]')).toHaveCount(0);

    // → Cinema (Custom UI): a different composition → the cinema skin class is present.
    await page.getByRole("button", { name: "Cinema", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-cinema"]')).toHaveCount(1);

    // → Sunset / Bold (Default UI + CSS): more CSS-only re-skins of the Default tree.
    await page.getByRole("button", { name: "Sunset", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-sunset"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-bold"]')).toHaveCount(1);

    // → Compact (Custom UI): a slim composition (no center overlay).
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-compact"]')).toHaveCount(1);

    // → Mono (Default UI + CSS): a CSS-only re-skin of the Default tree → mono class, no LIVE button.
    await page.getByRole("button", { name: "Mono", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-mono"]')).toHaveCount(1);
    await expect(page.locator('[class*="livebutton"]')).toHaveCount(0);

    // → back to Live (DVR) (Custom UI): the LIVE button returns, the re-skins are gone.
    await page.getByRole("button", { name: "Live (DVR)", exact: true }).click();
    await expect(page.locator('[class*="livebutton"]')).toHaveCount(1);
    await expect(page.locator('[class*="ui-skin-neon"]')).toHaveCount(0);
    await expect(page.locator('[class*="ui-skin-glass"]')).toHaveCount(0);

    // The selector is grouped into three categories (Default UI / Default UI + CSS / Custom UI),
    // and every theme button lives under one of them.
    await expect(page.locator(".theme-cat-label")).toHaveCount(3);
    await expect(page.locator(".theme-cat .theme-btn")).toHaveCount(14);
  });

  test("the Binge theme: Skip Intro shows in the intro range; Next is hidden mid-clip", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "連続再生", exact: true }).click();

    const skip = page.locator('#player [class*="skipintro-button"]');
    const nextEp = page.locator('#player [class*="nextepisode-button"]');

    // Both buttons are DYNAMIC (not permanent). Pause + seek into the (sample) intro range 5–18s:
    // Skip Intro shows, while Next stays hidden (it only surfaces near the end).
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("#player video");
      if (v) {
        v.pause();
        v.currentTime = 8;
      }
    });
    await expect(skip).toBeVisible();
    await expect(nextEp).toBeHidden();
    // Clicking Skip Intro jumps the playhead forward toward introEnd (~18; keyframe-tolerant).
    const beforeSkip = await page.evaluate(() => document.querySelector<HTMLVideoElement>("#player video")?.currentTime ?? 0);
    await skip.click({ force: true });
    // Poll for the seek to land: the segment at introEnd may need buffering, so a fixed wait flakes
    // (it occasionally read the pre-seek time and saw no jump).
    await expect
      .poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>("#player video")?.currentTime ?? 0), {
        timeout: 10_000,
      })
      .toBeGreaterThan(beforeSkip + 4);
  });

  test("the Binge theme: near the end, the Next-up card + Next button appear and Next advances", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "連続再生", exact: true }).click();
    // Turn OFF continuous play so the card stays (won't auto-advance), then seek into the final
    // seconds — the Next-up card AND the (dynamic) Next button both surface.
    await page.getByRole("checkbox", { name: /連続再生/ }).uncheck();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("#player video");
      if (v) {
        v.pause();
        if (Number.isFinite(v.duration)) v.currentTime = v.duration - 6;
      }
    });
    const card = page.locator('#player [class*="nextup-card"]');
    const nextEp = page.locator('#player [class*="nextepisode-button"]');
    // Generous timeout: seeking to the unbuffered tail can take a while to fetch the last segment.
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(card.locator(".nextup-title")).toContainText("VOD DASH"); // next after VOD HLS
    await expect(nextEp).toBeVisible();
    // The Next button advances to the next episode → a fresh source loads (playhead resets).
    await nextEp.click({ force: true });
    await page.waitForTimeout(3000);
    const afterNext = await page.evaluate(() => document.querySelector<HTMLVideoElement>("#player video")?.currentTime ?? 999);
    expect(afterNext).toBeLessThan(60);
  });

  test("the Sports theme overlays game info, auto-hides it, and INFO re-shows it", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "スポーツ中継", exact: true }).click();
    const scoreboard = page.locator('#player [class*="scoreboard-strip"]');
    const playerCard = page.locator('#player [class*="playerinfo-card"]');
    await expect(scoreboard).toHaveCount(1);
    await expect(playerCard).toHaveCount(1);
    // They appear initially (within the auto-hide window) and render the sample data.
    await expect(scoreboard).toBeVisible();
    await expect(playerCard).toBeVisible();
    await expect(scoreboard).toContainText("North Hawks");
    // …then auto-hide after a few seconds, with no interaction (like a broadcast scorebug).
    await expect(scoreboard).toBeHidden({ timeout: 9000 });
    await expect(playerCard).toBeHidden();
    // The INFO button re-shows them.
    const info = page.locator('#player [class*="sportsinfo-toggle"]').first();
    await info.click({ force: true });
    await expect(scoreboard).toBeVisible();
    await expect(playerCard).toBeVisible();
    // …and clicking INFO again hides them immediately.
    await info.click({ force: true });
    await expect(scoreboard).toBeHidden();
  });

  test("casting toggles add/remove the PiP / AirPlay / Chromecast buttons on the custom UIs", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await page.waitForTimeout(3000);
    // Default theme is Live (DVR), a CUSTOM tree → it ships without casting buttons.
    await expect(page.locator('#player [class*="piptogglebutton"]')).toHaveCount(0);
    await expect(page.locator('#player [class*="airplaytogglebutton"]')).toHaveCount(0);

    // Toggle PiP on → the library button is added to the tree (PiP works in Chrome, so it's visible).
    await page.getByRole("checkbox", { name: /PiP/ }).check();
    await expect(page.locator('#player [class*="piptogglebutton"]')).toHaveCount(1);
    // Toggle AirPlay on too → its button is added (present in the DOM; it self-hides off-Safari).
    await page.getByRole("checkbox", { name: /AirPlay/ }).check();
    await expect(page.locator('#player [class*="airplaytogglebutton"]')).toHaveCount(1);
    // Both still present together (the toggles are independent).
    await expect(page.locator('#player [class*="piptogglebutton"]')).toHaveCount(1);

    // Toggle PiP back off → only that button is removed; AirPlay stays.
    await page.getByRole("checkbox", { name: /PiP/ }).uncheck();
    await expect(page.locator('#player [class*="piptogglebutton"]')).toHaveCount(0);
    await expect(page.locator('#player [class*="airplaytogglebutton"]')).toHaveCount(1);

    // Chromecast: enabling it also turns on PlayerConfig.remotecontrol, so it rebuilds the
    // player; after the rebuild the Cast button is in the custom tree.
    await page.getByRole("checkbox", { name: /Chromecast/ }).check();
    await page.waitForTimeout(4000); // player recreate + source reload
    await expect(page.locator('#player [class*="casttogglebutton"]')).toHaveCount(1);
    // The player still plays after the cast-driven rebuild (remotecontrol didn't break init).
    const playing = await page.evaluate(
      () => (document.querySelector("#player video") as HTMLVideoElement | null)?.readyState ?? 0,
    );
    expect(playing).toBeGreaterThanOrEqual(2); // HAVE_CURRENT_DATA+

    // On the stock Default UI all three are present already, independent of the toggles.
    await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
    await expect(page.locator('#player [class*="piptogglebutton"]')).toHaveCount(1);
  });

  test("theme labels follow the language toggle and carry no brand/service names", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.waitForSelector(".theme-cat", { timeout: 20000 });
    // A theme with a localized label changes to Sports when English is selected.
    await expect(page.getByRole("button", { name: "スポーツ中継", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("button", { name: "Sports", exact: true })).toBeVisible();
    // The streaming-style themes are de-branded: no service names or imitation-style suffixes in any theme label.
    const labels = await page.locator(".theme-btn").allTextContents();
    expect(labels.some((l) => /Netflix|YouTube|Disney|風/.test(l))).toBe(false);
  });

  test("streaming-style themes build distinct compositions with brand colors", async ({ page }) => {
    await page.goto(`${APP}/`);
    // VOD HLS (Tears of Steel) has multiple video renditions, so the SeekBar renders
    // and the settings gear shows its quality list. If that upstream stream ever drops
    // to a single rendition, the gear + seek-color assertions below would fail for an
    // unrelated reason — keep this on a multi-rendition source.
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await page.waitForTimeout(3000);

    // The played-bar color guards the CSS-specificity fix: the base modern skin colors
    // it at (0,3,0), so a brand override must reach that depth — a lone .ui-skin-* (0,2,0)
    // silently loses and the bar stays white. Read the exact element the base rule targets.
    const seekColor = (): Promise<string | null> =>
      page.evaluate(() => {
        const el = document.querySelector(".bmpui-ui-seekbar .bmpui-seekbar .bmpui-seekbar-playbackposition");
        return el ? getComputedStyle(el).backgroundColor : null;
      });

    // Premiere: a different composition (title bar + settings gear) + brand red.
    // Use the exact root class — `[class*="ui-titlebar"]` also matches the row class
    // `bmpui-titlebar-row` (it contains the substring "ui-titlebar"). All three brand
    // themes now also carry the official tv-sample RecommendationOverlay.
    await page.getByRole("button", { name: "Premiere", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-premiere"]')).toHaveCount(1);
    await expect(page.locator(".bmpui-ui-titlebar")).toHaveCount(1);
    await expect(page.locator(".bmpui-ui-recommendation-overlay")).toHaveCount(1);
    await expect(page.locator('[class*="settingstogglebutton"]')).toHaveCount(1);
    expect(await seekColor()).toBe("rgb(229, 9, 20)");

    // Creator: now WITH a title bar too (added to match the other brands), settings
    // gear, RecommendationOverlay, brand red.
    await page.getByRole("button", { name: "Creator", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-creator"]')).toHaveCount(1);
    await expect(page.locator(".bmpui-ui-titlebar")).toHaveCount(1);
    await expect(page.locator(".bmpui-ui-recommendation-overlay")).toHaveCount(1);
    await expect(page.locator('[class*="settingstogglebutton"]')).toHaveCount(1);
    expect(await seekColor()).toBe("rgb(255, 0, 0)");

    // Studio: title bar + the inline scrubber + RecommendationOverlay, brand blue.
    await page.getByRole("button", { name: "Studio", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-studio"]')).toHaveCount(1);
    await expect(page.locator(".bmpui-ui-titlebar")).toHaveCount(1);
    await expect(page.locator(".bmpui-ui-recommendation-overlay")).toHaveCount(1);
    expect(await seekColor()).toBe("rgb(31, 155, 255)");

    // …back to Live (DVR): the streaming skins, their settings gear, and the
    // RecommendationOverlay are all gone (it's a brand-theme element).
    await page.getByRole("button", { name: "Live (DVR)", exact: true }).click();
    await expect(page.locator('[class*="ui-skin-premiere"]')).toHaveCount(0);
    await expect(page.locator('[class*="settingstogglebutton"]')).toHaveCount(0);
    await expect(page.locator(".bmpui-ui-recommendation-overlay")).toHaveCount(0);
  });

  test("the customization guide is a standalone page linked from Player Lab", async ({ page }) => {
    await page.goto(`${APP}/`);
    const link = page.locator("#ui-guide .ui-guide-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "./guide.html");
    // The guide page loads with its detailed sections + reference links, and its own
    // language toggle works.
    await page.goto(`${APP}/guide.html`);
    await expect(page.locator("#guide-title")).toHaveText("Player UI カスタマイズ・ガイド");
    // Known sections by id (robust to adding/removing others) + the source reference link.
    await expect(page.locator("#architecture")).toBeVisible();
    await expect(page.locator("#references")).toBeVisible();
    await expect(page.locator('.guide-links a[href*="bitmovin-player-ui"]').first()).toBeVisible();
    // The code-first expansion: the deep "custom component" section, the cookbook with
    // copy-paste recipes, gotcha callouts, and captioned code blocks.
    await expect(page.locator("#custom-component")).toBeVisible();
    await expect(page.locator("#cookbook .guide-recipe").first()).toBeVisible();
    expect(await page.locator(".guide-recipe").count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator(".guide-callout.warn").first()).toBeVisible();
    await expect(page.locator(".guide-codecap").first()).toBeVisible();
    // A deep-link into the player-ui source (the user wanted source-referenced guidance).
    await expect(page.locator('.guide-links a[href*="/tree/main/src/ts/components"]')).toBeVisible();

    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.locator("#guide-title")).toHaveText("Player UI Customization Guide");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // Sample-code comments are English in the English UI — no kana/kanji in any code block
    // (the prose/captions are bilingual; the code is English-only, like the rest of the app).
    const cjkInGuideCode = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".guide-code code")).some((c) => /[぀-ヿ一-龯]/.test(c.textContent ?? "")),
    );
    expect(cjkInGuideCode).toBe(false);
  });

  test("the per-theme diff shows how each theme changes the default", async ({ page }) => {
    await page.goto(`${APP}/`);
    const diff = page.locator("#ui-construction .theme-diff");
    // Default theme is Live (DVR) → added components, built from the default (Japanese UI).
    await expect(diff).toContainText("ベース:");
    await expect(diff).toContainText("QuickSeekButton");
    // The construction code shows HOW it's built — the real component tree + source file.
    await expect(diff).toContainText("構築コード");
    await expect(diff.locator(".theme-diff-code")).toContainText("new UIContainer");
    await expect(diff.locator(".theme-diff-codesrc")).toContainText("buildLiveUiContainer");
    // …and it reads without a horizontal scrollbar (the snippets are formatted narrow
    // and the box wraps) — the panel was previously too small and scrolled sideways.
    const overflow = await diff
      .locator(".theme-diff-code")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // Neon → a CSS-only reskin, zero component changes; construction shows the class + CSS.
    await page.getByRole("button", { name: "Neon", exact: true }).click();
    await expect(diff).toContainText("ui-skin-neon");
    await expect(diff).toContainText("コンポーネント変更ゼロ");
    await expect(diff.locator(".theme-diff-code")).toContainText("extraCssClasses");

    // Premiere → a different composition; construction shows the new components + factory.
    await page.getByRole("button", { name: "Premiere", exact: true }).click();
    await expect(diff.locator(".theme-diff-code")).toContainText("new TitleBar()");
    await expect(diff.locator(".theme-diff-codesrc")).toContainText("buildPremiereUiContainer");

    // The stock theme is the baseline.
    await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
    await expect(diff).toContainText("基準");
  });

  test("the stage height stays constant across themes (panel pinned to player height)", async ({ page }) => {
    // Wide viewport → the construction panel is pinned to the player's height and scrolls
    // internally, so theme content length never changes the stage height.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await page.waitForTimeout(2500);
    const heights = (): Promise<{ p: number; c: number }> =>
      page.evaluate(() => ({
        p: Math.round(document.querySelector("#player")!.getBoundingClientRect().height),
        c: Math.round(document.querySelector("#ui-construction")!.getBoundingClientRect().height),
      }));
    // A short-content theme (Default) and the longest (Premiere) must both keep the panel
    // equal to the player height, and the player height itself must not change.
    await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
    const short = await heights();
    await page.getByRole("button", { name: "Premiere", exact: true }).click();
    const long = await heights();
    expect(short.c).toBe(short.p); // panel pinned to player height
    expect(long.c).toBe(long.p);
    expect(long.p).toBe(short.p); // player height unchanged across themes
    // …and the long theme's construction code scrolls within the pinned panel. (Premiere
    // has the longest construction snippet — well taller than the ~428px player at this
    // viewport — so it must overflow the pinned panel.)
    const scrolls = await page.evaluate(() => {
      const el = document.querySelector("#ui-construction .construction-content")!;
      return el.scrollHeight > el.clientHeight + 1;
    });
    expect(scrolls).toBe(true);
  });

  test("the Live theme has ±10s quick-seek buttons", async ({ page }) => {
    await page.goto(`${APP}/`);
    // The library's QuickSeekButton ×2 flank the play button (back / forward).
    await expect(page.locator('[class*="quickseekbutton"]')).toHaveCount(2);
  });

  test("autohide is off by default and the toggle is enabled on every theme", async ({ page }) => {
    await page.goto(`${APP}/`);
    // Control-panel labels are bilingual; the app defaults to Japanese, so match the JA label.
    const cb = page.getByRole("checkbox", { name: "コントロールを自動で隠す" });
    // Default OFF — controls stay visible until you switch it on.
    await expect(cb).not.toBeChecked();
    // Enabled on every theme, including the stock Default (no gating, no hint anymore).
    await expect(page.locator(".panel-hint")).toHaveCount(0);
    for (const t of ["Default (Bitmovin)", "Cinema", "Premiere", "Live (DVR)"]) {
      await page.getByRole("button", { name: t, exact: true }).click();
      await expect(cb).toBeEnabled();
    }
  });

  test("autohide drives the Default theme too (off = always shown, on = hides when idle)", async ({ page }) => {
    await page.goto(`${APP}/`);
    // Switch to the stock Default theme — the toggle now controls its hideDelay because
    // DefaultUIFactory re-wraps the stock tree (it used to be a silent no-op here).
    await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
    const cbOpacity = async (): Promise<number | null> =>
      page.evaluate(() => {
        const cb = document.querySelector(".bmpui-ui-controlbar");
        return cb ? Number(getComputedStyle(cb).opacity) : null;
      });
    const idle = async (): Promise<void> => {
      await page.locator("#player").hover();
      await page.mouse.move(400, 300);
      await page.mouse.move(0, 0); // away from the player → start the hide timer
      await page.waitForTimeout(2800); // past the 2000ms hideDelay + fade
    };
    // Autohide OFF (default): the stock control bar stays visible when idle.
    await idle();
    await expect.poll(cbOpacity, { timeout: 2000 }).toBe(1);
    // Turn autohide ON → the stock control bar now fades out when idle.
    await page.getByRole("checkbox", { name: "コントロールを自動で隠す" }).check();
    await idle();
    await expect.poll(cbOpacity, { timeout: 4000 }).toBe(0);
  });

  test("@public UI settings section exposes the UIConfig toggles and they take effect", async ({ page }) => {
    await page.goto(`${APP}/`);
    // Control-panel labels are bilingual; the app defaults to Japanese, so match JA labels.
    // A dedicated UI settings card holds autohide and the other UIManager-level toggles.
    const uiSettings = page.locator("#control-panel .panel-section", { hasText: "UI 設定" });
    await expect(uiSettings).toHaveCount(1);
    // Autohide, 11 top-level UIConfig flags, subtitle-language adaptation and 2 numbers.
    await expect(uiSettings.locator('input[type="checkbox"]')).toHaveCount(13);
    await expect(uiSettings.locator('input[type="number"]')).toHaveCount(2);
    await expect(uiSettings.locator('input[type="text"]')).toHaveCount(1);
    await expect(uiSettings.locator(".panel-subnote")).toHaveCount(1);
    // Every setting carries guidance: 13 toggles, 2 numbers and the language input.
    await expect(uiSettings.locator(".info-chip")).toHaveCount(16);
    // SDK defaults: scrub-preview + speed-item + snapping on, keep-on-hover off.
    await expect(page.getByRole("checkbox", { name: "シーク中のプレビュー" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "シークをマーカーにスナップ" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "ホバー中はバーを隠さない" })).not.toBeChecked();

    // playbackSpeedSelectionEnabled has a real, visible effect on a gear theme: the speed
    // item in the settings panel hides when the flag is off, and returns when on.
    await page.getByRole("button", { name: "Creator", exact: true }).click();
    const speedItem = page.locator("#player .bmpui-ui-playbackspeedselectbox");
    await expect(speedItem).toHaveCount(1);
    await page.getByRole("checkbox", { name: "設定歯車に再生速度を表示" }).uncheck();
    await expect(speedItem).toHaveCount(0);
    await page.getByRole("checkbox", { name: "設定歯車に再生速度を表示" }).check();
    await expect(speedItem).toHaveCount(1);

    // The setting persists across a theme switch (it lives in the app's UIConfig, not the theme).
    await page.getByRole("checkbox", { name: "シーク中のプレビュー" }).uncheck();
    await page.getByRole("button", { name: "Live (DVR)", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "シーク中のプレビュー" })).not.toBeChecked();
  });

  test("telemetry: the state panel is 'Player state' (not DVR), and QoE notes it's client-side", async ({ page }) => {
    await page.goto(`${APP}/`);
    const telemetry = page.locator("#control-panel .panel-grid-state");
    // The readout also applies to VOD: it is named Player state, not DVR state.
    await expect(telemetry.locator("h2", { hasText: "プレイヤー状態" })).toBeVisible();
    await expect(telemetry.locator("h2", { hasText: "DVR" })).toHaveCount(0);
    // The QoE card carries a "?" chip clarifying it's measured client-side in real time
    // (not the Bitmovin Analytics query API, which is a server-side call).
    const qoeChip = telemetry.locator(".panel-section", { hasText: "QoE" }).locator(".info-chip");
    await expect(qoeChip).toHaveCount(1);
    await expect(qoeChip).toHaveAttribute("data-info-en", /client-side/i);
    await expect(qoeChip).toHaveAttribute("data-info-ja", /リアルタイム計測/);
  });

  test("the server-proxied Analytics view runs queries and shows an honest unconfigured state", async ({ page }) => {
    await page.goto(`${APP}/`);
    const panel = page.locator(".analytics-panel");
    await expect(panel).toBeVisible();
    // Four preset queries + a "?" chip explaining the server proxy.
    await expect(panel.locator(".analytics-preset")).toHaveCount(4);
    await expect(panel.locator(".info-chip")).toHaveCount(1);
    // The test server has no Analytics key, so a query returns the honest "not configured"
    // message (proves the browser → /api/analytics/query proxy round-trip, no key exposed).
    await page.getByRole("button", { name: "平均スタートアップ時間" }).click();
    await expect(panel.locator(".analytics-status")).toContainText("API キー未設定");
    // The status follows the language toggle (re-localized in place, no re-mount).
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(panel.locator(".analytics-status")).toContainText("No API key on the server");
    await expect(page.getByRole("button", { name: "Avg startup time" })).toBeVisible();
  });

  test("the Player Config panel applies recreate / reload / runtime changes", async ({ page }) => {
    await page.goto(`${APP}/`);
    await expect(page.locator("#config-panel .config-field")).toHaveCount(144);
    // Dynamic config (runtime + reload) leads in its own band; recreate config follows.
    // Per-band counts document the split and survive additive growth of the static groups.
    await expect(page.locator("#config-panel .config-band-dynamic")).toBeVisible();
    await expect(page.locator("#config-panel .config-band-static")).toBeVisible();
    // Dynamic band: Player API, Adaptation (dynamic), Low Latency (dynamic), Source.
    await expect(page.locator("#config-panel .config-band-dynamic .config-group")).toHaveCount(4);
    // Static band: Playback, Adaptation, Buffer, Network, Tweaks, Logs, Style, Cast, Live, Location, Misc.
    await expect(page.locator("#config-panel .config-band-static .config-group")).toHaveCount(11);
    // The runtime Dynamic Adaptation group exposes limitToPlayerSize (the field that was missing).
    const limitField = page.locator("#config-panel .config-band-dynamic .config-field", {
      hasText: "limitToPlayerSize",
    });
    await expect(limitField).toHaveCount(1);

    // Per-field guidance: nearly every field carries a "?" chip carrying BOTH languages
    // (data-info-ja / data-info-en), shown via the shared styled overlay. Inline dynamic
    // fields are hand-translated; static config fields carry the SDK JSDoc + its JA translation.
    await expect(page.locator("#config-panel .info-chip").first()).toBeVisible();
    expect(await page.locator("#config-panel .info-chip").count()).toBeGreaterThan(100);
    await expect(limitField.locator(".info-chip")).toHaveAttribute("data-info-ja", /プレイヤーの表示サイズ/);
    await expect(limitField.locator(".info-chip")).toHaveAttribute("data-info-en", /display size/);
    const autoplayChip = page
      .locator("#config-panel .config-field", { hasText: "autoplay" })
      .first()
      .locator(".info-chip");
    await expect(autoplayChip).toHaveAttribute("data-info-en", /loading a source/);
    await expect(autoplayChip).toHaveAttribute("data-info-ja", /ソース読み込み/);
    // Hovering a chip reveals the single styled overlay — in JA (default) it shows the JA text.
    await limitField.locator(".info-chip").hover();
    await expect(page.locator(".info-overlay")).toBeVisible();
    await expect(page.locator(".info-overlay")).toContainText("プレイヤーの表示サイズ");
    await expect(page.locator("#config-panel .config-mode.mode-recreate").first()).toBeVisible();
    await expect(page.locator("#config-panel .config-mode.mode-reload").first()).toBeVisible();
    await expect(page.locator("#config-panel .config-mode.mode-runtime").first()).toBeVisible();

    // Open every group so its fields are interactable.
    const openAll = (): Promise<void> =>
      page.evaluate(() =>
        document.querySelectorAll("#config-panel details").forEach((d) => ((d as HTMLDetailsElement).open = true)),
      );
    await openAll();

    // 🔁 recreate: editing a PlayerConfig field stages it; Apply rebuilds the player.
    const recreate = page.getByRole("button", { name: /再生成して適用/ });
    await expect(recreate).toBeDisabled();
    await page
      .locator("#config-panel .config-field", { hasText: "autoplay" })
      .first()
      .locator("input[type=checkbox]")
      .uncheck();
    await expect(recreate).toBeEnabled();
    await recreate.click();
    // The player is rebuilt: a fresh control bar + <video> appear, and the staged edit
    // is committed (button disabled again).
    await expect(page.locator(".bmpui-ui-controlbar")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("video")).toHaveCount(1);
    await expect(recreate).toBeDisabled();

    // 📥 reload: a SourceConfig title override shows up in a theme that has a TitleBar.
    const reload = page.getByRole("button", { name: /再読み込みして適用/ });
    await openAll();
    const titleInput = page
      .locator("#config-panel .config-field", { hasText: /^title/ })
      .first()
      .locator("input");
    await titleInput.fill("E2E CONFIG TITLE");
    await titleInput.blur(); // text fields stage on change (fires on blur), like a real form
    await expect(reload).toBeEnabled();
    await reload.click();
    await expect(reload).toBeDisabled(); // committed → no longer dirty
    await page.getByRole("button", { name: "Premiere", exact: true }).click();
    // toHaveText auto-waits for the reload + theme switch to settle — no fixed sleep.
    await expect(page.locator(".bmpui-label-metadata-title")).toHaveText("E2E CONFIG TITLE", { timeout: 10000 });
  });

  test("@public configuration code captures applied values and copies without draft edits", async ({ page }) => {
    await captureAppPlayer(page);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.locator(".config-code > summary").click();
    const code = page.getByRole("textbox", { name: "Applied configuration code", exact: true });
    const refresh = page.getByRole("button", { name: "Refresh code", exact: true });
    await expect(code).toHaveValue(/YOUR_PLAYER_KEY/);
    const title = configField(page, /^title/).locator("input");
    await title.fill("CODE_SNAPSHOT_APPLIED_TITLE");
    await title.blur();
    await refresh.click();
    await expect(code).not.toHaveValue(/CODE_SNAPSHOT_APPLIED_TITLE/);
    await page.getByRole("button", { name: /Reload the source to apply/ }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getSource()?.title)).toBe("CODE_SNAPSHOT_APPLIED_TITLE");
    await refresh.click();
    await expect(code).toHaveValue(/CODE_SNAPSHOT_APPLIED_TITLE/);
    const volume = configField(page, /^volume \(0–100\)/).locator("input");
    await volume.fill("37");
    await volume.blur();
    await expect.poll(() => page.evaluate(() => window.player?.getVolume())).toBe(37);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect(code).toHaveValue(/player\.setVolume\(37\);/);
    await expect(page.locator(".config-code [role=status]")).toHaveText("Copied.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await code.inputValue());
    await page.evaluate(() => {
      const target = window as Window & {
        finishConfigurationCopy?: () => void; pendingConfigurationCopy?: Promise<void>;
        restoreConfigurationClipboard?: () => void;
      };
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      target.restoreConfigurationClipboard = () => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: write });
      Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: (text: string) => {
        target.pendingConfigurationCopy = write(text).then(() => new Promise<void>((resolve) => { target.finishConfigurationCopy = resolve; }));
        return target.pendingConfigurationCopy;
      } });
    });
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as Window & { finishConfigurationCopy?: () => void }).finishConfigurationCopy)).toBe("function");
    await volume.fill("38");
    await volume.blur();
    await refresh.click();
    await expect(code).toHaveValue(/player\.setVolume\(38\);/);
    await page.evaluate(async () => {
      const target = window as Window & {
        finishConfigurationCopy?: () => void; pendingConfigurationCopy?: Promise<void>;
        restoreConfigurationClipboard?: () => void;
      };
      target.finishConfigurationCopy!();
      await target.pendingConfigurationCopy;
      target.restoreConfigurationClipboard!();
    });
    await expect(page.locator(".config-code [role=status]")).toHaveText("");
    await page.setViewportSize({ width: 375, height: 900 });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(375);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "日本語", exact: true }).click();
    await page.locator(".config-code > summary").click();
    await expect(page.getByRole("textbox", { name: "適用済み設定コード", exact: true })).toHaveValue(/CODE_SNAPSHOT_APPLIED_TITLE/);
  });

  test("@public applied config overrides can be cleared without resetting other fields", async ({ page }) => {
    await captureAppPlayer(page);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await openConfigGroup(page, "Playback");
    await openConfigGroup(page, "Adaptation (initial)");
    const audio = configField(page, /^audioLanguage/).locator("input");
    const autoplay = configField(page, /^autoplay/).locator("input");
    const logic = configField(page, /^logic/).locator("select");
    await audio.fill("en");
    await audio.blur();
    await autoplay.uncheck();
    await logic.selectOption("v2");
    await page.getByRole("button", { name: /Recreate the player to apply/ }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getConfig(false).playback?.audioLanguage)).toBe("en");
    await audio.fill("");
    await audio.blur();
    await logic.selectOption("");
    const recreate = page.getByRole("button", { name: /Recreate the player to apply/ });
    await expect(recreate).toBeEnabled();
    await recreate.click();
    await expect.poll(() => page.evaluate(() => {
      const config = window.player?.getConfig(false);
      return { audio: config?.playback?.audioLanguage, autoplay: config?.playback?.autoplay,
        desktop: config?.adaptation?.desktop?.logic, mobile: config?.adaptation?.mobile?.logic };
    })).toEqual({ audio: undefined, autoplay: false, desktop: undefined, mobile: undefined });

    const title = configField(page, /^title/).locator("input");
    const description = configField(page, /^description/).locator("input");
    const offset = configField(page, /^options.startOffset \(s\)/).locator("input");
    await title.fill("Config override");
    await title.blur();
    await description.fill("Keep this description");
    await description.blur();
    await offset.fill("12");
    await offset.blur();
    const reload = page.getByRole("button", { name: /Reload the source to apply/ });
    await reload.click();
    await expect.poll(() => page.evaluate(() => window.player?.getSource()?.title)).toBe("Config override");
    await title.fill("");
    await title.blur();
    await offset.fill("");
    await offset.blur();
    await expect(reload).toBeEnabled();
    await reload.click();
    await expect.poll(() => page.evaluate(() => {
      const source = window.player?.getSource();
      return { title: source?.title, description: source?.description, offset: source?.options?.startOffset };
    })).toEqual({ title: "VOD HLS (Tears of Steel)", description: "Keep this description", offset: undefined });
  });

  test("@public config inputs follow applied SDK values after language changes and rebuilds", async ({ page }) => {
    await captureAppPlayer(page);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await openConfigGroup(page, "Playback");
    await configField(page, /^autoplay/).locator("input").uncheck();
    await page.getByRole("button", { name: /Recreate the player to apply/ }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getConfig(false).playback?.autoplay)).toBe(false);
    const volume = configField(page, /^volume \(0/).locator("input");
    const speed = configField(page, /^playbackSpeed/).locator("input");
    await volume.fill("25");
    await volume.blur();
    await speed.fill("1.5");
    await speed.blur();
    await expect.poll(() => page.evaluate(() => [window.player?.getVolume(), window.player?.getPlaybackSpeed()])).toEqual([25, 1.5]);
    const title = configField(page, /^title/).locator("input");
    await title.fill("Applied source title");
    await title.blur();
    await page.getByRole("button", { name: /Reload the source to apply/ }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getSource()?.title)).toBe("Applied source title");
    await page.getByRole("button", { name: "日本語", exact: true }).click();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(volume).toHaveValue("25");
    await expect(speed).toHaveValue("1.5");
    await expect(title).toHaveValue("Applied source title");
    await openConfigGroup(page, "Playback");
    await expect(configField(page, /^autoplay/).locator("input")).not.toBeChecked();
    // A draft in the reload band survives a recreate in the separate static band.
    await title.fill("Unapplied draft");
    await title.blur();
    await page.getByRole("checkbox", { name: /Allow DVR/ }).uncheck();
    await expect.poll(() => page.evaluate(() => window.player?.getConfig(false).playback?.timeShift)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.player?.getSource()?.title)).toBe("Applied source title");
    await expect(volume).toHaveValue("100");
    await expect(speed).toHaveValue("1");
    await expect(title).toHaveValue("Unapplied draft");
    await expect(page.getByRole("button", { name: /Reload the source to apply/ })).toBeEnabled();
    expect(await page.evaluate(() => [window.player?.getVolume(), window.player?.getPlaybackSpeed()])).toEqual([100, 1]);
  });

  test("@public player gestures leave settings and recommendation handlers intact", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.evaluate(async () => {
      const moduleUrl = "/src/gestures.ts";
      const { installPlayerGesture } = await import(moduleUrl);
      const fixture = document.createElement("div");
      fixture.id = "gesture-fixture";
      fixture.style.cssText = "position:relative;z-index:1000;height:180px";
      fixture.innerHTML = '<div class="bmpui-ui-settings-panel"><button>Fixture settings</button></div>' +
        '<div class="bmpui-ui-recommendation-overlay"><button>Fixture recommendation</button><button>Fixture replay</button></div>' +
        '<div id="gesture-surface" style="height:40px">Fixture video surface</div>';
      for (const overlay of Array.from(fixture.children)) {
        (overlay as HTMLElement).style.cssText = "position:static;display:block;transform:none;height:45px";
      }
      document.body.prepend(fixture);
      const state = { clicks: [] as string[], playing: false, toggles: 0, seeks: 0, targets: [] as number[], rangeAvailable: true };
      for (const button of Array.from(fixture.querySelectorAll("button"))) button.addEventListener("click", () => state.clicks.push(button.textContent!));
      const fakePlayer = {
        isPlaying: () => state.playing,
        play: () => { state.playing = true; state.toggles++; },
        pause: () => { state.playing = false; state.toggles++; },
        isLive: () => false, getCurrentTime: () => 20, getDuration: () => 100,
        getSeekableRange: () => state.rangeAvailable ? { start: 0, end: 100 } : undefined,
        seek: (target: number) => { state.seeks++; state.targets.push(target); },
      } as unknown as PlayerAPI;
      installPlayerGesture(fixture, { getPlayer: () => fakePlayer, getMode: () => "seek", isActive: () => true });
      Object.assign(window, { gestureFixture: state });
    });
    for (const name of ["Fixture settings", "Fixture recommendation", "Fixture replay"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.waitForTimeout(300); // Cross the deliberate 250ms single-click gesture deadline.
    expect(await page.evaluate(() => (window as unknown as { gestureFixture: { clicks: string[]; toggles: number } }).gestureFixture))
      .toMatchObject({ clicks: ["Fixture settings", "Fixture recommendation", "Fixture replay"], toggles: 0 });
    await page.locator("#gesture-surface").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { gestureFixture: { toggles: number } }).gestureFixture.toggles)).toBe(1);
    await page.locator("#gesture-surface").dblclick();
    await expect.poll(() => page.evaluate(() => (window as unknown as { gestureFixture: { seeks: number } }).gestureFixture.seeks)).toBe(1);
    // The UI helper also supports mobile adapters without a seekable range.
    // Exercise that adapter fallback without changing the Web Player contract.
    await page.evaluate(() => { (window as unknown as { gestureFixture: { rangeAvailable: boolean } }).gestureFixture.rangeAvailable = false; });
    await page.locator("#gesture-surface").dblclick();
    await expect.poll(() => page.evaluate(() => (window as unknown as { gestureFixture: { targets: number[] } }).gestureFixture.targets)).toEqual([30, 30]);
  });

  for (const theme of ["Premiere", "Creator", "Studio"]) {
    test(`@public ${theme} settings clicks preserve playback and recommendations load their source`, async ({ page }) => {
      await captureAppPlayer(page, true);
      expect(await page.evaluate(() => window.player!.getConfig(false).playback?.autoplay)).toBe(false);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.getByRole("button", { name: theme, exact: true }).click();
      await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>("#player video")?.readyState ?? 0)).toBeGreaterThanOrEqual(3);
      await page.evaluate(() => window.player!.pause());
      await page.locator("#player .bmpui-ui-settingstogglebutton").click();
      const settings = page.locator("#player .bmpui-ui-settings-panel");
      await expect(settings).toBeVisible();
      await settings.locator(".bmpui-ui-settings-panel-item:visible .bmpui-ui-label").first().click();
      await page.waitForTimeout(300); // A settings click must not become a delayed playback gesture.
      expect(await page.evaluate(() => window.player!.isPlaying())).toBe(false);
      await page.locator("#player .bmpui-ui-settingstogglebutton").click();
      await page.evaluate(async () => {
        const player = window.player!;
        player.seek(player.getDuration() - 0.2);
        await player.play();
      });
      await expect(page.locator("#player .bmpui-ui-recommendation-overlay")).toBeVisible({ timeout: 25_000 });
      const recommendation = page.locator("#player .bmpui-ui-recommendation-item").first();
      await recommendation.click();
      await expect.poll(() => page.evaluate(() => window.player?.getSource()?.title)).toContain("Big Buck Bunny");
      await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>("#player video")?.readyState ?? 0))
        .toBeGreaterThanOrEqual(3);
      // The SDK recommendation itself must start decoded playback with autoplay off.
      await expectDecodedPlayback(page);
      // Source selection made inside the SDK UI also becomes the app's rebuild source.
      await page.getByRole("checkbox", { name: /DVR.*timeShift/ }).uncheck();
      await expect.poll(() => page.evaluate(() => window.player?.getConfig(false).playback?.timeShift)).toBe(false);
      await expect.poll(() => page.evaluate(() => window.player?.getSource()?.title)).toContain("Big Buck Bunny");
      expect(await page.evaluate(() => window.player?.getSource()?.dash)).toContain("bbb_30fps.mpd");
      // The recreated Player uses the app default autoplay=true; the first
      // recommendation above independently proves autoplay=false behavior.
      // Check decoded output and clock progression after source recreation too.
      await expectDecodedPlayback(page);
      expect(errors).toEqual([]);
    });
  }

  test("@public selecting the current preset recommendation clears previous source overrides", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await captureAppPlayer(page);
    await page.getByRole("button", { name: "English", exact: true }).click();
    // Observe actual SDK completion without altering its load or event behavior.
    await page.evaluate(() => {
      window.__events = [];
      window.player!.on(window.player!.exports.PlayerEvent.SourceLoaded, () => window.__events.push("SourceLoaded"));
    });
    const loadAndWait = async (action: () => Promise<unknown>): Promise<void> => {
      const before = await page.evaluate(() => window.__events.length);
      await action();
      await expect.poll(() => page.evaluate(() => window.__events.length)).toBeGreaterThan(before);
    };
    await loadAndWait(() => page.getByRole("button", { name: "VOD DASH", exact: true }).click());
    await page.getByRole("button", { name: "Premiere", exact: true }).click();
    const title = configField(page, /^title/).locator("input");
    const description = configField(page, /^description/).locator("input");
    const reload = page.getByRole("button", { name: /Reload the source to apply/ });
    await title.fill("Previous title override");
    await title.blur();
    await loadAndWait(() => reload.click());
    await description.fill("Previous description override");
    await description.blur();
    await loadAndWait(() => reload.click());
    // App-managed reloads must retain previously applied sibling overrides.
    expect(await page.evaluate(() => window.player?.getSource()?.title)).toBe("Previous title override");
    await page.evaluate(async () => {
      const player = window.player!;
      player.seek(player.getDuration() - 0.2);
      await player.play();
    });
    await expect(page.locator("#player .bmpui-ui-recommendation-overlay")).toBeVisible({ timeout: 25_000 });
    // This recommendation loads the SAME preset ID through the SDK UI directly.
    await loadAndWait(() => page.locator("#player .bmpui-ui-recommendation-item").first().click());
    await expect(title).toHaveValue("VOD DASH (Big Buck Bunny)");
    await description.fill("New description only");
    await description.blur();
    await loadAndWait(() => reload.click());
    expect(await page.evaluate(() => {
      const source = window.player?.getSource();
      return { title: source?.title, description: source?.description };
    })).toEqual({ title: "VOD DASH (Big Buck Bunny)", description: "New description only" });
    // A managed reload whose title equals the preset still retains its other
    // applied fields on the next edit; it is not another preset selection.
    const offset = configField(page, /^options.startOffset \(s\)/).locator("input");
    await offset.fill("3");
    await offset.blur();
    await loadAndWait(() => reload.click());
    expect(await page.evaluate(() => window.player?.getSource()?.description)).toBe("New description only");
    await expectDecodedPlayback(page);
    expect(errors).toEqual([]);
  });

  test("info-chip overlays follow the language toggle", async ({ page }) => {
    await page.goto(`${APP}/`);
    // A control-panel chip (its panel does NOT re-mount on language change — the chip itself
    // resolves the current language). Locate it by a language-STABLE substring — the UIConfig
    // key, which is present in BOTH languages' text and won't drift when copy is reworded.
    const chip = page.locator('#control-panel .info-chip[data-info-en*="seekbarSnappingEnabled"]');
    await chip.hover();
    await expect(page.locator(".info-overlay")).toContainText("マーカー");
    // Switch to English → the same chip's overlay now shows English (no panel re-mount).
    await page.getByRole("button", { name: "English", exact: true }).click();
    await chip.hover();
    await expect(page.locator(".info-overlay")).toContainText("timeline marker");
    await expect(page.locator(".info-overlay")).not.toContainText("マーカー");
    // The chip's aria-label tracks the language too (updated by the lang-change handler).
    await expect(chip).toHaveAttribute("aria-label", /timeline marker/);
  });

  test("the language toggle switches the UI prose between Japanese and English", async ({ page }) => {
    await page.goto(`${APP}/`);
    // Default Japanese.
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.locator(".ui-theme-bar-label")).toHaveText("UI テーマ");
    await expect(page.locator(".ui-guide-head h2")).toHaveText("UI はどうカスタムするか");
    // The control panel's own labels are bilingual too (a section title + a setting label).
    await expect(page.locator("#control-panel h2", { hasText: "再生" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "シーク中のプレビュー" })).toBeVisible();
    // Switch to English → prose across chrome, guide, the config panel AND the control panel updates.
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(".ui-theme-bar-label")).toHaveText("UI theme");
    await expect(page.locator(".ui-guide-head h2")).toHaveText("How to customize the UI");
    await expect(page.locator(".config-band-dynamic .config-band-head")).toContainText("Dynamic");
    // The control panel re-localized in place (it doesn't re-mount — preserves its live log).
    await expect(page.locator("#control-panel h2", { hasText: "Playback" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Seek scrub-preview" })).toBeVisible();
    // Sample-code comments are localized too: no Japanese (kana/kanji) remains in the
    // English construction snippet (guards the localizeCode comment map going stale).
    const cjkInCode = await page.evaluate(() => {
      const t = document.querySelector("#ui-construction .theme-diff-code")?.textContent ?? "";
      return /[぀-ヿ一-龯]/.test(t);
    });
    expect(cjkInCode).toBe(false);
    // Back to Japanese.
    await page.getByRole("button", { name: "日本語", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.locator(".ui-theme-bar-label")).toHaveText("UI テーマ");
  });

  test("every theme's construction code is fully localized in English (no mixed JA/EN)", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // Switch through EVERY theme button and assert its construction snippet has no kana/kanji.
    // The earlier guard only checked the active (Live) theme; this catches a comment added to
    // any theme (Default+CSS / Custom) without a matching localizeCode entry.
    const buttons = page.locator("#ui-theme-bar .theme-btn");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(13);
    const sources = new Set<string>();
    for (let i = 0; i < count; i++) {
      const name = (await buttons.nth(i).textContent())?.trim() ?? `#${i}`;
      await buttons.nth(i).click();
      const { cjk, src } = await page.evaluate(() => ({
        cjk: /[぀-ヿ一-龯]/.test(document.querySelector("#ui-construction .theme-diff-code")?.textContent ?? ""),
        src: document.querySelector("#ui-construction .theme-diff-codesrc")?.textContent ?? "",
      }));
      expect(cjk, `theme "${name}" has untranslated JA in its construction code`).toBe(false);
      sources.add(src);
    }
    // The construction panel really updates per theme (guards against re-checking stale,
    // already-English content if a click silently failed to switch): the unlocalized source
    // path differs across themes, so we should have seen many distinct values.
    expect(sources.size).toBeGreaterThanOrEqual(8);
  });

  test("double-click can be switched to ±10s seek", async ({ page }) => {
    await page.goto(`${APP}/`);
    // The setting offers both behaviors.
    const sel = page.locator("#control-panel select");
    await expect(sel.locator("option")).toHaveCount(2);

    // VOD so currentTime is an ordinary timeline.
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await sel.selectOption("seek");

    const readTime = async (): Promise<number> => {
      const t = (await page.locator(".panel-readout").textContent()) ?? "";
      return Number.parseFloat(/time \(rel\):\s*([\d.-]+)/.exec(t)?.[1] ?? "NaN");
    };
    // Wait until the source is actually playing (time advancing) before seeking,
    // rather than a fixed sleep.
    await expect.poll(readTime, { timeout: 15_000 }).toBeGreaterThan(0.5);
    const box = (await page.locator("#player").boundingBox())!;
    const before = await readTime();
    // Double-click the right half → forward ~10s (well beyond the ~1s of playback drift).
    await page.mouse.dblclick(box.x + box.width * 0.78, box.y + box.height * 0.42);
    await expect.poll(async () => (await readTime()) - before, { timeout: 6_000 }).toBeGreaterThan(5);
  });

  test("the LIVE button is a reset pill — visible dot, no default-button box", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "Live DASH + DVR", exact: true }).click();
    // Wait until the LIVE button is actually shown (live source settled).
    await expect.poll(async () => (await uiState(page)).liveButtonVisible, { timeout: 20_000 }).toBe(true);
    const style = await page.evaluate(() => {
      const el = document.querySelector('[class*="livebutton"]')!;
      const cs = getComputedStyle(el);
      const dot = getComputedStyle(el, "::before");
      return { borderStyle: cs.borderStyle, color: cs.color, dotW: parseFloat(dot.width) };
    });
    expect(style.dotW).toBeGreaterThan(0); // status dot not collapsed (flex: none)
    expect(style.borderStyle).toBe("none"); // UA <button> border reset (cssClass replaces .bmpui-ui-button)
    expect(style.color).toBe("rgb(255, 255, 255)"); // white label, not the UA dark text
  });

  test("live→VOD switches the DVR UI promptly (no stuck Live UI)", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "Live DASH + DVR", exact: true }).click();
    await expect.poll(async () => (await uiState(page)).mode, { timeout: 20_000 }).toBe("live-dvr");
    // The live source must really decode, not just parse — give the live edge time to buffer.
    await expect
      .poll(async () => page.evaluate(() => document.querySelector("video")?.readyState ?? 0), { timeout: 25_000 })
      .toBeGreaterThanOrEqual(3);
    expect((await uiState(page)).liveButtonVisible).toBe(true);

    // Switch to VOD. The control panel mode + DVR availability flip promptly (the bug
    // was a multi-second lag stuck on "live-dvr"); the player's LIVE button hides once
    // isLive() settles (~0.5s later — the panel is optimistic, the player catches up),
    // so poll for both rather than racing the settle.
    await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
    await expect.poll(async () => (await uiState(page)).mode, { timeout: 5_000 }).toBe("vod");
    await expect.poll(async () => (await uiState(page)).liveButtonVisible, { timeout: 6_000 }).toBe(false);
    expect((await uiState(page)).dvrAvailable).toBe("false");

    // …and back to live is prompt too.
    await page.getByRole("button", { name: "Live DASH + DVR", exact: true }).click();
    await expect.poll(async () => (await uiState(page)).mode, { timeout: 10_000 }).toBe("live-dvr");
  });

  test("live playback shows a true live latency in the player-state readout", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "Live DASH + DVR", exact: true }).click();
    await expect.poll(async () => (await uiState(page)).mode, { timeout: 20_000 }).toBe("live-dvr");
    // Real playback so getCurrentTime(AbsoluteTime) resolves to a wall clock (DASH availabilityStartTime).
    await expect
      .poll(async () => page.evaluate(() => document.querySelector("video")?.readyState ?? 0), { timeout: 25_000 })
      .toBeGreaterThanOrEqual(3);
    // "liveLatency: X.Xs" is the TRUE end-to-end latency: positive even at the live edge (inherent
    // encode/package/CDN/buffer delay). The old metric (−getTimeShift) read ~0.0s at the edge, so a
    // positive value proves it's real latency, not the scrub offset.
    await expect
      .poll(
        async () => {
          const ro = (await page.locator(".panel-readout").textContent()) ?? "";
          const m = /liveLatency:\s*([\d.]+)s/.exec(ro);
          return m ? Number(m[1]) : -1;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    // The SDK's getLatency() (distance from the live edge) is shown alongside it.
    await expect(page.locator(".panel-readout")).toContainText("getLatency:");
  });

  test("the config panel exposes low-latency catchup + fallback runtime config", async ({ page }) => {
    await page.goto(`${APP}/`);
    await page.evaluate(() =>
      document.querySelectorAll("#config-panel details").forEach((d) => ((d as HTMLDetailsElement).open = true)),
    );
    const llGroup = page.locator("#config-panel .config-band-dynamic .config-group", { hasText: "Low Latency" });
    await expect(llGroup).toHaveCount(1);
    // targetLatency + catchup{playbackRateThreshold, seekThreshold, playbackRate}
    //              + fallback{playbackRateThreshold, seekThreshold, playbackRate} = 7 number inputs.
    await expect(llGroup.locator('input[type="number"]')).toHaveCount(7);
    for (const label of [
      "catchup: playbackRateThreshold",
      "catchup: seekThreshold",
      "fallback: playbackRateThreshold",
      "fallback: seekThreshold",
    ]) {
      await expect(llGroup).toContainText(label);
    }
    // Editing a catchup field on a normal (non-low-latency) stream is a no-op — the read-merge-write
    // via player.lowlatency.getCatchupConfig() throws and is caught — so it must not crash the app.
    const seek = llGroup
      .locator(".config-field", { hasText: "catchup: seekThreshold" })
      .locator('input[type="number"]');
    await seek.fill("10");
    await seek.blur();
    await expect(seek).toHaveValue("10");
    await expect(page.locator("video")).toHaveCount(1);
  });

  test("app button styles don't leak onto the player (play overlay stays transparent)", async ({ page }) => {
    await page.goto(`${APP}/`);
    // The full-player center play/pause overlay must stay transparent. A solid
    // background here is the app's `button { background }` styling leaking onto the
    // Bitmovin <button>, which masked the whole video — a gray box at rest, a frame
    // on hover. Assert the resting background; the leak applies at rest too.
    await expect(page.locator('[class*="hugeplaybacktogglebutton"]')).toHaveCount(1);
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const b = document.querySelector('[class*="hugeplaybacktogglebutton"]');
            return b ? getComputedStyle(b).backgroundColor : null;
          }),
        { timeout: 15_000 },
      )
      .toBe("rgba(0, 0, 0, 0)");
  });

  test("the default source actually plays (not just parses the manifest)", async ({ page }) => {
    await page.goto(`${APP}/`);
    // Guards the class of bug the user hit: a source whose manifest loads but whose
    // video never decodes (e.g. a rate-limited / dead default). Assert REAL playback —
    // the <video> reaches a ready state with data AND currentTime advances — not just
    // the control panel's derived mode.
    await expect
      .poll(async () => page.evaluate(() => document.querySelector("video")?.readyState ?? 0), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3); // HAVE_FUTURE_DATA
    const t0 = await page.evaluate(() => document.querySelector("video")!.currentTime);
    await expect
      .poll(async () => page.evaluate((p) => (document.querySelector("video")?.currentTime ?? 0) - p, t0), {
        timeout: 8_000,
      })
      .toBeGreaterThan(0.3); // time advanced → genuinely playing
  });
});
