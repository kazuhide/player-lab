import { expect, test, type CDPSession, type Page, type Request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { arch, availableParallelism, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";

interface Sample {
  phase: string;
  atMs: number;
  taskMs: number;
  threadCpuMs: number;
  rendererCpuMs: number;
  scriptMs: number;
  layoutMs: number;
  jsHeapUsedMiB: number;
  jsHeapTotalMiB: number;
  documents: number;
  domNodes: number;
  domListeners: number;
  connectedElements: number;
  mediaElements: number;
  activeIntervals: number;
  livePlayers: number;
  uiRootClass: string | null;
  playersCreated: number;
  playersDestroyed: number;
  appMetricsTimer: boolean;
  appSourceLoadPending: boolean;
  requestsInFlight: number;
  requestsStarted: number;
  requestsPeak: number;
  longTasks: number;
  longTaskMs: number;
  decodedFrames: number;
  droppedFrames: number;
  videoWidth: number;
  videoHeight: number;
  processMemory: { rssMiBByType: Record<string, number>; countByType: Record<string, number>; retiredBeforeRss: number };
}

interface Probe {
  player: import("bitmovin-player").PlayerAPI | undefined;
  created: number;
  destroyed: number;
  state(): { metricsTimer: boolean; sourceLoadPending: boolean; uiRootClass: string | null };
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __performanceProbe: Probe;
    __performanceIntervals: Set<number>;
    __performanceLongTasks: { count: number; duration: number };
  }
}

function fixtureUrl(variable: string, path: string): string {
  const value = process.env[variable] ?? `http://localhost:5180/vod-baseline/${path}`;
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error(`${variable} must be a local HTTP fixture URL without credentials or query parameters`);
  }
  return value;
}

/** Instrument the response served to this test, never the committed app. The
 * disposal body is extracted from the app's existing rebuild teardown, so it
 * exercises the same UI release and SDK destroy path without a production hook. */
async function instrumentApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const intervals = new Set<number>();
    window.__performanceIntervals = intervals;
    const set = window.setInterval.bind(window);
    const clearInterval = window.clearInterval.bind(window);
    const clearTimeout = window.clearTimeout.bind(window);
    window.setInterval = ((...args: Parameters<typeof set>) => {
      const id = set(...args);
      intervals.add(id);
      return id;
    }) as typeof window.setInterval;
    // The browser permits either clear function for an interval handle.
    window.clearInterval = ((id?: number) => { intervals.delete(id ?? -1); clearInterval(id); }) as typeof window.clearInterval;
    window.clearTimeout = ((id?: number) => { intervals.delete(id ?? -1); clearTimeout(id); }) as typeof window.clearTimeout;
    window.__performanceLongTasks = { count: 0, duration: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__performanceLongTasks.count += 1;
        window.__performanceLongTasks.duration += entry.duration;
      }
    }).observe({ type: "longtask", buffered: true });
  });
  const hls = fixtureUrl("PERF_HLS_URL", "master.m3u8");
  const dash = fixtureUrl("PERF_DASH_URL", "manifest.mpd");
  await page.route("**/src/sources.ts", async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    for (const [from, to] of [
      ["https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8", hls],
      ["https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd", dash],
    ]) {
      expect(body.split(from!), "the known baseline URL must occur exactly once").toHaveLength(2);
      body = body.replace(from!, to!);
    }
    await route.fulfill({ response, body });
  });
  await page.route("**/src/main.ts", async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    const constructor = /const instance = new Player\([^\n]+\);/g;
    expect(body.match(constructor), "one app-owned Player constructor").toHaveLength(1);
    const teardown = /async function doBuild\(\)\s*\{([\s\S]*?)\n\s+const baseConfig/;
    const disposal = teardown.exec(body)?.[1];
    expect(disposal, "the existing rebuild teardown must remain identifiable").toContain("await old.destroy()");
    expect(body.split("const old = player;")).toHaveLength(2);
    body = body.replace(constructor, `$&
      window.__performanceProbe.player = instance;
      window.__performanceProbe.created += 1;
      instance.on(PlayerEvent.Destroy, () => { window.__performanceProbe.destroyed += 1; });`)
      .replace("const old = player;", "const old = player;\nwindow.__performanceProbe.player = undefined;");
    // The object is installed before the asynchronous first build runs.
    body += `
      window.__performanceProbe = {
        player: undefined, created: 0, destroyed: 0,
        state: () => ({
          metricsTimer: metricsTimer !== undefined, sourceLoadPending: appSourceLoad !== undefined,
          uiRootClass: uiManager?.getUiVariants()[0]?.ui.constructor.name ?? null,
        }),
        dispose: async () => {
          await buildChain;
          window.__performanceProbe.player = undefined;
          ${disposal}
        },
      };
    `;
    await route.fulfill({ response, body });
  });
}

