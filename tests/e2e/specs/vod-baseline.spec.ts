import { expect, test } from "@playwright/test";
import { PUBLIC_VOD_DASH, PUBLIC_VOD_HLS } from "../src/streams";

test.describe("VOD baseline (public reference streams)", () => {
  test("HLS loads with a finite duration and is not live", async ({ page }) => {
    await page.goto("/");
    const res = await page.evaluate((url) => window.harness.load({ hls: url, title: "vod-baseline" }), PUBLIC_VOD_HLS);
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    const snap = await page.evaluate(() => window.harness.snapshot());
    expect(snap.isLive).toBe(false);
    expect(Number.isFinite(snap.duration)).toBe(true);
    expect(snap.duration).toBeGreaterThan(0);
    expect(snap.maxTimeShift).toBe(0); // VOD has no timeshift window
  });

  test("DASH loads with a finite duration", async ({ page }) => {
    await page.goto("/");
    const res = await page.evaluate((url) => window.harness.load({ dash: url, title: "vod-baseline" }), PUBLIC_VOD_DASH);
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    const snap = await page.evaluate(() => window.harness.snapshot());
    expect(snap.isLive).toBe(false);
    expect(Number.isFinite(snap.duration)).toBe(true);
    expect(snap.duration).toBeGreaterThan(0);
  });

  test("seek lands near the requested time (VOD Seek/Seeked)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((url) => window.harness.load({ hls: url, title: "vod-baseline" }), PUBLIC_VOD_HLS);

    const currentTime = await page.evaluate(async () => {
      const seeked = window.harness.waitFor("Seeked");
      window.player!.seek(30);
      await seeked;
      return window.player!.getCurrentTime();
    });
    expect(currentTime).toBeGreaterThan(25);
    expect(currentTime).toBeLessThan(40);
  });
});
