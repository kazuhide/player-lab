import { describe, expect, it } from "vitest";
import { createSourceLoadHint } from "../src/playback/sourceLoad";
import { deriveTimelineState, type PlayerSnapshot } from "../src/playback/state";
const live: PlayerSnapshot = { isLive: true, duration: Infinity, maxTimeShift: -300, timeShift: -30, currentTime: 80 };
const vod: PlayerSnapshot = { isLive: false, duration: 120, maxTimeShift: 0, timeShift: 0, currentTime: 4 };
const mode = (snap: PlayerSnapshot) => deriveTimelineState(snap, { timeShiftEnabled: true }).mode;

describe("source loading hint", () => {
  it("uses the selected live source during a rebuild instead of the first VOD preset", () => {
    const hint = createSourceLoadHint();
    hint.begin(true);
    expect(mode(hint.snapshot({ ...live, duration: 120 }))).toBe("live-dvr");
  });
  it("retires a live hint after loading so a finalized stream becomes VOD", () => {
    const hint = createSourceLoadHint();
    const token = hint.begin(true);
    hint.settle(token);
    expect(mode(hint.snapshot(vod))).toBe("vod");
  });
  it("retires a VOD hint before another source becomes live", () => {
    const hint = createSourceLoadHint();
    const token = hint.begin(false);
    expect(mode(hint.snapshot(live))).toBe("vod");
    hint.settle(token);
    expect(mode(hint.snapshot(live))).toBe("live-dvr");
  });
  it("does not clear the new hint when an older load rejects", () => {
    const hint = createSourceLoadHint();
    const old = hint.begin(false);
    hint.begin(true);
    hint.settle(old);
    expect(mode(hint.snapshot({ ...live, duration: 120 }))).toBe("live-dvr");
  });
});