async function ready(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const probe = window.__performanceProbe;
    const video = document.querySelector("#player video") as HTMLVideoElement | null;
    return probe?.player?.getSource() !== undefined && !probe.state().sourceLoadPending &&
      video !== null && video.readyState >= 3 && !video.paused;
  })).toBe(true);
  await expect(page.locator("#player video")).toHaveCount(1);
  const before = await page.evaluate(() => document.querySelector<HTMLVideoElement>("#player video")!.currentTime);
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>("#player video")!.currentTime))
    .toBeGreaterThan(before + 0.1);
}

function metric(metrics: { name: string; value: number }[], name: string): number {
  const value = metrics.find((entry) => entry.name === name)?.value;
  if (value === undefined || !Number.isFinite(value)) throw new Error(`CDP metric unavailable: ${name}`);
  return value;
}

async function processMemory(session: CDPSession): Promise<Sample["processMemory"]> {
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  const ids = processInfo.map((entry) => entry.id);
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid browser process inventory");
  if (!["darwin", "linux"].includes(platform())) throw new Error("Process RSS sampling requires macOS or Linux");
  // RSS includes shared resident pages. Keep process categories separate; neither
  // subtract JS heap nor describe a GPU process's system RAM as video RAM.
  const output = execFileSync("ps", ["-o", "pid=,rss=", "-p", ids.join(",")], { encoding: "utf8", timeout: 5000 });
  const rss = new Map(output.trim().split("\n").filter(Boolean).map((line) => {
    const values = line.trim().split(/\s+/).map(Number);
    if (values.length !== 2 || values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("Invalid process RSS sample");
    return [values[0]!, values[1]!] as const;
  }));
  const result: Sample["processMemory"] = { rssMiBByType: {}, countByType: {}, retiredBeforeRss: 0 };
  for (const process of processInfo) {
    const value = rss.get(process.id);
    if (value === undefined) { result.retiredBeforeRss += 1; continue; }
    result.rssMiBByType[process.type] = (result.rssMiBByType[process.type] ?? 0) + value / 1024;
    result.countByType[process.type] = (result.countByType[process.type] ?? 0) + 1;
  }
  return result;
}

async function sample(page: Page, session: CDPSession, browserSession: CDPSession, phase: string, network: NetworkState): Promise<Sample> {
  const [{ metrics }, counters] = await Promise.all([
    session.send("Performance.getMetrics"), session.send("Memory.getDOMCounters"),
  ]);
  const state = await page.evaluate(() => {
    const probe = window.__performanceProbe;
    const video = document.querySelector<HTMLVideoElement>("#player video");
    const frames = video?.getVideoPlaybackQuality();
    return {
      atMs: performance.now(),
      connectedElements: document.querySelectorAll("*").length,
      mediaElements: document.querySelectorAll("#player video, #player audio").length,
      activeIntervals: window.__performanceIntervals.size,
      livePlayers: probe.created - probe.destroyed,
      uiRootClass: probe.state().uiRootClass,
      playersCreated: probe.created,
      playersDestroyed: probe.destroyed,
      appMetricsTimer: probe.state().metricsTimer,
      appSourceLoadPending: probe.state().sourceLoadPending,
      longTasks: window.__performanceLongTasks.count,
      longTaskMs: window.__performanceLongTasks.duration,
      decodedFrames: frames?.totalVideoFrames ?? 0,
      droppedFrames: frames?.droppedVideoFrames ?? 0,
      videoWidth: video?.videoWidth ?? 0,
      videoHeight: video?.videoHeight ?? 0,
    };
  });
  return {
    phase, ...state,
    taskMs: metric(metrics, "TaskDuration") * 1000,
    threadCpuMs: metric(metrics, "ThreadTime") * 1000,
    rendererCpuMs: metric(metrics, "ProcessTime") * 1000,
    scriptMs: metric(metrics, "ScriptDuration") * 1000,
    layoutMs: metric(metrics, "LayoutDuration") * 1000,
    jsHeapUsedMiB: metric(metrics, "JSHeapUsedSize") / 2 ** 20,
    jsHeapTotalMiB: metric(metrics, "JSHeapTotalSize") / 2 ** 20,
    documents: counters.documents,
    domNodes: counters.nodes,
    domListeners: counters.jsEventListeners,
    requestsInFlight: network.pending.size,
    requestsStarted: network.started,
    requestsPeak: network.peak,
    processMemory: await processMemory(browserSession),
  };
}

interface NetworkState { pending: Set<Request>; started: number; peak: number }

function observeNetwork(page: Page): NetworkState {
  const state: NetworkState = { pending: new Set(), started: 0, peak: 0 };
  page.on("request", (request) => {
    state.pending.add(request);
    state.started += 1;
    state.peak = Math.max(state.peak, state.pending.size);
  });
  page.on("requestfinished", (request) => state.pending.delete(request));
  page.on("requestfailed", (request) => state.pending.delete(request));
  return state;
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

test("measure the real app's playback, theme, settings, source and destroy lifecycle", async ({ browser }, testInfo) => {
  const measuredRuns = Number(process.env.PERF_RUNS ?? 3);
  if (!Number.isInteger(measuredRuns) || measuredRuns < 1 || measuredRuns > 10) {
    throw new Error("PERF_RUNS must be an integer between 1 and 10");
  }
  const measuredInputs = ["apps/web", "packages/ui-shared", "patches", "pnpm-lock.yaml", "tests/e2e/performance/lifecycle.spec.ts"];
  const assertCommittedInputs = () => {
    const changes = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal", "--", ...measuredInputs], { encoding: "utf8" }).trim();
    if (changes) throw new Error("Commit measured application, dependency and harness inputs before recording a performance result");
  };
  assertCommittedInputs();
  const measuredRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const runs: Sample[][] = [];
  const collectionDiagnostics: Sample[] = [];
  const servedUiHashes = new Set<string>();
  const servedDependencyHashes = new Set<string>();
  const diagnosticCollection = process.env.PERF_DIAGNOSTIC_GC === "1";
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error("The performance config must provide baseURL");
  const browserSession = await browser.newBrowserCDPSession();
  for (let run = 0; run <= measuredRuns; run += 1) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      let pageErrors = 0;
      let consoleErrors = 0;
      page.on("pageerror", () => { pageErrors += 1; });
      page.on("console", (message) => { if (message.type() === "error") consoleErrors += 1; });
      await instrumentApp(page);
      const session = await context.newCDPSession(page);
      const network = observeNetwork(page);
      await session.send("Performance.enable", { timeDomain: "timeTicks" });
      const sharedUiResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/packages/ui-shared/dist/index.js"));
      const dependencyResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/bitmovin-player-ui.js"));
      await page.goto("/");
      servedUiHashes.add(createHash("sha256").update(await (await sharedUiResponse).body()).digest("hex"));
      servedDependencyHashes.add(createHash("sha256").update(await (await dependencyResponse).body()).digest("hex"));
      await ready(page);
      const duration = await page.evaluate(() => window.__performanceProbe.player!.getDuration());
      expect(duration, "use the common 60-second fixture").toBeGreaterThan(59.5);
      expect(duration, "use the common 60-second fixture").toBeLessThan(60.5);
      await page.getByRole("button", { name: "English", exact: true }).click();
      await expect(page.locator("#ui-theme-bar .theme-btn")).toHaveCount(14);
      await page.waitForTimeout(2000);
      const samples = [await sample(page, session, browserSession, "ready", network)];
      await page.waitForTimeout(3000);
      samples.push(await sample(page, session, browserSession, "playback", network));

      for (let cycle = 1; cycle <= 3; cycle += 1) {
        for (let i = 0; i < 14; i += 1) {
          await page.locator("#ui-theme-bar .theme-btn").nth(i).click();
        }
        await page.getByRole("button", { name: "Live (DVR)", exact: true }).click();
        await page.waitForTimeout(500);
        samples.push(await sample(page, session, browserSession, `themes-${cycle}`, network));
      }

      for (let cycle = 1; cycle <= 3; cycle += 1) {
        const preview = page.getByRole("checkbox", { name: /^Seek scrub-preview/ });
        await preview.uncheck();
        await preview.check();
        samples.push(await sample(page, session, browserSession, `settings-${cycle}`, network));
      }

      const field = async (label: RegExp) => {
        const row = page.locator("#config-panel .config-field").filter({ has: page.locator(".config-field-label", { hasText: label }) });
        const group = row.locator("xpath=ancestor::details[1]");
        if (!await group.evaluate((element) => (element as HTMLDetailsElement).open)) await group.locator(":scope > summary").click();
        return row.locator("input");
      };
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        const created = await page.evaluate(() => window.__performanceProbe.created);
        const title = `Performance source ${cycle}`;
        const input = await field(/^title/);
        await input.fill(title);
        await input.blur();
        await page.getByRole("button", { name: /Reload the source to apply/ }).click();
        await expect.poll(() => page.evaluate(() => window.__performanceProbe.player?.getSource()?.title)).toBe(title);
        await ready(page);
        expect(await page.evaluate(() => window.__performanceProbe.created)).toBe(created);
        samples.push(await sample(page, session, browserSession, `source-apply-${cycle}`, network));
      }
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        const created = await page.evaluate(() => window.__performanceProbe.created);
        const duration = 8 + cycle * 2;
        const input = await field(/^video\.forwardduration/);
        await input.fill(String(duration));
        await input.blur();
        await page.getByRole("button", { name: /Recreate the player to apply/ }).click();
        await expect.poll(() => page.evaluate(() => window.__performanceProbe.created)).toBe(created + 1);
        await ready(page);
        expect(await page.evaluate(() => window.__performanceProbe.player?.getConfig(false).buffer?.video?.forwardduration)).toBe(duration);
        samples.push(await sample(page, session, browserSession, `player-apply-${cycle}`, network));
      }

      for (let cycle = 1; cycle <= 3; cycle += 1) {
        await page.getByRole("button", { name: "VOD DASH", exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.__performanceProbe.player?.getSource()?.dash)).toBe(fixtureUrl("PERF_DASH_URL", "manifest.mpd"));
        await ready(page);
        await page.getByRole("button", { name: "VOD HLS", exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.__performanceProbe.player?.getSource()?.hls)).toBe(fixtureUrl("PERF_HLS_URL", "master.m3u8"));
        await ready(page);
        samples.push(await sample(page, session, browserSession, `sources-${cycle}`, network));
      }

      for (let cycle = 1; cycle <= 3; cycle += 1) {
        const created = await page.evaluate(() => window.__performanceProbe.created);
        await page.getByRole("checkbox", { name: /^Allow DVR/ }).click();
        await expect.poll(() => page.evaluate(() => window.__performanceProbe.created)).toBe(created + 1);
        await ready(page);
        samples.push(await sample(page, session, browserSession, `recreate-${cycle}`, network));
      }

      await page.evaluate(() => window.__performanceProbe.dispose());
      await expect(page.locator("#player video, #player audio")).toHaveCount(0);
      await page.waitForTimeout(3000);
      samples.push(await sample(page, session, browserSession, "disposed", network));
      const end = samples[samples.length - 1]!;
      expect(end.livePlayers, "every created player must have emitted Destroy").toBe(0);
      expect(end.appMetricsTimer, "the app must stop its periodic metrics render").toBe(false);
      expect(end.appSourceLoadPending).toBe(false);
      expect(end.rendererCpuMs, "the renderer CPU counter must advance").toBeGreaterThan(samples[0]!.rendererCpuMs);
      expect(pageErrors, "uncaught exceptions invalidate the measurement").toBe(0);
      expect(consoleErrors, "console errors invalidate the measurement").toBe(0);
      for (const value of samples.slice(0, -1)) {
        expect(value.livePlayers).toBe(1);
        expect(value.mediaElements).toBe(1);
      }
      if (run > 0) runs.push(samples);
      if (diagnosticCollection && run > 0) {
        // Separate from the normal samples: explicit collection can distinguish
        // retained objects from detached objects awaiting a natural collection.
        await session.send("HeapProfiler.collectGarbage");
        collectionDiagnostics.push(await sample(page, session, browserSession, "disposed-after-explicit-gc", network));
      }
      console.log(`Lifecycle ${run === 0 ? "warm-up (excluded)" : `sample ${run}/${measuredRuns}`}: ${samples.length} phases, ${end.playersCreated} players created and destroyed.`);
    } finally {
      await context.close();
    }
  }

  const phases = runs[0]!.map((sample, index) => {
    const entries = runs.map((run) => run[index]!);
    const startEntries = runs.map((run) => run[0]!);
    const taskDeltas = entries.map((entry, i) => entry.taskMs - startEntries[i]!.taskMs);
    const threadDeltas = entries.map((entry, i) => entry.threadCpuMs - startEntries[i]!.threadCpuMs);
    const rendererDeltas = entries.map((entry, i) => entry.rendererCpuMs - startEntries[i]!.rendererCpuMs);
    const heaps = entries.map((entry) => entry.jsHeapUsedMiB);
    return {
      phase: sample.phase,
      elapsedMsMedian: median(entries.map((entry, i) => entry.atMs - startEntries[i]!.atMs)),
      taskMsMedian: median(taskDeltas),
      taskMsMin: Math.min(...taskDeltas),
      taskMsMax: Math.max(...taskDeltas),
      threadCpuMsMedian: median(threadDeltas), threadCpuMsMin: Math.min(...threadDeltas), threadCpuMsMax: Math.max(...threadDeltas),
      rendererCpuMsMedian: median(rendererDeltas), rendererCpuMsMin: Math.min(...rendererDeltas), rendererCpuMsMax: Math.max(...rendererDeltas),
      jsHeapUsedMiBMedian: median(heaps), jsHeapUsedMiBMin: Math.min(...heaps), jsHeapUsedMiBMax: Math.max(...heaps),
      domNodesMedian: median(entries.map((entry) => entry.domNodes)),
      domListenersMedian: median(entries.map((entry) => entry.domListeners)),
      activeIntervalsMedian: median(entries.map((entry) => entry.activeIntervals)),
      requestsInFlightMax: Math.max(...entries.map((entry) => entry.requestsInFlight)),
    };
  });
  const root = resolve(testInfo.project.testDir, "../../..");
  const playerVersion = JSON.parse(readFileSync(resolve(root, "apps/web/package.json"), "utf8")).dependencies["bitmovin-player"];
  const uiVersion = JSON.parse(readFileSync(resolve(root, "packages/ui-shared/package.json"), "utf8")).dependencies["bitmovin-player-ui"];
  const uiPatch = resolve(root, `patches/bitmovin-player-ui@${uiVersion}.patch`);
  assertCommittedInputs();
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), "the measured source revision must stay fixed").toBe(measuredRevision);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      revision: measuredRevision,
      playerVersion, uiVersion,
      trackedMeasuredInputsClean: true,
      sharedUiBundleSha256: createHash("sha256").update(readFileSync(resolve(root, "packages/ui-shared/dist/bitmovinplayer-ui.js"))).digest("hex"),
      harnessSha256: createHash("sha256").update(readFileSync(resolve(testInfo.project.testDir, "lifecycle.spec.ts"))).digest("hex"),
      sharedUiSha256: createHash("sha256").update(readFileSync(resolve(testInfo.project.testDir, "../../../packages/ui-shared/src/liveUi.ts"))).digest("hex"),
      playerAppSha256: createHash("sha256").update(readFileSync(resolve(testInfo.project.testDir, "../../../apps/web/src/main.ts"))).digest("hex"),
      servedSharedUiSha256: [...servedUiHashes],
      servedUiDependencySha256: [...servedDependencyHashes],
      uiPatchSha256: existsSync(uiPatch) ? createHash("sha256").update(readFileSync(uiPatch)).digest("hex") : null,
    },
    environment: {
      browser: browser.version(), node: process.version, platform: platform(), release: release(), arch: arch(),
      cpuModel: cpus()[0]?.model ?? "unavailable", logicalCpus: cpus().length,
      availableParallelism: availableParallelism(), memoryGiB: totalmem() / 2 ** 30,
    },
    conditions: {
      app: "Vite development server", viewport: "1440x900", headless: true,
      warmupRunsExcluded: 1, measuredRuns, workers: 1, retries: 0,
      media: "Local 60-second H.264/AAC Big Buck Bunny HLS/DASH fixture with 2-second video segments",
      forcedGarbageCollectionDuringSamples: false,
      explicitCollectionAfterSamples: diagnosticCollection,
      cpuThrottling: false, networkThrottling: false,
      note: "Run on an otherwise idle machine. Renderer CPU excludes other browser processes. RSS is sampled by browser process type and includes shared pages, code, JavaScript and native allocations; it is not a private-allocation total. GPU-process RSS is system RAM, not VRAM. JavaScript heap excludes native media buffers and GPU memory.",
    },
    phases, runs, collectionDiagnostics,
  };
  const output = testInfo.outputPath("lifecycle-performance.json");
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("lifecycle-performance", { path: output, contentType: "application/json" });
  console.log(JSON.stringify({ measuredRuns, phases }, null, 2));
  await browserSession.detach();
});
