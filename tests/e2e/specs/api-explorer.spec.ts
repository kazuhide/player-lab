import type { Page, Route } from "@playwright/test";
import { expect, test } from "../src/browser-test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ApiSchema } from "../../../apps/web/src/api/types";

const catalog = JSON.parse(readFileSync(resolve(__dirname, "../../../apps/web/src/api/schema.json"), "utf8")) as ApiSchema;
test.beforeEach(async ({ page }) => {
  await page.route(/analytics-ingress[^/]*\.bitmovin\.com/i, route => route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.goto("./");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.locator(".api-explorer > summary").click();
  await expect(page.getByRole("searchbox", { name: "Search APIs" })).toBeVisible();
});

async function selectApi(page: Page, category: string, id: string): Promise<void> {
  await page.getByRole("combobox", { name: "API category", exact: true }).selectOption(category);
  await page.getByRole("searchbox", { name: "Search APIs" }).fill(id);
  await page.getByRole("listbox", { name: "SDK entry", exact: true }).selectOption(id);
}
async function branch(page: Page, id: string, kind: string): Promise<void> {
  const entry = catalog.rows.find(entry => entry.id === id)!;
  const schema = catalog.nodes[entry.schema!]!;
  if (schema.kind === "union") {
    const choice = schema.options!.find(key => catalog.nodes[key]!.kind === kind)!;
    await page.locator(".api-explorer-form > .api-value > select").selectOption(choice);
  }
}
async function apply(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toContainText("Configuration submitted");
}
async function readApi(page: Page, id: string): Promise<string> {
  await selectApi(page, "observation", id);
  await page.getByRole("button", { name: "Read state", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toHaveText("SDK call completed.");
  return (await page.locator(".api-result").textContent())!;
}

function objectField(page: Page, name: string) {
  return page.locator(".api-explorer-form fieldset").filter({
    has: page.locator("legend > label", { hasText: new RegExp("^\\s*" + name + "$") }),
  }).last();
}

async function scriptedHls(page: Page): Promise<void> {
  const id = "PlayerConfig.playback.preferredTech";
  await selectApi(page, "configuration", id); await branch(page, id, "array");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await objectField(page, "player").getByRole("combobox", { name: "Input type", exact: true }).selectOption({ label: "PlayerType.Html5" });
  await objectField(page, "streaming").getByRole("combobox", { name: "Input type", exact: true }).selectOption({ label: "StreamType.Hls" });
  await apply(page);
  const config = JSON.parse(await readApi(page, "PlayerAPI.getConfig"));
  expect(config.playback.preferredTech).toEqual([{ player: "html5", streaming: "hls" }]);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
}

test("typed source values reload the current source and API reads show the submitted value", async ({ page }) => {
  const id = "SourceConfig.title";
  await selectApi(page, "configuration", id); await branch(page, id, "string");
  await page.locator(".api-explorer-form input[type=text]").fill("Detailed API source");
  await apply(page);
  expect(await readApi(page, "PlayerAPI.getSource")).toContain("Detailed API source");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("a failed basic Apply restores its detailed override after an unrelated Read state", async ({ page }) => {
  const id = "SourceConfig.title";
  await selectApi(page, "configuration", id); await branch(page, id, "string");
  await page.locator(".api-explorer-form input[type=text]").fill("Detailed original title");
  await apply(page);
  const source = JSON.parse(await readApi(page, "PlayerAPI.getSource")) as { hls: string };
  const master = new URL(source.hls, page.url()).href;
  let held: Route | undefined;
  await page.route(master, route => { held = route; });
  const basicTitle = page.locator("#config-panel .config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) }).locator("input");
  await basicTitle.fill("Basic failing title"); await basicTitle.dispatchEvent("change");
  await page.getByRole("button", { name: "Reload the source to apply", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await readApi(page, "PlayerAPI.getConfig");
  await held!.fulfill({ status: 200, contentType: "application/vnd.apple.mpegurl", body: "invalid HLS manifest" });
  await expect(page.locator(".config-band-dynamic [role=status]")).toContainText("Could not apply settings.");
  await page.unroute(master);
  await page.getByRole("button", { name: "Recreate Player", exact: true }).click();
  await expect(page.locator(".api-explorer > [role=status]")).toHaveText("SDK call completed.");
  expect(JSON.parse(await readApi(page, "PlayerAPI.getSource")).title).toBe("Detailed original title");
});

test("an error before first opening the SDK editor disables commands until source recovery", async ({ page }, testInfo) => {
  const source = JSON.parse(await readApi(page, "PlayerAPI.getSource")) as { hls: string };
  const master = new URL(source.hls, page.url()).href;
  // A fresh document starts playback without loading the optional SDK catalog.
  await page.goto("./");
  await page.getByRole("button", { name: "English", exact: true }).click();
  const details = page.locator(".api-explorer");
  await expect(details).toHaveJSProperty("open", false);
  await expect(page.getByRole("searchbox", { name: "Search APIs" })).toHaveCount(0);
  const video = page.locator("#player video");
  await expect(video).toHaveJSProperty("readyState", 4);
  await page.route(master, route => route.fulfill({ status: 404,
    contentType: "application/vnd.apple.mpegurl", body: "not found" }));
  try {
    const title = page.locator("#config-panel .config-field").filter({
      has: page.locator(".config-field-label", { hasText: /^title/ }),
    }).locator("input");
    await title.fill("Source recovery before opening the SDK editor");
    await title.dispatchEvent("change");
    await page.getByRole("button", { name: "Reload the source to apply", exact: true }).click();
    await expect(page.locator(".config-band-dynamic [role=status]")).toContainText("Could not apply settings.");
    await expect(details).toHaveJSProperty("open", false);
    await details.locator(":scope > summary").click();
    await page.getByRole("combobox", { name: "API category", exact: true }).selectOption("command");
    await page.getByRole("searchbox", { name: "Search APIs" }).fill("PlayerAPI.play");
    await expect(page.locator('option[value="PlayerAPI.play"]')).toBeDisabled();
    await expect(page.locator('button[data-api-run="PlayerAPI.play"]')).toBeDisabled();
    await expect(page.locator('button[data-api-run="PlayerAPI.play"]')).toHaveAttribute("data-api-unavailable", "source");
    const retained = await readApi(page, "PlayerAPI.getSource");
    // This transport may unload on a manifest error. Controller tests also
    // cover SDK failures that retain the historical source configuration.
    await testInfo.attach("closed-editor-failed-source", { contentType: "application/json",
      body: JSON.stringify({ sourceRetained: !["null", "undefined"].includes(retained),
        editorOpenedAfterFailure: true, unavailable: "source" }) });
    await page.unroute(master);
    await page.getByRole("button", { name: "Reload the source to apply", exact: true }).click();
    await expect(video).toHaveJSProperty("readyState", 4);
    await selectApi(page, "command", "PlayerAPI.pause");
    await expect(page.getByRole("button", { name: "Run API", exact: true })).toBeEnabled();
  } finally {
    await page.unroute(master);
  }
});

for (const successor of ["pending", "failed"]) test(`Recreate reports superseded while a newer Cast build is ${successor}`, async ({ page }) => {
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  const source = JSON.parse(await readApi(page, "PlayerAPI.getSource")) as { hls: string };
  const held: Route[] = [];
  await page.route(new URL(source.hls, page.url()).href, route => { held.push(route); });
  let failed = false;
  page.on("console", message => { if (message.type() === "error" && message.text().includes("Player recreation failed")) failed = true; });
  await page.getByRole("button", { name: "Recreate Player", exact: true }).click();
  await expect.poll(() => held.length).toBe(1);
  await page.getByRole("checkbox", { name: /Chromecast button/ }).check();
  await expect.poll(() => held.length).toBe(2);
  await held[0]!.abort("failed");
  await expect(page.locator(".api-explorer > [role=status]")).toHaveText("The player or source changed. Apply again.");
  if (successor === "failed") {
    await held[1]!.fulfill({ status: 200, contentType: "application/vnd.apple.mpegurl", body: "invalid HLS manifest" });
    await expect.poll(() => failed).toBe(true);
    await expect(page.locator(".api-explorer > [role=status]")).toHaveText("The player or source changed. Apply again.");
  }
});

test("a codec priority array and query dictionary reach the recreated Player", async ({ page }) => {
  let id = "PlayerConfig.playback.audioCodecPriority";
  await selectApi(page, "configuration", id); await branch(page, id, "array");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.locator(".api-explorer-form input[type=text]").fill("mp4a.40.2");
  await apply(page);
  expect(await readApi(page, "PlayerAPI.getConfig")).toContain('"mp4a.40.2"');
  id = "PlayerConfig.tweaks.query_parameters";
  await selectApi(page, "configuration", id); await branch(page, id, "object");
  await page.getByRole("textbox", { name: "Property name", exact: true }).fill("lab_fixture");
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  await page.locator(".api-explorer-form fieldset input[type=text]").fill("enabled");
  await apply(page);
  expect(await readApi(page, "PlayerAPI.getConfig")).toContain('"lab_fixture": "enabled"');
});

test("a user-approved request callback runs in the real SDK after Player recreation", async ({ page }) => {
  // Native HLS owns its HTTP requests; use the SDK's scripted HLS transport.
  await scriptedHls(page);
  const id = "PlayerConfig.network.preprocessHttpRequest";
  await selectApi(page, "configuration", id); await branch(page, id, "function");
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill("return Promise.resolve(request);");
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await apply(page);
  await expect(page.locator(".api-event-log")).toContainText("Callback invoked");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  await expect(page.locator(".api-explorer-content > pre").first()).toContainText("return Promise.resolve(request)");
});

test("a complete subtitle array applies required sibling fields in one SDK load", async ({ page }) => {
  const id = "SourceConfig.subtitleTracks";
  const url = new URL("./api-explorer-subtitle.vtt", page.url()).href;
  await page.route(url, route => route.fulfill({ status: 200, contentType: "text/vtt",
    body: "WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nRequired subtitle fields applied together.\n" }));
  await selectApi(page, "configuration", id); await branch(page, id, "array");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  for (const [name, value] of Object.entries({ id: "edited-track", lang: "en", kind: "subtitle", label: "Edited English" })) {
    await objectField(page, name).locator('input[type="text"]').fill(value);
  }
  const location = objectField(page, "url");
  await location.getByRole("checkbox", { name: "url", exact: true }).check();
  await location.getByRole("combobox", { name: "Input type", exact: true }).selectOption({ label: "string" });
  await location.locator('input[type="text"]').fill(url);
  await apply(page);
  expect(await readApi(page, "PlayerAPI.subtitles.list")).toContain("Edited English");
  await selectApi(page, "command", "PlayerAPI.subtitles.enable");
  await page.locator('.api-explorer-form input[type="text"]').fill("edited-track");
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect(page.locator("#player .bmpui-ui-subtitle-overlay")).toContainText("Required subtitle fields applied together.");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("indexed comparisons follow the selected item and retain its baseline after a failed SDK load", async ({ page, browserName }, testInfo) => {
  const urls = ["first", "second", "draft"].map(name => new URL(`./indexed-${name}.vtt`, page.url()).href);
  await page.route(/indexed-.*\.vtt$/, route => route.fulfill({ status: 200, contentType: "text/vtt",
    body: "WEBVTT\n\n00:00.000 --> 10:00.000\nIndexed comparison fixture\n" }));
  await selectApi(page, "configuration", "SourceConfig.subtitleTracks");
  await branch(page, "SourceConfig.subtitleTracks", "array");
  for (const [index, url] of urls.slice(0, 2).entries()) {
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    for (const [name, value] of Object.entries({ id: `indexed-${index}`, lang: "en", kind: "subtitle", label: `Track ${index}` })) {
      await objectField(page, name).locator('input[type="text"]').fill(value);
    }
    const location = objectField(page, "url");
    await location.getByRole("checkbox", { name: "url", exact: true }).check();
    await location.getByRole("combobox", { name: "Input type", exact: true }).selectOption({ label: "string" });
    await location.locator('input[type="text"]').fill(url);
  }
  await apply(page);
  const source = JSON.parse(await readApi(page, "PlayerAPI.getSource"));
  const master = new URL(source.hls, page.url()).href;
  const id = "SourceConfig.subtitleTracks[].url";
  await selectApi(page, "configuration", id); await branch(page, id, "string");
  const value = page.locator('.api-explorer-form input[type="text"]');
  const index = page.getByRole("spinbutton", { name: "Array index 1", exact: true });
  const difference = page.locator(".api-draft-status");
  await value.fill(urls[1]!);
  await expect(difference).toHaveText(`Before: ${urls[0]} → After: ${urls[1]}`);
  await index.fill("1");
  await expect(difference).toBeHidden();
  await index.fill(""); await expect(difference).toContainText("After: Incomplete input.");
  await index.fill("1"); await value.fill(urls[2]!);
  await expect(difference).toHaveText(`Before: ${urls[1]} → After: ${urls[2]}`);
  const requests: { route: Route; response?: Promise<void> }[] = [];
  const settled = new Set<Route>();
  let rejectRequests = false;
  const rejectRequest = (request: typeof requests[number]): Promise<void> => request.response ??= request.route.fulfill({
    status: 404, contentType: "application/vnd.apple.mpegurl", body: "not found",
  }).then(() => { settled.add(request.route); });
  const interceptSource = async (route: Route): Promise<void> => {
    const request = { route };
    requests.push(request);
    if (rejectRequests) await rejectRequest(request);
  };
  await page.route(master, interceptSource);
  try {
    await page.getByRole("button", { name: "Apply setting", exact: true }).click();
    await expect.poll(() => requests.length > 0).toBe(true);
    await index.fill("0"); await expect(difference).toHaveText(`Before: ${urls[0]} → After: ${urls[2]}`);
    await index.fill("1"); await expect(difference).toHaveText(`Before: ${urls[1]} → After: ${urls[2]}`);
    // Native HLS and scripted HLS can retry with different request types.
    rejectRequests = true;
    await Promise.all(requests.map(rejectRequest));
    const failure = browserName === "webkit"
      ? "1210: The video element has thrown an error while loading the stream."
      : "1208: Failed to load HLS playlist: 404 Not Found.";
    await expect(page.locator(".api-explorer > [role=status]")).toHaveText(failure);
    await page.getByRole("combobox", { name: "API category", exact: true }).selectOption("command");
    await page.getByRole("searchbox", { name: "Search APIs" }).fill("PlayerAPI.play");
    await expect(page.locator('option[value="PlayerAPI.play"]')).toBeDisabled();
    await expect(page.locator('button[data-api-run="PlayerAPI.play"]')).toBeDisabled();
    await expect(page.locator('button[data-api-run="PlayerAPI.play"]')).toHaveAttribute("data-api-unavailable", "source");
    const retainedSource = await readApi(page, "PlayerAPI.getSource");
    await testInfo.attach("failed-source-availability", { contentType: "application/json", body: JSON.stringify({
      engine: browserName, failure, sourceRetained: !["null", "undefined"].includes(retainedSource),
      operation: "PlayerAPI.play", unavailable: "source",
    }) });
    await selectApi(page, "configuration", id);
    await expect(difference).toHaveText(`Before: ${urls[1]} → After: ${urls[2]}`);
    await index.fill("0");
    await expect(difference).toHaveText(`Before: ${urls[0]} → After: ${urls[2]}`);
    await value.fill(urls[0]!); await expect(difference).toBeHidden();
    await index.fill("1");
    await expect(difference).toHaveText(`Before: ${urls[1]} → After: ${urls[0]}`);
    await value.fill(urls[2]!);
    await expect(difference).toHaveText(`Before: ${urls[1]} → After: ${urls[2]}`);
    await page.unroute(master, interceptSource);
    await Promise.all(requests.map(rejectRequest));
    expect(settled.size, "every intercepted request must be fulfilled before retry").toBe(requests.length);
    await apply(page);
    await expect(difference).toBeHidden();
    await index.fill("0");
    await expect(difference).toHaveText(`Before: ${urls[0]} → After: ${urls[2]}`);
    await index.fill("1"); await expect(difference).toBeHidden();
    expect(JSON.parse(await readApi(page, "PlayerAPI.getSource"))).toEqual({ ...source, subtitleTracks: [
      source.subtitleTracks[0], { ...source.subtitleTracks[1], url: urls[2] },
    ] });
    // Recovery follows autoplay. Pause explicitly so the following play command
    // exercises a permitted transition rather than an already-playing no-op.
    await expect.poll(() => page.locator("#player video").evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
    await selectApi(page, "command", "PlayerAPI.pause");
    await page.getByRole("button", { name: "Run API", exact: true }).click();
    await expect(page.locator("#player video")).toHaveJSProperty("paused", true);
    const video = page.locator("#player video");
    const playbackBefore = await video.evaluate((element: HTMLVideoElement) => {
      const progress = { frames: 0, callback: 0 };
      const presented = () => { progress.frames++; progress.callback = element.requestVideoFrameCallback(presented); };
      progress.callback = element.requestVideoFrameCallback(presented);
      Reflect.set(element, "__indexedApplyRecovery", progress);
      return { time: element.currentTime, frames: progress.frames };
    });
    try {
      await selectApi(page, "command", "PlayerAPI.play");
      await page.getByRole("button", { name: "Run API", exact: true }).click();
      await expect(page.locator(".api-explorer > [role=status]")).toHaveText("SDK call completed.");
      await video.scrollIntoViewIfNeeded();
      // Count fresh frames presented after the successful retry.
      await expect.poll(() => video.evaluate((element: HTMLVideoElement, start) =>
        !element.paused && element.readyState >= 3 && element.videoWidth > 0
          && element.currentTime > start.time + 0.3
          && Reflect.get(element, "__indexedApplyRecovery").frames > 1, playbackBefore)).toBe(true);
    } finally {
      const playbackAfter = await video.evaluate((element: HTMLVideoElement) => {
        const progress = Reflect.get(element, "__indexedApplyRecovery");
        element.cancelVideoFrameCallback(progress.callback);
        Reflect.deleteProperty(element, "__indexedApplyRecovery");
        return { time: element.currentTime, frames: progress.frames, paused: element.paused,
          readyState: element.readyState, errorCode: element.error?.code ?? null,
          width: element.videoWidth, height: element.videoHeight };
      });
      await testInfo.attach("indexed-apply-recovery", { contentType: "application/json", body: JSON.stringify({
        engine: browserName, failure, matchedRequests: requests.length, settledRequests: settled.size,
        requestTypes: requests.map(request => request.route.request().resourceType()),
        frameMeasurement: "requestVideoFrameCallback", playbackBefore, playbackAfter,
      }) });
    }
  } finally {
    rejectRequests = true;
    await page.unroute(master, interceptSource);
    await Promise.all(requests.map(rejectRequest));
  }
});

test("ordinary VOD disables ad actions while notification APIs remain available", async ({ page }) => {
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  await page.getByRole("combobox", { name: "API category", exact: true }).selectOption("command");
  for (const [id, reason] of [["PlayerAPI.ads.skip", "ad-inactive"], ["PlayerAPI.sgai.skip", "sgai-inactive"]]) {
    await page.getByRole("searchbox", { name: "Search APIs" }).fill(id!);
    const option = page.locator(`option[value="${id}"]`);
    await expect(option).toBeDisabled();
    await expect(option).toHaveAttribute("data-api-unavailable", reason!);
    await expect(page.locator(`button[data-api-run="${id}"]`)).toBeDisabled();
    await expect(page.locator(`p[data-api-reason="${id}"]`)).toBeVisible();
  }
  // These calls report externally managed ad events; they do not insert ads.
  const notification = "PlayerAPI.analytics.ssai.adBreakEnd";
  await page.getByRole("searchbox", { name: "Search APIs" }).fill(notification);
  await expect(page.locator(`option[value="${notification}"]`)).toBeEnabled();
  await expect(page.locator(`button[data-api-run="${notification}"]`)).toBeEnabled();
});

test("component constructor overrides apply through every original theme", async ({ page }) => {
  const id = "UIComponentConfigMap.ControlBar.cssClasses";
  await selectApi(page, "configuration", id); await branch(page, id, "array");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.locator(".api-explorer-form input[type=text]").fill("api-control-check");
  await apply(page);
  const themes = page.locator("#ui-theme-bar .theme-btn");
  const count = await themes.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await themes.nth(index).click();
    await expect(page.locator('#player [class*="api-control-check"]').first()).toBeAttached();
  }
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("editing a marker inside the base array preserves its neighbours and exports usable edits", async ({ page }) => {
  const id = "UIConfig.metadata.markers[].title";
  await selectApi(page, "configuration", id);
  await page.getByRole("spinbutton", { name: "Array index 1", exact: true }).fill("2");
  await branch(page, id, "string");
  await page.locator(".api-explorer-form input[type=text]").fill("Edited third chapter");
  await apply(page);
  const config = await readApi(page, "UIManager.getConfig");
  expect(config).toContain("Chapter 1"); expect(config).toContain("Chapter 2"); expect(config).toContain("Edited third chapter");
});

test("indexed UI drafts retain their accepted baseline across theme replacement and player recreation", async ({ page }) => {
  const id = "UIConfig.metadata.markers[].title";
  await selectApi(page, "configuration", id); await branch(page, id, "string");
  const index = page.getByRole("spinbutton", { name: "Array index 1", exact: true });
  const value = page.locator(".api-explorer-form input[type=text]");
  const difference = page.locator(".api-draft-status");
  await index.fill("2"); await value.fill("Accepted third chapter");
  await expect(difference).toHaveText("Before: Chapter 3 → After: Accepted third chapter");
  await apply(page);
  await value.fill("Unapplied third chapter");
  for (const replacement of ["theme", "player"]) {
    if (replacement === "theme") await page.locator("#ui-theme-bar .theme-btn").nth(1).click();
    else await page.getByRole("button", { name: "Recreate Player", exact: true }).click();
    await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
    const config = await readApi(page, "UIManager.getConfig");
    expect(config).toContain("Chapter 1"); expect(config).toContain("Chapter 2");
    expect(config).toContain("Accepted third chapter"); expect(config).not.toContain("Unapplied third chapter");
    await selectApi(page, "configuration", id);
    await expect(index).toHaveValue("2"); await expect(value).toHaveValue("Unapplied third chapter");
    await expect(difference).toHaveText("Before: Accepted third chapter → After: Unapplied third chapter");
  }
});

test("a real language-change dispatcher is created and connected to UI localization", async ({ page }) => {
  const id = "UIConfig.localization.events.onLanguageChanged";
  await selectApi(page, "configuration", id);
  await page.locator(".api-explorer-form > .api-value > select").selectOption("factory:EventDispatcher");
  await apply(page);
  await expect(page.locator(".api-explorer-content > pre").first()).toContainText("new EventDispatcher()");
  const config = JSON.parse(await readApi(page, "UIManager.getConfig"));
  // Production minification renames classes. A real instance has an opaque
  // preview, whereas an incorrectly cast plain object is serialized as data.
  expect(config.localization.events.onLanguageChanged).toMatch(/^\[[^\]]+\]$/);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("a GUI-created dispatcher can be selected again when its configuration is rebuilt", async ({ page }) => {
  const id = "UIConfig.localization.events.onLanguageChanged";
  await selectApi(page, "configuration", id);
  await page.locator(".api-explorer-form > .api-value > select").selectOption("factory:EventDispatcher");
  await apply(page);
  await selectApi(page, "configuration", id);
  const picker = page.locator(".api-explorer-form > .api-value > select");
  const reference = await picker.locator('option[value^="resource:"]').first().getAttribute("value");
  expect(reference).toBeTruthy();
  await picker.selectOption(reference!);
  await apply(page);
  await expect(page.locator(".api-explorer-content > pre").first()).toContainText("new EventDispatcher()");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("an eagerly created GUI component follows its configured localization dispatcher", async ({ page }) => {
  let id = "UIConfig.localization.events.onLanguageChanged";
  await selectApi(page, "configuration", id);
  await page.locator(".api-explorer-form > .api-value > select").selectOption("factory:EventDispatcher");
  await apply(page);
  id = "UIComponentConfigMap.ControlBar.components";
  await selectApi(page, "configuration", id); await branch(page, id, "array");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.locator(".api-explorer-form select").filter({ has: page.locator('option[value="factory:Label"]') }).selectOption("factory:Label");
  const config = page.getByRole("checkbox", { name: "config", exact: true });
  await config.check();
  await config.locator("../..").locator(":scope > .api-value > select").selectOption({ label: "Config" });
  const text = objectField(page, "text");
  await text.getByRole("checkbox", { name: "text", exact: true }).check();
  await text.getByRole("combobox", { name: "Input type", exact: true }).selectOption({ label: "Localizer" });
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill('return lab.ui.i18n.getLocalizer("play")();');
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await apply(page);
  const label = page.locator("#player .bmpui-ui-controlbar .bmpui-ui-label").filter({ hasText: /^Play$/ }).first();
  await expect(label).toBeVisible();
  await selectApi(page, "command", "PlayerAPI.on");
  await page.locator(".api-explorer-form select").filter({ has: page.locator("option", { hasText: /^PlayerEvent.TimeChanged$/ }) }).selectOption({ label: "PlayerEvent.TimeChanged" });
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill('lab.ui.i18n.setLanguage("de");');
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect(page.locator("#player .bmpui-ui-controlbar .bmpui-ui-label").filter({ hasText: /^Abspielen$/ }).first()).toBeVisible();
});

test("a visible Player element can be selected as the UI container across UI rebuilds", async ({ page }) => {
  await selectApi(page, "configuration", "UIConfig.container");
  await branch(page, "UIConfig.container", "instance");
  const picker = page.locator(".api-explorer-form select").last();
  const surface = await picker.locator("option").filter({ hasText: /^Player surface/ }).getAttribute("value");
  await picker.selectOption(surface!);
  await apply(page);
  await expect(page.locator("#player .bmpui-ui-uicontainer:visible").first()).toBeVisible();
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("the original live-rewind checkbox reflects detailed settings and can override them", async ({ page }) => {
  const id = "PlayerConfig.playback.timeShift";
  await selectApi(page, "configuration", id);
  const entry = catalog.rows.find(row => row.id === id)!;
  const type = catalog.nodes[entry.schema!]!;
  await page.locator(".api-explorer-form > .api-value > select").selectOption(type.options!.find(id => catalog.nodes[id]!.value === false)!);
  await apply(page);
  const toggle = page.getByRole("checkbox", { name: /^Allow DVR \(timeShift\)/ });
  await expect(toggle).not.toBeChecked();
  const previous = await page.locator("#player video").elementHandle();
  await toggle.check();
  await expect.poll(() => previous!.evaluate(video => video.isConnected)).toBe(false);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  const config = JSON.parse(await readApi(page, "PlayerAPI.getConfig"));
  expect(config.playback.timeShift).toBe(true);
  await expect(toggle).toBeChecked();
});

test("the original UI controls reflect detailed edits and can replace them", async ({ page }) => {
  let id = "UIConfig.seekbarSnappingEnabled";
  await selectApi(page, "configuration", id);
  const entry = catalog.rows.find(row => row.id === id)!;
  await page.locator(".api-explorer-form > .api-value > select").selectOption(catalog.nodes[entry.schema!]!.options!.find(key => catalog.nodes[key]!.value === false)!);
  await apply(page);
  const toggle = page.getByRole("checkbox", { name: /^Snap seeks to markers/ });
  await expect(toggle).not.toBeChecked();
  id = "UIConfig.seekbarSnappingRange";
  await selectApi(page, "configuration", id); await branch(page, id, "number");
  await page.locator(".api-explorer-form input[inputmode=decimal]").fill("3");
  await apply(page);
  const range = page.locator(".panel-row").filter({ has: page.locator(".panel-label", { hasText: /^Snap range/ }) }).getByRole("spinbutton");
  await expect(range).toHaveValue("3");
  id = "UIConfig.localization.language";
  await selectApi(page, "configuration", id); await branch(page, id, "string");
  await page.locator(".api-explorer-form input[type=text]").fill("de");
  await apply(page);
  await expect(page.getByRole("textbox", { name: "Player UI language", exact: true })).toHaveValue("de");
  await toggle.check();
  expect(JSON.parse(await readApi(page, "UIManager.getConfig")).seekbarSnappingEnabled).toBe(true);
  id = "UIComponentConfigMap.UIContainer.hideDelay";
  await selectApi(page, "configuration", id); await branch(page, id, "number");
  await page.locator(".api-explorer-form input[inputmode=decimal]").fill("5000");
  await apply(page);
  const autohide = page.getByRole("checkbox", { name: /^Autohide controls/ });
  await expect(autohide).toBeChecked();
  await autohide.uncheck();
  expect(JSON.parse(await readApi(page, "UIManager.getConfig")).componentConfigOverrides?.UIContainer?.hideDelay).not.toBe(5000);
  await expect(autohide).not.toBeChecked();
});

test("SDK-managed UI uses the configured factory and theme selection restores app ownership", async ({ page }) => {
  let id = "PlayerConfig.style.uiManagerFactory";
  await selectApi(page, "configuration", id); await branch(page, id, "function");
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill(
    'return lab.ui.UIFactory.buildUI(playerAPI, { ...config, seekbarSnappingRange: 7.25 });');
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await apply(page);
  id = "PlayerConfig.ui";
  await selectApi(page, "configuration", id);
  await page.getByRole("textbox", { name: "Data without an SDK type restriction" }).fill("{}");
  await apply(page);
  await expect(page.locator(".ui-theme-bar-note")).toContainText("SDK-managed UI");
  // Event counts survive the bounded payload history; verify the actual factory result as well.
  await expect(page.locator(".api-event-log")).toContainText(/(?:^|\n)callback: [1-9]\d*(?:\n|$)/);
  expect(JSON.parse(await readApi(page, "UIManager.getConfig")).seekbarSnappingRange).toBe(7.25);
  await page.locator("#ui-theme-bar .theme-btn").filter({ hasText: /^Sports$/ }).click();
  await expect(page.locator(".ui-theme-bar-note")).not.toContainText("SDK-managed UI");
  await expect(page.locator("#player video")).toHaveCount(1);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("an unset playback parent does not block a later edit in the original controls", async ({ page }) => {
  await selectApi(page, "configuration", "PlayerConfig.playback");
  await branch(page, "PlayerConfig.playback", "undefined");
  await apply(page);
  const toggle = page.getByRole("checkbox", { name: /^Allow DVR \(timeShift\)/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  await expect(toggle).not.toBeChecked();
  const config = JSON.parse(await readApi(page, "PlayerAPI.getConfig"));
  expect(config.playback.timeShift).toBe(false);
});

test("an unfinished request callback can be removed without waiting for its old load", async ({ page }) => {
  await scriptedHls(page);
  const id = "PlayerConfig.network.preprocessHttpRequest";
  await selectApi(page, "configuration", id); await branch(page, id, "function");
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill("return new Promise(() => {});");
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await expect.poll(async () => (await page.locator(".api-event-log").textContent())!.includes("Callback invoked")).toBe(true);
  await page.getByRole("button", { name: "Remove this override", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toHaveText("Override removed.");
  await expect(page.locator("#player video")).toHaveCount(1);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("a rejected older source load cannot roll back settings retained by a new Player", async ({ page }) => {
  await scriptedHls(page);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  const source = JSON.parse(await readApi(page, "PlayerAPI.getSource")) as { hls: string };
  const hls = source.hls + (source.hls.includes("?") ? "&" : "?") + "slow_source=1";
  let id = "PlayerConfig.network.preprocessHttpRequest";
  await selectApi(page, "configuration", id); await branch(page, id, "function");
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill('return request.url.includes("slow_source=1") ? new Promise(() => {}) : Promise.resolve(request);');
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await apply(page);
  await page.getByRole("button", { name: "Clear event history", exact: true }).click();
  id = "SourceConfig.hls";
  await selectApi(page, "configuration", id); await branch(page, id, "string");
  await page.locator(".api-explorer-form input[type=text]").fill(hls);
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await expect.poll(async () => (await page.locator(".api-event-log").textContent())!.includes("Callback invoked")).toBe(true);
  await selectApi(page, "configuration", "PlayerConfig.network.preprocessHttpRequest");
  await page.getByRole("button", { name: "Remove this override", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toHaveText("Override removed.");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  expect(JSON.parse(await readApi(page, "PlayerAPI.getSource")).hls).toBe(hls);
});

test("SDK-owned UI variants and markers keep the identity required by switch and remove", async ({ page }) => {
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  await readApi(page, "UIManager.getUiVariants");
  await selectApi(page, "command", "UIManager.switchToUiVariant");
  const picker = page.getByRole("combobox", { name: "SDK object", exact: true }).first();
  await expect(picker).toBeVisible();
  const first = await picker.locator('option[value^="resource:"]').first().getAttribute("value");
  await picker.selectOption(first!);
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toHaveText("SDK call completed.");
  await expect(page.locator("#player .bmpui-ui-uicontainer").first()).toBeVisible();
  const before = JSON.parse(await readApi(page, "UIManager.getTimelineMarkers")) as { title: string }[];
  expect(before.length).toBeGreaterThan(0);
  await selectApi(page, "command", "UIManager.removeTimelineMarker");
  const marker = page.getByRole("combobox", { name: "SDK object", exact: true }).first();
  await marker.selectOption((await marker.locator('option[value^="resource:"]').first().getAttribute("value"))!);
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toHaveText("SDK call completed.");
  const after = JSON.parse(await readApi(page, "UIManager.getTimelineMarkers")) as typeof before;
  expect(after).toEqual(before.slice(1));
});

test("a marker selection remains valid when its collection exceeds the resource pool limit", async ({ page }) => {
  let id = "PlayerConfig.style.uiManagerFactory";
  await selectApi(page, "configuration", id); await branch(page, id, "function");
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill(
    'config.metadata = { markers: Array.from({ length: 65 }, (_, index) => ({ time: index, title: "item-" + index })) }; return lab.ui.UIFactory.buildUI(playerAPI, config);');
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await apply(page);
  id = "PlayerConfig.ui";
  await selectApi(page, "configuration", id);
  await page.getByRole("textbox", { name: "Data without an SDK type restriction" }).fill("{}");
  await apply(page);
  await expect(page.locator("#player .bmpui-ui-uicontainer:visible").first()).toBeVisible();
  await expect.poll(async () => (await page.locator(".api-event-log").textContent())!.includes("Callback invoked")).toBe(true);
  const before = JSON.parse(await readApi(page, "UIManager.getTimelineMarkers"));
  expect(before[0].title).toBe("item-0");
  await selectApi(page, "command", "UIManager.removeTimelineMarker");
  const picker = page.getByRole("combobox", { name: "SDK object", exact: true });
  await expect(picker.locator("option")).toHaveCount(65);
  await picker.selectOption((await picker.locator("option").first().getAttribute("value"))!);
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toHaveText("SDK call completed.");
  const after = JSON.parse(await readApi(page, "UIManager.getTimelineMarkers"));
  expect(after[0].title).toBe("item-1");
});

test("runtime arguments change volume, state reads expose it, and event subscriptions record playback", async ({ page }) => {
  await selectApi(page, "command", "PlayerAPI.setVolume");
  await page.locator(".api-explorer-form fieldset input[type=text]").first().fill("37");
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  expect(await readApi(page, "PlayerAPI.getVolume")).toBe("37");
  await expect.poll(() => page.locator("#player video").evaluate((video: HTMLVideoElement) => !video.paused && video.readyState >= 3)).toBe(true);
  await selectApi(page, "command", "PlayerAPI.pause");
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect.poll(async () => (await page.locator(".api-event-log").textContent())!.includes("PlayerEvent.Paused")).toBe(true);
});

test("destroy and recreate use the application's owner lifecycle", async ({ page }) => {
  await selectApi(page, "command", "PlayerAPI.destroy");
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect(page.locator("#player video")).toHaveCount(0);
  await page.getByRole("button", { name: "Recreate Player", exact: true }).click();
  await expect(page.locator("#player video")).toHaveCount(1);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});
