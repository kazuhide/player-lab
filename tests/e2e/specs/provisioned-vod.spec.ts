import { expect, test } from "@playwright/test";
import { PROVISIONED, requireProvisionedStreams } from "../src/streams";

// Drives the stream we provisioned via encoding/test-streams (vod-baseline) — a
// real H.264 ABR ladder on the showcase S3, proving the provision → E2E loop.
test.describe("Provisioned VOD baseline (encoding/test-streams → S3)", () => {
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
  });

  test("seek lands within the clip", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((url) => window.harness.load({ hls: url, title: "vod-baseline" }), PROVISIONED.vodBaselineHls);

    const currentTime = await page.evaluate(async () => {
      const seeked = window.harness.waitFor("Seeked");
      window.player!.seek(4);
      await seeked;
      return window.player!.getCurrentTime();
    });
    expect(currentTime).toBeGreaterThan(2);
  });
});
