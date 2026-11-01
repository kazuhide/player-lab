import type { Page, Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { SDK_VERSIONS, type EngineId } from "../../../apps/web/src/startup/contract";
import type { createComparisonExport } from "../../../apps/web/src/startup/export";
import { expect, test } from "../src/browser-test";

type ExportedComparison = ReturnType<typeof createComparisonExport>;
type ExportedTrial = ExportedComparison["trials"][number];
type Language = "en" | "ja";
const engines: readonly EngineId[] = ["web-x", "hls", "shaka"];
const sdkChunk = /\/assets\/(?:webx|hls|shaka)-[A-Za-z0-9_-]+\.js(?:\?.*)?$/;
const labels = {
  en: { title: "Startup comparison", player: "Player", imports: "SDK import", repeats: "Trials per player",
    settings: "Settings", candidates: "Configuration candidates", compare: "Compare this video",
    calibrate: "Evaluate candidates and compare", stop: "Stop", save: "Save JSON", clear: "Clear results",
    current: "Current comparison", metric: "Summary metric", guide: "Implementation guide" },
  ja: { title: "起動性能の比較", player: "プレイヤー", imports: "SDKの読み込み", repeats: "各プレイヤーの繰り返し",
    settings: "設定", candidates: "設定候補", compare: "この動画で比較",
    calibrate: "設定候補を評価して比較", stop: "中止", save: "JSONを保存", clear: "結果を消去",
    current: "現在の比較", metric: "集計する指標", guide: "実装ガイド" },
} as const;
const marks = ["sdkImportStart", "sdkImportEnd", "constructorStart", "constructorEnd", "attachStart", "attachComplete",
  "loadStart", "loadComplete", "playRequest", "playResolved", "sdkReady", "sdkPlaying", "loadedData", "nativePlaying",
  "firstFrame", "firstMovingFrame", "advanced"];
const intervals = ["sdkImportMs", "constructorMs", "attachMs", "loadMs", "playPromiseMs", "selectionToPlayRequestMs",
  "selectionToSdkReadyMs", "selectionToSdkPlayingMs", "selectionToLoadedDataMs", "selectionToNativePlayingMs",
  "selectionToFirstFrameMs", "selectionToFirstMovingFrameMs", "selectionToAdvancedMs", "playRequestToNativePlayingMs",
  "playRequestToFirstFrameMs", "playRequestToFirstMovingFrameMs", "playRequestToAdvancedMs"];

async function openComparison(page: Page, language: Language = "en"): Promise<void> {
  const response = await page.goto("comparison.html");
  expect(response?.status()).toBe(200);
  expect(await response!.text()).not.toContain("@vite/client");
  await page.getByRole("button", { name: language === "en" ? "English" : "日本語", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await expect(page.getByRole("heading", { name: labels[language].title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: labels[language].compare, exact: true }).first()).toBeEnabled();
}

function exactKeys(value: object, keys: readonly string[]): void {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function nullableNumber(value: unknown, signed = false): void {
  if (value === null) return;
  expect(typeof value).toBe("number");
  expect(Number.isFinite(value)).toBe(true);
  if (!signed) expect(value as number).toBeGreaterThanOrEqual(0);
}

/** Check the downloaded public boundary, rather than serializing internal SDK state in the test. */
function expectSafeExport(value: ExportedComparison): void {
  exactKeys(value, ["schemaVersion", "clock", "trials"]);
  expect(value.schemaVersion).toBe(1);
  expect(value.clock).toBe("selection-relative-ms");
  expect(Array.isArray(value.trials)).toBe(true);
  expect(value.trials.length).toBeGreaterThan(0);
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/https?:|blob:|data:|license|authorization|password|token|metadata|stack|headers|sourceUrl/i);
  for (const trial of value.trials) {
    exactKeys(trial, ["run", "seed", "phase", "measurement", "statistics"]);
    expect(Number.isSafeInteger(trial.run)).toBe(true);
    expect(trial.run).toBeGreaterThan(0);
    expect(Number.isInteger(trial.seed)).toBe(true);
    expect(trial.seed).toBeGreaterThanOrEqual(0);
    expect(trial.seed).toBeLessThanOrEqual(0xffffffff);
    expect(["comparison", "screening", "confirmation"]).toContain(trial.phase);
    const measurement = trial.measurement;
    exactKeys(measurement, ["schemaVersion", "context", "status", "failureCode", "offsetsMs", "intervalsMs"]);
    expect(measurement.schemaVersion).toBe(1);
    exactKeys(measurement.context, ["engine", "version", "contentId", "sdkMode", "profile", "httpCache", "tuning"]);
    expect(engines).toContain(measurement.context.engine);
    expect(measurement.context.version).toBe(SDK_VERSIONS[measurement.context.engine]);
    expect(["bbb-360p", "bbb-180p"]).toContain(measurement.context.contentId);
    expect(["on-demand", "preloaded"]).toContain(measurement.context.sdkMode);
    expect(["default", "startup"]).toContain(measurement.context.profile);
    expect(measurement.context.httpCache).toBe("browser-managed");
    for (const [key, setting] of Object.entries(measurement.context.tuning)) {
      expect(["hlsWorker", "shakaPrefetchLimit", "webXLoadControl"]).toContain(key);
      if (key === "hlsWorker") expect(typeof setting).toBe("boolean");
      else expect([0, 1, 2]).toContain(setting);
    }
    expect(["success", "failure", "cancelled"]).toContain(measurement.status);
    if (measurement.status === "success") expect(measurement.failureCode).toBeNull();
    else expect(["unsupported", "initialization-failed", "configuration-rejected", "load-failed", "play-rejected",
      "sdk-error", "media-error", "aborted", "deadline", "cleanup-failed", "invalid-playback"]).toContain(measurement.failureCode);
    exactKeys(measurement.offsetsMs, marks);
    for (const [mark, offset] of Object.entries(measurement.offsetsMs)) {
      nullableNumber(offset, measurement.context.sdkMode === "preloaded" && ["sdkImportStart", "sdkImportEnd"].includes(mark));
    }
    exactKeys(measurement.intervalsMs, intervals);
    for (const interval of Object.values(measurement.intervalsMs)) {
      exactKeys(interval, ["valueMs", "reason"]);
      nullableNumber(interval.valueMs);
      if (interval.valueMs === null) expect(["missing-start", "missing-end", "missing-both", "end-before-start"]).toContain(interval.reason);
      else expect(interval.reason).toBeNull();
    }
    const statistics = trial.statistics;
    exactKeys(statistics, ["sdkCode", "video", "resources", "longTasks", "javascriptHeapDeltaBytes", "cleanupMs", "providerSample"]);
    nullableNumber(statistics.sdkCode);
    nullableNumber(statistics.javascriptHeapDeltaBytes, true);
    nullableNumber(statistics.cleanupMs);
    for (const [group, keys] of [[statistics.video, ["width", "height", "advancedSeconds", "droppedFrames", "totalFrames"]],
      [statistics.resources, ["count", "observedTransferBytes", "zeroTransferSizeCount"]],
      [statistics.longTasks, ["count", "durationMs"]]] as const) {
      if (group !== null) { exactKeys(group, keys); Object.values(group).forEach((number) => nullableNumber(number)); }
    }
    if (statistics.providerSample !== null) {
      const sample = statistics.providerSample;
      exactKeys(sample, ["mediaEngine", "workerActive", "loadLatencySeconds", "timeToFirstFrameSeconds", "bandwidthEstimateBps"]);
      expect(["media-source", "managed-media-source", "media-source-family", "native", "unknown"]).toContain(sample.mediaEngine);
      expect([null, true, false]).toContain(sample.workerActive);
      nullableNumber(sample.loadLatencySeconds); nullableNumber(sample.timeToFirstFrameSeconds); nullableNumber(sample.bandwidthEstimateBps);
    }
  }
}

async function downloadResults(page: Page, language: Language = "en"): Promise<ExportedComparison> {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: labels[language].save, exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("player-lab-startup-results.json");
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, "utf8")) as ExportedComparison;
  expectSafeExport(exported);
  return exported;
}

function expectPlayback(trial: ExportedTrial): void {
  expect(trial.measurement.status, `${trial.measurement.context.engine}: ${trial.measurement.failureCode}`).toBe("success");
  expect(trial.measurement.failureCode).toBeNull();
  for (const mark of ["nativePlaying", "firstFrame", "firstMovingFrame", "advanced"] as const) {
    expect(trial.measurement.offsetsMs[mark], mark).toBeGreaterThan(0);
  }
  expect(trial.statistics.video).toMatchObject({ width: 320, height: 180 });
  expect(trial.statistics.video!.advancedSeconds).toBeGreaterThanOrEqual(0.1);
  expect(trial.statistics.video!.totalFrames).toBeGreaterThan(0);
  // SDK Ready/Playing remain nullable when a provider cannot expose that milestone.
  expect(trial.measurement.intervalsMs.selectionToNativePlayingMs.reason).toBeNull();
  expect(trial.measurement.intervalsMs.selectionToFirstMovingFrameMs.reason).toBeNull();
}

function watchAccountRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "api.bitmovin.com" || /analytics-ingress[^/]*\.bitmovin\.com/i.test(url.hostname)) requests.push(url.hostname);
  });
  return requests;
}

