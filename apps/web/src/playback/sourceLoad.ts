import type { PlayerSnapshot } from "./state";

/** A source-kind hint while load() is pending. */
export function createSourceLoadHint() {
  let expectedLive: boolean | undefined;
  let generation = 0;
  return {
    begin(isLive: boolean): number { expectedLive = isLive; return ++generation; },
    settle(token: number): void { if (token === generation) expectedLive = undefined; },
    snapshot(snap: PlayerSnapshot): PlayerSnapshot {
      const settledVod = Number.isFinite(snap.duration) && snap.duration > 0;
      if (expectedLive === false && !settledVod) return { ...snap, isLive: false, duration: 1, maxTimeShift: 0, timeShift: 0 };
      if (expectedLive === true && settledVod) return { ...snap, isLive: true, duration: Infinity };
      return snap;
    },
  };
}
