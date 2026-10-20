import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { PlayerEvent } from "bitmovin-player/modules/bitmovinplayer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  players: [] as Array<{ config: object; load: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; listeners: Map<string, Set<() => void>> }>,
  videos: [] as Array<{ deinitialize: ReturnType<typeof vi.fn> }>,
  initialization: null as Promise<void> | null,
  destruction: null as Promise<void> | null,
}));
vi.mock("react-native", () => ({
  Button: "Button", ScrollView: "ScrollView", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: <T,>(styles: T) => styles },
  NativeModules: {},
  Platform: { OS: "android", Version: 36 },
}));
// The Vega core installs browser shims when imported. Mock that native boundary, while
// retaining the real application controller/session and the SDK's declared event names.
vi.mock("bitmovin-player/modules/bitmovinplayer-core", () => ({
  PlayerEvent: { TimeChanged: "timechanged", SourceLoaded: "sourceloaded", TimeShifted: "timeshifted", DurationChanged: "durationchanged", DVRWindowExceeded: "dvrwindowexceeded" },
  TimelineReferencePoint: { Start: "start", End: "end" },
}));
vi.mock("@amazon-devices/react-native-w3cmedia", () => ({
  KeplerVideoSurfaceView: "KeplerVideoSurfaceView",
  VideoPlayer: class {
    constructor() { runtime.videos.push(this); }
    initialize = vi.fn(() => { const gate = runtime.initialization; runtime.initialization = null; return gate ?? Promise.resolve(); });
    deinitialize = vi.fn(async () => {});
    setSurfaceHandle = vi.fn();
    clearSurfaceHandle = vi.fn();
  },
}));
vi.mock("../src/vegaPlayer", () => ({
  createVegaPlayer: (config: object) => {
    const listeners = new Map<string, Set<() => void>>();
    const player = {
      config, listeners, load: vi.fn(async () => {}),
      destroy: vi.fn(() => { const gate = runtime.destruction; runtime.destruction = null; return gate ?? Promise.resolve(); }),
      on: (event: string, callback: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); },
      off: (event: string, callback: () => void) => listeners.get(event)?.delete(callback),
      isLive: () => true, getDuration: () => Infinity, getMaxTimeShift: () => -900, getTimeShift: () => 0, getCurrentTime: () => 0,
      timeShift: vi.fn(),
    };
    runtime.players.push(player);
    return player;
  },
}));

import { App } from "../src/App";

let screen: ReactTestRenderer;
let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
function element(type: string, props: Record<string, unknown> = {}): ReactTestInstance {
  return screen.root.findAll((node) => String(node.type) === type && Object.entries(props).every(([key, value]) => node.props[key] === value))[0]!;
}
const current = () => runtime.players[runtime.players.length - 1]!;
const button = (title: string) => element("Button", { title });
const input = (label: string) => element("TextInput", { accessibilityLabel: label });
async function press(title: string) { await act(async () => button(title).props.onPress()); }
async function text(label: string, value: string) { await act(async () => input(label).props.onChangeText(value)); }
async function mount() {
  await act(async () => { screen = create(<App />); });
  await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("surface"));
}
beforeEach(() => {
  runtime.players.length = 0;
  runtime.videos.length = 0;
  runtime.initialization = null;
  runtime.destruction = null;
  errors = vi.spyOn(console, "error");
  warnings = vi.spyOn(console, "warn");
});
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  const unexpectedErrors = [...errors.mock.calls];
  const unexpectedWarnings = [...warnings.mock.calls];
  errors.mockRestore();
  warnings.mockRestore();
  expect(unexpectedErrors).toEqual([]);
  expect(unexpectedWarnings).toEqual([]);
});

