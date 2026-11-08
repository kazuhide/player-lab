import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseCaseDriver, UseCaseSource } from "../src/startup/use-cases/contracts";

const sdk = vi.hoisted(() => {
  function gate() {
    let resolve!: () => void; let reject!: (reason: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  class Video extends EventTarget {
    paused = true;
    currentTime = 0;
    readyState = 2;
    videoWidth = 640;
    videoHeight = 360;
    buffered = { length: 0 };
    released = false;
    onPause = () => {};
    readonly frames = new Map<number, VideoFrameRequestCallback>();
    private nextFrame = 0;
    requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
      const id = ++this.nextFrame; this.frames.set(id, callback); return id;
    }
    cancelVideoFrameCallback(id: number) { this.frames.delete(id); }
    pause() { this.paused = true; this.onPause(); }
  }
  const state = { players: [] as Player[], holdLoad: false, pendingPreplay: true };
  class Player {
    static addModule() {}
    readonly loadGate = gate();
    readonly preplay = gate();
    video!: Video;
    plays = 0;
    destroyed = false;
    preplayPending = false;
    readonly events = new Map<string, (event: unknown) => void>();
    constructor() { state.players.push(this); }
    on(name: string, listener: (event: unknown) => void) { this.events.set(name, listener); }
    setVideoElement(video: Video) {
      this.video = video;
      video.onPause = () => {
        if (this.preplayPending) {
          this.preplayPending = false;
          this.preplay.reject(new DOMException("The pending play request was interrupted by pause.", "AbortError"));
        }
      };
    }
    getVideoElement() { return this.video; }
    getPlayerType() { return "html5"; }
    load() { return state.holdLoad ? this.loadGate.promise : Promise.resolve(); }
    play() {
      this.plays++; this.video.paused = false;
      if (state.pendingPreplay && this.plays === 1) { this.preplayPending = true; return this.preplay.promise; }
      return Promise.resolve();
    }
    pause() { this.video.pause(); }
    seek(seconds: number) { this.video.currentTime = seconds; return true; }
    preload() {}
    async destroy() { this.destroyed = true; this.video.pause(); this.loadGate.resolve(); this.preplay.resolve(); }
  }
  return { state, Player, Video };
});
vi.mock("bitmovin-player/modules/bitmovinplayer-core", () => ({
  Player: sdk.Player, PlayerEvent: { Error: "error" }, PlayerType: { Html5: "html5" },
  LogLevel: { OFF: "off" }, StreamType: { Hls: "hls", Dash: "dash" }, TimelineReferencePoint: { Start: "start" },
}));
vi.mock("bitmovin-player/modules/bitmovinplayer-engine-bitmovin", () => ({ default: { name: "EngineBitmovin", module: {} } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-mserenderer", () => ({ default: { name: "RendererMSE", module: {} } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-hls", () => ({ default: { name: "HLS", module: {} } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-dash", () => ({ default: { name: "DASH", module: {} } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-xml", () => ({ default: { name: "XML", module: {} } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-abr", () => ({ default: { name: "ABR", module: {} } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-container-mp4", () => ({ default: { name: "ContainerMP4", module: {} } }));
vi.mock("bitmovin-player/modules/bitmovinplayer-container-ts", () => ({ default: { name: "ContainerTS", module: {} } }));
vi.mock("../src/startup/use-cases/hls-v8-shared", async (original) => {
  const actual = await original<typeof import("../src/startup/use-cases/hls-v8-shared")>();
  return { ...actual,
    createStage: () => ({ remove() {} }),
    createOwnedVideo: () => ({ video: new sdk.Video(), mount: {} }),
    showOwnedVideo: () => {},
    releaseOwnedVideo: (video: InstanceType<typeof sdk.Video>) => { video.released = true; video.pause(); },
  };
});
import { createDriver } from "../src/startup/use-cases/bitmovin8";

const open: UseCaseDriver[] = [];
const source: UseCaseSource = { id: "source-1", url: "https://fixture.invalid/source-1.m3u8", format: "hls", startTimeSeconds: 0 };
async function drain() { for (let index = 0; index < 24; index++) await Promise.resolve(); }
async function begin() {
  const events: Array<{ name: string; sourceId: string }> = [];
  const driver = await createDriver({ container: {} as HTMLElement, licenseKey: "test-only-key", policy: "decoded",
    bufferSeconds: 12, signal: new AbortController().signal,
    event: (name, sourceId) => { events.push({ name, sourceId }); } });
  open.push(driver);
  const preparation = driver.prepare(source);
  const outcome = Promise.allSettled([preparation]);
  await drain();
  return { driver, outcome, events, player: sdk.state.players[0]! };
}

beforeEach(() => {
  sdk.state.players.length = 0; sdk.state.holdLoad = false; sdk.state.pendingPreplay = true;
  vi.stubGlobal("MediaSource", class {}); vi.stubGlobal("ManagedMediaSource", undefined);
  vi.stubGlobal("HTMLVideoElement", sdk.Video); vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((driver) => driver.dispose()));
  vi.unstubAllGlobals();
});

describe("Bitmovin v8 decoded preparation promotion", () => {
  it("keeps the selected source playable when promotion interrupts its pending background play", async () => {
    const f = await begin();
    expect(f.player.plays).toBe(1);
    expect(f.player.preplayPending).toBe(true);
    expect(f.player.video.frames.size).toBe(1);
    const observed: HTMLVideoElement[] = [];
    const video = await f.driver.activate(source.id, (owned) => { observed.push(owned); });
    expect((await f.outcome).map((row) => row.status)).toEqual(["fulfilled"]);
    expect(observed).toEqual([video]);
    expect(f.driver.state(source.id).video).toBe(video);
    expect(f.player.video).toMatchObject({ paused: false, released: false });
    expect(f.player.destroyed).toBe(false);
    expect(f.player.video.frames.size).toBe(0);
    expect(f.events.filter((event) => event.name === "error")).toEqual([]);
  });

  it("does not resume background preplay after promotion while metadata is still pending", async () => {
    sdk.state.holdLoad = true; sdk.state.pendingPreplay = false;
    const f = await begin();
    expect(f.player.plays).toBe(0);
    const active = f.driver.activate(source.id, () => {});
    f.player.loadGate.resolve();
    const video = await active; await f.outcome;
    expect(f.player.plays).toBe(1);
    expect(f.driver.state(source.id).video).toBe(video);
    expect(f.player.video).toMatchObject({ paused: false, released: false });
    expect(f.events.filter((event) => event.name === "error")).toEqual([]);
  });
});
