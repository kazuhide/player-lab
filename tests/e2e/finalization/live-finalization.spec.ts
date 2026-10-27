import { expect, test, type Page } from "@playwright/test";
import type { TimeMode } from "bitmovin-player";
import { startFinalizationServer } from "../src/finalization-server";
import { expectMovingVideo } from "../src/playback-observation";

const APP = `http://localhost:${process.env.E2E_APP_PORT ?? 5175}`;
let media: Awaited<ReturnType<typeof startFinalizationServer>>;

test.beforeAll(async () => {
  const directory = process.env.E2E_FINALIZATION_MEDIA_DIR;
  if (!directory) throw new Error("Set E2E_FINALIZATION_MEDIA_DIR to the generated vod-baseline directory.");
  media = await startFinalizationServer(directory, Number(process.env.E2E_FINALIZATION_PORT ?? 5192));
});
test.beforeEach(() => media.reset());
test.afterAll(async () => { await media?.close(); });

async function capturePlayer(page: Page): Promise<void> {
  await page.route("**/src/main.ts", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const constructor = /const instance = new Player\([^\n]+\);/g;
    expect(body.match(constructor)).toHaveLength(1);
    await route.fulfill({ response, body: body.replace(constructor, `$&
window.player = instance;
window.finalizationSourceLoaded = false;
instance.on(instance.exports.PlayerEvent.SourceLoaded, () => { window.finalizationSourceLoaded = true; });`) });
  });
}

async function vodTimeline(page: Page) {
  return page.evaluate(() => {
    const player = window.player!;
    const events = (window as unknown as { finalizationEvents: string[] }).finalizationEvents;
    return {
      time: player.getCurrentTime("relativetime" as TimeMode),
      seekbarTime: player.getCurrentTime() - player.getSeekableRange().start,
      rangeStart: player.getSeekableRange().start,
      duration: player.getDuration(),
      seeked: events.filter(event => event === "Seeked").length,
    };
  });
}

async function expectVodSeek(page: Page, action: () => Promise<unknown>, target: number): Promise<void> {
  const arm = await vodTimeline(page);
  await action();
  await expect.poll(async () => (await vodTimeline(page)).seeked, { timeout: 10_000 }).toBeGreaterThan(arm.seeked);
  await expect.poll(async () => Math.abs((await vodTimeline(page)).time - target)).toBeLessThan(0.5);
}

async function expectBingeTimelineControls(page: Page): Promise<void> {
  await page.evaluate(() => window.player!.pause());
  await page.getByRole("button", { name: "Binge", exact: true }).click();
  const skip = page.getByRole("button", { name: "Skip the intro", exact: true });
  const next = page.getByRole("button", { name: "Play the next episode", exact: true });
  const card = page.locator("#player .bmpui-ui-nextup-card");
  await expect.soft(skip).toBeVisible();
  await expect.soft(next).toBeHidden();
  await expectVodSeek(page, () => skip.click(), 18);
  await expect(skip).toBeHidden();
  await expect(next).toBeHidden();
  await expect(card).toBeHidden();
  await expectVodSeek(page, () => page.evaluate(() => {
    const player = window.player!;
    player.seek(player.getSeekableRange().start + 55);
  }), 55);
  await expect(next).toBeVisible();
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Playing in [4-6]s/);
  await expectVodSeek(page, () => page.evaluate(() => {
    const player = window.player!;
    player.seek(player.getSeekableRange().start + 10);
  }), 10);
  await page.getByRole("button", { name: "Live (DVR)", exact: true }).click();
}

