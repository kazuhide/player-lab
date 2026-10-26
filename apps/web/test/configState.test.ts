import { describe, expect, it } from "vitest";
import { applyErrorMessage, deepMerge, settleApply } from "../src/configState";

describe("configuration overrides", () => {
  it("removes a cleared override without losing sibling values", () => {
    const applied = { playback: { audioLanguage: "en", autoplay: false }, tweaks: { max_retries: 4 } };
    const reset = deepMerge(applied, { playback: { audioLanguage: undefined } });
    expect(reset).toEqual({ playback: { autoplay: false }, tweaks: { max_retries: 4 } });
    expect(applied.playback.audioLanguage).toBe("en");
  });

  it("removes desktop and mobile adaptation overrides when default is selected", () => {
    const applied = { adaptation: { desktop: { logic: "v2", preload: true }, mobile: { logic: "v2" } } };
    expect(deepMerge(applied, { adaptation: { desktop: { logic: undefined }, mobile: { logic: undefined } } }))
      .toEqual({ adaptation: { desktop: { preload: true } } });
  });

  it("restores the source preset after clearing an applied source override", () => {
    const preset = { hls: "https://media.example.test/master.m3u8", title: "Preset title", options: { startOffset: -10 } };
    const applied = { title: "Edited title", options: { startOffset: -20, startOffsetTimelineReference: "end" } };
    const reset = deepMerge(applied, { title: undefined, options: { startOffset: undefined } });
    expect(deepMerge(preset, reset)).toEqual({
      hls: preset.hls, title: "Preset title", options: { startOffset: -10, startOffsetTimelineReference: "end" },
    });
  });

  it("replaces arrays and does not merge into prototype keys", () => {
    const patch = JSON.parse('{"subtitleTracks":[{"id":"new"}],"__proto__":{"polluted":true}}');
    const merged = deepMerge({ subtitleTracks: [{ id: "old" }] }, patch);
    expect(merged.subtitleTracks).toEqual([{ id: "new" }]);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });
});

describe("settings apply ownership", () => {
  it("shows structured SDK rejection messages and codes", () => {
    expect(applyErrorMessage({ code: 1201, message: "The source is invalid." })).toBe("1201: The source is invalid.");
    expect(applyErrorMessage(new Error("Load failed"))).toBe("Load failed");
  });
  it("reports success only while the submitted player and source are still current", async () => {
    const owner = {};
    let current = owner;
    let source = 1;
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    const outcome = settleApply(pending, () => current === owner && source === 1);
    source = 2;
    resolve();
    await expect(outcome).resolves.toBe("superseded");
    current = {};
    await expect(settleApply(Promise.resolve(), () => current === owner)).resolves.toBe("superseded");
    await expect(settleApply(Promise.resolve(), () => true)).resolves.toBe("applied");
  });

  it("preserves the current SDK error and retires an old owner's rejection", async () => {
    const error = new Error("Source load failed");
    await expect(settleApply(Promise.reject(error), () => true)).rejects.toBe(error);
    let reject!: (error: Error) => void;
    let current = true;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    const outcome = settleApply(pending, () => current);
    current = false;
    reject(error);
    await expect(outcome).resolves.toBe("superseded");
  });
});
