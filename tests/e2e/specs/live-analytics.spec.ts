import { expect, test } from "@playwright/test";

// §15 end-to-end: play a live stream with the Bitmovin Analytics COLLECTOR
// enabled and prove real playback happened (the dashboard/Query API then shows
// the session — verified out-of-band, since aggregation lags ingestion).
//
// The suite normally pins analytics OFF (playwright.config.ts) so E2E runs
// don't pollute the dashboard; this spec is the deliberate exception and only
// runs when BOTH env vars are set — e.g. against the provisioned live DVR
// channel while encoding/live-dvr/start.sh has it running:
//
//   E2E_ANALYTICS_LIVE_DASH_URL=https://…/live/dvr-showcase/main.mpd \
//   E2E_ANALYTICS_LICENSE_KEY=$BITMOVIN_ANALYTICS_LICENSE_KEY \
//     pnpm exec playwright test live-analytics
//
// Deliberately NOT E2E_LIVE_DASH_URL: playwright.config.ts defaults that one
// globally (BBC testcard fallback for live-dvr), which would let this spec run
// against a public stream on the analytics key alone.
const LIVE_DASH = process.env.E2E_ANALYTICS_LIVE_DASH_URL;
const ANALYTICS_KEY = process.env.E2E_ANALYTICS_LICENSE_KEY;

test.describe("Live + Analytics collector (§15)", () => {
  test.skip(
    !LIVE_DASH || !ANALYTICS_KEY,
    "set E2E_ANALYTICS_LIVE_DASH_URL and E2E_ANALYTICS_LICENSE_KEY to run (see comment)",
  );

  test("plays the live channel and the collector actually beacons", async ({ page }) => {
    test.setTimeout(120_000); // live start + 15s dwell + retries need headroom
    await page.goto("/");

    // The analytics assertion: the collector must POST to the Bitmovin
    // analytics ingress. Armed BEFORE load so the startup beacon can't race us.
    const beacon = page.waitForRequest(/analytics-ingress[^/]*\.bitmovin\.com/i, {
      timeout: 60_000,
    });

    // The collector rides in via the per-load config override the harness
    // already supports — no env plumbing through the pinned dev server needed.
    const res = await page.evaluate(
      ({ url, key }) =>
        window.harness.load({ dash: url, title: "live-analytics" }, { analytics: { key } }),
      { url: LIVE_DASH!, key: ANALYTICS_KEY! },
    );
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    // Genuinely play: time must ADVANCE across the dwell (a first TimeChanged
    // followed by a stall must fail). Live DASH currentTime is an absolute
    // timestamp (§7) — only the delta is meaningful.
    const played = await page.evaluate(async () => {
      const ok = await window.harness.waitFor("TimeChanged", 30_000);
      if (!ok) return { ok, advanced: 0 };
      const t0 = window.player!.getCurrentTime();
      await new Promise((r) => setTimeout(r, 15_000));
      return { ok, advanced: window.player!.getCurrentTime() - t0 };
    });
    expect(played.ok, "no TimeChanged — live channel not playing").toBe(true);
    expect(played.advanced, "playback did not advance across the dwell").toBeGreaterThan(5);

    const snap = await page.evaluate(() => window.harness.snapshot());
    expect(snap.isLive, "expected the provisioned channel to be live").toBe(true);

    // Fails the test if no analytics request was ever made (timeout rejects).
    const req = await beacon;
    expect(req.url()).toContain("bitmovin");
  });
});
