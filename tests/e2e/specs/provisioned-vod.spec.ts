import { expect, test } from "@playwright/test";
import type { TimeMode } from "bitmovin-player";
import { PROVISIONED, requireProvisionedStreams } from "../src/streams";

// Both the existing cloud templates and the opt-in local generator expose the
// same fixture paths. Playback assertions do not depend on the hosting provider.
test.describe("Configured VOD baseline (encoding/test-streams)", () => {
  test.beforeAll(() => requireProvisionedStreams());

  test("loads the provisioned HLS: finite duration, not live, ABR ladder", async ({ page }) => {
    await page.goto("/");
    const res = await page.evaluate(
      (url) => window.harness.load({ hls: url, title: "vod-baseline" }),
      PROVISIONED.vodBaselineHls,
    );
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    const snap = await page.evaluate(() => window.harness.snapshot());
    expect(snap.isLive).toBe(false);
    expect(Number.isFinite(snap.duration)).toBe(true);
    expect(snap.duration).toBeGreaterThan(5); // ~10s sample
    expect(snap.maxTimeShift).toBe(0); // VOD: no timeshift window
    expect(await page.evaluate(() => window.player!.getAvailableVideoQualities().length)).toBeGreaterThanOrEqual(2);
  });

  test("loads DASH and advances through the same finite clip", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(
      (dash) => window.harness.load({ dash, title: "vod-baseline-dash" }),
      PROVISIONED.vodBaselineDash,
    );
    expect(result.loaded, result.error ?? "DASH load failed").toBe(true);
    const initial = await page.evaluate(() => window.player!.getCurrentTime("relativetime" as TimeMode));
    await expect.poll(() => page.evaluate(() => window.player!.getCurrentTime("relativetime" as TimeMode))).toBeGreaterThan(initial + 0.5);
    const state = await page.evaluate(() => window.harness.snapshot());
    expect(state.isLive).toBe(false);
    expect(state.duration).toBeGreaterThan(5);
    expect(Number.isFinite(state.duration)).toBe(true);
    expect(state.maxTimeShift).toBe(0);
  });

  test("seek lands within the clip", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((url) => window.harness.load({ hls: url, title: "vod-baseline" }), PROVISIONED.vodBaselineHls);

    const { fired, currentTime } = await page.evaluate(async () => {
      const seeked = window.harness.waitFor("Seeked");
      window.player!.seek(4);
      const fired = await seeked;
      return { fired, currentTime: window.player!.getCurrentTime("relativetime" as TimeMode) };
    });
    expect(fired, "the requested seek must complete").toBe(true);
    expect(currentTime).toBeGreaterThan(2);
    expect(currentTime).toBeLessThan(6);
  });
});
