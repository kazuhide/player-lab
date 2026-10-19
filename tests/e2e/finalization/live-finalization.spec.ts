import { expect, test, type Page } from "@playwright/test";
import type { TimeMode } from "bitmovin-player";
import { startFinalizationServer } from "../src/finalization-server";

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

for (const format of ["hls", "dash"] as const) {
  test(`${format.toUpperCase()} event finalizes in the existing app without reloading the source`, async ({ page }) => {
    await capturePlayer(page);
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: "English", exact: true }).click();
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

    // Rebuild through the real setting twice; the active source must remain live.
    const dvr = page.getByRole("checkbox", { name: /^Allow DVR \(timeShift\)/ });
    await expect(dvr).toBeVisible();
    await dvr.uncheck();
    await expect(state).toContainText(/mode:\s*live-no-dvr/);
    await dvr.check();
    await expect(state).toContainText(/mode:\s*live-dvr/);
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
      player.timeShift(-10);
      return player.getSource();
    });
    await expect.poll(() => page.evaluate(() => window.player?.getTimeShift())).toBeLessThan(-5);

    media.finalize();
    await expect.poll(() => media.counts().finalManifests).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const duration = window.player!.getDuration();
      return Number.isFinite(duration) && duration > 59 && duration < 61;
    }), { timeout: 30_000 }).toBe(true);
    await expect(state).toContainText(/mode:\s*vod/);
    await expect(state).toContainText(/dvrAvailable:\s*false/);
    await expect(page.locator('#player [class*="livebutton"]')).toBeHidden();
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
    console.log(`${format}: real media, live/DVR recreation, manifest finalization, finite duration and VOD seek verified`);
    await page.evaluate(() => window.player!.pause());
  });
}
