import { expect, test } from "@playwright/test";
import { REFERENCE } from "../src/streams";

// The test that was missing: a genuinely-live stream must behave as live (not the
// finalized-VOD state a stopped encoder leaves behind), expose a DVR window, and
// support timeShift inside it. Source: a continuously-live DASH stream with a DVR
// window — DASH-IF livesim2 by default, overridable via E2E_LIVE_DASH_URL (the CI
// config points it at the BBC R&D testcard, since livesim2 rate-limits under load).
// Both have a window comfortably larger than the −60s shift below.
const LIVE_DASH = process.env.E2E_LIVE_DASH_URL ?? REFERENCE.liveDashDvr300;

test.describe("Live DVR — genuine live stream", () => {
  test("isLive + a real DVR window + timeShift inside it", async ({ page }) => {
    await page.goto("/");
    const res = await page.evaluate(
      (url) => window.harness.load({ dash: url, title: "live-dvr" }),
      LIVE_DASH,
    );
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    const { started, snap } = await page.evaluate(async () => {
      const ok = await window.harness.waitFor("TimeChanged", 30_000);
      return { started: ok, snap: window.harness.snapshot() };
    });
    expect(started, "stream never produced TimeChanged (never started?)").toBe(true);

    // Genuinely live — this is exactly what the stale finalized-VOD streams failed.
    expect(snap.isLive, "stream is not live (finalized/VOD?)").toBe(true);
    expect(
      snap.duration === Infinity || snap.duration > 1e7,
      `live duration should be ∞, got ${snap.duration}`,
    ).toBe(true);

    // DVR window present and substantial — assert a real timeshift buffer (well past
    // the −60s we shift to below) rather than a loose "any negative". livesim2 reports
    // ~300s, the BBC testcard ~900s; the bounds accommodate either. NOTE for freshly
    // started channels (E2E_LIVE_DASH_URL at the dvr-showcase encoder): the player
    // derives the window from ACCUMULATED content, not the manifest's
    // timeShiftBufferDepth — run this only after the window has filled
    // (≥ timeshift + liveEdgeOffset seconds of ingest).
    console.log(`live-dvr: maxTimeShift=${snap.maxTimeShift}s (source: ${LIVE_DASH})`);
    test.info().annotations.push({ type: "maxTimeShift", description: `${snap.maxTimeShift}s @ ${LIVE_DASH}` });
    expect(snap.maxTimeShift, `maxTimeShift should be a substantial DVR window, got ${snap.maxTimeShift}`).toBeLessThan(
      -120,
    );
    expect(snap.maxTimeShift).toBeGreaterThan(-2000);

    // timeShift to a fixed offset inside the window and confirm it actually moved,
    // then return to the live edge and confirm THAT completed too (§5.2) — the
    // return is asserted, not merely invoked. waitFor subscribes at call time, so
    // arming it before timeShift(0) cannot be satisfied by the first event.
    const shift = await page.evaluate(async () => {
      const done = window.harness.waitFor("TimeShifted", 15_000);
      window.player!.timeShift(-60); // fixed offset, safely inside the DVR window
      const fired = await done;
      const offset = window.player!.getTimeShift();
      const backDone = window.harness.waitFor("TimeShifted", 15_000);
      window.player!.timeShift(0); // return to the live edge
      const backFired = await backDone;
      const backOffset = window.player!.getTimeShift();
      return { fired, offset, backFired, backOffset };
    });
    expect(shift.fired, "TimeShifted never fired").toBe(true);
    expect(shift.offset, "timeShift did not move into the DVR window").toBeLessThan(-10);
    expect(shift.backFired, "edge-return TimeShifted never fired").toBe(true);
    expect(shift.backOffset, `edge return should land near 0, got ${shift.backOffset}`).toBeGreaterThan(-15);
  });
});