describe("Vega configuration in the mounted App and media session", () => {
  it("uses a local URL parser when the legacy native URL getters are unavailable", async () => {
    class LegacyURL {
      get protocol(): string { throw new Error("URL.protocol is not implemented"); }
      get hostname(): string { throw new Error("URL.hostname is not implemented"); }
    }
    vi.stubGlobal("URL", LegacyURL);
    try {
      await mount();
      await press("Show configuration");
      await text("Source URL", "HTTPS://example.com/movie.m3u8");
      await press("HLS");
      await press("Apply and recreate player");
      expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ hls: "HTTPS://example.com/movie.m3u8" }));
      expect(globalThis.URL).toBe(LegacyURL);
    } finally { vi.unstubAllGlobals(); }
  });
  it("isolates drafts and maps validated source/player fields through the real session path", async () => {
    await mount();
    expect(runtime.players).toHaveLength(1);
    await press("Show configuration");
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    await text("Source URL", "https://example.com/custom.m3u8");
    await press("HLS");
    await text("Source title", "Custom source");
    await text("Poster URL", "https://example.com/poster.jpg");
    await text("Start offset (seconds)", "-30");
    await press("End");
    await text("Video forward buffer (seconds)", "20");
    await text("Audio forward buffer (seconds)", "25");
    await text("Maximum video bitrate (bits per second)", "3500000");
    await act(async () => element("Switch", { accessibilityLabel: "Autoplay" }).props.onValueChange(false));
    await act(async () => element("Switch", { accessibilityLabel: "Mute on startup" }).props.onValueChange(false));
    expect(runtime.players).toHaveLength(1);
    const old = current();
    await press("Apply and recreate player");
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.players).toHaveLength(2);
    expect(current().config).toMatchObject({
      ui: false, playback: { autoplay: false, muted: false },
      buffer: { video: { forwardduration: 20 }, audio: { forwardduration: 25 } },
      adaptation: { bitrates: { maxSelectableVideoBitrate: 3500000 } },
    });
    expect(current().load).toHaveBeenCalledWith({ hls: "https://example.com/custom.m3u8", title: "Custom source", poster: "https://example.com/poster.jpg",
      options: { startOffset: -30, startOffsetTimelineReference: "end" } });
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    expect(runtime.videos[0]!.deinitialize).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Source URL", "file:///movie.mpd"], ["Poster URL", "invalid"], ["Start offset (seconds)", "NaN"],
    ["Source URL", "https:example.com/movie.mpd"], ["Source URL", "https://example.com/a b.mpd"],
    ["Video forward buffer (seconds)", "-1"], ["Audio forward buffer (seconds)", "Infinity"],
    ["Maximum video bitrate (bits per second)", "0"],
  ])("rejects invalid %s input %s without replacing resources", async (label, value) => {
    await mount();
    await press("Show configuration");
    await text(label, value);
    await press("Apply and recreate player");
    expect(element("Text", { accessibilityRole: "alert" })).toBeDefined();
    expect(runtime.players).toHaveLength(1);
    expect(current().load).toHaveBeenCalledTimes(1);
    await press("Reset draft");
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    expect(runtime.players).toHaveLength(1);
  });

  it("keeps selected presets, logs and DVR permission, and removes optional settings when cleared", async () => {
    await mount();
    await act(async () => {
      element("Switch", { accessibilityLabel: "Allow DVR" }).props.onValueChange(false);
      for (const callback of current().listeners.get(PlayerEvent.SourceLoaded) ?? []) callback();
    });
    await press("VOD HLS");
    const selected = current().load.mock.calls[0]![0];
    await press("Show configuration");
    await text("Video forward buffer (seconds)", "10");
    await text("Maximum video bitrate (bits per second)", "2000000");
    await press("Apply and recreate player");
    expect(current().load).toHaveBeenCalledWith(selected);
    expect(element("Switch", { accessibilityLabel: "Allow DVR" }).props.value).toBe(false);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "SourceLoaded")).toHaveLength(1);
    await text("Video forward buffer (seconds)", "");
    await text("Maximum video bitrate (bits per second)", "");
    await press("Apply and recreate player");
    expect(current().config).not.toHaveProperty("buffer");
    expect(current().config).not.toHaveProperty("adaptation");
    const count = runtime.players.length;
    await text("Source URL", ` ${selected.hls} `);
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(count);
  });

  it("serializes rapid Apply operations behind old media cleanup and ignores retired callbacks", async () => {
    await mount();
    const old = current();
    const retiredCallback = [...old.listeners.get(PlayerEvent.SourceLoaded)!][0]!;
    let release!: () => void;
    runtime.destruction = new Promise<void>((resolve) => { release = resolve; });
    await press("Show configuration");
    await text("Source URL", "https://example.com/intermediate.mpd");
    await press("Apply and recreate player");
    await text("Source URL", "https://example.com/latest.mpd");
    await press("Apply and recreate player");
    await act(async () => retiredCallback());
    expect(runtime.players).toHaveLength(1);
    expect(runtime.videos).toHaveLength(1);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "SourceLoaded")).toEqual([]);
    await act(async () => release());
    expect(runtime.players).toHaveLength(2);
    expect(current().load).toHaveBeenCalledWith(expect.objectContaining({ dash: "https://example.com/latest.mpd" }));
    expect(runtime.videos).toHaveLength(2);
    expect(old.destroy).toHaveBeenCalledTimes(1);
  });

  it("maps progressive sources and beginning-relative offsets without HLS/DASH leftovers", async () => {
    await mount();
    await press("Show configuration");
    await press("Progressive MP4");
    await text("Source URL", "https://example.com/movie.mp4");
    await text("Source title", "");
    await text("Poster URL", "");
    await text("Start offset (seconds)", "10.5");
    await press("Start");
    await press("Apply and recreate player");
    expect(current().load).toHaveBeenCalledWith({ progressive: "https://example.com/movie.mp4", options: { startOffset: 10.5, startOffsetTimelineReference: "start" } });
  });

  it("cancels a not-yet-initialized App session before creating the latest configuration", async () => {
    let initialized!: () => void;
    runtime.initialization = new Promise<void>((resolve) => { initialized = resolve; });
    await mount();
    expect(runtime.players).toHaveLength(0);
    await press("Show configuration");
    await text("Source URL", "https://example.com/latest.mpd");
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(0);
    await act(async () => initialized());
    expect(runtime.players).toHaveLength(1);
    expect(current().load).toHaveBeenCalledWith(expect.objectContaining({ dash: "https://example.com/latest.mpd" }));
    expect(runtime.videos[0]!.deinitialize).toHaveBeenCalledTimes(1);
  });
});