async function expectVodTimelineControls(page: Page): Promise<void> {
  await page.evaluate(() => window.player!.pause());
  await expect.poll(() => page.evaluate(() => window.player!.isPaused())).toBe(true);
  const slider = page.locator("#player .bmpui-ui-seekbar");
  await slider.hover();
  await slider.focus();
  await expect(slider).toBeFocused();
  const before = await vodTimeline(page);
  const aria = await slider.evaluate(element => ({
    now: Number(element.getAttribute("aria-valuenow")),
    min: Number(element.getAttribute("aria-valuemin")),
    max: Number(element.getAttribute("aria-valuemax")),
    text: element.getAttribute("aria-valuetext"),
  }));
  // Compare the integer readout with a rounding tolerance, rather than requiring
  // the SDK's relative-clock origin to equal the seekable origin to the fraction.
  expect.soft(Math.abs(aria.now - before.time), "accessible time must use the visible VOD timeline").toBeLessThan(1);
  expect.soft(aria).toMatchObject({ min: 0, max: before.duration });
  expect.soft(aria.now).toBeGreaterThanOrEqual(aria.min);
  expect.soft(aria.now).toBeLessThanOrEqual(aria.max);
  expect.soft(aria.text).not.toMatch(/Hours/i);

  const seek = (action: () => Promise<unknown>, target: number) => expectVodSeek(page, action, target);
  const seekByKeyboard = async (key: "ArrowRight" | "ArrowLeft", step: number) => {
    const current = await vodTimeline(page);
    // Key handlers floor the SDK's seekable-relative clock; ARIA can still show
    // the preceding seek. Convert that target to the SDK's relative time mode.
    const target = Math.floor(current.seekbarTime) + step + current.time - current.seekbarTime;
    await seek(() => slider.press(key), target);
    await expect.poll(() => slider.evaluate(element => {
      const player = window.player!;
      const seekbarTime = player.getCurrentTime() - player.getSeekableRange().start;
      return Number(element.getAttribute("aria-valuenow")) - Math.floor(seekbarTime);
    }), { message: "accessible time must catch up with the completed VOD keyboard seek" }).toBe(0);
  };
  await seekByKeyboard("ArrowRight", 1);
  await seekByKeyboard("ArrowLeft", -1);
  const afterLeft = await vodTimeline(page);
  await seek(() => page.locator('#player [data-bmpui-seek-direction="forward"]').click(), afterLeft.time + 10);
  const afterForward = await vodTimeline(page);
  await seek(() => page.locator('#player [data-bmpui-seek-direction="rewind"]').click(), afterForward.time - 10);

  await page.locator("#control-panel select").selectOption("seek");
  const beforeGesture = await vodTimeline(page);
  const box = (await page.locator("#player").boundingBox())!;
  await seek(() => page.mouse.dblclick(box.x + box.width * 0.78, box.y + box.height * 0.42), beforeGesture.time + 10);
  await seek(() => slider.press("Home"), 0);
  await page.locator("#player .bmpui-ui-playbacktogglebutton").click();
  await seek(() => slider.press("End"), before.duration);
  // Completion exposes the existing Replay UI; no source reload rebases the clock.
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.player!.isPlaying())).toBe(true);
  await expect.poll(async () => (await vodTimeline(page)).time).toBeGreaterThan(0);
  await expect.poll(async () => (await vodTimeline(page)).time).toBeLessThan(5);
  await expectMovingVideo(page);
}