for (const language of ["en", "ja"] as const) {
  for (const width of [320, 1440]) {
    test(`${language} comparison controls fit ${width}px and support keyboard navigation`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await openComparison(page, language);
      await expect(page.getByRole("link", { name: labels[language].guide, exact: true })).toBeVisible();
      const player = page.getByRole("combobox", { name: labels[language].player, exact: true });
      await player.focus();
      await page.keyboard.press("h");
      await expect(player).toHaveValue("hls");
      await player.selectOption("all");
      await expect(player).toHaveValue("all");
      const candidates = page.locator(".startup-candidates");
      await candidates.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(candidates).toHaveAttribute("open", "");
      await expect(page.getByRole("combobox", { name: "hls.js enableWorker", exact: true })).toBeVisible();
      const layout = await page.locator("#app").evaluate((app) => {
        const font = getComputedStyle(app).fontFamily;
        return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          controls: Array.from(app.querySelectorAll<HTMLElement>("button, select, summary")).map((element) => ({
            font: getComputedStyle(element).fontFamily, matchesAppFont: getComputedStyle(element).fontFamily === font,
            right: element.getBoundingClientRect().right, left: element.getBoundingClientRect().left,
          })), width: document.documentElement.clientWidth };
      });
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.controls.length).toBeGreaterThan(8);
      for (const control of layout.controls) {
        expect(control.matchesAppFont, control.font).toBe(true);
        expect(control.right).toBeLessThanOrEqual(layout.width + 1);
        expect(control.left).toBeGreaterThanOrEqual(0);
      }
      await testInfo.attach(`comparison-${language}-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }
}

test("nonloading Web X policies cannot be selected and preparation fetches no media", async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (/\.(?:m3u8|m4s|mp4|ts)(?:\?|$)/.test(new URL(request.url()).pathname)) mediaRequests.push(request.resourceType());
  });
  await openComparison(page);
  await page.locator(".startup-candidates summary").click();
  const policy = page.getByRole("combobox", { name: "Web X LoadControl", exact: true });
  // Inspect the option itself; a state matcher can follow its label to the enabled select.
  for (const value of ["0", "1"]) {
    const option = policy.locator(`option[value="${value}"]`);
    await expect(option).toHaveJSProperty("disabled", true);
    await expect(option).toHaveAttribute("disabled", "");
  }
  await policy.focus();
  await page.keyboard.press("d");
  await expect(policy).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Compare this video", exact: true }).first()).toBeEnabled();
  expect(mediaRequests).toEqual([]);
});

for (const mode of ["on-demand", "preloaded"] as const) {
  test(`the production ${mode} cohort plays and renders all SDKs at the selected resolution`, async ({ page }) => {
    const accountRequests = watchAccountRequests(page);
    await openComparison(page);
    await page.getByRole("combobox", { name: "Trials per player", exact: true }).selectOption("1");
    await page.getByRole("combobox", { name: "SDK import", exact: true }).selectOption(mode);
    const compare = page.getByRole("button", { name: "Compare this video", exact: true }).nth(1);
    await expect(compare).toBeEnabled();
    await compare.click();
    await expect(page.locator(".startup-trials tbody tr")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    const exported = await downloadResults(page);
    expect(exported.trials).toHaveLength(3);
    expect(exported.trials.map((trial) => trial.measurement.context.engine).sort()).toEqual([...engines].sort());
    for (const trial of exported.trials) {
      expectPlayback(trial);
      expect(trial.phase).toBe("comparison");
      expect(trial.measurement.context).toMatchObject({ contentId: "bbb-180p", sdkMode: mode, profile: "startup" });
      if (mode === "preloaded") {
        expect(trial.measurement.offsetsMs.sdkImportStart).toBeLessThan(0);
        expect(trial.measurement.offsetsMs.sdkImportEnd).toBeLessThan(0);
        expect(trial.measurement.intervalsMs.sdkImportMs.reason).toBeNull();
      } else expect(trial.measurement.offsetsMs.sdkImportStart).toBeGreaterThanOrEqual(0);
    }
    await expect(page.getByText("The cohort does not qualify for a median comparison. (insufficient-samples)", { exact: true })).toBeVisible();
    expect(accountRequests).toEqual([]);
  });
}

test("candidate evaluation exports every outcome and ranks only frozen confirmation trials", async ({ page }) => {
  const accountRequests = watchAccountRequests(page);
  await openComparison(page);
  await page.getByRole("button", { name: "Evaluate candidates and compare", exact: true }).nth(1).click();
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  for (const select of await page.locator(".startup-controls select").all()) await expect(select).toBeDisabled();
  for (const button of await page.locator("#comparison-language button, .startup-card button").all()) await expect(button).toBeDisabled();
  // This new cohort has 36 actual trials; the existing 90-second test deadline remains unchanged.
  await expect(page.locator(".startup-trials tbody tr")).toHaveCount(36, { timeout: 75_000 });
  await expect(stop).toHaveCount(0);
  const exported = await downloadResults(page);
  expect(exported.trials).toHaveLength(36);
  const screening = exported.trials.filter((trial) => trial.phase === "screening");
  const confirmation = exported.trials.filter((trial) => trial.phase === "confirmation");
  expect(screening).toHaveLength(18);
  expect(confirmation).toHaveLength(18);
  expect(exported.trials.slice(0, 18).every((trial) => trial.phase === "screening")).toBe(true);
  expect(exported.trials.slice(18).every((trial) => trial.phase === "confirmation")).toBe(true);
  expect(new Set(exported.trials.map((trial) => trial.run)).size).toBe(1);
  expect(new Set(exported.trials.map((trial) => trial.seed)).size).toBe(1);
  for (const trial of exported.trials) {
    expectPlayback(trial);
    expect(trial.measurement.context).toMatchObject({ contentId: "bbb-180p", profile: "startup", sdkMode: "on-demand" });
  }
  for (const engine of engines) {
    expect(screening.filter((trial) => trial.measurement.context.engine === engine)).toHaveLength(6);
    expect(confirmation.filter((trial) => trial.measurement.context.engine === engine)).toHaveLength(6);
  }
  const selected = JSON.parse((await page.locator(".startup-results > pre").textContent())!);
  exactKeys(selected, ["tuning", "fallbackReasons"]);
  expect(selected.fallbackReasons).toEqual({});
  for (const trial of confirmation) expect(trial.measurement.context.tuning).toEqual(selected.tuning);
  expect(new Set(screening.filter((trial) => trial.measurement.context.engine === "hls").map((trial) => trial.measurement.context.tuning.hlsWorker))).toEqual(new Set([true, false]));
  expect(new Set(screening.filter((trial) => trial.measurement.context.engine === "shaka").map((trial) => trial.measurement.context.tuning.shakaPrefetchLimit))).toEqual(new Set([0, 1, 2]));
  expect(screening.filter((trial) => trial.measurement.context.engine === "web-x").every((trial) => trial.measurement.context.tuning.webXLoadControl === 2)).toBe(true);
  const summary = page.getByRole("table", { name: "Current comparison", exact: true });
  await expect(summary.locator("tbody tr")).toHaveCount(3);
  for (const row of await summary.locator("tbody tr").all()) {
    await expect(row.locator("td").nth(1)).toHaveText("6 / 6");
    for (const index of [4, 5, 6]) await expect(row.locator("td").nth(index)).toHaveText("0");
  }
  await expect(page.getByText(/^(?:Smallest median under these conditions:|Equal medians:)/)).toBeVisible();
  await page.getByRole("combobox", { name: "Summary metric", exact: true }).selectOption("constructorMs");
  await expect(page.getByText("These operations differ between SDKs; this metric is not ranked.", { exact: true })).toBeVisible();
  expect(accountRequests).toEqual([]);
});

test("Stop remains available during a held between-trial SDK preload and discards its frame", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let observeHeld!: () => void;
  const held = new Promise<void>((resolve) => { observeHeld = resolve; });
  let heldRoute: Route | null = null;
  let heldOnce = false;
  await page.route(sdkChunk, async (route) => {
    const request = route.request();
    const frameUrl = new URL(request.frame().url());
    if (!heldOnce && frameUrl.pathname.endsWith("/comparison-runner.html")
      && frameUrl.searchParams.get("mode") === "preloaded" && await page.locator(".startup-trials tbody tr").count() === 1) {
      heldOnce = true; heldRoute = route; observeHeld();
      await gate;
      await route.abort().catch(() => undefined);
    } else await route.continue();
  });
  try {
    await openComparison(page);
    await page.getByRole("combobox", { name: "Trials per player", exact: true }).selectOption("1");
    await page.getByRole("combobox", { name: "SDK import", exact: true }).selectOption("preloaded");
    const compare = page.getByRole("button", { name: "Compare this video", exact: true }).nth(1);
    await expect(compare).toBeEnabled(); await compare.click();
    await expect.poll(() => heldOnce).toBe(true);
    await held;
    await expect(page.locator(".startup-trials tbody tr")).toHaveCount(1);
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible();
    await expect(stop).toBeEnabled();
    await stop.click();
    await expect(stop).toHaveCount(0);
    await expect(page.locator(".startup-trials tbody tr")).toHaveCount(2);
    const exported = await downloadResults(page);
    expect(exported.trials).toHaveLength(2);
    expectPlayback(exported.trials[0]!);
    expect(exported.trials[1]!.measurement.status).toBe("cancelled");
    expect(exported.trials[1]!.measurement.failureCode).toBe("aborted");
    expect(exported.trials[1]!.measurement.offsetsMs.nativePlaying).toBeNull();
    expect(exported.trials[1]!.statistics.video).toBeNull();
    expect(heldRoute).not.toBeNull();
  } finally {
    release();
    await page.unroute(sdkChunk);
  }
});
