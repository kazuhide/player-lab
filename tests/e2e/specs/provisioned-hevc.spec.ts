import { expect, test } from "@playwright/test";
import { PROVISIONED } from "../src/streams";

// Multi-codec: the H.265 stream provisioned via encoding/test-streams (vod-hevc).
// Asserts the player accepts the HEVC manifest and reports an hvc1/hev1 codec.
// (Playback/decoding is platform-dependent; this verifies provisioning + acceptance.)
test.describe("Provisioned HEVC VOD (multi-codec)", () => {
  test("player loads the H.265 stream and reports an hvc1 codec", async ({ page }) => {
    await page.goto("/");
    const res = await page.evaluate((url) => window.harness.load({ hls: url, title: "hevc" }), PROVISIONED.vodHevcHls);
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    const snap = await page.evaluate(() => window.harness.snapshot());
    expect(snap.isLive).toBe(false);
    expect(snap.duration).toBeGreaterThan(0);

    const codecs = await page.evaluate(() => window.player!.getAvailableVideoQualities().map((q) => q.codec ?? ""));
    expect(codecs.some((c) => /hvc1|hev1/i.test(c)), `codecs=${JSON.stringify(codecs)}`).toBe(true);
  });
});