for (const format of ["hls", "dash"] as const) {
  test(`${format.toUpperCase()} event finalizes in the existing app without reloading the source`, async ({ page }) => {
    await capturePlayer(page);
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.getByRole("button", { name: "Live (DVR)", exact: true }).click();
    await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
    await page.locator(".api-explorer > summary").click();
    await page.getByRole("combobox", { name: "API category", exact: true }).selectOption("command");
    await page.getByRole("searchbox", { name: "Search APIs" }).fill("PlayerAPI.seek");
    const apiPicker = page.getByRole("listbox", { name: "SDK entry", exact: true });
    await apiPicker.selectOption("PlayerAPI.seek");
    const seekArgument = page.locator('.api-explorer-form fieldset input[type="text"]').first();
    await seekArgument.fill("12");
    const runSeek = page.locator('button[data-api-run="PlayerAPI.seek"]');
    await expect(runSeek).toBeEnabled();
    const label = format === "hls" ? "Live HLS" : "Live DASH + DVR";
    await page.getByRole("button", { name: label, exact: true }).click();
    const state = page.locator(".panel-readout");
    await expect(state).toContainText(/mode:\s*live-dvr/);
    await expect.poll(() => page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>("#player video");
      return !!video && !video.paused && video.readyState >= 3 && video.currentTime > 0;
    })).toBe(true);
    expect(media.counts().liveManifests).toBeGreaterThan(0);
    expect(media.counts().mediaRequests).toBeGreaterThan(0);
    await expect(apiPicker).toHaveValue("PlayerAPI.seek");
    await expect(seekArgument).toHaveValue("12");
    await expect(runSeek).toBeDisabled();
    await expect(runSeek).toHaveAttribute("data-api-unavailable", "vod-only");
    await expect(page.locator('p[data-api-reason="PlayerAPI.seek"]')).toHaveText("Available for on-demand sources.");

    // Rebuild through the real setting twice; the active source must remain live.
    const dvr = page.getByRole("checkbox", { name: /^Allow DVR \(timeShift\)/ });
    await expect(dvr).toBeVisible();
    await dvr.uncheck();
    await expect(state).toContainText(/mode:\s*live-no-dvr/);
    await expect(page.locator("#player .bmpui-ui-seekbar")).toBeHidden();
    await expect(page.getByRole("button", { name: "-10s", exact: true })).toBeDisabled();
    await dvr.check();
    await expect(state).toContainText(/mode:\s*live-dvr/);
    await expect(page.locator("#player .bmpui-ui-seekbar")).toBeVisible();
    await expect(page.getByRole("button", { name: "-10s", exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { finalizationSourceLoaded: boolean }).finalizationSourceLoaded)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.player?.getDuration())).toBe(Infinity);
    const before = await page.evaluate(() => {
      const player = window.player!;
      (window as unknown as { finalizingPlayer: unknown }).finalizingPlayer = player;
      const events: string[] = [];
      (window as unknown as { finalizationEvents: string[] }).finalizationEvents = events;
      player.on(player.exports.PlayerEvent.SourceLoaded, () => events.push("SourceLoaded"));
      player.on(player.exports.PlayerEvent.DurationChanged, () => events.push("DurationChanged"));
      player.on(player.exports.PlayerEvent.Seeked, () => events.push("Seeked"));
      player.on(player.exports.PlayerEvent.TimeShifted, () => events.push("TimeShifted"));
      return player.getSource();
    });
    await page.getByRole("button", { name: "-10s", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getTimeShift())).toBeLessThan(-5);
    const liveSlider = page.locator("#player .bmpui-ui-seekbar");
    const shifted = await page.evaluate(() => (window as unknown as { finalizationEvents: string[] }).finalizationEvents
      .filter(event => event === "TimeShifted").length);
    await liveSlider.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => (window as unknown as { finalizationEvents: string[] }).finalizationEvents
      .filter(event => event === "TimeShifted").length)).toBeGreaterThan(shifted);
    await expect.poll(() => page.evaluate(() => window.player!.getTimeShift())).toBeLessThan(-5);
    await expect.poll(async () => Number(await liveSlider.getAttribute("aria-valuenow"))).toBeLessThan(0);

    media.finalize();
    await expect.poll(() => media.counts().finalManifests).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const duration = window.player!.getDuration();
      return Number.isFinite(duration) && duration > 59 && duration < 61;
    }), { timeout: 30_000 }).toBe(true);
    await expect(state).toContainText(/mode:\s*vod/);
    await expect(state).toContainText(/dvrAvailable:\s*false/);
    await expect(page.locator('#player [class*="livebutton"]')).toBeHidden();
    await expect(apiPicker).toHaveValue("PlayerAPI.seek");
    await expect(seekArgument).toHaveValue("12");
    // Finalization retains the source's timeline origin. The original draft is
    // kept; a value in the current seekable range is now a valid VOD operation.
    const validSeek = await page.evaluate(() => window.player!.getSeekableRange().start + 12);
    await seekArgument.fill(String(validSeek));
    await expect(runSeek).toBeEnabled();
    const after = await page.evaluate(() => {
      const globals = window as unknown as { finalizingPlayer: unknown; finalizationEvents: string[] };
      return {
        samePlayer: window.player === globals.finalizingPlayer,
        source: window.player?.getSource(),
        events: globals.finalizationEvents,
      };
    });
    expect(after.samePlayer).toBe(true);
    expect(after.source).toEqual(before);
    expect(after.events).toContain("DurationChanged");
    expect(after.events).not.toContain("SourceLoaded");
    const seek = await page.evaluate(async () => {
      const player = window.player!;
      const event = player.exports.PlayerEvent.Seeked;
      const completion = new Promise<boolean>((resolve) => {
        const finish = (fired: boolean) => {
          clearTimeout(timer);
          player.off(event, onSeeked);
          resolve(fired);
        };
        const onSeeked = () => finish(true);
        const timer = setTimeout(() => finish(false), 10_000);
        player.on(event, onSeeked);
      });
      // Finalizing an event does not rebase its wall-clock media timeline.
      const accepted = player.seek(player.getSeekableRange().start + 10);
      const fired = await completion;
      // An event with wall-clock timing retains an absolute default time after
      // it ends. Read one completed seek on the relative VOD timeline.
      return { accepted, fired, position: player.getCurrentTime("relativetime" as TimeMode) };
    });
    expect(seek.accepted).toBe(true);
    expect(seek.fired, "the VOD seek must complete").toBe(true);
    expect(Number.isFinite(seek.position)).toBe(true);
    expect(seek.position).toBeGreaterThan(8);
    expect(seek.position).toBeLessThan(16);
    const finite = await vodTimeline(page);
    if (format === "dash") expect(finite.rangeStart).toBeGreaterThan(1_000_000);
    await expectBingeTimelineControls(page);
    await expectVodTimelineControls(page);
    const retained = await page.evaluate(() => ({
      samePlayer: window.player === (window as unknown as { finalizingPlayer: unknown }).finalizingPlayer,
      source: window.player!.getSource(),
      sourceReloaded: (window as unknown as { finalizationEvents: string[] }).finalizationEvents.includes("SourceLoaded"),
    }));
    expect(retained).toEqual({ samePlayer: true, source: before, sourceReloaded: false });
    console.log(`${format}: real media, live/DVR recreation, manifest finalization, finite duration and VOD seek verified`);
    await page.evaluate(() => window.player!.pause());
  });
}
