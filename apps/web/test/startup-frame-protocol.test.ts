import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runner = vi.hoisted(() => ({ preload: vi.fn(), run: vi.fn() }));
vi.mock("../src/startup/runner", async (original) => ({
  ...await original<typeof import("../src/startup/runner")>(), preloadEngine: runner.preload, runBrowserTrial: runner.run,
}));
import { TrialFrame } from "../src/startup/frame";
import { unavailableTrial } from "../src/startup/runner";

// Test only postMessage/document ownership. No iframe, browser or SDK is executed.
const frames: TrialFrame[] = [];
let surface: EventTarget;
let iframe: { title: string; allow: string; src: string; contentWindow: { postMessage: ReturnType<typeof vi.fn> }; remove: ReturnType<typeof vi.fn> };
const origin = "https://player-lab.invalid";
function message(data: unknown, source: unknown = iframe.contentWindow, from = origin) {
  const event = new Event("message");
  Object.defineProperties(event, { data: { value: data }, source: { value: source }, origin: { value: from } });
  surface.dispatchEvent(event);
}
function fixture() {
  const stage = { replaceChildren: vi.fn() };
  const frame = new TrialFrame("hls", "on-demand", stage as unknown as HTMLElement);
  frames.push(frame);
  const channel = new URL(iframe.src).searchParams.get("channel")!;
  return { frame, channel, stage, packet: (type: string, fields: Record<string, unknown> = {}) => ({ type, channel, ...fields }) };
}
async function ready(f: ReturnType<typeof fixture>) {
  const pending = f.frame.ready(); message(f.packet("ready")); await pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  surface = new EventTarget();
  Object.assign(surface, { setTimeout, clearTimeout });
  iframe = { title: "", allow: "", src: "", contentWindow: { postMessage: vi.fn() }, remove: vi.fn() };
  vi.stubGlobal("window", surface); vi.stubGlobal("location", new URL(`${origin}/comparison.html`));
  vi.stubGlobal("document", { createElement: vi.fn(() => iframe) });
});
afterEach(() => {
  frames.splice(0).forEach((frame) => frame.close());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("comparison document message ownership", () => {
  it("creates a single visible document with its own channel and selected SDK mode", () => {
    const f = fixture(); const url = new URL(iframe.src);
    expect(url.pathname).toBe("/comparison-runner.html");
    expect(url.searchParams.get("engine")).toBe("hls"); expect(url.searchParams.get("mode")).toBe("on-demand");
    expect(f.channel).toMatch(/^[\da-f-]{36}$/i);
    expect(f.stage.replaceChildren).toHaveBeenCalledExactlyOnceWith(iframe);
    expect(iframe).toMatchObject({ allow: "autoplay", title: "Player Lab comparison video" });
  });

  it("requires the owned source, exact origin and channel before accepting ready", async () => {
    const f = fixture(); let settled = false;
    const pending = f.frame.ready().then(() => { settled = true; });
    message(f.packet("ready"), {}); message(f.packet("ready"), iframe.contentWindow, "https://other.invalid");
    message({ type: "ready", channel: "old-channel" }); message(null); message("ready");
    await Promise.resolve(); expect(settled).toBe(false);
    message(f.packet("ready")); await pending;
    expect(settled).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the explicit start contract and ignores stale or duplicate result packets", async () => {
    const f = fixture(); await ready(f);
    const controller = new AbortController();
    const pending = f.frame.start("bbb-360p", "startup", { hlsWorker: false }, controller.signal, 123);
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith(
      f.packet("start", { contentId: "bbb-360p", profile: "startup", tuning: { hlsWorker: false }, selectedAt: 123 }), origin);
    let settled = false; void pending.then(() => { settled = true; });
    const result = unavailableTrial("deadline");
    message({ type: "result", channel: "stale", result });
    message(f.packet("result", { result }), {});
    message(f.packet("result", { result }), iframe.contentWindow, "https://other.invalid");
    message(f.packet("ready")); await Promise.resolve(); expect(settled).toBe(false);
    message(f.packet("result", { result }));
    message(f.packet("result", { result: unavailableTrial("unsupported") }));
    expect(await pending).toBe(result); expect(vi.getTimerCount()).toBe(0);
    controller.abort(); expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(1);
  });

  it("allows only one start for each document", async () => {
    const f = fixture(); await ready(f); const controller = new AbortController();
    const pending = f.frame.start("bbb-180p", "default", {}, controller.signal, 0);
    await expect(f.frame.start("bbb-360p", "default", {}, controller.signal, 0)).rejects.toThrow("aborted");
    message(f.packet("result", { result: unavailableTrial("deadline") })); await pending;
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send start for a preaborted request", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.frame.start("bbb-360p", "default", {}, controller.signal, 0)).rejects.toThrow("aborted");
    expect(iframe.contentWindow.postMessage).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("sends cancellation only to the owned document and awaits its terminal result", async () => {
    const f = fixture(); await ready(f); const controller = new AbortController();
    const pending = f.frame.start("bbb-360p", "default", {}, controller.signal, 0);
    controller.abort(); controller.abort();
    expect(iframe.contentWindow.postMessage).toHaveBeenLastCalledWith(f.packet("cancel"), origin);
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(2);
    const result = unavailableTrial("aborted"); message(f.packet("result", { result }));
    expect(await pending).toBe(result);
  });

  it("rejects an explicit prepare failure from the owned document", async () => {
    const f = fixture(); const pending = expect(f.frame.ready()).rejects.toThrow("prepare-failed");
    message(f.packet("prepare-failed")); await pending; expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds document readiness and removes its pending listener on timeout", async () => {
    const f = fixture(); const pending = expect(f.frame.ready()).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(30_000); await pending;
    message(f.packet("ready")); expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a started document that never returns a result", async () => {
    const f = fixture(); await ready(f); const controller = new AbortController();
    const pending = expect(f.frame.start("bbb-360p", "default", {}, controller.signal, 0)).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(40_000); await pending;
    controller.abort(); expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a missing result payload instead of converting it to playback success", async () => {
    const f = fixture(); await ready(f);
    const pending = expect(f.frame.start("bbb-360p", "default", {}, new AbortController().signal, 0)).rejects.toThrow("invalid-result");
    message(f.packet("result", { result: null })); await pending;
  });

  it.each(["ready", "result"] as const)("closes a pending %s exactly once and ignores later messages", async (phase) => {
    const f = fixture();
    if (phase === "result") await ready(f);
    const operation = phase === "ready" ? f.frame.ready()
      : f.frame.start("bbb-360p", "default", {}, new AbortController().signal, 0);
    const pending = expect(operation).rejects.toThrow("closed");
    f.frame.close(); f.frame.close(); await pending;
    message(f.packet(phase, { result: unavailableTrial("aborted") }));
    expect(iframe.remove).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    await expect(f.frame.ready()).rejects.toThrow("closed");
    await expect(f.frame.start("bbb-360p", "default", {}, new AbortController().signal, 0)).rejects.toThrow("aborted");
  });
});


const channel = "a250d434-55e8-43ca-93a7-534d295f515c";
async function flushMessages() { await Promise.resolve(); await Promise.resolve(); }
async function bootPage(mode = "on-demand", engine = "shaka", token = channel) {
  const parentClock = { timeOrigin: 100_000, now: () => 100 };
  const owner = { performance: parentClock, postMessage: vi.fn() };
  const video = { muted: false, playbackRate: 2 };
  const container = {};
  vi.stubGlobal("parent", owner);
  vi.stubGlobal("location", new URL(`${origin}/comparison-runner.html?channel=${token}&engine=${engine}&mode=${mode}`));
  vi.stubGlobal("performance", { timeOrigin: 100_000 - 0.10009765625, now: () => 100,
    setResourceTimingBufferSize: vi.fn() });
  vi.stubGlobal("document", { querySelector: vi.fn(() => video), getElementById: vi.fn(() => container) });
  vi.resetModules();
  await import("../src/startup/runner-page");
  await flushMessages();
  return { owner, video, container, parentClock,
    start: { type: "start", channel, contentId: "bbb-360p", profile: "default", tuning: {}, selectedAt: 100_100 } };
}

describe("trial document accepts only its owning parent", () => {
  beforeEach(() => {
    runner.preload.mockReset(); runner.run.mockReset();
    runner.run.mockResolvedValue(unavailableTrial("aborted"));
  });

  it("announces readiness to the exact origin and uses the public source and supplied parent clock", async () => {
    const f = await bootPage();
    expect(f.video).toEqual({ muted: true, playbackRate: 1 });
    expect(f.owner.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "ready", channel }, origin);
    message(f.start, f.owner); await flushMessages();
    expect(runner.preload).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ engine: "shaka", video: f.video,
      container: f.container, url: `${origin}/media/vod-baseline/comparison-360p.m3u8`, profile: "default",
      selectedAt: 100_100, tuning: {}, clock: f.parentClock }));
    expect(f.owner.postMessage).toHaveBeenLastCalledWith({ type: "result", channel, result: unavailableTrial("aborted") }, origin);
  });

  it("rejects wrong source, origin, channel and malformed start fields before allowing one valid start", async () => {
    const f = await bootPage();
    message(f.start, {}); message(f.start, f.owner, "https://other.invalid");
    message({ ...f.start, channel: "stale" }, f.owner); message(null, f.owner); message("start", f.owner);
    const invalid = [
      { contentId: "other" }, { profile: "other" }, { tuning: null }, { tuning: [] }, { tuning: { unknown: true } },
      { tuning: { hlsWorker: 1 } }, { tuning: { shakaPrefetchLimit: 3 } }, { tuning: { webXLoadControl: "1" } },
      { selectedAt: "100100" }, { selectedAt: NaN }, { selectedAt: Infinity },
      { selectedAt: 1 }, { selectedAt: 200_000 },
    ];
    for (const fields of invalid) message({ ...f.start, ...fields }, f.owner);
    await flushMessages(); expect(runner.run).not.toHaveBeenCalled();
    message({ ...f.start, contentId: "bbb-180p", profile: "startup",
      tuning: { hlsWorker: false, shakaPrefetchLimit: 0, webXLoadControl: 2 } }, f.owner);
    expect(runner.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      url: `${origin}/media/vod-baseline/comparison-180p.m3u8`, profile: "startup",
      tuning: { hlsWorker: false, shakaPrefetchLimit: 0, webXLoadControl: 2 } }));
  });

  it("never starts twice in the same document, including while the first result is pending", async () => {
    let resolve!: (value: ReturnType<typeof unavailableTrial>) => void;
    runner.run.mockImplementation(() => new Promise((yes) => { resolve = yes; }));
    const f = await bootPage();
    message(f.start, f.owner); message(f.start, f.owner); message({ ...f.start, contentId: "bbb-180p" }, f.owner);
    expect(runner.run).toHaveBeenCalledTimes(1);
    resolve(unavailableTrial("deadline")); await flushMessages(); message(f.start, f.owner);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(f.owner.postMessage.mock.calls.filter(([data]) => data.type === "result")).toHaveLength(1);
  });

  it("aborts an active trial only for its owner and channel", async () => {
    const f = await bootPage(); message(f.start, f.owner);
    const signal = runner.run.mock.calls[0]![0].signal as AbortSignal;
    message({ type: "cancel", channel }, {});
    message({ type: "cancel", channel }, f.owner, "https://other.invalid");
    message({ type: "cancel", channel: "stale" }, f.owner);
    expect(signal.aborted).toBe(false);
    message({ type: "cancel", channel }, f.owner); expect(signal.aborted).toBe(true);
  });

  it("aborts its active trial when the document receives pagehide", async () => {
    const f = await bootPage(); message(f.start, f.owner);
    const signal = runner.run.mock.calls[0]![0].signal as AbortSignal;
    expect(signal.aborted).toBe(false); surface.dispatchEvent(new Event("pagehide"));
    expect(signal.aborted).toBe(true);
  });

  it("awaits preload on the same parent clock before ready and passes its exact bounds to the trial", async () => {
    let resolve!: (value: { start: number; end: number }) => void;
    runner.preload.mockImplementation(() => new Promise((yes) => { resolve = yes; }));
    const f = await bootPage("preloaded");
    expect(runner.preload).toHaveBeenCalledExactlyOnceWith("shaka", f.parentClock);
    expect(f.owner.postMessage).not.toHaveBeenCalled();
    message(f.start, f.owner); expect(runner.run).not.toHaveBeenCalled();
    const preloaded = { start: 100_050, end: 100_080 }; resolve(preloaded); await flushMessages();
    expect(f.owner.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "ready", channel }, origin);
    message(f.start, f.owner);
    expect(runner.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clock: f.parentClock, preloaded }));
  });

  it("reports preload failure without leaking its error or announcing ready", async () => {
    runner.preload.mockRejectedValue(new Error("private SDK import detail"));
    const f = await bootPage("preloaded"); await flushMessages();
    expect(f.owner.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "prepare-failed", channel }, origin);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it.each([
    ["on-demand", "other", channel], ["other", "shaka", channel], ["on-demand", "shaka", "invalid-channel"],
  ])("does not boot an invalid document contract (%s, %s)", async (mode, engine, token) => {
    const f = await bootPage(mode, engine, token);
    expect(f.owner.postMessage).not.toHaveBeenCalled();
    expect(runner.preload).not.toHaveBeenCalled(); expect(runner.run).not.toHaveBeenCalled();
  });
});
